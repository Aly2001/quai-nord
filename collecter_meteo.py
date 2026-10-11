"""
Récupération de la météo heure par heure (Open-Meteo, gratuit, sans clé).

Le script :
  1. interroge Open-Meteo pour une vingtaine de points des Hauts-de-France :
     les derniers jours OBSERVÉS + les PRÉVISIONS des 3 prochains jours ;
  2. range tout dans meteo.db, table "meteo" (une ligne par point et par heure),
     sans doublons : une prévision est remplacée par la valeur la plus récente ;
  3. relie chaque gare à son point météo le plus proche (table "gare_point") ;
  4. exporte les prévisions des prochains jours pour le site (meteo.json).

Données : Open-Meteo (licence CC BY 4.0), usage non commercial.

Lancement :
    python collecter_meteo.py         -> les 14 derniers jours + 3 jours de prévisions
    python collecter_meteo.py 60      -> les 60 derniers jours (maximum : 92)
"""

import json
import math
import sqlite3
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
import requests

URL = "https://api.open-meteo.com/v1/forecast"
BASE_METEO = "meteo.db"
BASE_GTFS = "gtfs.db"
JOURS_PASSES = 14
JOURS_PREVUS = 3
DISTANCE_MAX_KM = 40       # au-delà, une gare n'a pas de point météo (hors région)
DOSSIER_SITE = Path("site/public/horaires")

# Les points météo : une vingtaine de villes réparties sur la région
POINTS = {
    "Dunkerque": (51.03, 2.37), "Calais": (50.95, 1.85), "Boulogne-sur-Mer": (50.72, 1.61),
    "Étaples": (50.51, 1.64), "Abbeville": (50.10, 1.83), "Hazebrouck": (50.72, 2.54),
    "Lille": (50.63, 3.07), "Lens": (50.43, 2.83), "Arras": (50.29, 2.78),
    "Douai": (50.37, 3.08), "Valenciennes": (50.36, 3.52), "Maubeuge": (50.28, 3.97),
    "Amiens": (49.89, 2.30), "Saint-Quentin": (49.85, 3.29), "Laon": (49.56, 3.62),
    "Beauvais": (49.43, 2.08), "Compiègne": (49.42, 2.83), "Creil": (49.26, 2.47),
    "Hirson": (49.92, 4.08), "Saint-Pol-sur-Ternoise": (50.38, 2.33),
}

# Nom chez Open-Meteo  ->  nom de colonne chez nous
VARIABLES = {
    "precipitation": "pluie_mm",        # somme de l'heure précédente
    "snowfall": "neige_cm",             # somme de l'heure précédente
    "temperature_2m": "temperature",    # °C, à l'heure indiquée
    "wind_speed_10m": "vent_kmh",       # km/h
    "wind_gusts_10m": "rafales_kmh",    # km/h, rafale maximale de l'heure précédente
}


# ----------------------------------------------------------------------
# 1. Télécharger la météo d'un point
# ----------------------------------------------------------------------
def telecharger(nom, latitude, longitude, jours_passes):
    reponse = requests.get(URL, timeout=30, params={
        "latitude": latitude,
        "longitude": longitude,
        "hourly": ",".join(VARIABLES),
        "timezone": "Europe/Paris",          # heures françaises, comme les horaires SNCF
        "past_days": jours_passes,
        "forecast_days": JOURS_PREVUS,
    })
    reponse.raise_for_status()
    horaire = reponse.json()["hourly"]

    # Les listes parallèles deviennent un tableau : une ligne par heure
    df = pd.DataFrame(horaire).rename(columns=VARIABLES)
    df["heure"] = pd.to_datetime(df["time"]).dt.strftime("%Y-%m-%d %H:00:00")
    df["point"] = nom
    return df[["point", "heure", *VARIABLES.values()]]


# ----------------------------------------------------------------------
# 2. Ranger dans la base, sans doublons
# ----------------------------------------------------------------------
def creer_tables(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS meteo (
            point        TEXT NOT NULL,
            heure        TEXT NOT NULL,      -- 'AAAA-MM-JJ HH:00:00', heure française
            pluie_mm     REAL,
            neige_cm     REAL,
            temperature  REAL,
            vent_kmh     REAL,
            rafales_kmh  REAL,
            observe      INTEGER,            -- 1 = heure passée (observée), 0 = prévision
            maj          TEXT,               -- date de la dernière mise à jour
            PRIMARY KEY (point, heure)
        );
    """)


def enregistrer(conn, df):
    maintenant = datetime.now(ZoneInfo("Europe/Paris"))
    df = df.copy()
    df["observe"] = (df["heure"] < maintenant.strftime("%Y-%m-%d %H:00:00")).astype(int)
    df["maj"] = maintenant.strftime("%Y-%m-%d %H:%M")
    lignes = df[["point", "heure", "pluie_mm", "neige_cm", "temperature",
                 "vent_kmh", "rafales_kmh", "observe", "maj"]].astype(object)
    lignes = lignes.where(pd.notna(lignes), None).values.tolist()
    # Upsert : une prévision est remplacée par une valeur plus récente
    conn.executemany("""
        INSERT INTO meteo VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT (point, heure) DO UPDATE SET
            pluie_mm = excluded.pluie_mm, neige_cm = excluded.neige_cm,
            temperature = excluded.temperature, vent_kmh = excluded.vent_kmh,
            rafales_kmh = excluded.rafales_kmh, observe = excluded.observe, maj = excluded.maj
    """, lignes)
    conn.commit()


# ----------------------------------------------------------------------
# 3. Relier chaque gare à son point météo le plus proche
# ----------------------------------------------------------------------
def distance_km(lat1, lon1, lat2, lon2):
    """Distance à vol d'oiseau entre deux positions GPS (formule de haversine)."""
    r = 6371
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def relier_gares(conn):
    if not Path(BASE_GTFS).exists():
        print("   (gtfs.db introuvable : lance charger_gtfs.py, liaison des gares ignorée)")
        return
    gtfs = sqlite3.connect(BASE_GTFS)
    gares = gtfs.execute("SELECT stop_id, stop_lat, stop_lon FROM stops").fetchall()
    gtfs.close()

    liens = []
    for stop_id, lat, lon in gares:
        try:
            lat, lon = float(lat), float(lon)
        except (TypeError, ValueError):
            continue
        nom, (plat, plon) = min(POINTS.items(), key=lambda p: distance_km(lat, lon, *p[1]))
        d = distance_km(lat, lon, plat, plon)
        if d <= DISTANCE_MAX_KM:
            liens.append((stop_id, nom, round(d, 1)))

    conn.executescript("""
        DROP TABLE IF EXISTS gare_point;
        CREATE TABLE gare_point (stop_id TEXT PRIMARY KEY, point TEXT, distance_km REAL);
    """)
    conn.executemany("INSERT INTO gare_point VALUES (?,?,?)", liens)
    conn.commit()
    print(f"   {len(liens)} arrêts reliés à un point météo (à moins de {DISTANCE_MAX_KM} km)")


# ----------------------------------------------------------------------
# 4. Exporter les prochains jours pour le site
# ----------------------------------------------------------------------
def exporter_pour_le_site(conn):
    if not DOSSIER_SITE.parent.exists():
        print("   (dossier site/public introuvable : export pour le site ignoré)")
        return
    DOSSIER_SITE.mkdir(parents=True, exist_ok=True)
    aujourd_hui = datetime.now(ZoneInfo("Europe/Paris")).date()
    debut = aujourd_hui.strftime("%Y-%m-%d 00:00:00")
    fin = (aujourd_hui + timedelta(days=4)).strftime("%Y-%m-%d 00:00:00")

    # Format compact : points -> "AAAA-MM-JJTHH" -> [pluie, neige, température, rafales]
    points = {}
    for point, heure, pluie, neige, temp, rafales in conn.execute("""
        SELECT point, heure, pluie_mm, neige_cm, temperature, rafales_kmh
        FROM meteo WHERE heure >= ? AND heure < ? ORDER BY point, heure
    """, (debut, fin)):
        cle = heure[:10] + "T" + heure[11:13]
        points.setdefault(point, {})[cle] = [pluie, neige, temp, rafales]

    gares = dict(conn.execute("SELECT stop_id, point FROM gare_point").fetchall()) \
        if conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'gare_point'").fetchone() else {}

    contenu = {
        "maj": datetime.now(ZoneInfo("Europe/Paris")).strftime("%Y-%m-%d %H:%M"),
        "points": points,
        "gares": gares,
    }
    (DOSSIER_SITE / "meteo.json").write_text(json.dumps(contenu, ensure_ascii=False), encoding="utf-8")
    print(f"   meteo.json : {len(points)} points, {len(gares)} arrêts")


# ----------------------------------------------------------------------
def main():
    jours_passes = min(int(sys.argv[1]), 92) if len(sys.argv) > 1 else JOURS_PASSES
    conn = sqlite3.connect(BASE_METEO)
    creer_tables(conn)

    print(f"1. Météo de {len(POINTS)} points : {jours_passes} jours passés + {JOURS_PREVUS} jours prévus")
    reussis = 0
    for nom, (lat, lon) in POINTS.items():
        try:
            df = telecharger(nom, lat, lon, jours_passes)
            enregistrer(conn, df)
            reussis += 1
        except Exception as erreur:            # un point en échec n'arrête pas les autres
            print(f"   ÉCHEC pour {nom} : {erreur}")
        time.sleep(0.2)                        # politesse envers le service gratuit
    print(f"   {reussis}/{len(POINTS)} points récupérés")

    print("2. Liaison des gares aux points météo")
    relier_gares(conn)

    total, observees = conn.execute("SELECT COUNT(*), SUM(observe) FROM meteo").fetchone()
    print(f"3. Base météo : {total} heures, dont {observees or 0} observées et "
          f"{total - (observees or 0)} prévues")

    print("4. Export des prévisions pour le site")
    exporter_pour_le_site(conn)
    conn.close()

    if reussis == 0:
        sys.exit(1)                            # signale l'échec à mettre_a_jour.py


if __name__ == "__main__":
    main()
