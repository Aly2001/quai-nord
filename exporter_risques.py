"""
Calcul du risque de retard pour le site, avec LISSAGE.

Pour chaque train, on estime la probabilité d'avoir 5 minutes de retard ou plus,
à partir des retards constatés (analyse.db, table "retards").

Le problème des petits échantillons
-----------------------------------
Un train observé 46 fois sans aucun retard aurait un taux brut de 0 %, ce qui
laisse croire qu'il n'est jamais en retard. On n'a juste pas encore vu de retard.

Le lissage (moyenne bayésienne)
-------------------------------
On fait comme si chaque groupe avait déjà été observé K fois avec un taux « a priori »,
puis on ajoute ses vraies observations :

    risque lissé = (retards observés + K × taux a priori) / (passages observés + K)

Peu de passages -> le risque reste proche de l'a priori.
Beaucoup de passages -> le risque reflète vraiment le groupe.

Les « a priori » s'emboîtent, du plus général au plus précis :
    toute la France  ->  l'heure  ->  la ligne à cette heure  ->  le train

Résultat : site/public/horaires/risques.json (même format qu'avant).

À relancer après construire_retards.py (fait automatiquement par mettre_a_jour.py).
"""

import json
import sqlite3
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd

BASE_ANALYSE = "analyse.db"
SORTIE = Path("site/public/horaires/risques.json")
K = 20                 # poids de l'a priori, en « passages fictifs »
MIN_PAR_TRAIN = 5      # grâce au lissage, quelques passages suffisent
MIN_PAR_GROUPE = 10


def lisser(retards, passages, a_priori):
    return (retards + K * a_priori) / (passages + K)


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
    if df.empty:
        raise SystemExit("Aucun retard constaté : laisse tourner le collecteur un peu plus.")
    df["heure"] = pd.to_datetime(df["heure_prevue"]).dt.strftime("%H")

    # ---------- Niveau 0 : toute la France ----------
    taux_global = df["en_retard"].mean()

    # ---------- Niveau 1 : par heure (a priori = toute la France) ----------
    h = df.groupby("heure")["en_retard"].agg(["sum", "count"])
    h["taux"] = lisser(h["sum"], h["count"], taux_global)

    # ---------- Niveau 2 : par ligne et par heure (a priori = l'heure) ----------
    avec_ligne = df.dropna(subset=["ligne"])
    lh = avec_ligne.groupby(["ligne", "heure"])["en_retard"].agg(["sum", "count"])
    a_priori_lh = [h["taux"].get(heure, taux_global) for _, heure in lh.index]
    lh["taux"] = lisser(lh["sum"], lh["count"], pd.Series(a_priori_lh, index=lh.index))

    # ---------- Niveau 3 : par train (a priori = sa ligne à son heure habituelle) ----------
    trains = df.dropna(subset=["numero_train"])
    mode = lambda s: s.mode().iat[0] if not s.mode().empty else None
    t = trains.groupby("numero_train").agg(
        retards=("en_retard", "sum"),
        passages=("en_retard", "count"),
        ligne=("ligne", mode),
        heure=("heure", mode),
    )

    def a_priori_train(train):
        # L'a priori d'un train = sa ligne à son heure habituelle, calculée SANS ce train
        # (« leave-one-out ») : sinon le train se confirmerait lui-même.
        a_priori_heure = h["taux"].get(train["heure"], taux_global)
        cle = (train["ligne"], train["heure"])
        if train["ligne"] is None or cle not in lh.index:
            return a_priori_heure
        autres_retards = lh.at[cle, "sum"] - train["retards"]
        autres_passages = lh.at[cle, "count"] - train["passages"]
        return lisser(max(autres_retards, 0), max(autres_passages, 0), a_priori_heure)

    t["a_priori"] = t.apply(a_priori_train, axis=1)
    t["taux"] = lisser(t["retards"], t["passages"], t["a_priori"])

    # ---------- Export (même format qu'avant, plus le taux brut pour la transparence) ----------
    def entree(taux, n, retards):
        return {"taux": round(float(taux), 3), "n": int(n), "brut": round(float(retards) / n, 3)}

    resultat = {
        "genere_le": datetime.now(ZoneInfo("Europe/Paris")).strftime("%Y-%m-%d %H:%M"),
        "jours_observes": int(df["date_service"].nunique()),
        "passages": int(len(df)),
        "lissage": {"methode": "moyenne bayésienne", "k": K, "taux_global": round(float(taux_global), 3)},
        "par_train": {num: entree(r["taux"], r["passages"], r["retards"])
                      for num, r in t.iterrows() if r["passages"] >= MIN_PAR_TRAIN},
        "par_ligne_heure": {f"{ligne}|{heure}": entree(r["taux"], r["count"], r["sum"])
                            for (ligne, heure), r in lh.iterrows() if r["count"] >= MIN_PAR_GROUPE},
        "par_heure": {heure: entree(r["taux"], r["count"], r["sum"])
                      for heure, r in h.iterrows() if r["count"] >= MIN_PAR_GROUPE},
    }
    SORTIE.write_text(json.dumps(resultat, ensure_ascii=False), encoding="utf-8")

    print(f"Passages constatés utilisés : {len(df)} sur {resultat['jours_observes']} jour(s)")
    print(f"Taux moyen (toute la France) : {taux_global:.1%}")
    print(f"Trains avec un risque propre    : {len(resultat['par_train'])}")
    print(f"Couples ligne / heure           : {len(resultat['par_ligne_heure'])}")
    print(f"Heures de la journée            : {len(resultat['par_heure'])}")
    zeros = sum(1 for v in resultat["par_train"].values() if v["brut"] == 0)
    print(f"Trains à 0 % brut, désormais lissés : {zeros}")
    print(f"Fichier créé : {SORTIE}")


if __name__ == "__main__":
    main()
