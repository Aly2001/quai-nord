"""
Les bus à l'arrivée en gare : préparation des données (Calais et Boulogne).

Pour chaque réseau de bus, ce script :
  1. lit ses horaires en données ouvertes (format GTFS, comme la SNCF) :
     le fichier donnees_bus/<reseau>.zip s'il existe (téléchargé à la main),
     sinon il le télécharge lui-même ;
  2. regroupe les voyages en PARCOURS : une ligne fait des centaines de voyages par jour,
     mais suit seulement quelques trajets différents (un par sens, parfois une variante) ;
  3. relie chaque gare SNCF couverte aux arrêts de bus à moins de 400 m ;
  4. écrit un petit fichier pour le site : site/public/bus/<reseau>.json

Le site n'a ensuite qu'à lire ce fichier pour répondre à
« quelle ligne relie la gare à tel endroit ? » : aucun calcul lourd sur le téléphone.

Lancement, depuis le dossier projet-sncf : python charger_bus.py
"""

import csv
import io
import json
import math
import sqlite3
import sys
import unicodedata
import zipfile
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

DOSSIER_SORTIE = Path("site/public/bus")
DOSSIER_ZIP = Path("donnees_bus")      # calais.zip et boulogne.zip, téléchargés à la main
BASE_GTFS_SNCF = "gtfs.db"
RAYON_GARE = 400            # mètres : arrêts de bus considérés « à la gare »
MIN_VOYAGES = 3             # un parcours emprunté moins souvent est une exception, on l'ignore

# Les réseaux couverts. « gares » : les noms SNCF des gares desservies (comparés sans
# accents, tirets ni majuscules), pour retrouver leur position dans gtfs.db.
RESEAUX = {
    "calais": {
        "nom": "Imag'in (Calais)",
        "url": "https://zenbus.net/gtfs/static/download.zip?dataset=sitac-calais-rt&src=true",
        "source": "Réseau urbain SITAC, transport.data.gouv.fr, Licence Ouverte",
        "gares": ["calais ville", "calais frethun"],
    },
    "boulogne": {
        "nom": "Marinéo (Boulogne-sur-Mer)",
        "url": "https://s3.eu-west-1.amazonaws.com/files.orchestra.ratpdev.com/networks/boulogne/exports/medias.zip",
        "source": "Réseau urbain Marinéo, transport.data.gouv.fr, Licence Ouverte",
        "gares": ["boulogne ville", "boulogne sur mer", "boulogne tintelleries"],
    },
}


def normaliser(texte):
    """« Calais - Fréthun » -> « calais frethun » : sans accents, tirets ni majuscules."""
    sans_accents = unicodedata.normalize("NFD", texte).encode("ascii", "ignore").decode()
    return " ".join("".join(c if c.isalnum() else " " for c in sans_accents.lower()).split())


def distance_m(lat1, lon1, lat2, lon2):
    """Distance à vol d'oiseau en mètres (formule de haversine), comme pour la météo."""
    rayon_terre = 6_371_000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * rayon_terre * math.asin(math.sqrt(a))


def lire_csv(archive, nom):
    """Lit un fichier du zip GTFS (gère le BOM « utf-8-sig » que mettent certains réseaux)."""
    with archive.open(nom) as fichier:
        return list(csv.DictReader(io.TextIOWrapper(fichier, encoding="utf-8-sig")))


def en_minutes(heure):
    """« 25:10:00 » -> 1510 minutes (le GTFS dépasse 24 h pour les bus après minuit)."""
    try:
        h, m, *_ = (heure or "").split(":")
        return int(h) * 60 + int(m)
    except ValueError:
        return None


def couleur(valeur, defaut):
    valeur = (valeur or "").strip().lstrip("#")
    return f"#{valeur.upper()}" if len(valeur) == 6 else defaut


def gares_sncf(noms_cherches):
    """Position des gares SNCF couvertes, lue dans gtfs.db (déjà chargé chaque nuit)."""
    if not Path(BASE_GTFS_SNCF).exists():
        raise SystemExit("gtfs.db introuvable : lance d'abord python charger_gtfs.py")
    conn = sqlite3.connect(BASE_GTFS_SNCF)
    lignes = conn.execute("SELECT stop_name, stop_lat, stop_lon FROM stops").fetchall()
    conn.close()
    positions = defaultdict(list)
    for nom, lat, lon in lignes:
        if normaliser(nom) in noms_cherches and lat and lon:
            positions[nom].append((float(lat), float(lon)))
    # Une gare a souvent plusieurs points d'arrêt (TER, TGV...) : on garde leur moyenne
    return {nom: (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
            for nom, pts in positions.items()}


def preparer(code, reseau):
    print(f"\n== {reseau['nom']} ==", flush=True)
    fichier_local = DOSSIER_ZIP / f"{code}.zip"
    if fichier_local.exists():
        contenu = fichier_local.read_bytes()
        date = datetime.fromtimestamp(fichier_local.stat().st_mtime).strftime("%d/%m/%Y")
        print(f"   Fichier local : {fichier_local} ({len(contenu) / 1024 / 1024:.1f} Mo, du {date})", flush=True)
    else:
        print(f"   {fichier_local} absent : téléchargement automatique…", flush=True)
        reponse = requests.get(reseau["url"], timeout=120)
        reponse.raise_for_status()
        contenu = reponse.content
        print(f"   Téléchargé : {len(contenu) / 1024 / 1024:.1f} Mo", flush=True)
    archive = zipfile.ZipFile(io.BytesIO(contenu))

    # ---------- Les lignes ----------
    lignes = {}
    for r in lire_csv(archive, "routes.txt"):
        lignes[r["route_id"]] = {
            "nom": (r.get("route_short_name") or r.get("route_long_name") or "?").strip(),
            "long": (r.get("route_long_name") or "").strip(),
            "couleur": couleur(r.get("route_color"), "#14213D"),
            "texte": couleur(r.get("route_text_color"), "#FFFFFF"),
        }

    # ---------- Les arrêts ----------
    arrets = {}
    for s in lire_csv(archive, "stops.txt"):
        if s.get("location_type", "0") not in ("", "0"):      # on garde les points d'arrêt, pas les zones
            continue
        try:
            arrets[s["stop_id"]] = [s["stop_name"].strip(), round(float(s["stop_lat"]), 6),
                                    round(float(s["stop_lon"]), 6)]
        except (KeyError, ValueError):
            continue

    # ---------- Les voyages, regroupés en parcours ----------
    voyages = {t["trip_id"]: (t["route_id"], (t.get("trip_headsign") or "").strip())
               for t in lire_csv(archive, "trips.txt")}
    suites = defaultdict(list)                     # trip_id -> [(ordre, stop_id, minutes)]
    for st in lire_csv(archive, "stop_times.txt"):
        if st["trip_id"] in voyages and st["stop_id"] in arrets:
            suites[st["trip_id"]].append((int(st["stop_sequence"]), st["stop_id"],
                                          en_minutes(st.get("departure_time") or st.get("arrival_time"))))

    compte = Counter()
    temps = {}                                     # parcours -> minutes depuis le 1er arrêt
    for trip_id, suite in suites.items():
        route_id, direction = voyages[trip_id]
        suite.sort()
        ordre = tuple(stop_id for _, stop_id, _ in suite)
        if len(ordre) >= 2:
            # Sans direction annoncée, on prend le dernier arrêt comme direction
            cle = (route_id, direction or arrets[ordre[-1]][0], ordre)
            compte[cle] += 1
            # La durée entre arrêts, prise sur un voyage réel de ce parcours
            minutes = [m for _, _, m in suite]
            if cle not in temps and None not in minutes:
                temps[cle] = [m - minutes[0] for m in minutes]

    parcours = [{"ligne": route_id, "direction": direction, "arrets": list(ordre), "voyages": n,
                 "minutes": temps.get((route_id, direction, ordre))}
                for (route_id, direction, ordre), n in compte.items()
                if n >= MIN_VOYAGES and route_id in lignes]
    print(f"   {len(suites)} voyages regroupés en {len(parcours)} parcours "
          f"(ignorés : {sum(1 for n in compte.values() if n < MIN_VOYAGES)} parcours exceptionnels)", flush=True)

    # On ne garde que les arrêts et les lignes réellement utilisés
    utilises = {a for p in parcours for a in p["arrets"]}
    arrets = {a: v for a, v in arrets.items() if a in utilises}
    lignes = {l: v for l, v in lignes.items() if any(p["ligne"] == l for p in parcours)}

    # ---------- Les gares et leurs arrêts proches ----------
    gares = {}
    for nom_gare, (lat, lon) in gares_sncf(set(reseau["gares"])).items():
        proches = sorted((round(distance_m(lat, lon, a[1], a[2])), stop_id) for stop_id, a in arrets.items())
        proches = [[stop_id, d] for d, stop_id in proches if d <= RAYON_GARE]
        gares[nom_gare] = {"lat": round(lat, 6), "lon": round(lon, 6), "arrets_proches": proches}
        noms = sorted({arrets[s][0] for s, _ in proches})
        print(f"   Gare {nom_gare} : {len(proches)} arrêts à moins de {RAYON_GARE} m"
              f"{' (' + ', '.join(noms[:4]) + ')' if noms else ''}", flush=True)
    if not gares:
        print("   ATTENTION : aucune gare SNCF retrouvée pour ce réseau", flush=True)

    sortie = {
        "reseau": reseau["nom"],
        "source": reseau["source"],
        "genere_le": datetime.now(ZoneInfo("Europe/Paris")).strftime("%Y-%m-%d %H:%M"),
        "lignes": lignes,
        "arrets": arrets,
        "parcours": parcours,
        "gares": gares,
    }
    DOSSIER_SORTIE.mkdir(parents=True, exist_ok=True)
    chemin = DOSSIER_SORTIE / f"{code}.json"
    chemin.write_text(json.dumps(sortie, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"   {len(lignes)} lignes, {len(arrets)} arrêts -> {chemin} "
          f"({chemin.stat().st_size / 1024:.0f} Ko)", flush=True)


def main():
    erreurs = 0
    for code, reseau in RESEAUX.items():
        try:
            preparer(code, reseau)
        except Exception as erreur:            # un réseau en panne n'empêche pas les autres
            erreurs += 1
            print(f"   ÉCHEC pour {reseau['nom']} : {erreur}", flush=True)
    sys.exit(1 if erreurs == len(RESEAUX) else 0)


if __name__ == "__main__":
    main()
