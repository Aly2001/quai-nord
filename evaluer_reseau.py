"""
La note de chaque nuit du réseau de neurones (GRU), sur de VRAIES journées qu'il n'a jamais vues.

Le réseau est appris ailleurs (Colab, puis automatiquement chaque semaine) et ses poids sont déposés
dans le bucket. Ici, sans TensorFlow :
  1. on récupère le fichier de poids (reseau_gru.npz) ;
  2. on prend chaque journée complète APRÈS la dernière journée vue à l'apprentissage, pas encore notée ;
  3. on calcule le risque de chaque passage avec le réseau en numpy (reseau_numpy.py) ;
  4. sur la MÊME journée, on note aussi les deux régressions logistiques, apprises sur les jours d'avant ;
  5. on écrit une ligne par journée dans modele/historique_reseau.csv.

Les mêmes notes que le modèle de chaque nuit : score de Brier, gain sur le taux de la ligne,
risque moyen annoncé et part réellement perturbée.

Étape facultative de la mise à jour de la nuit : si elle échoue, la nuit continue.
Lancement : python evaluer_reseau.py
"""
import csv
import re
import sqlite3
import subprocess
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

import entrainer_modele as em
import reseau_numpy as rn
import sequences as sq

BASE_ANALYSE = "analyse.db"
POIDS = Path("modele/reseau_gru.npz")
POIDS_BUCKET = "gs://quai-nord-transfert-aly/modele/reseau_gru.npz"
HISTORIQUE = Path("modele/historique_reseau.csv")
COLONNES = ["nuit", "journee", "poids_jusqu_au", "passages", "brier_ligne",
            "gain_reseau_pct", "gain_etat_pct", "gain_logistique_pct",
            "annonce_reseau_pct", "annonce_etat_pct", "annonce_logistique_pct", "reel_pct"]


def recuperer_poids():
    """Copie le dernier fichier de poids du bucket. Renvoie la date de dépôt (pour les anciens fichiers
    qui ne disent pas quelle était leur dernière journée d'apprentissage), ou None."""
    POIDS.parent.mkdir(exist_ok=True)
    try:
        subprocess.run(["gsutil", "-q", "cp", POIDS_BUCKET, str(POIDS)], check=True, timeout=300)
        liste = subprocess.run(["gsutil", "ls", "-l", POIDS_BUCKET], check=True, timeout=120,
                               capture_output=True, text=True).stdout
        trouve = re.search(r"(\d{4}-\d{2}-\d{2})T", liste)
        return trouve.group(1) if trouve else None
    except Exception as erreur:
        print(f"   (bucket injoignable : {erreur} — on garde le fichier déjà présent s'il existe)")
        return None


def derniere_journee_vue(preparation, depose_le):
    """La dernière journée que le réseau a pu voir pendant son apprentissage."""
    if preparation.get("derniere_journee"):
        return pd.Timestamp(preparation["derniere_journee"])
    if depose_le:   # ancien fichier : au plus tard la veille de son dépôt
        return pd.Timestamp(depose_le) - pd.Timedelta(days=1)
    return None


def charger(base=BASE_ANALYSE):
    """Les mêmes passages que le modèle de chaque nuit, avec le retard et la suppression (pour les séquences)."""
    with sqlite3.connect(f"file:{base}?mode=ro", uri=True) as conn:
        df = pd.read_sql("""
            SELECT date_service, trip_id, ligne, heure_prevue, ordre_arret, retard_minutes, supprime,
                   pluie_mm, rafales_kmh, perturbe
            FROM retards
            WHERE hauts_de_france = 1 AND type_observation = 'CONSTATE' AND heure_prevue IS NOT NULL
              AND trip_id LIKE '%:TER:%'
        """, conn)
    return em.preparer_variables(df)


def deja_notees():
    if not HISTORIQUE.exists():
        return set()
    with open(HISTORIQUE, newline="", encoding="utf-8") as f:
        return {ligne["journee"] for ligne in csv.DictReader(f)}


def noter_journee(df, jour, poids, preparation):
    """Toutes les notes d'une journée. df : les journées complètes, état de la ligne déjà calculé."""
    test = df[df["date"] == jour].reset_index(drop=True)
    avant = df[df["date"] < jour]
    y = test["perturbe"].to_numpy(float)

    def brier(p):
        return float(((np.asarray(p, float) - y) ** 2).mean())

    # La référence : le taux de la ligne, sur les jours d'avant (même calcul que entrainer_modele.py)
    constante = avant["perturbe"].mean()
    par_ligne = avant.groupby("ligne")["perturbe"].agg(["sum", "count"])
    taux = (par_ligne["sum"] + 20 * constante) / (par_ligne["count"] + 20)
    reference = brier(test["ligne"].map(taux).fillna(constante))

    p_reseau = rn.predire(poids, sq.construire_sequences(test), rn.fiche(test, preparation))
    logistique = em.construire_modele().fit(em.preparer(avant), avant["perturbe"])
    p_logi = logistique.predict_proba(em.preparer(test))[:, 1]
    etat = em.construire_modele(em.NOMBRES_ETAT).fit(em.preparer(avant, em.NOMBRES_ETAT), avant["perturbe"])
    p_etat = etat.predict_proba(em.preparer(test, em.NOMBRES_ETAT))[:, 1]

    gain = lambda p: round(100 * (1 - brier(p) / reference), 2)
    pct = lambda p: round(100 * float(np.mean(p)), 1)
    return {
        "nuit": date.today().isoformat(), "journee": f"{jour:%Y-%m-%d}",
        "passages": len(test), "brier_ligne": round(reference, 4),
        "gain_reseau_pct": gain(p_reseau), "gain_etat_pct": gain(p_etat), "gain_logistique_pct": gain(p_logi),
        "annonce_reseau_pct": pct(p_reseau), "annonce_etat_pct": pct(p_etat), "annonce_logistique_pct": pct(p_logi),
        "reel_pct": pct(y),
    }


def ecrire(lignes):
    nouveau = not HISTORIQUE.exists()
    with open(HISTORIQUE, "a", newline="", encoding="utf-8") as f:
        ecrivain = csv.DictWriter(f, fieldnames=COLONNES)
        if nouveau:
            ecrivain.writeheader()
        ecrivain.writerows(lignes)


def main(aujourd_hui=None):
    print("1. Fichier de poids du réseau...")
    depose_le = recuperer_poids()
    if not POIDS.exists():
        print("   Aucun fichier de poids : rien à noter (lancer d'abord la section 10 du notebook).")
        return 0
    poids, preparation = rn.charger(POIDS)
    limite = derniere_journee_vue(preparation, depose_le)
    if limite is None:
        print("   On ne sait pas jusqu'à quel jour le réseau a appris : pas de note, pour rester honnête.")
        return 0
    print(f"   Réseau appris jusqu'au {limite:%d/%m} (fichier du {preparation.get('entraine_le') or depose_le}).")

    print("2. Journées à noter...")
    df = charger()
    jours = em.jours_complets(df, aujourd_hui=aujourd_hui)
    a_noter = [j for j in jours if j > limite and f"{j:%Y-%m-%d}" not in deja_notees()]
    if not a_noter:
        print("   Aucune nouvelle journée complète depuis l'apprentissage.")
        return 0
    df = em.etat_de_la_ligne(df[df["date"].isin(jours)].reset_index(drop=True))

    print("3. Les notes (gain sur le taux de la ligne ; risque annoncé / réel) :")
    lignes = []
    for jour in a_noter:
        ligne = {**noter_journee(df, jour, poids, preparation), "poids_jusqu_au": f"{limite:%Y-%m-%d}"}
        lignes.append(ligne)
        print(f"   {jour:%d/%m} · {ligne['passages']} passages · gain réseau {ligne['gain_reseau_pct']} %, "
              f"état de la ligne {ligne['gain_etat_pct']} %, logistique {ligne['gain_logistique_pct']} % · "
              f"annoncé {ligne['annonce_reseau_pct']} % / réel {ligne['reel_pct']} %")
    ecrire(lignes)
    print(f"4. {len(lignes)} journée(s) ajoutée(s) à {HISTORIQUE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
