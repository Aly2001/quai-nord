"""
Le risque EN DIRECT de chaque TER des Hauts-de-France des prochaines heures, avec le réseau de neurones.

Toutes les 5 minutes (tâche planifiée « cron » sur la VM) :
  1. les passages déjà observés aujourd'hui (sncf.db, mis à jour par le collecteur), avec la même
     préparation que la table des retards (construire_retards.py) ;
  2. les passages PRÉVUS dans les prochaines heures (horaires théoriques, gtfs.db), avec la météo prévue ;
  3. pour chaque passage prévu : la séquence de ce qu'on sait de sa ligne aujourd'hui (sequences.py),
     sa fiche (ligne, heure, jour, position, météo), puis le réseau en numpy (reseau_numpy.py) ;
  4. on écrit risques_direct.json et on le dépose dans un bucket public, que le site pourra lire.

Même règle qu'à l'apprentissage : la question est posée 30 min avant le départ du train (ou maintenant,
s'il part plus tard) et seuls les passages DÉJÀ JUGÉS à ce moment-là sont utilisés.
Le site n'utilise pas encore ce fichier : il sera branché quand le réseau aura tenu ses conditions
pendant 2 semaines (voir evaluer_reseau.py), après validation d'une maquette.

Lancement : python predire_direct.py            (calcule et publie)
            python predire_direct.py --local    (calcule seulement, sans publier)
"""
import fcntl
import json
import os
import sqlite3
import sys
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd

import construire_retards as cr
import entrainer_modele as em
import reseau_numpy as rn
import sequences as sq

BASE_TEMPS_REEL = "sncf.db"
BASE_GTFS = "gtfs.db"
BASE_METEO = "meteo.db"
POIDS = Path("modele/reseau_gru.npz")
SORTIE = Path("modele/risques_direct.json")
BUCKET_PUBLIC = "quai-nord-direct"                 # bucket lisible par tous : seulement ce fichier
HORIZON = timedelta(hours=3)                       # les trains des 3 prochaines heures
PARIS = ZoneInfo("Europe/Paris")
VERROU = Path("predire_direct.verrou")


def ouvrir(base_tr=BASE_TEMPS_REEL, base_gtfs=BASE_GTFS, base_meteo=BASE_METEO):
    """sncf.db en lecture seule (le collecteur écrit pendant ce temps), avec les horaires et la météo."""
    conn = sqlite3.connect(f"file:{base_tr}?mode=ro", uri=True, timeout=60)
    conn.execute(f"ATTACH DATABASE 'file:{base_gtfs}?mode=ro' AS g")
    avec_meteo = os.path.exists(base_meteo)
    if avec_meteo:
        conn.execute(f"ATTACH DATABASE 'file:{base_meteo}?mode=ro' AS m")
    return conn, avec_meteo


def observes(conn, avec_meteo, jours):
    """Les passages déjà observés des jours de service donnés, préparés comme la table des retards."""
    selection = cr.requete(conn, avec_meteo)
    marques = ",".join("?" * len(jours))
    df = pd.read_sql(f"""
        SELECT * FROM ({selection} AND p.date_service IN ({marques}))
        WHERE hauts_de_france = 1 AND heure_prevue IS NOT NULL AND trip_id LIKE '%:TER:%'
    """, conn, params=[f"{j:%Y%m%d}" for j in jours])
    return em.preparer_variables(df) if len(df) else df


def services_du_jour(conn, jour):
    """Les services qui circulent ce jour-là (règles du calendrier + exceptions)."""
    tables = {t for (t,) in conn.execute("SELECT name FROM g.sqlite_master WHERE type = 'table'")}
    d = f"{jour:%Y%m%d}"
    actifs = set()
    if "calendar" in tables:
        colonne = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"][jour.weekday()]
        actifs |= {s for (s,) in conn.execute(
            f"SELECT service_id FROM g.calendar WHERE start_date <= ? AND end_date >= ? AND {colonne} = '1'", (d, d))}
    if "calendar_dates" in tables:
        for service, exception in conn.execute(
                "SELECT service_id, exception_type FROM g.calendar_dates WHERE date = ?", (d,)):
            (actifs.add if str(exception) == "1" else actifs.discard)(service)
    return actifs


def prevus(conn, avec_meteo, jour):
    """Tous les passages PRÉVUS des TER dans les gares des Hauts-de-France, pour le jour de service donné."""
    services = sorted(services_du_jour(conn, jour))
    if not services:
        return pd.DataFrame()
    secondes = cr.heure_gtfs_en_secondes("COALESCE(st.arrival_time, st.departure_time)")
    heure_prevue = f"datetime('{jour:%Y-%m-%d}', '+' || {secondes} || ' seconds')"
    meteo = (f"""LEFT JOIN m.gare_point gp ON gp.stop_id = st.stop_id
                 LEFT JOIN m.meteo mt ON mt.point = gp.point
                                     AND mt.heure = strftime('%Y-%m-%d %H:00:00', {heure_prevue}, '+1 hour')"""
             if avec_meteo else "")
    pluie, rafales = ("mt.pluie_mm", "mt.rafales_kmh") if avec_meteo else ("NULL", "NULL")
    numero = cr.colonne_ou_null(conn, "trips", "trip_headsign")
    conn.execute("CREATE TEMP TABLE IF NOT EXISTS services_actifs (service_id TEXT PRIMARY KEY)")
    conn.execute("DELETE FROM services_actifs")
    conn.executemany("INSERT OR IGNORE INTO services_actifs VALUES (?)", [(s,) for s in services])
    df = pd.read_sql(f"""
        SELECT st.trip_id, t.{numero} AS numero_train, r.route_short_name AS ligne, s.stop_name AS gare,
               CAST(st.stop_sequence AS INTEGER) AS ordre_arret, {heure_prevue} AS heure_prevue,
               {pluie} AS pluie_mm, {rafales} AS rafales_kmh, '{jour:%Y%m%d}' AS date_service
        FROM g.stop_times st
        JOIN g.trips t  ON t.trip_id = st.trip_id
        JOIN temp.services_actifs sa ON sa.service_id = t.service_id
        JOIN g.routes r ON r.route_id = t.route_id
        JOIN g.stops s  ON s.stop_id = st.stop_id
        {meteo}
        WHERE s.hauts_de_france = 1 AND st.trip_id LIKE '%:TER:%'
    """, conn)
    return em.preparer_variables(df) if len(df) else df


def calculer(maintenant=None, base_tr=BASE_TEMPS_REEL, base_gtfs=BASE_GTFS, base_meteo=BASE_METEO, poids=POIDS):
    """Le contenu de risques_direct.json."""
    maintenant = pd.Timestamp(maintenant or datetime.now(PARIS).replace(tzinfo=None))
    aujourd_hui = maintenant.normalize()
    jours = [aujourd_hui - timedelta(days=1), aujourd_hui]      # la veille : les trains d'après minuit
    reseau, preparation = rn.charger(poids)

    conn, avec_meteo = ouvrir(base_tr, base_gtfs, base_meteo)
    try:
        faits = observes(conn, avec_meteo, jours)
        a_venir = pd.concat([prevus(conn, avec_meteo, j) for j in jours], ignore_index=True)
    finally:
        conn.close()

    resultat = {"genere_le": maintenant.strftime("%Y-%m-%dT%H:%M"), "horizon_h": HORIZON.seconds // 3600,
                "reseau": {"entraine_le": preparation.get("entraine_le"),
                           "appris_jusqu_au": preparation.get("derniere_journee")},
                "trains": {}}
    if a_venir.empty:
        return resultat

    # La question : 30 min avant le PREMIER passage du train dans la région, ou maintenant s'il part plus tard
    a_venir["heure_prevue"] = pd.to_datetime(a_venir["heure_prevue"])
    premier = a_venir.groupby(["date", "trip_id"])["heure_prevue"].transform("min")
    a_venir["question"] = (premier - sq.AVANCE).clip(upper=maintenant)
    cibles = a_venir[(a_venir["heure_prevue"] >= maintenant)
                     & (a_venir["heure_prevue"] <= maintenant + HORIZON)].reset_index(drop=True)
    if cibles.empty:
        return resultat

    if faits.empty:     # personne n'a encore circulé aujourd'hui : des séquences vides (petit matin)
        faits = cibles.iloc[0:0].assign(retard_minutes=[], perturbe=[], supprime=[])
    sequences = sq.construire_sequences(faits, cibles=cibles, question=cibles["question"])
    cibles["risque"] = rn.predire(reseau, sequences, rn.fiche(cibles, preparation))

    cibles["cle"] = cibles["numero_train"].fillna(cibles["trip_id"]).astype(str)   # le numéro du train, sinon son identifiant
    for (cle, date_service), train in cibles.sort_values("heure_prevue").groupby(["cle", "date_service"]):
        resultat["trains"][cle] = {
            "jour": f"{pd.Timestamp(date_service):%Y-%m-%d}", "ligne": train["ligne"].iat[0],
            "arrets": [{"gare": g, "heure": f"{h:%H:%M}", "risque": round(float(r), 3)}
                       for g, h, r in zip(train["gare"], train["heure_prevue"], train["risque"])],
        }
    return resultat


def publier(fichier):
    """Dépose le fichier dans le bucket public, sans cache (le site doit voir la dernière version)."""
    from google.cloud import storage
    blob = storage.Client().bucket(BUCKET_PUBLIC).blob(fichier.name)
    blob.cache_control = "no-cache, max-age=0"
    blob.upload_from_filename(str(fichier), content_type="application/json")


def main():
    verrou = open(VERROU, "w")
    try:
        fcntl.flock(verrou, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print("Un calcul est déjà en cours : on passe ce tour.")
        return 0
    if not POIDS.exists():
        print(f"{POIDS} introuvable : lancer d'abord evaluer_reseau.py (qui récupère les poids).")
        return 0
    resultat = calculer()
    SORTIE.parent.mkdir(exist_ok=True)
    temporaire = SORTIE.with_suffix(".tmp")
    temporaire.write_text(json.dumps(resultat, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.replace(temporaire, SORTIE)
    arrets = sum(len(t["arrets"]) for t in resultat["trains"].values())
    print(f"[{resultat['genere_le']}] {len(resultat['trains'])} trains, {arrets} arrêts · {SORTIE}")
    if "--local" not in sys.argv:
        publier(SORTIE)
        print(f"   publié : https://storage.googleapis.com/{BUCKET_PUBLIC}/{SORTIE.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
