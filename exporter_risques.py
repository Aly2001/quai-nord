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


def la_plus_frequente(compteur):
    """La valeur la plus fréquente (en cas d'égalité : la plus petite, comme pandas .mode()),
    ou None s'il n'y en a aucune."""
    if not compteur:
        return None
    return min(compteur.items(), key=lambda paire: (-paire[1], paire[0]))[0]


def compter(base):
    """Parcourt UNE fois les retards constatés et renvoie tous les compteurs utiles.
    Chaque compteur : {clé: [retards, passages]}."""
    def ajouter(compteur, cle, retard):
        case = compteur.get(cle)
        if case is None:
            compteur[cle] = [retard, 1]
        else:
            case[0] += retard
            case[1] += 1

    c = {"total": 0, "retards": 0, "jours": set(), "heure": {}, "ligne_heure": {}, "train": {},
         "train_ligne": {}, "train_heure": {}, "ligne": {}, "gare": {}}
    conn = sqlite3.connect(f"file:{base}?mode=ro", uri=True)
    curseur = conn.execute(f"""
        SELECT numero_train, ligne, gare, date_service, en_retard, substr(heure_prevue, 12, 2)
        FROM retards WHERE {FILTRE}
    """)
    while paquet := curseur.fetchmany(50_000):
        for train, ligne, gare, jour, retard, heure in paquet:
            retard = int(retard or 0)
            c["total"] += 1
            c["retards"] += retard
            c["jours"].add(jour)
            ajouter(c["heure"], heure, retard)
            if ligne is not None:
                ajouter(c["ligne_heure"], (ligne, heure), retard)
                ajouter(c["ligne"], ligne, retard)
            if gare is not None:
                ajouter(c["gare"], gare, retard)
            if train is not None:
                ajouter(c["train"], train, retard)
                if ligne is not None:
                    par_ligne = c["train_ligne"].setdefault(train, {})
                    par_ligne[ligne] = par_ligne.get(ligne, 0) + 1
                if heure is not None:
                    par_heure = c["train_heure"].setdefault(train, {})
                    par_heure[heure] = par_heure.get(heure, 0) + 1
    conn.close()
    return c


def tableau(compteur, index):
    """Un compteur {clé: [retards, passages]} en tableau pandas (colonnes sum et count), trié par clé."""
    noms = index if isinstance(index, list) else [index]
    lignes = [(*(cle if isinstance(cle, tuple) else (cle,)), r, n) for cle, (r, n) in sorted(compteur.items())]
    return pd.DataFrame(lignes, columns=[*noms, "sum", "count"]).set_index(index)


def main():
    if not Path(BASE_ANALYSE).exists():
        raise SystemExit("analyse.db introuvable : lance d'abord python construire_retards.py")
    if not SORTIE.parent.exists():
        raise SystemExit("Dossier site/public/horaires introuvable : lance d'abord python exporter_horaires.py")

    # UNE SEULE LECTURE de la table, ligne par ligne, en comptant au fur et à mesure.
    # Pourquoi : la machine a peu de mémoire (1 Go) et un disque lent. Charger toute la table
    # dans pandas saturait la mémoire, et faire plusieurs GROUP BY obligeait SQLite à trier des
    # millions de lignes sur le disque, plusieurs fois : des heures, de plus en plus chaque nuit.
    # Ici, on ne garde en mémoire que les compteurs (quelques milliers de trains, lignes, gares).
    # Les résultats sont exactement les mêmes.
    c = compter(BASE_ANALYSE)
    total, jours = c["total"], len(c["jours"])
    if not total:
        raise SystemExit("Aucun retard constaté : laisse tourner le collecteur un peu plus.")

    # ---------- Niveau 0 : toute la France ----------
    taux_global = c["retards"] / total

    # ---------- Niveau 1 : par heure (a priori = toute la France) ----------
    h = tableau(c["heure"], "heure")
    h["taux"] = lisser(h["sum"], h["count"], taux_global)

    # ---------- Niveau 2 : par ligne et par heure (a priori = l'heure) ----------
    lh = tableau(c["ligne_heure"], ["ligne", "heure"])
    a_priori_lh = [h["taux"].get(heure, taux_global) for _, heure in lh.index]
    lh["taux"] = lisser(lh["sum"], lh["count"], pd.Series(a_priori_lh, index=lh.index, dtype=float))

    # ---------- Niveau 3 : par train (a priori = sa ligne à son heure habituelle) ----------
    t = tableau(c["train"], "numero_train").rename(columns={"sum": "retards", "count": "passages"})
    t["ligne"] = [la_plus_frequente(c["train_ligne"].get(num)) for num in t.index]
    t["heure"] = [la_plus_frequente(c["train_heure"].get(num)) for num in t.index]

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
    par_l = tableau(c["ligne"], "ligne")
    par_l["taux"] = lisser(par_l["sum"], par_l["count"], taux_global)
    par_g = tableau(c["gare"], "gare")
    par_g["taux"] = lisser(par_g["sum"], par_g["count"], taux_global)
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
