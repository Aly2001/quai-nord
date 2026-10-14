"""
Export des horaires PRÉVUS pour le site React.

Pour chaque gare des Hauts-de-France et chaque jour à venir (4 par défaut),
le script écrit un petit fichier JSON avec les départs et les arrivées.
Chaque départ contient aussi la SUITE de son trajet (gares et heures), ce qui
permet au site de chercher un trajet « de Boulogne à Calais » :

    site/public/horaires/gares.json                          -> la liste des gares et des jours
    site/public/horaires/<gare>/<AAAA-MM-JJ>.json            -> les horaires d'une gare un jour

Le site React lit ces fichiers directement : aucun serveur n'est nécessaire.
Plus tard, l'API FastAPI renverra exactement le même format.

À relancer chaque jour, juste après charger_gtfs.py :
    python charger_gtfs.py
    python exporter_horaires.py

Options :
    python exporter_horaires.py 7               -> 7 jours au lieu de 4
    python exporter_horaires.py 7 2026-10-12    -> à partir d'une date précise
"""

import json
import re
import shutil
import sqlite3
import sys
import unicodedata
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd

BASE_GTFS = "gtfs.db"
DOSSIER_SORTIE = Path("site/public/horaires")
JOURS_GTFS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
TYPES_TRANSPORT = {"2": "Train", "3": "Car"}   # codes GTFS route_type


# ----------------------------------------------------------------------
# Outils
# ----------------------------------------------------------------------
# Gares hors de la région utilisables comme gare de départ (nom exact dans le GTFS)
PARIS_NORD = r"Paris[ -]Gare[ -]du[ -]Nord|Paris[ -]Nord"


def slug(nom):
    """'Boulogne Tintelleries' -> 'boulogne-tintelleries' (nom de dossier sûr)."""
    sans_accents = unicodedata.normalize("NFKD", nom).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", sans_accents.lower()).strip("-")


def en_secondes(heure):
    """'25:10:00' -> 90600. En GTFS, une heure peut dépasser 24 h."""
    h, m, s = (int(x) for x in heure.split(":"))
    return h * 3600 + m * 60 + s


def format_heure(secondes):
    """90600 -> '01:10' (après minuit, on revient à 00 h)."""
    return f"{(secondes // 3600) % 24:02d}:{(secondes % 3600) // 60:02d}"


def table_existe(conn, nom):
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
                        (nom,)).fetchone() is not None


# ----------------------------------------------------------------------
# Chargement (une seule fois, en mémoire : beaucoup plus rapide)
# ----------------------------------------------------------------------
def charger(conn):
    print("1. Lecture des horaires théoriques...")
    stops = pd.read_sql("SELECT stop_id, stop_name, hauts_de_france FROM stops", conn)
    trips = pd.read_sql("SELECT * FROM trips", conn)
    routes = pd.read_sql("SELECT * FROM routes", conn)
    stop_times = pd.read_sql(
        "SELECT trip_id, arrival_time, departure_time, stop_id, stop_sequence FROM stop_times", conn)
    stop_times["ordre"] = stop_times["stop_sequence"].astype(int)

    calendrier = pd.read_sql("SELECT * FROM calendar", conn) if table_existe(conn, "calendar") else None
    exceptions = (pd.read_sql("SELECT * FROM calendar_dates", conn)
                  if table_existe(conn, "calendar_dates") else None)

    # Informations de chaque trajet : numéro, ligne, type de transport
    if "trip_headsign" not in trips.columns:
        trips["trip_headsign"] = ""
    if "route_short_name" not in routes.columns:
        routes["route_short_name"] = ""
    infos = trips.merge(routes[["route_id", "route_short_name", "route_type"]], on="route_id", how="left")
    infos = infos.set_index("trip_id")[["service_id", "trip_headsign", "route_id", "route_short_name", "route_type"]]

    # Origine et terminus de chaque trajet (première et dernière gare)
    noms = stop_times.merge(stops[["stop_id", "stop_name"]], on="stop_id")
    tri = noms.sort_values(["trip_id", "ordre"])
    extremites = pd.DataFrame({
        "ordre_min": tri.groupby("trip_id")["ordre"].first(),
        "origine": tri.groupby("trip_id")["stop_name"].first(),
        "ordre_max": tri.groupby("trip_id")["ordre"].last(),
        "terminus": tri.groupby("trip_id")["stop_name"].last(),
    })

    # La liste complète des arrêts de chaque trajet : (ordre, gare, heure en secondes)
    # Elle sert à construire la « suite » d'un départ : les gares desservies ensuite.
    heure_arret = tri["arrival_time"].fillna(tri["departure_time"])
    arrets_par_trajet = {}
    for trip_id, ordre, nom, heure, stop_id in zip(tri["trip_id"], tri["ordre"], tri["stop_name"],
                                                    heure_arret, tri["stop_id"]):
        if isinstance(heure, str):
            arrets_par_trajet.setdefault(trip_id, []).append((ordre, nom, en_secondes(heure), stop_id))

    # On ne garde que les passages dans les gares des Hauts-de-France...
    gares_hdf = stops[stops["hauts_de_france"] == 1][["stop_id", "stop_name"]]
    # ... plus Paris Gare du Nord, terminus de nombreux TER de la région : on y garde
    # SEULEMENT les trains qui desservent aussi les Hauts-de-France (trajets retour).
    gares_paris = stops[stops["stop_name"].str.fullmatch(PARIS_NORD, case=False, na=False)][["stop_id", "stop_name"]]
    trains_hdf = set(stop_times.loc[stop_times["stop_id"].isin(gares_hdf["stop_id"]), "trip_id"])
    passages_paris = stop_times.merge(gares_paris, on="stop_id")
    passages_paris = passages_paris[passages_paris["trip_id"].isin(trains_hdf)]
    passages = pd.concat([stop_times.merge(gares_hdf, on="stop_id"), passages_paris], ignore_index=True)
    passages = passages.join(infos, on="trip_id").join(extremites, on="trip_id")
    heure_dep = passages["departure_time"].fillna(passages["arrival_time"])
    heure_arr = passages["arrival_time"].fillna(passages["departure_time"])
    passages = passages[heure_dep.notna()].copy()
    passages["s_depart"] = heure_dep[heure_dep.notna()].map(en_secondes)
    passages["s_arrivee"] = heure_arr[heure_dep.notna()].map(en_secondes)

    print(f"   {len(passages)} passages prévus dans {passages['stop_name'].nunique()} gares de la région")
    return passages, calendrier, exceptions, arrets_par_trajet


def services_actifs(jour, calendrier, exceptions):
    """Les service_id qui circulent ce jour-là (règles + exceptions)."""
    d = jour.strftime("%Y%m%d")
    actifs = set()
    if calendrier is not None:
        colonne = JOURS_GTFS[jour.weekday()]
        regle = (calendrier["start_date"] <= d) & (calendrier["end_date"] >= d) & (calendrier[colonne] == "1")
        actifs |= set(calendrier.loc[regle, "service_id"])
    if exceptions is not None:
        du_jour = exceptions[exceptions["date"] == d]
        actifs |= set(du_jour.loc[du_jour["exception_type"] == "1", "service_id"])
        actifs -= set(du_jour.loc[du_jour["exception_type"] == "2", "service_id"])
    return actifs


def horaires_du_jour(passages, jour, calendrier, exceptions):
    """Les passages qui circulent réellement le jour demandé."""
    s_jour = services_actifs(jour, calendrier, exceptions)
    s_veille = services_actifs(jour - timedelta(days=1), calendrier, exceptions)

    # Trains du jour avant minuit + trains de la veille après minuit (heures GTFS >= 24:00)
    du_jour = passages[passages["service_id"].isin(s_jour) & (passages["s_depart"] < 86400)].copy()
    de_veille = passages[passages["service_id"].isin(s_veille) & (passages["s_depart"] >= 86400)].copy()
    du_jour["decalage"] = 0
    de_veille["decalage"] = 86400
    de_veille["s_depart"] -= 86400
    de_veille["s_arrivee"] -= 86400
    return pd.concat([du_jour, de_veille])


def texte(valeur):
    """Valeur vide ou manquante (NaN) -> chaîne vide."""
    return "" if pd.isna(valeur) else str(valeur)


def vers_liste(lignes, colonne_heure, colonne_lieu, arrets_par_trajet=None):
    """Transforme des passages en liste de trains pour le JSON.
    Si arrets_par_trajet est donné (départs), on ajoute la suite du trajet."""
    lignes = lignes.sort_values(colonne_heure)
    resultat = []
    for _, l in lignes.iterrows():
        train = {
            "heure": format_heure(int(l[colonne_heure])),
            "lieu": texte(l[colonne_lieu]),
            "numero": texte(l["trip_headsign"]),
            "ligne": texte(l["route_short_name"]),
            "transport": TYPES_TRANSPORT.get(str(l["route_type"]), "Train"),
        }
        if arrets_par_trajet is not None:
            # trip_id et stop_id servent à retrouver le train dans le flux temps réel
            train["trip_id"] = l["trip_id"]
            train["stop_id"] = l["stop_id"]
            train["suite"] = [
                {"gare": nom, "heure": format_heure(secondes - int(l["decalage"])), "stop_id": stop_id}
                for ordre, nom, secondes, stop_id in arrets_par_trajet.get(l["trip_id"], [])
                if ordre > l["ordre"]
            ]
        resultat.append(train)
    return resultat


# ----------------------------------------------------------------------
# Programme principal
# ----------------------------------------------------------------------
def main():
    # 4 jours : aujourd'hui, demain, après-demain (affichés) + 1 jour de réserve,
    # au cas où la mise à jour quotidienne ne se ferait pas un jour.
    nb_jours = int(sys.argv[1]) if len(sys.argv) > 1 else 4
    debut = (date.fromisoformat(sys.argv[2]) if len(sys.argv) > 2
             else datetime.now(ZoneInfo("Europe/Paris")).date())
    jours = [debut + timedelta(days=i) for i in range(nb_jours)]

    if not Path(BASE_GTFS).exists():
        raise SystemExit("gtfs.db introuvable : lance d'abord python charger_gtfs.py")
    if not Path("site").exists():
        raise SystemExit("Dossier 'site' introuvable : lance ce script depuis le dossier projet-sncf")

    conn = sqlite3.connect(BASE_GTFS)
    passages, calendrier, exceptions, arrets_par_trajet = charger(conn)
    conn.close()

    print(f"2. Export de {nb_jours} jours, du {jours[0]} au {jours[-1]}...")
    # On efface les anciens horaires (un dossier par gare), mais PAS les autres fichiers
    # du dossier (risques.json, meteo.json, temps_reel.json), écrits par d'autres scripts.
    DOSSIER_SORTIE.mkdir(parents=True, exist_ok=True)
    for element in DOSSIER_SORTIE.iterdir():
        if element.is_dir():
            shutil.rmtree(element)

    # Toutes les gares de la région ayant au moins un train prévu dans le GTFS
    gares = {slug(nom): nom for nom in passages["stop_name"].unique()}

    # Les gares de CORRESPONDANCE, selon deux règles :
    #  1. au moins 3 lignes différentes (une ligne = son nom court, ex. « K71 » ;
    #     à défaut, son identifiant) ;
    #  2. OU desservies par des trains grandes lignes (TGV, Intercités, OUIGO...) :
    #     on y change souvent de train, même quand peu de lignes y passent.
    #     Dans le GTFS SNCF, le type de train figure dans l'identifiant de l'arrêt,
    #     ex. « StopPoint:OCETGV INOUI-87317362 ».
    nom_ligne = passages["route_short_name"].fillna("").where(
        passages["route_short_name"].fillna("") != "", passages["route_id"])
    lignes_par_gare = nom_ligne.groupby(passages["stop_name"]).nunique()
    par_lignes = {nom for nom, nb in lignes_par_gare.items() if nb >= 3}

    est_grande_ligne = passages["stop_id"].str.contains(
        r"TGV|INTERCIT|OUIGO|LYRIA|EUROSTAR", case=False, regex=True, na=False)
    par_grandes_lignes = set(passages.loc[est_grande_ligne, "stop_name"])

    # Paris Nord n'est pas une gare de correspondance pour Quai Nord : on ne propose pas
    # de changement à Paris pour un trajet entre deux gares de la région.
    hors_region = {nom for nom in gares.values() if re.fullmatch(PARIS_NORD, nom, flags=re.IGNORECASE)}
    par_lignes -= hors_region
    par_grandes_lignes -= hors_region
    if hors_region:
        print("   Gare hors région ajoutée au départ :", ", ".join(sorted(hors_region)))
    correspondances = sorted(slug(nom) for nom in par_lignes | par_grandes_lignes)
    print(f"   {len(correspondances)} gares de correspondance : {len(par_lignes)} par le nombre de lignes, "
          f"{len(par_grandes_lignes - par_lignes)} de plus grâce aux TGV et Intercités")
    if par_grandes_lignes - par_lignes:
        print("   Ajoutées grâce aux grandes lignes :", ", ".join(sorted(par_grandes_lignes - par_lignes)))

    # ---------- Les lignes, pour la carte ----------
    # Pour chaque ligne (K12, K71...), la liste de ses gares dans l'ordre, prise sur
    # son trajet le plus long. La carte s'en sert pour tracer la ligne.
    avec_nom = passages[passages["route_short_name"].fillna("") != ""]
    par_trajet = (avec_nom.sort_values(["trip_id", "ordre"])
                  .groupby("trip_id")
                  .agg(ligne=("route_short_name", "first"), gares=("stop_name", list)))
    par_trajet["gares"] = par_trajet["gares"].map(lambda g: list(dict.fromkeys(g)))   # sans doublon
    par_trajet["nb"] = par_trajet["gares"].map(len)
    plus_longs = par_trajet.sort_values("nb").groupby("ligne").tail(1)
    lignes = {ligne: gares_ligne for ligne, gares_ligne in zip(plus_longs["ligne"], plus_longs["gares"])
              if len(gares_ligne) >= 2}
    (DOSSIER_SORTIE / "lignes.json").write_text(json.dumps(lignes, ensure_ascii=False), encoding="utf-8")
    print(f"   lignes.json : {len(lignes)} lignes")

    for jour in jours:
        du_jour = horaires_du_jour(passages, jour, calendrier, exceptions)
        par_gare = dict(tuple(du_jour.groupby("stop_name")))
        for s, nom in gares.items():
            # Un fichier pour CHAQUE gare et CHAQUE jour, même vide :
            # le site ne tombe jamais sur un fichier manquant.
            lignes = par_gare.get(nom, du_jour.iloc[0:0])
            departs = vers_liste(lignes[lignes["ordre"] < lignes["ordre_max"]], "s_depart", "terminus",
                                 arrets_par_trajet)
            arrivees = vers_liste(lignes[lignes["ordre"] > lignes["ordre_min"]], "s_arrivee", "origine")
            dossier = DOSSIER_SORTIE / s
            dossier.mkdir(parents=True, exist_ok=True)
            contenu = {"gare": nom, "date": jour.isoformat(), "departs": departs, "arrivees": arrivees}
            (dossier / f"{jour.isoformat()}.json").write_text(
                json.dumps(contenu, ensure_ascii=False), encoding="utf-8")
        print(f"   {jour} : {du_jour['stop_name'].nunique()} gares desservies")

    index = {
        "genere_le": datetime.now(ZoneInfo("Europe/Paris")).strftime("%Y-%m-%d %H:%M"),
        "jours": [j.isoformat() for j in jours],
        "gares": [{"slug": s, "nom": n} for s, n in sorted(gares.items(), key=lambda x: x[1])],
        "correspondances": correspondances,
        # Toutes les gares où l'on peut arriver (y compris hors de la région, ex. Paris Nord)
        "destinations": sorted({nom for arrets in arrets_par_trajet.values() for _, nom, _, _ in arrets}),
    }
    (DOSSIER_SORTIE / "gares.json").write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")

    nb_fichiers = sum(1 for _ in DOSSIER_SORTIE.rglob("*.json"))
    print(f"\nTerminé : {len(gares)} gares, {nb_fichiers} fichiers dans {DOSSIER_SORTIE}")


if __name__ == "__main__":
    main()
