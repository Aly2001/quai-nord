"""
Entraîne le modèle de prédiction des perturbations (étape 6 de la mise à jour quotidienne).

Le modèle : une RÉGRESSION LOGISTIQUE, la meilleure de nos comparaisons (voir analyse_01.ipynb).
Il prédit le risque qu'un TER soit PERTURBÉ à une gare : en retard de 5 min ou plus, OU supprimé.
Ses variables : la ligne, l'heure, la position de l'arrêt dans le trajet, le jour de la semaine,
la pluie et les rafales.

Chaque nuit, le script :
  1. lit la table des retards (analyse.db), seulement les TER des Hauts-de-France constatés ;
  2. écarte les journées INCOMPLÈTES (collecte interrompue) et la journée en cours ;
  3. ÉVALUE honnêtement : apprend sur les jours anciens, teste sur les 4 derniers jours complets,
     et compare au « taux de la ligne » (la référence à battre) ;
  4. réentraîne sur TOUS les jours complets, et enregistre le modèle et son rapport dans modele/.

Le site ne l'utilise pas encore : il sera branché quand il battra nettement la référence,
avec plus de semaines de données. Ce script prépare ce moment.

Lancement : python entrainer_modele.py   (ou automatiquement par mettre_a_jour.py)
"""
import csv
import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

import joblib
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

BASE_ANALYSE = "analyse.db"
DOSSIER_MODELE = Path("modele")
CATEGORIES = ["ligne", "heure", "position", "jour_semaine"]
NOMBRES = ["pluie_mm", "rafales_kmh"]
TRANCHES = [0, 1, 2, 4, 7, 10, 14, 100]
NOMS_TRANCHES = ["1er", "2e", "3e-4e", "5e-7e", "8e-10e", "11e-14e", "15e et +"]
JOURS_TEST = 4             # les 4 derniers jours complets servent à l'évaluation
SEUIL_COMPLET = 0.6        # une journée est complète si elle a au moins 60 % des passages habituels
FREQUENCE_MIN = 200        # une ligne vue moins de 200 fois n'a pas son propre poids (trop peu fiable)


# ----------------------------------------------------------------------
# Les données
# ----------------------------------------------------------------------
def charger(base=None):
    """Les passages utiles : TER des Hauts-de-France, constatés, avec une heure prévue."""
    base = base or BASE_ANALYSE
    with sqlite3.connect(f"file:{base}?mode=ro", uri=True) as conn:
        return pd.read_sql("""
            SELECT date_service, ligne, heure_prevue, ordre_arret, pluie_mm, rafales_kmh, perturbe
            FROM retards
            WHERE hauts_de_france = 1 AND type_observation = 'CONSTATE' AND heure_prevue IS NOT NULL
              AND trip_id LIKE '%:TER:%'
        """, conn)


def preparer_variables(df):
    """Les variables du modèle, fabriquées comme dans le cahier d'analyse."""
    df = df.copy()
    df["date"] = pd.to_datetime(df["date_service"].astype(str), format="%Y%m%d")
    df["heure"] = pd.to_datetime(df["heure_prevue"]).dt.hour
    df["jour_semaine"] = df["date"].dt.dayofweek
    df["position"] = pd.cut(df["ordre_arret"] + 1, bins=TRANCHES, labels=NOMS_TRANCHES)   # numérotée à partir de 0
    return df


def jours_complets(df, aujourd_hui=None):
    """Les dates à garder : passées, et assez complètes (comparées aux autres jours du même type,
    semaine ou week-end). Une journée où la collecte s'est arrêtée serait DÉFORMÉE."""
    aujourd_hui = pd.Timestamp(aujourd_hui or datetime.now().date())
    par_jour = df[df["date"] < aujourd_hui].groupby("date").size()
    week_end = par_jour.index.dayofweek >= 5
    habituel = pd.Series(par_jour.where(~week_end).median(), index=par_jour.index)
    habituel[week_end] = par_jour[week_end].median()
    return sorted(par_jour[par_jour >= SEUIL_COMPLET * habituel].index)


def preparer(table):
    X = table[CATEGORIES + NOMBRES].copy()
    for c in CATEGORIES:
        X[c] = X[c].astype(str)
    return X


def construire_modele():
    return make_pipeline(
        ColumnTransformer([
            ("categories", OneHotEncoder(handle_unknown="infrequent_if_exist", min_frequency=FREQUENCE_MIN), CATEGORIES),
            ("nombres", make_pipeline(SimpleImputer(strategy="median"), StandardScaler()), NOMBRES),
        ]),
        LogisticRegression(C=1.0, max_iter=2000),
    )


# ----------------------------------------------------------------------
# L'évaluation honnête : apprendre sur le passé, tester sur des jours jamais vus
# ----------------------------------------------------------------------
def brier(probabilites, realite):
    return round(float(((probabilites - realite) ** 2).mean()), 4)


def evaluer(df, jours):
    """Apprend sur les jours anciens, teste sur les JOURS_TEST derniers. Renvoie les scores de Brier."""
    jours_test = jours[-JOURS_TEST:]
    apprentissage = df[df["date"].isin(jours[:-JOURS_TEST])]
    test = df[df["date"].isin(jours_test)]
    modele = construire_modele().fit(preparer(apprentissage), apprentissage["perturbe"])

    constante = apprentissage["perturbe"].mean()
    par_ligne = apprentissage.groupby("ligne")["perturbe"].agg(["sum", "count"])
    taux_ligne = (par_ligne["sum"] + 20 * constante) / (par_ligne["count"] + 20)      # lissé, comme la référence
    probabilites = modele.predict_proba(preparer(test))[:, 1]
    scores = {
        "constante": brier(constante, test["perturbe"]),
        "taux_de_la_ligne": brier(test["ligne"].map(taux_ligne).fillna(constante), test["perturbe"]),
        "modele": brier(probabilites, test["perturbe"]),
    }
    scores["gain_sur_la_ligne_pct"] = round(100 * (1 - scores["modele"] / scores["taux_de_la_ligne"]), 2)
    # La calibration, en résumé : le risque moyen ANNONCÉ, comparé à la part VRAIMENT perturbée
    calibration = {"annonce_pct": round(100 * float(probabilites.mean()), 1),
                   "reel_pct": round(100 * float(test["perturbe"].mean()), 1)}
    return scores, calibration, [d.strftime("%Y-%m-%d") for d in jours_test]


def ajouter_historique(chemin, ligne):
    """Une ligne par JOUR, sans jamais effacer les jours précédents : c'est sur cet historique qu'on décidera
    de brancher le modèle sur le site. Relancé plusieurs fois le même jour, le script remplace la ligne du jour."""
    lignes = []
    if chemin.exists():
        with open(chemin, newline="", encoding="utf-8") as fichier:
            lignes = [l for l in csv.DictReader(fichier) if l.get("date") != ligne["date"]]
    with open(chemin, "w", newline="", encoding="utf-8") as fichier:
        ecrivain = csv.DictWriter(fichier, fieldnames=list(ligne))
        ecrivain.writeheader()
        for ancienne in lignes:
            ecrivain.writerow({c: ancienne.get(c, "") for c in ligne})
        ecrivain.writerow(ligne)


# ----------------------------------------------------------------------
def main():
    if not Path(BASE_ANALYSE).exists():
        print(f"{BASE_ANALYSE} introuvable : lance d'abord construire_retards.py")
        return 1
    df = preparer_variables(charger())
    jours = jours_complets(df)
    print(f"1. {len(df)} passages, {len(jours)} journées complètes "
          f"({jours[0]:%d/%m} → {jours[-1]:%d/%m})" if jours else "1. Aucune journée complète.")
    if len(jours) < JOURS_TEST + 4:
        print("   Pas encore assez de journées complètes pour évaluer un modèle (il en faut au moins 8).")
        return 0
    df = df[df["date"].isin(jours)]

    scores, calibration, jours_test = evaluer(df, jours)
    print(f"2. Évaluation sur {', '.join(jours_test)} (jamais vus) :")
    for nom, valeur in scores.items():
        print(f"   {nom:<24} {valeur}")
    print(f"   risque moyen annoncé {calibration['annonce_pct']} %, réellement perturbés {calibration['reel_pct']} %")

    modele = construire_modele().fit(preparer(df), df["perturbe"])        # le modèle final : tous les jours
    DOSSIER_MODELE.mkdir(exist_ok=True)
    joblib.dump(modele, DOSSIER_MODELE / "modele_perturbations.joblib")
    rapport = {
        "genere_le": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "modele": "régression logistique",
        "cible": "perturbé (retard de 5 min ou plus, ou supprimé)",
        "variables": CATEGORIES + NOMBRES,
        "journees": len(jours), "premiere": f"{jours[0]:%Y-%m-%d}", "derniere": f"{jours[-1]:%Y-%m-%d}",
        "passages": int(len(df)), "jours_test": jours_test, "scores_brier": scores, "calibration": calibration,
    }
    (DOSSIER_MODELE / "rapport_modele.json").write_text(json.dumps(rapport, ensure_ascii=False, indent=2), encoding="utf-8")
    ajouter_historique(DOSSIER_MODELE / "historique.csv", {
        "date": datetime.now().strftime("%Y-%m-%d"),
        "examen": f"{jours_test[0][8:10]}/{jours_test[0][5:7]}-{jours_test[-1][8:10]}/{jours_test[-1][5:7]}",
        "journees": len(jours), "constante": scores["constante"], "ligne": scores["taux_de_la_ligne"],
        "modele": scores["modele"], "gain_pct": scores["gain_sur_la_ligne_pct"],
        "annonce_pct": calibration["annonce_pct"], "reel_pct": calibration["reel_pct"],
    })
    print(f"3. Modèle enregistré dans {DOSSIER_MODELE}/ (gain sur la référence : {scores['gain_sur_la_ligne_pct']} %)")
    print(f"   Historique : column -s, -t < {DOSSIER_MODELE}/historique.csv")
    return 0


if __name__ == "__main__":
    sys.exit(main())
