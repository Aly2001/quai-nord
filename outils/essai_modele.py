"""Essai à blanc du modèle : quatre versions comparées sur les MÊMES nuits que modele/historique.csv.

LECTURE SEULE : ne modifie ni analyse.db, ni le modèle, ni l'historique, ni le site. Rien n'est écrit sur le disque.

  A     : le modèle actuel (il doit retrouver à peu près les chiffres de l'historique : c'est le contrôle) ;
  B     : + « l'état de la ligne depuis le matin » : la part des passages de la même ligne déjà perturbés,
          connus AU MOINS 30 min avant le départ du train (jamais d'information venue de l'avenir) ;
  C     : A avec le niveau RECALÉ sur les 3 derniers jours d'apprentissage (l'ordre des trains ne change pas) ;
  B + C : les deux.

Pour chaque nuit et chaque version : le gain sur le taux de la ligne, et l'écart entre le risque annoncé et
le risque réel. Les conditions pour brancher un modèle sur le site : gain ≥ 3 % ET écart < 2 points.

Lancement, sur la VM, depuis ~/quai-nord (compter 10 à 20 minutes) :
    source .venv/bin/activate && nice python outils/essai_modele.py
"""
import csv
import math
import sqlite3
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

RACINE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RACINE))
import entrainer_modele as em  # noqa: E402  (les mêmes réglages et la même évaluation que chaque nuit)

AVANCE = pd.Timedelta(minutes=30)   # le risque est annoncé au moins 30 min avant le départ du train
CONNU_APRES = pd.Timedelta(minutes=5)  # un passage est jugé (retard de 5 min ou non) 5 min après son heure prévue
JOURS_RECALAGE = 3
GAIN_MIN, ECART_MAX = 3.0, 2.0


def charger():
    with sqlite3.connect(f"file:{RACINE / em.BASE_ANALYSE}?mode=ro", uri=True) as conn:
        return pd.read_sql("""
            SELECT date_service, trip_id, ligne, heure_prevue, ordre_arret, pluie_mm, rafales_kmh, perturbe
            FROM retards
            WHERE hauts_de_france = 1 AND type_observation = 'CONSTATE' AND heure_prevue IS NOT NULL
              AND trip_id LIKE '%:TER:%'
        """, conn)


def etat_de_la_ligne(df):
    """Pour chaque passage : ce qu'on savait de SA ligne, ce jour-là, 30 min avant le départ de SON train.
    part_matin : la part des passages déjà jugés qui étaient perturbés (vide s'il n'y en a aucun) ;
    log_obs    : combien de passages étaient déjà jugés (log), pour que le modèle sache si la part est fiable."""
    df = df.copy()
    df["moment"] = pd.to_datetime(df["heure_prevue"])
    depart = df.groupby(["date", "trip_id"])["moment"].transform("min")
    df["question"] = depart - AVANCE

    faits = df[["date", "ligne", "moment", "perturbe"]].copy()
    faits["connu"] = faits["moment"] + CONNU_APRES
    faits = faits.sort_values("connu")
    groupe = faits.groupby(["date", "ligne"], sort=False)
    faits["vus"] = groupe.cumcount() + 1
    faits["perturbes"] = groupe["perturbe"].cumsum()

    questions = (df[["date", "trip_id", "ligne", "question"]].drop_duplicates(["date", "trip_id", "ligne"])
                 .sort_values("question"))
    reponses = pd.merge_asof(questions, faits[["date", "ligne", "connu", "vus", "perturbes"]],
                             left_on="question", right_on="connu", by=["date", "ligne"],
                             direction="backward", allow_exact_matches=True)
    df = df.merge(reponses[["date", "trip_id", "ligne", "vus", "perturbes"]], on=["date", "trip_id", "ligne"], how="left")
    df["vus"] = df["vus"].fillna(0)
    df["part_matin"] = np.where(df["vus"] > 0, df["perturbes"] / df["vus"].clip(lower=1), np.nan)
    df["log_obs"] = np.log1p(df["vus"])
    return df.drop(columns=["moment", "question", "perturbes"])


def modele(categories, nombres):
    return make_pipeline(
        ColumnTransformer([
            ("categories", OneHotEncoder(handle_unknown="infrequent_if_exist", min_frequency=em.FREQUENCE_MIN), categories),
            ("nombres", make_pipeline(SimpleImputer(strategy="median"), StandardScaler()), nombres),
        ]),
        LogisticRegression(C=1.0, max_iter=2000),
    )


def colonnes(table, categories, nombres):
    X = table[categories + nombres].copy()
    for c in categories:
        X[c] = X[c].astype(str)
    return X


def recaler(prob_test, prob_recents, reel_recents):
    """Décale le niveau (sur l'échelle des log-cotes) pour que le risque moyen des jours récents soit juste.
    Le même décalage pour tous les trains : leur ORDRE ne change pas."""
    def logit(p):
        p = np.clip(p, 1e-6, 1 - 1e-6)
        return np.log(p / (1 - p))
    l_recents, l_test = logit(prob_recents), logit(prob_test)
    bas, haut = -5.0, 5.0
    for _ in range(60):                                   # dichotomie : un seul nombre à trouver
        milieu = (bas + haut) / 2
        if (1 / (1 + np.exp(-(l_recents + milieu)))).mean() < reel_recents:
            bas = milieu
        else:
            haut = milieu
    return 1 / (1 + np.exp(-(l_test + (bas + haut) / 2)))


def une_nuit(df, nuit):
    jours = em.jours_complets(df, aujourd_hui=nuit)
    if len(jours) < em.JOURS_TEST + 4:
        return None
    jours_test, jours_appr = jours[-em.JOURS_TEST:], jours[:-em.JOURS_TEST]
    appr, test = df[df["date"].isin(jours_appr)], df[df["date"].isin(jours_test)]
    recents = appr[appr["date"].isin(jours_appr[-JOURS_RECALAGE:])]

    constante = appr["perturbe"].mean()
    par_ligne = appr.groupby("ligne")["perturbe"].agg(["sum", "count"])
    taux_ligne = (par_ligne["sum"] + 20 * constante) / (par_ligne["count"] + 20)
    reference = em.brier(test["ligne"].map(taux_ligne).fillna(constante), test["perturbe"])

    versions = {}
    for nom, (cats, nbs) in {"A": (em.CATEGORIES, em.NOMBRES),
                             "B": (em.CATEGORIES, em.NOMBRES + ["part_matin", "log_obs"])}.items():
        m = modele(cats, nbs).fit(colonnes(appr, cats, nbs), appr["perturbe"])
        p_test = m.predict_proba(colonnes(test, cats, nbs))[:, 1]
        p_recents = m.predict_proba(colonnes(recents, cats, nbs))[:, 1]
        versions[nom] = p_test
        versions[f"{nom}+C"] = recaler(p_test, p_recents, recents["perturbe"].mean())
    reel = 100 * test["perturbe"].mean()
    resultats = {}
    for nom, p in versions.items():
        nom = {"A+C": "C", "B+C": "B+C"}.get(nom, nom)
        resultats[nom] = {"gain": round(100 * (1 - em.brier(p, test["perturbe"]) / reference), 2),
                          "ecart": round(100 * float(np.mean(p)) - reel, 1)}
    return {"examen": f"{jours_test[0]:%d/%m}-{jours_test[-1]:%d/%m}", "journees": len(jours), "resultats": resultats}


def main():
    historique = RACINE / em.DOSSIER_MODELE / "historique.csv"
    if not historique.exists():
        print("modele/historique.csv introuvable : lance ce script depuis ~/quai-nord")
        return 1
    with open(historique, newline="", encoding="utf-8") as f:
        anciennes = list(csv.DictReader(f))
    print("1. Lecture des passages (lecture seule)…", flush=True)
    df = em.preparer_variables(charger())
    print(f"   {len(df)} passages. Calcul de l'état de la ligne depuis le matin…", flush=True)
    df = etat_de_la_ligne(df)
    sans = df["part_matin"].isna().mean()
    print(f"   {100 * sans:.0f} % des passages n'ont encore rien vu sur leur ligne (premiers trains du jour).")

    ordre = ["A", "B", "C", "B+C"]
    print("\n2. Les nuits rejouées (gain sur la ligne en %, écart annoncé − réel en points)\n")
    print(f"{'nuit':<11}{'examen':<13}{'hist.':>7}" + "".join(f"{v:>15}" for v in ordre))
    tenues = {v: 0 for v in ordre}
    for ancienne in anciennes:
        r = une_nuit(df, ancienne["date"])
        if r is None:
            continue
        cases = []
        for v in ordre:
            g, e = r["resultats"][v]["gain"], r["resultats"][v]["ecart"]
            ok = g >= GAIN_MIN and abs(e) < ECART_MAX
            tenues[v] += ok
            cases.append(f"{g:>6.2f} {e:>+5.1f}{'✓' if ok else ' '}")
        print(f"{ancienne['date']:<11}{r['examen']:<13}{float(ancienne['gain_pct']):>7.2f}" + "".join(f"{c:>15}" for c in cases),
              flush=True)

    print("\n   ✓ : les deux conditions tenues (gain ≥ 3 % et écart < 2 points)")
    print("   hist. : le gain noté cette nuit-là ; la colonne A doit en être proche (sinon, les données ont changé)\n")
    print("3. Nuits où les deux conditions sont tenues : " + ", ".join(f"{v} {n}" for v, n in tenues.items()))
    meilleure = max(ordre, key=lambda v: tenues[v])
    if tenues[meilleure] == 0:
        print("   Aucune version ne tient encore les deux conditions : on ne change rien.")
    else:
        print(f"   La version {meilleure} est la plus souvent au niveau : à confirmer sur les prochaines nuits.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
