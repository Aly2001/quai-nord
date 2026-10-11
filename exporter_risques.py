"""
Calcul du risque de retard OBSERVÉ, pour l'afficher sur le site.

À partir des retards constatés (analyse.db, table "retards"), le script calcule
la part de passages avec 5 minutes de retard ou plus :
  1. pour chaque train (numéro)            -> au moins 10 passages observés
  2. pour chaque ligne, heure par heure    -> au moins 30 passages observés
  3. pour chaque heure de la journée       -> au moins 30 passages observés

Le site utilise la mesure la plus précise disponible pour chaque train.
Résultat : site/public/horaires/risques.json

C'est une estimation à partir de l'historique, en attendant le modèle de
machine learning, qui remplacera ce fichier avec le même format.

À relancer après construire_retards.py :
    python construire_retards.py
    python exporter_risques.py
"""

import json
import sqlite3
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd

BASE_ANALYSE = "analyse.db"
SORTIE = Path("site/public/horaires/risques.json")
MIN_PAR_TRAIN = 10
MIN_PAR_GROUPE = 30


def en_dictionnaire(groupes, minimum):
    """Garde les groupes assez grands et les met au format JSON."""
    resultat = {}
    for cle, ligne in groupes.iterrows():
        if ligne["count"] >= minimum:
            resultat[cle] = {"taux": round(float(ligne["mean"]), 3), "n": int(ligne["count"])}
    return resultat


def main():
    if not Path(BASE_ANALYSE).exists():
        raise SystemExit("analyse.db introuvable : lance d'abord python construire_retards.py")
    if not SORTIE.parent.exists():
        raise SystemExit("Dossier site/public/horaires introuvable : lance d'abord python exporter_horaires.py")

    conn = sqlite3.connect(BASE_ANALYSE)
    df = pd.read_sql("""
        SELECT numero_train, ligne, heure_prevue, date_service, en_retard
        FROM retards
        WHERE type_observation = 'CONSTATE' AND heure_prevue IS NOT NULL
    """, conn)
    conn.close()
    df["heure"] = pd.to_datetime(df["heure_prevue"]).dt.hour

    # 1. Par train
    trains = df.dropna(subset=["numero_train"])
    par_train = en_dictionnaire(trains.groupby("numero_train")["en_retard"].agg(["mean", "count"]),
                                MIN_PAR_TRAIN)

    # 2. Par ligne et par heure  (clé : "K10|07")
    lignes = df.dropna(subset=["ligne"]).copy()
    lignes["cle"] = lignes["ligne"] + "|" + lignes["heure"].map(lambda h: f"{h:02d}")
    par_ligne_heure = en_dictionnaire(lignes.groupby("cle")["en_retard"].agg(["mean", "count"]),
                                      MIN_PAR_GROUPE)

    # 3. Par heure  (clé : "07")
    df["cle_heure"] = df["heure"].map(lambda h: f"{h:02d}")
    par_heure = en_dictionnaire(df.groupby("cle_heure")["en_retard"].agg(["mean", "count"]),
                                MIN_PAR_GROUPE)

    resultat = {
        "genere_le": datetime.now(ZoneInfo("Europe/Paris")).strftime("%Y-%m-%d %H:%M"),
        "jours_observes": int(df["date_service"].nunique()),
        "passages": int(len(df)),
        "par_train": par_train,
        "par_ligne_heure": par_ligne_heure,
        "par_heure": par_heure,
    }
    SORTIE.write_text(json.dumps(resultat, ensure_ascii=False), encoding="utf-8")

    print(f"Passages constatés utilisés : {len(df)} sur {resultat['jours_observes']} jour(s)")
    print(f"Trains avec un risque propre    : {len(par_train)}")
    print(f"Couples ligne / heure           : {len(par_ligne_heure)}")
    print(f"Heures de la journée            : {len(par_heure)}")
    print(f"Fichier créé : {SORTIE}")


if __name__ == "__main__":
    main()
