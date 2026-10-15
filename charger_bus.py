"""
Les bus à l'arrivée en gare : préparation des données (Calais et Boulogne).

Pour chaque réseau de bus, ce script :
  1. lit ses horaires en données ouvertes (format GTFS, comme la SNCF) :
     le fichier donnees_bus/<reseau>.zip s'il existe (téléchargé à la main),
     sinon il le télécharge lui-même ;
  2. regroupe les voyages en PARCOURS : une ligne fait des centaines de voyages par jour,
     mais suit seulement quelques trajets différents (un par sens, parfois une variante) ;
  3. relie chaque gare SNCF couverte aux arrêts de bus à moins de 400 m ;
  4. prépare les LIEUX UTILES autour des gares (universités, hôpitaux, mairie, plages...),
     depuis OpenStreetMap, pour que le site les retrouve sans interroger Internet à chaque question ;
  5. écrit un petit fichier pour le site : site/public/bus/<reseau>.json

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
import time
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
# On garde TOUS les parcours, avec leur nombre de voyages : le site pénalise les plus rares.
# (Certains réseaux, comme Marinéo, décrivent un voyage valable de nombreux jours en UNE seule ligne :
#  un seuil fixe écartait alors des lignes tout à fait normales.)

# OpenStreetMap demande à chaque programme de se présenter (sinon : « 406 Not Acceptable »)
ENTETES = {"User-Agent": "QuaiNord/1.0 (projet etudiant, https://github.com/Aly2001/quai-nord)"}

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


# ---------- Les lieux utiles (OpenStreetMap) ----------
SERVEURS_OVERPASS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
RAYON_LIEUX = 10_000        # mètres autour de chaque gare

# Les filtres OpenStreetMap des lieux qu'on garde (« l'un OU l'autre »)
FILTRES_LIEUX = [
    '["amenity"~"^(university|college|hospital|clinic|townhall|school|post_office|police|library|theatre|cinema|ferry_terminal)$"]["name"]',
    '["building"~"^(university|college)$"]["name"]',
    '["natural"="beach"]["name"]',
    '["leisure"~"^(stadium|sports_centre|swimming_pool)$"]["name"]',
    '["tourism"~"^(museum|attraction|aquarium|zoo)$"]["name"]',
    '["shop"="mall"]["name"]',
]


def categorie_lieu(tags):
    """La catégorie d'un lieu OpenStreetMap, avec le même vocabulaire que le site (bus.js)."""
    amenity, nom = tags.get("amenity", ""), tags.get("name", "")
    nom_simple = normaliser(nom)
    if amenity in ("university", "college") or tags.get("building") in ("university", "college"):
        return "universite"
    if amenity in ("hospital", "clinic"):
        return "hopital"
    if amenity == "school":
        if "lycee" in nom_simple:
            return "lycee"
        if "college" in nom_simple:
            return "college"
        return None                                   # écoles primaires : trop nombreuses, on les écarte
    simples = {"townhall": "mairie", "post_office": "poste", "police": "police", "library": "mediatheque",
               "theatre": "theatre", "cinema": "cinema", "ferry_terminal": "ferry"}
    if amenity in simples:
        return simples[amenity]
    if tags.get("natural") == "beach":
        return "plage"
    leisure = tags.get("leisure", "")
    if leisure == "stadium":
        return "stade"
    if leisure == "swimming_pool" or (leisure == "sports_centre" and tags.get("sport") == "swimming"):
        return "piscine"
    if tags.get("tourism") == "museum":
        return "musee"
    if tags.get("tourism") in ("attraction", "aquarium", "zoo"):
        return "loisirs"
    if tags.get("shop") == "mall":
        return "commerce"
    return None


def demander_overpass(requete):
    """Une petite demande à OpenStreetMap, avec patience : 3 essais, sur 3 serveurs, en attendant
    de plus en plus longtemps (les serveurs publics sont gratuits et souvent très sollicités)."""
    for essai, attente in enumerate([0, 15, 45]):
        if attente:
            print(f"      nouvel essai dans {attente} s…", flush=True)
            time.sleep(attente)
        for serveur in SERVEURS_OVERPASS:
            try:
                reponse = requests.post(serveur, data={"data": requete}, headers=ENTETES, timeout=60)
                reponse.raise_for_status()
                return reponse.json()["elements"]
            except Exception as erreur:
                print(f"      {serveur.split('/')[2]} : {str(erreur)[:70]}", flush=True)
    return None


def lieux_utiles(gares, anciens):
    """Les lieux nommés autour des gares, téléchargés depuis OpenStreetMap, une petite demande par type.
    En cas d'échec, on GARDE les lieux de la dernière préparation réussie."""
    if not gares:
        return anciens
    lats = [lat for lat, _ in gares.values()]
    lons = [lon for _, lon in gares.values()]
    # Un rectangle d'environ 10 km autour des gares (sud, ouest, nord, est)
    rectangle = f"{min(lats) - 0.09},{min(lons) - 0.14},{max(lats) + 0.09},{max(lons) + 0.14}"
    elements, echecs = [], 0
    for filtre in FILTRES_LIEUX:
        resultat = demander_overpass(f"[out:json][timeout:50];nwr{filtre}({rectangle});out center tags;")
        if resultat is None:
            echecs += 1
        else:
            elements += resultat
        time.sleep(2)                                      # rester poli avec les serveurs
    if echecs == len(FILTRES_LIEUX):
        print(f"   ATTENTION : OpenStreetMap indisponible, on garde les {len(anciens)} lieux de la dernière fois", flush=True)
        return anciens
    lieux, vus = [], set()
    for e in elements:
        tags = e.get("tags", {})
        categorie = categorie_lieu(tags)
        lat = e.get("lat", e.get("center", {}).get("lat"))
        lon = e.get("lon", e.get("center", {}).get("lon"))
        cle = (normaliser(tags.get("name", "")), categorie)
        if not categorie or lat is None or cle in vus:   # un même lieu peut être décrit plusieurs fois
            continue
        vus.add(cle)
        lieux.append({"nom": tags["name"], "cat": categorie, "lat": round(lat, 6), "lon": round(lon, 6)})
    if echecs:
        # Fusion : les catégories absentes cette fois gardent leurs lieux de la dernière préparation
        presentes = {l["cat"] for l in lieux}
        recuperes = [l for l in anciens if l["cat"] not in presentes]
        lieux += recuperes
        print(f"   ATTENTION : {echecs} types de lieux sur {len(FILTRES_LIEUX)} non téléchargés"
              f"{f' ({len(recuperes)} lieux de la dernière fois conservés)' if recuperes else ''}", flush=True)
    if not lieux:
        print(f"   ATTENTION : aucun lieu reçu, on garde les {len(anciens)} lieux de la dernière fois", flush=True)
        return anciens
    return lieux


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
        reponse = requests.get(reseau["url"], headers=ENTETES, timeout=120)
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
                for (route_id, direction, ordre), n in compte.items() if route_id in lignes]
    print(f"   {len(suites)} voyages regroupés en {len(parcours)} parcours "
          f"(dont {sum(1 for p in parcours if p['voyages'] < 3)} peu fréquents, pénalisés dans le classement)", flush=True)

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

    # ---------- Les lieux utiles autour des gares ----------
    chemin = DOSSIER_SORTIE / f"{code}.json"
    anciens = []
    if chemin.exists():
        try:
            anciens = json.loads(chemin.read_text(encoding="utf-8")).get("lieux", [])
        except ValueError:
            pass
    print("   Lieux utiles (OpenStreetMap)…", flush=True)
    lieux = lieux_utiles({nom: (g["lat"], g["lon"]) for nom, g in gares.items()}, anciens)
    if lieux:
        par_categorie = Counter(l["cat"] for l in lieux)
        print(f"   {len(lieux)} lieux utiles : " + ", ".join(f"{c} {n}" for c, n in par_categorie.most_common()), flush=True)
        universites = sorted(l["nom"] for l in lieux if l["cat"] == "universite")
        if universites:
            print(f"   Universités : {', '.join(universites[:6])}", flush=True)

    sortie = {
        "reseau": reseau["nom"],
        "source": reseau["source"],
        "genere_le": datetime.now(ZoneInfo("Europe/Paris")).strftime("%Y-%m-%d %H:%M"),
        "lignes": lignes,
        "arrets": arrets,
        "parcours": parcours,
        "gares": gares,
        "lieux": lieux,
        "source_lieux": "© les contributeurs d'OpenStreetMap (ODbL)",
    }
    DOSSIER_SORTIE.mkdir(parents=True, exist_ok=True)
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
