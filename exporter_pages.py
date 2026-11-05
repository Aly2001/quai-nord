"""
Les chiffres des pages ANALYSES et PRÉDICTION (étape de la mise à jour de la nuit, après entrainer_modele.py).

Lecture seule de analyse.db, modele/historique.csv et resultats/ ; écrit un seul fichier : site/public/donnees/pages.json.
Tout vient des retards réellement CONSTATÉS sur les TER des Hauts-de-France, sur les journées COMPLÈTES
(les mêmes que le modèle : une journée où la collecte s'est arrêtée serait déformée).

    python exporter_pages.py
"""
import csv
import json
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

import entrainer_modele as em

RACINE = Path(__file__).resolve().parent
SORTIE = RACINE / "site" / "public" / "donnees" / "pages.json"
ESSAI = RACINE / "resultats" / "essai_etat_ligne.json"     # dans Git (le dossier modele/ ne l'est pas)
HISTORIQUE = RACINE / "modele" / "historique.csv"
AVANCE = pd.Timedelta(minutes=30)          # comme l'essai : ce qu'on savait 30 min avant le départ du train
CONNU_APRES = pd.Timedelta(minutes=5)
CALME, AGITE, VUS_MIN = 0.10, 0.30, 5      # « la ligne allait bien » / « avait déjà des problèmes »
TRANCHES = [(1, 1, "1re gare"), (2, 4, "2e à 4e"), (5, 8, "5e à 8e"), (9, 13, "9e à 13e"), (14, 999, "14e et +")]
HEURES = [(5, 6, "5 h - 7 h"), (7, 8, "7 h - 9 h"), (9, 15, "9 h - 16 h"), (16, 18, "16 h - 19 h"), (19, 23, "19 h et +")]
JOURS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."]


def charger(base):
    import sqlite3
    with sqlite3.connect(f"file:{base}?mode=ro", uri=True) as conn:
        return pd.read_sql("""
            SELECT date_service, trip_id, ligne, heure_prevue, ordre_arret, perturbe, supprime
            FROM retards
            WHERE hauts_de_france = 1 AND type_observation = 'CONSTATE' AND heure_prevue IS NOT NULL
              AND trip_id LIKE '%:TER:%'
        """, conn)


def taux(serie):
    return round(100 * float(serie.mean()), 1) if len(serie) else None


def etat_de_la_ligne(df):
    """Pour chaque passage : la part des passages de SA ligne déjà perturbés, ce jour-là, 30 min avant le départ
    de SON train (même règle que l'essai à blanc : jamais d'information venue de l'avenir)."""
    df = df.copy()
    df["moment"] = pd.to_datetime(df["heure_prevue"])
    df["question"] = df.groupby(["date", "trip_id"])["moment"].transform("min") - AVANCE
    faits = df[["date", "ligne", "moment", "perturbe"]].copy()
    faits["connu"] = faits["moment"] + CONNU_APRES
    faits = faits.sort_values("connu")
    groupe = faits.groupby(["date", "ligne"], sort=False)
    faits["vus"], faits["perturbes"] = groupe.cumcount() + 1, groupe["perturbe"].cumsum()
    questions = df[["date", "trip_id", "ligne", "question"]].drop_duplicates(["date", "trip_id", "ligne"]).sort_values("question")
    reponses = pd.merge_asof(questions, faits[["date", "ligne", "connu", "vus", "perturbes"]], left_on="question",
                             right_on="connu", by=["date", "ligne"], direction="backward")
    df = df.merge(reponses[["date", "trip_id", "ligne", "vus", "perturbes"]], on=["date", "trip_id", "ligne"], how="left")
    df["vus"] = df["vus"].fillna(0)
    df["part_matin"] = np.where(df["vus"] > 0, df["perturbes"] / df["vus"].clip(lower=1), np.nan)
    return df


def analyses(df):
    df = df.copy()
    df["rang"] = df["ordre_arret"] + 1
    df["h"] = pd.to_datetime(df["heure_prevue"]).dt.hour
    position = [{"tranche": nom, "taux": taux(d["perturbe"]), "passages": int(len(d))}
                for a, b, nom in TRANCHES if len(d := df[(df["rang"] >= a) & (df["rang"] <= b)])]
    heures = [{"tranche": nom, "taux": taux(d["perturbe"]), "passages": int(len(d))}
              for a, b, nom in HEURES if len(d := df[(df["h"] >= a) & (df["h"] <= b)])]
    par_jour = [{"date": f"{j:%Y-%m-%d}", "etiquette": f"{JOURS[j.dayofweek]} {j:%d/%m}", "taux": taux(d["perturbe"]),
                 "passages": int(len(d))} for j, d in df.groupby("date")]
    semaine = [{"jour": JOURS[n], "taux": taux(d["perturbe"]), "passages": int(len(d))}
               for n, d in df.groupby(df["date"].dt.dayofweek)]
    etat = etat_de_la_ligne(df)
    connus = etat[etat["vus"] >= VUS_MIN]
    calme, agite = connus[connus["part_matin"] < CALME], connus[connus["part_matin"] >= AGITE]
    return {
        "passages": int(len(df)), "taux_perturbe": taux(df["perturbe"]), "taux_supprime": taux(df["supprime"]),
        "par_position": position, "par_heure": heures, "par_jour": par_jour, "par_jour_semaine": semaine,
        "domino": {"calme": {"taux": taux(calme["perturbe"]), "passages": int(len(calme))},
                   "agite": {"taux": taux(agite["perturbe"]), "passages": int(len(agite))},
                   "seuils": {"calme": CALME, "agite": AGITE}},
    }


def modele():
    lignes = []
    if HISTORIQUE.exists():
        with open(HISTORIQUE, newline="", encoding="utf-8") as f:
            for l in csv.DictReader(f):
                lignes.append({"date": l["date"], "examen": l["examen"], "journees": int(l["journees"]),
                               "gain": float(l["gain_pct"]), "annonce": float(l["annonce_pct"]), "reel": float(l["reel_pct"])})
    essai = json.loads(ESSAI.read_text(encoding="utf-8")) if ESSAI.exists() else None
    return {"historique": lignes, "essai": essai, "conditions": {"gain_min": 3.0, "ecart_max": 2.0, "jours": 14}}


def main():
    base = RACINE / em.BASE_ANALYSE
    if not base.exists():
        print(f"{base} introuvable : lance d'abord construire_retards.py")
        return 1
    df = em.preparer_variables(charger(base))
    jours = em.jours_complets(df)
    df = df[df["date"].isin(jours)]
    if df.empty:
        print("Aucune journée complète : rien à exporter.")
        return 0
    contenu = {"genere_le": datetime.now().strftime("%Y-%m-%d %H:%M"), "journees": len(jours),
               "premiere": f"{jours[0]:%Y-%m-%d}", "derniere": f"{jours[-1]:%Y-%m-%d}",
               **analyses(df), "modele": modele()}
    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    SORTIE.write_text(json.dumps(contenu, ensure_ascii=False), encoding="utf-8")
    print(f"Pages : {contenu['journees']} journées, {contenu['passages']} passages -> {SORTIE.relative_to(RACINE)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
