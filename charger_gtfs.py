"""
Chargement des horaires théoriques SNCF (GTFS).

Le script :
  1. télécharge le fichier GTFS officiel de la SNCF (un .zip) ;
  2. charge ses tableaux dans une base séparée : gtfs.db ;
  3. repère les gares situées dans les Hauts-de-France ;
  4. vérifie que les codes du temps réel (sncf.db) correspondent
     bien aux codes du GTFS.

Les horaires théoriques changent régulièrement : relance ce script
environ une fois par semaine.

Lancement : python charger_gtfs.py
(Le collecteur peut continuer à tourner pendant ce temps.)
"""

import os
import sqlite3
import zipfile

import pandas as pd
import requests

URL_GTFS = ("https://eu.ftp.opendatasoft.com/sncf/plandata/"
            "Export_OpenData_SNCF_GTFS_NewTripId.zip")
FICHIER_ZIP = "gtfs_sncf.zip"
BASE_GTFS = "gtfs.db"
BASE_TEMPORAIRE = "gtfs_tmp.db"
BASE_TEMPS_REEL = "sncf.db"

# Contour simplifié des Hauts-de-France : une liste de points (longitude,
# latitude) qui fait le tour de la région. Précis à quelques kilomètres
# près, suffisant pour classer les gares.
CONTOUR_HDF = [
    (1.38, 50.07), (1.50, 50.40), (1.52, 50.95), (2.00, 51.05),
    (2.55, 51.09), (2.63, 50.82), (2.95, 50.70), (3.15, 50.79),
    (3.30, 50.53), (3.65, 50.45), (3.75, 50.35), (4.05, 50.35),
    (4.20, 50.27), (4.15, 50.10), (4.25, 49.95), (4.05, 49.70),
    (4.05, 49.40), (3.66, 49.15), (3.48, 48.84), (3.10, 49.05),
    (2.60, 49.10), (2.20, 49.17), (1.80, 49.20), (1.70, 49.30),
    (1.75, 49.70),
]

# Fichiers du GTFS qu'on charge, et nom de la table correspondante
FICHIERS = {
    "stops.txt": "stops",                # les gares et leurs coordonnées
    "routes.txt": "routes",              # les lignes
    "trips.txt": "trips",                # les trajets (un trajet = un train un jour)
    "stop_times.txt": "stop_times",      # les horaires prévus à chaque gare
    "calendar.txt": "calendar",          # les jours de circulation (règles)
    "calendar_dates.txt": "calendar_dates",  # les jours de circulation (exceptions)
}


def telecharger():
    print("1. Téléchargement du GTFS SNCF...")
    with requests.get(URL_GTFS, stream=True, timeout=120) as reponse:
        reponse.raise_for_status()
        with open(FICHIER_ZIP, "wb") as fichier:
            for morceau in reponse.iter_content(chunk_size=1024 * 1024):
                fichier.write(morceau)
    taille = os.path.getsize(FICHIER_ZIP) / 1024 / 1024
    print(f"   OK : {taille:.1f} Mo téléchargés")


def charger_dans_sqlite():
    print("2. Chargement dans la base...")
    if os.path.exists(BASE_TEMPORAIRE):
        os.remove(BASE_TEMPORAIRE)
    conn = sqlite3.connect(BASE_TEMPORAIRE)

    with zipfile.ZipFile(FICHIER_ZIP) as archive:
        presents = archive.namelist()
        for nom_fichier, table in FICHIERS.items():
            if nom_fichier not in presents:
                print(f"   (absent du zip : {nom_fichier})")
                continue
            total = 0
            with archive.open(nom_fichier) as f:
                # Lecture par paquets pour ne pas saturer la mémoire
                for paquet in pd.read_csv(f, dtype=str, chunksize=200_000):
                    paquet.to_sql(table, conn, if_exists="append", index=False)
                    total += len(paquet)
            print(f"   {table:<15} : {total:>9} lignes")

    # Index : accélèrent énormément les recherches et les jointures
    conn.executescript("""
        CREATE INDEX IF NOT EXISTS idx_stops ON stops(stop_id);
        CREATE INDEX IF NOT EXISTS idx_trips ON trips(trip_id);
        CREATE INDEX IF NOT EXISTS idx_st_trip ON stop_times(trip_id, stop_id);
    """)
    conn.commit()
    return conn


def dans_le_contour(lon, lat, contour=CONTOUR_HDF):
    """Algorithme du « lancer de rayon » : on trace une demi-droite depuis
    le point ; si elle coupe le contour un nombre impair de fois, le point
    est à l'intérieur."""
    dedans = False
    n = len(contour)
    for i in range(n):
        x1, y1 = contour[i]
        x2, y2 = contour[(i + 1) % n]
        if (y1 > lat) != (y2 > lat):
            x_croisement = x1 + (lat - y1) * (x2 - x1) / (y2 - y1)
            if lon < x_croisement:
                dedans = not dedans
    return dedans


def marquer_hauts_de_france(conn):
    print("3. Repérage des gares des Hauts-de-France...")
    conn.execute("ALTER TABLE stops ADD COLUMN hauts_de_france INTEGER")
    gares = conn.execute("SELECT rowid, stop_lon, stop_lat FROM stops").fetchall()
    resultats = []
    for rowid, lon, lat in gares:
        try:
            resultats.append((int(dans_le_contour(float(lon), float(lat))), rowid))
        except (TypeError, ValueError):       # coordonnées manquantes
            resultats.append((0, rowid))
    conn.executemany("UPDATE stops SET hauts_de_france = ? WHERE rowid = ?",
                     resultats)
    conn.commit()
    nb, = conn.execute("""
        SELECT COUNT(DISTINCT stop_name) FROM stops WHERE hauts_de_france = 1
    """).fetchone()
    print(f"   {nb} gares trouvées dans la zone")


def remplacer_ancienne_base(conn):
    conn.close()
    os.replace(BASE_TEMPORAIRE, BASE_GTFS)   # remplacement en une seule fois


def verifier_correspondance():
    print("4. Vérification : le temps réel correspond-il au GTFS ?")
    if not os.path.exists(BASE_TEMPS_REEL):
        print("   (sncf.db introuvable, vérification ignorée)")
        return
    conn = sqlite3.connect(BASE_TEMPS_REEL)
    conn.execute(f"ATTACH DATABASE '{BASE_GTFS}' AS g")

    total, gares_ok, trains_ok = conn.execute("""
        SELECT COUNT(*),
               SUM(stop_id IN (SELECT stop_id FROM g.stops)),
               SUM(trip_id IN (SELECT trip_id FROM g.trips))
        FROM passages
    """).fetchone()
    if total:
        print(f"   Gares reconnues  : {100 * gares_ok / total:5.1f} %")
        print(f"   Trains reconnus  : {100 * trains_ok / total:5.1f} %")

    print("\n   Aperçu : gares des Hauts-de-France les plus touchées")
    print("   " + "-" * 58)
    print(f"   {'Gare':<32}{'Passages':>10}{'Retard ≥ 5 min':>16}")
    for nom, nb, pct in conn.execute("""
        SELECT s.stop_name,
               COUNT(*) AS nb,
               100.0 * SUM(p.retard_arrivee >= 300) / COUNT(*) AS pct
        FROM passages p
        JOIN g.stops s ON s.stop_id = p.stop_id
        WHERE s.hauts_de_france = 1 AND p.retard_arrivee IS NOT NULL
        GROUP BY s.stop_name
        HAVING nb >= 5
        ORDER BY pct DESC, nb DESC
        LIMIT 10
    """):
        print(f"   {nom[:31]:<32}{nb:>10}{pct:>15.0f} %")
    conn.close()


if __name__ == "__main__":
    telecharger()
    conn = charger_dans_sqlite()
    marquer_hauts_de_france(conn)
    remplacer_ancienne_base(conn)
    verifier_correspondance()
    print("\nTerminé ! Les horaires théoriques sont dans gtfs.db")
