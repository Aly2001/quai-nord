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


FILTRE = ("type_observation = 'CONSTATE' AND heure_prevue IS NOT NULL "
          "AND supprime = 0")   # les suppressions seront traitées à part, avec le modèle


def lisser(retards, passages, a_priori):
    return (retards + K * a_priori) / (passages + K)


def la_plus_frequente(comptes):
    """Pour chaque train, la valeur la plus fréquente (en cas d'égalité : la plus petite,
    comme pandas .mode()). comptes : colonnes numero_train, valeur, n."""
    if comptes.empty:
        return pd.Series(dtype=object)
    tries = comptes.sort_values(["numero_train", "n", "valeur"], ascending=[True, False, True])
    return tries.drop_duplicates("numero_train").set_index("numero_train")["valeur"]


def main():
    if not Path(BASE_ANALYSE).exists():
        raise SystemExit("analyse.db introuvable : lance d'abord python construire_retards.py")
    if not SORTIE.parent.exists():
        raise SystemExit("Dossier site/public/horaires introuvable : lance d'abord python exporter_horaires.py")

    # Tous les comptages sont faits PAR SQLITE : avant, la table entière (des millions de
    # lignes) était chargée dans pandas, ce qui saturait la mémoire de la machine (1 Go) et
    # prenait plus de 2 heures. Les résultats sont exactement les mêmes.
    conn = sqlite3.connect(f"file:{BASE_ANALYSE}?mode=ro", uri=True)
    conn.execute(f"""
        CREATE TEMP VIEW constates AS
        SELECT numero_train, ligne, gare, date_service, en_retard,
               substr(heure_prevue, 12, 2) AS heure
        FROM retards
        WHERE {FILTRE}
    """)
    lire = lambda requete: pd.read_sql(requete, conn)

    total, retards_total, jours = conn.execute(
        "SELECT COUNT(*), SUM(en_retard), COUNT(DISTINCT date_service) FROM constates").fetchone()
    if not total:
        conn.close()
        raise SystemExit("Aucun retard constaté : laisse tourner le collecteur un peu plus.")

    # ---------- Niveau 0 : toute la France ----------
    taux_global = retards_total / total

    # ---------- Niveau 1 : par heure (a priori = toute la France) ----------
    h = lire('SELECT heure, SUM(en_retard) AS "sum", COUNT(*) AS "count" FROM constates '
             'GROUP BY heure').set_index("heure")
    h["taux"] = lisser(h["sum"], h["count"], taux_global)

    # ---------- Niveau 2 : par ligne et par heure (a priori = l'heure) ----------
    lh = lire('SELECT ligne, heure, SUM(en_retard) AS "sum", COUNT(*) AS "count" FROM constates '
              'WHERE ligne IS NOT NULL GROUP BY ligne, heure').set_index(["ligne", "heure"])
    a_priori_lh = [h["taux"].get(heure, taux_global) for _, heure in lh.index]
    lh["taux"] = lisser(lh["sum"], lh["count"], pd.Series(a_priori_lh, index=lh.index))

    # ---------- Niveau 3 : par train (a priori = sa ligne à son heure habituelle) ----------
    t = lire('SELECT numero_train, SUM(en_retard) AS retards, COUNT(*) AS passages FROM constates '
             'WHERE numero_train IS NOT NULL GROUP BY numero_train').set_index("numero_train")
    t["ligne"] = la_plus_frequente(lire(
        'SELECT numero_train, ligne AS valeur, COUNT(*) AS n FROM constates '
        'WHERE numero_train IS NOT NULL AND ligne IS NOT NULL GROUP BY numero_train, ligne'))
    t["heure"] = la_plus_frequente(lire(
        'SELECT numero_train, heure AS valeur, COUNT(*) AS n FROM constates '
        'WHERE numero_train IS NOT NULL AND heure IS NOT NULL GROUP BY numero_train, heure'))
    for colonne in ("ligne", "heure"):
        t[colonne] = t[colonne].astype(object).where(t[colonne].notna(), None)

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

    t["a_priori"] = t.apply(a_priori_train, axis=1) if len(t) else []
    t["taux"] = lisser(t["retards"], t["passages"], t["a_priori"])

    # ---------- Pour la carte : par ligne et par gare (a priori = toute la France) ----------
    par_l = lire('SELECT ligne, SUM(en_retard) AS "sum", COUNT(*) AS "count" FROM constates '
                 'WHERE ligne IS NOT NULL GROUP BY ligne').set_index("ligne")
    par_l["taux"] = lisser(par_l["sum"], par_l["count"], taux_global)
    par_g = lire('SELECT gare, SUM(en_retard) AS "sum", COUNT(*) AS "count" FROM constates '
                 'WHERE gare IS NOT NULL GROUP BY gare').set_index("gare")
    par_g["taux"] = lisser(par_g["sum"], par_g["count"], taux_global)
    conn.close()
    # Seulement les gares du site (région + Paris Nord), pour garder un fichier léger
    index_gares = SORTIE.parent / "gares.json"
    if index_gares.exists():
        noms_site = {g["nom"] for g in json.loads(index_gares.read_text(encoding="utf-8"))["gares"]}
        par_g = par_g[par_g.index.isin(noms_site)]

    # ---------- Export (même format qu'avant, plus le taux brut pour la transparence) ----------
    def entree(taux, n, retards):
        return {"taux": round(float(taux), 3), "n": int(n), "brut": round(float(retards) / n, 3)}

    resultat = {
        "genere_le": datetime.now(ZoneInfo("Europe/Paris")).strftime("%Y-%m-%d %H:%M"),
        "jours_observes": int(jours),
        "passages": int(total),
        "lissage": {"methode": "moyenne bayésienne", "k": K, "taux_global": round(float(taux_global), 3)},
        "par_train": {num: entree(r["taux"], r["passages"], r["retards"])
                      for num, r in t.iterrows() if r["passages"] >= MIN_PAR_TRAIN},
        "par_ligne_heure": {f"{ligne}|{heure}": entree(r["taux"], r["count"], r["sum"])
                            for (ligne, heure), r in lh.iterrows() if r["count"] >= MIN_PAR_GROUPE},
        "par_heure": {heure: entree(r["taux"], r["count"], r["sum"])
                      for heure, r in h.iterrows() if r["count"] >= MIN_PAR_GROUPE},
        "par_ligne": {ligne: entree(r["taux"], r["count"], r["sum"]) for ligne, r in par_l.iterrows()},
        "par_gare": {gare: entree(r["taux"], r["count"], r["sum"]) for gare, r in par_g.iterrows()},
    }
    SORTIE.write_text(json.dumps(resultat, ensure_ascii=False), encoding="utf-8")

    print(f"Passages constatés utilisés : {total} sur {resultat['jours_observes']} jour(s)")
    print(f"Taux moyen (toute la France) : {taux_global:.1%}")
    print(f"Trains avec un risque propre    : {len(resultat['par_train'])}")
    print(f"Couples ligne / heure           : {len(resultat['par_ligne_heure'])}")
    print(f"Heures de la journée            : {len(resultat['par_heure'])}")
    print(f"Lignes (carte)                  : {len(resultat['par_ligne'])}")
    print(f"Gares (carte)                   : {len(resultat['par_gare'])}")
    zeros = sum(1 for v in resultat["par_train"].values() if v["brut"] == 0)
    print(f"Trains à 0 % brut, désormais lissés : {zeros}")
    print(f"Fichier créé : {SORTIE}")


if __name__ == "__main__":
    main()
