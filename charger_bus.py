"""
Les bus, trams et métros à l'arrivée en gare : préparation des données.

Les réseaux couverts sont décrits dans UNE seule liste, site/src/data/reseaux.json,
lue aussi par le site et par Nora (comme la FAQ) : ajouter un réseau = ajouter une entrée.

Pour UN réseau à la fois, ce script :
  1. lit ses horaires en données ouvertes (format GTFS, comme la SNCF) :
     le fichier donnees_bus/<reseau>.zip s'il existe (téléchargé à la main),
     sinon il le télécharge lui-même ;
     puis il CONTRÔLE la période de validité du fichier : un fichier expiré est refusé,
     et l'ancien fichier du site est gardé ;
  2. écarte les lignes inutiles au voyageur (scolaires, transport à la demande)
     et note le type de chaque ligne : bus, tram ou métro ;
  3. regroupe les voyages en PARCOURS : une ligne fait des centaines de voyages par jour,
     mais suit seulement quelques trajets différents (un par sens, parfois une variante) ;
  4. relie chaque gare SNCF couverte aux arrêts de bus à moins de 400 m ;
  5. prépare les LIEUX UTILES autour des gares (universités, hôpitaux, mairie, plages...),
     depuis OpenStreetMap, pour que le site les retrouve sans interroger Internet à chaque question ;
  6. écrit un petit fichier pour le site : site/public/bus/<reseau>.json

Le site n'a ensuite qu'à lire ce fichier pour répondre à
« quelle ligne relie la gare à tel endroit ? » : aucun calcul lourd sur le téléphone.

Lancement, depuis le dossier projet-sncf :
    python charger_bus.py            -> la liste des réseaux et l'état de leurs fichiers
    python charger_bus.py lille      -> prépare un seul réseau
    python charger_bus.py tous       -> prépare tous les réseaux, l'un après l'autre
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
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import re

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

# La liste UNIQUE des réseaux (voir l'explication de chaque champ dans le fichier lui-même)
FICHIER_RESEAUX = Path("site/src/data/reseaux.json")
JOURS_AVANT_ALERTE = 30     # on prévient quand un fichier expire dans moins d'un mois


def lire_reseaux(chemin=FICHIER_RESEAUX):
    """{code: réseau} depuis reseaux.json."""
    donnees = json.loads(Path(chemin).read_text(encoding="utf-8"))
    return {r["code"]: r for r in donnees["reseaux"]}


# ---------- Les HORAIRES : à quelle heure passe chaque bus ----------
# Un bus suit toujours le même parcours, avec les mêmes durées entre les arrêts (déjà gardées dans
# « minutes »). On garde donc seulement, pour chaque parcours, l'heure de départ de CHAQUE voyage au
# premier arrêt, et ses jours de circulation. Le site calcule le reste : départ 14:32 + 4 min = 14:36.
# Un fichier à part ({code}_horaires.json), chargé seulement quand on cherche un bus.

def lire_services(archive):
    """Les jours de circulation : {service: [jours « 1111100 », du, au, [jours ajoutés], [jours retirés]]}."""
    services = {}
    noms = set(archive.namelist())
    if "calendar.txt" in noms:
        semaine = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
        for c in lire_csv_flux(archive, "calendar.txt"):
            services[c["service_id"].strip()] = ["".join((c.get(j) or "0").strip() for j in semaine),
                                                 (c.get("start_date") or "").strip(), (c.get("end_date") or "").strip(), [], []]
    if "calendar_dates.txt" in noms:
        for c in lire_csv_flux(archive, "calendar_dates.txt"):
            service = services.setdefault(c["service_id"].strip(), ["0000000", "", "", [], []])
            (service[3] if (c.get("exception_type") or "").strip() == "1" else service[4]).append(c["date"].strip())
    return services


def jours_du_service(service, debut, fin):
    """L'ensemble des jours (dates) où circule un service, entre debut et fin."""
    semaine, du, au, ajoutes, retires = service
    jours = set()
    d, f = en_date(du), en_date(au)
    if d and f:
        jour = max(d, debut)
        while jour <= min(f, fin):
            if semaine[jour.weekday()] == "1":
                jours.add(jour)
            jour += timedelta(days=1)
    jours |= {j for j in map(en_date, ajoutes) if j and debut <= j <= fin}
    return jours - {j for j in map(en_date, retires) if j}


def ecrire_horaires(code, archive, cles, departs, debut, fin):
    """Le fichier des horaires, compact : les services qui circulent EXACTEMENT les mêmes jours sont réunis
    (Lille en décrit des milliers, pour seulement quelques dizaines de calendriers différents).
    Chaque calendrier est une suite de 0 et de 1, un caractère par jour depuis « debut »."""
    chemin = DOSSIER_SORTIE / f"{code}_horaires.json"
    services = lire_services(archive)
    if not (debut and fin):
        chemin.write_text(json.dumps({"debut": None, "jours": [], "departs": [{} for _ in cles]}), encoding="utf-8")
        return
    nb_jours = (fin - debut).days + 1
    calendriers, numero_calendrier, calendrier_du_service = [], {}, {}
    for nom, service in services.items():
        actifs = jours_du_service(service, debut, fin)
        if not actifs:
            continue
        motif = "".join("1" if debut + timedelta(days=i) in actifs else "0" for i in range(nb_jours))
        if motif not in numero_calendrier:
            numero_calendrier[motif] = len(calendriers)
            calendriers.append(motif)
        calendrier_du_service[nom] = numero_calendrier[motif]
    par_parcours = []
    for cle in cles:
        groupes = defaultdict(set)
        for service, minute in departs[cle]:
            if service in calendrier_du_service:
                groupes[str(calendrier_du_service[service])].add(minute)
        par_parcours.append({n: sorted(m) for n, m in groupes.items()})
    horaires = {"debut": debut.isoformat(), "jours": calendriers, "departs": par_parcours}
    chemin.write_text(json.dumps(horaires, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    total = sum(len(m) for p in par_parcours for m in p.values())
    print(f"   {total} départs de bus, {len(services)} services réunis en {len(calendriers)} calendriers "
          f"-> {chemin} ({chemin.stat().st_size / 1024:.0f} Ko)", flush=True)


# ---------- La validité du fichier GTFS ----------
# Un fichier GTFS décrit ses jours de circulation de deux façons, souvent mélangées :
#   calendar.txt       : « du lundi au vendredi, du 01/09 au 30/06 » (start_date, end_date)
#   calendar_dates.txt : des jours un par un, ajoutés (exception_type 1) ou retirés (2)
# La période du fichier va donc du premier au dernier jour cité, dans l'un OU l'autre.

def en_date(texte):
    """« 20261231 » -> date(2026, 12, 31) ; None si le texte n'est pas une date."""
    try:
        return datetime.strptime((texte or "").strip(), "%Y%m%d").date()
    except ValueError:
        return None


def periode_validite(archive):
    """(premier jour, dernier jour) de circulation décrits par le fichier, ou (None, None)."""
    jours = []
    noms = set(archive.namelist())
    if "calendar.txt" in noms:
        for c in lire_csv_flux(archive, "calendar.txt"):
            jours += [en_date(c.get("start_date")), en_date(c.get("end_date"))]
    if "calendar_dates.txt" in noms:
        for c in lire_csv_flux(archive, "calendar_dates.txt"):
            if (c.get("exception_type") or "").strip() == "1":
                jours.append(en_date(c.get("date")))
    jours = [j for j in jours if j]
    return (min(jours), max(jours)) if jours else (None, None)


def controler_validite(debut, fin, aujourd_hui=None):
    """Refuse un fichier expiré (exception) ; renvoie la liste des avertissements sinon."""
    aujourd_hui = aujourd_hui or date.today()
    if fin is None:
        return ["période de validité introuvable dans le fichier (ni calendar.txt ni calendar_dates.txt)"]
    if fin < aujourd_hui:
        raise ValueError(f"fichier EXPIRÉ depuis le {fin:%d/%m/%Y} : télécharge une version à jour "
                         "(l'ancien fichier du site est conservé)")
    avertissements = []
    if debut and debut > aujourd_hui:
        avertissements.append(f"ce fichier ne commence que le {debut:%d/%m/%Y} : "
                              "c'est peut-être le futur réseau, pas celui d'aujourd'hui")
    reste = (fin - aujourd_hui).days
    if reste < JOURS_AVANT_ALERTE:
        avertissements.append(f"le fichier expire dans {reste} jours (le {fin:%d/%m/%Y}) : "
                              "pense à le recharger bientôt")
    return avertissements


# ---------- Le type de transport, et les lignes écartées ----------
# Le champ route_type du GTFS dit le type de chaque ligne. Deux codifications existent :
# la simple (0 = tram, 1 = métro, 3 = bus) et l'étendue (900 = tram, 401 = métro, 700 = bus...).

def mode_transport(route_type):
    try:
        code = int(route_type)
    except (TypeError, ValueError):
        return "bus"
    if code == 0 or 900 <= code <= 999:
        return "tram"
    if code == 1 or 400 <= code <= 499:
        return "metro"
    return "bus"


# Écartées sur TOUS les réseaux : un voyageur qui sort du train ne peut pas les utiliser
# (les lignes scolaires sont réservées aux élèves, le transport à la demande se réserve à l'avance)
MOTIFS_EXCLUS_COMMUNS = [r"\bscolaire", r"\btad\b", r"\ba la demande\b", r"\btransport a la demande\b"]
TYPE_TRANSPORT_A_LA_DEMANDE = 715          # route_type GTFS : « bus à la demande »


def ligne_exclue(route, motifs_reseau=()):
    """Vrai si la ligne est scolaire ou à la demande (selon ses noms et son type)."""
    try:
        if int(route.get("route_type") or 3) == TYPE_TRANSPORT_A_LA_DEMANDE:
            return True
    except ValueError:
        pass
    noms = [normaliser(route.get("route_short_name") or ""), normaliser(route.get("route_long_name") or "")]
    motifs = MOTIFS_EXCLUS_COMMUNS + list(motifs_reseau)
    return any(re.search(motif, nom) for motif in motifs for nom in noms if nom)


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
        # Un lycée avec des classes prépas ou des BTS est souvent rangé « college » dans OpenStreetMap
        if nom_simple.startswith("lycee") or "cite scolaire" in nom_simple:
            return "lycee"
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
    lieux, parties, vus = [], [], set()
    for e in elements:
        tags = e.get("tags", {})
        categorie = categorie_lieu(tags)
        lat = e.get("lat", e.get("center", {}).get("lat"))
        lon = e.get("lon", e.get("center", {}).get("lon"))
        nom = tags.get("name", "")
        campus_declare = tags.get("amenity") in ("university", "college")
        if categorie == "universite" and campus_declare:
            # Une UFR déclarée comme université, avec sa lettre de bâtiment devant (« F - UFR d'Économie ») :
            # c'est une vraie destination pour un étudiant, on garde son nom sans la lettre
            nom = PREFIXE_AILE.sub("", nom)
            if normaliser(nom).startswith(NOMS_DE_PIECES):        # « Bâtiment A - Accueil » : jamais une destination
                continue
        cle = (normaliser(nom), categorie)
        if not categorie or lat is None or cle in vus:   # un même lieu peut être décrit plusieurs fois
            continue
        vus.add(cle)
        lieu = {"nom": nom, "cat": categorie, "lat": round(lat, 6), "lon": round(lon, 6)}
        # Un BÂTIMENT universitaire sans campus déclaré (« A - Accueil », « Amphithéâtre ») est peut-être
        # une simple partie d'un campus : on décide après avoir vu tous les campus (voir plus bas)
        if categorie == "universite" and not campus_declare:
            parties.append(lieu)
        else:
            lieux.append(lieu)
    lieux += batiments_utiles(parties, [l for l in lieux if l["cat"] == "universite"])
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


RAYON_CAMPUS = 400          # mètres : un bâtiment aussi proche d'un campus en fait partie
# « A - Accueil », « B2 : Amphis », « C1—Lettres » : tous les tirets possibles, espaces ou non
PARTIE_DE_BATIMENT = re.compile(r"^\w{1,2}\s*[-\u2010-\u2015\u2212:]\s*\S")
PREFIXE_AILE = re.compile(r"^\w{1,2}\s*[-\u2010-\u2015\u2212:]\s*(?=\S)")   # la lettre seule, à retirer
# Des noms de PIÈCES ou de services, jamais une destination en soi
NOMS_DE_PIECES = ("batiment", "amphi", "amphitheatre", "bibliotheque", "accueil", "salle", "hall",
                  "agence comptable", "scolarite", "restaurant universitaire", "cafeteria")


def batiments_utiles(batiments, campus):
    """Les bâtiments universitaires à garder comme destinations.
    Sur certains campus, chaque bâtiment est décrit à part (« A - Accueil », « Bibliothèque »...) :
    proposés au voyageur, ils noieraient le vrai campus. On les écarte s'ils sont près d'un campus,
    ou si leur nom est celui d'une aile (« A - ... »). Un bâtiment isolé (sans campus déclaré) est gardé."""
    gardes = []
    for b in batiments:
        if PARTIE_DE_BATIMENT.match(b["nom"]) or normaliser(b["nom"]).startswith(NOMS_DE_PIECES):
            continue
        if any(distance_m(b["lat"], b["lon"], c["lat"], c["lon"]) <= RAYON_CAMPUS for c in campus):
            continue
        gardes.append(b)
    return gardes


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


def arret_sur_reservation(horaire):
    """Vrai si, à cet arrêt, il faut réserver pour monter ou pour descendre (code GTFS 2)."""
    return "2" in ((horaire.get("pickup_type") or "").strip(), (horaire.get("drop_off_type") or "").strip())


RAYON_DESTINATION = 500     # mètres : comme sur le site (bus.js), la marche maximale entre l'arrêt et le lieu
# Les GRANDS sites (un campus, un hôpital) sont décrits par leur point central, souvent loin de l'entrée :
# on accepte une marche un peu plus longue jusqu'à ce point
RAYON_GRANDS_SITES = 800
CATEGORIES_GRANDS_SITES = {"universite", "hopital", "stade", "commerce", "loisirs", "plage"}


def rayon_marche(categorie):
    return RAYON_GRANDS_SITES if categorie in CATEGORIES_GRANDS_SITES else RAYON_DESTINATION


def lieux_desservis(lieux, arrets):
    """Seulement les lieux qui ont un arrêt du réseau à distance de marche (500 m, 800 m pour un grand site) :
    les autres (un village voisin, une ville belge proche de la frontière) ne sont de toute façon pas desservis."""
    # Un premier tri grossier par carrés d'environ 1 km, pour ne pas calculer des millions de distances
    carres = defaultdict(list)
    for _, lat, lon in arrets.values():
        carres[(round(lat * 100), round(lon * 70))].append((lat, lon))
    gardes = []
    for l in lieux:
        cle_lat, cle_lon = round(l["lat"] * 100), round(l["lon"] * 70)
        voisins = [a for dl in (-1, 0, 1) for dk in (-1, 0, 1) for a in carres.get((cle_lat + dl, cle_lon + dk), [])]
        rayon = rayon_marche(l["cat"])
        if any(distance_m(l["lat"], l["lon"], lat, lon) <= rayon for lat, lon in voisins):
            gardes.append(l)
    return gardes


def lire_csv_flux(archive, nom):
    """Lit un fichier du zip GTFS ligne par ligne, sans tout garder en mémoire
    (gère le BOM « utf-8-sig » que mettent certains réseaux)."""
    with archive.open(nom) as fichier:
        yield from csv.DictReader(io.TextIOWrapper(fichier, encoding="utf-8-sig"))


def lire_csv(archive, nom):
    """Lit un petit fichier du zip GTFS en entier."""
    return list(lire_csv_flux(archive, nom))


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

    # ---------- La validité du fichier (avant tout le reste) ----------
    debut, fin = periode_validite(archive)
    if fin:
        print(f"   Valide du {debut:%d/%m/%Y} au {fin:%d/%m/%Y}", flush=True)
    for avertissement in controler_validite(debut, fin):        # un fichier expiré s'arrête ici
        print(f"   ATTENTION : {avertissement}", flush=True)

    # ---------- Les lignes ----------
    lignes, exclues = {}, []
    for r in lire_csv(archive, "routes.txt"):
        nom = (r.get("route_short_name") or r.get("route_long_name") or "?").strip()
        if ligne_exclue(r, reseau.get("exclure", [])):
            exclues.append(nom)
            continue
        lignes[r["route_id"]] = {
            "nom": nom,
            "long": (r.get("route_long_name") or "").strip(),
            "mode": mode_transport(r.get("route_type")),
            "couleur": couleur(r.get("route_color"), "#14213D"),
            "texte": couleur(r.get("route_text_color"), "#FFFFFF"),
        }
    if exclues:
        # La liste COMPLÈTE, triée « naturellement » (S2 avant S10), pour vérifier qu'aucune vraie ligne n'y est
        tri = sorted(exclues, key=lambda n: [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", n)])
        print(f"   {len(exclues)} lignes écartées (scolaires, à la demande) : {', '.join(tri)}", flush=True)

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
    # (seulement les voyages des lignes gardées)
    voyages = {t["trip_id"]: (t["route_id"], (t.get("trip_headsign") or "").strip(), (t.get("service_id") or "").strip())
               for t in lire_csv_flux(archive, "trips.txt") if t["route_id"] in lignes}
    suites = defaultdict(list)                     # trip_id -> [(ordre, stop_id, minutes)]
    reserves = Counter()                           # trip_id -> nombre d'arrêts « sur réservation »
    for st in lire_csv_flux(archive, "stop_times.txt"):
        if st["trip_id"] in voyages and st["stop_id"] in arrets:
            suites[st["trip_id"]].append((int(st["stop_sequence"]), st["stop_id"],
                                          en_minutes(st.get("departure_time") or st.get("arrival_time"))))
            if arret_sur_reservation(st):
                reserves[st["trip_id"]] += 1

    # Les voyages SUR RÉSERVATION (le GTFS le dit arrêt par arrêt : pickup_type ou drop_off_type = 2,
    # « téléphoner avant ») : un voyageur qui sort du train ne peut pas les prendre. On écarte un voyage
    # quand la plupart de ses arrêts sont sur réservation, quel que soit le nom de sa ligne.
    sur_reservation = {t for t, n in reserves.items() if n * 2 > len(suites[t])}
    if sur_reservation:
        lignes_avant = {voyages[t][0] for t in suites}
        for t in sur_reservation:
            del suites[t]
        disparues = sorted(lignes[r]["nom"] for r in lignes_avant - {voyages[t][0] for t in suites})
        print(f"   {len(sur_reservation)} voyages sur réservation écartés"
              f"{' (lignes entièrement sur réservation : ' + ', '.join(disparues) + ')' if disparues else ''}",
              flush=True)

    compte = Counter()
    temps = {}                                     # parcours -> minutes depuis le 1er arrêt
    departs = defaultdict(list)                    # parcours -> [(service, heure de départ au 1er arrêt)]
    for trip_id, suite in suites.items():
        route_id, direction, service = voyages[trip_id]
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
            if minutes[0] is not None:
                departs[cle].append((service, minutes[0]))

    cles = [cle for cle in compte if cle[0] in lignes]
    parcours = [{"ligne": route_id, "direction": direction, "arrets": list(ordre), "voyages": compte[(route_id, direction, ordre)],
                 "minutes": temps.get((route_id, direction, ordre))}
                for (route_id, direction, ordre) in cles]
    print(f"   {len(suites)} voyages regroupés en {len(parcours)} parcours "
          f"(dont {sum(1 for p in parcours if p['voyages'] < 3)} peu fréquents, pénalisés dans le classement)", flush=True)

    # On ne garde que les arrêts et les lignes réellement utilisés
    utilises = {a for p in parcours for a in p["arrets"]}
    arrets = {a: v for a, v in arrets.items() if a in utilises}
    lignes = {l: v for l, v in lignes.items() if any(p["ligne"] == l for p in parcours)}
    # Le bilan des lignes, APRÈS tous les tris (noms, réservation)
    par_mode = Counter(l["mode"] for l in lignes.values())
    print(f"   {len(lignes)} lignes gardées (" + ", ".join(f"{m} {n}" for m, n in par_mode.most_common()) + ") : "
          + ", ".join(sorted((l["nom"] for l in lignes.values()),
                             key=lambda n: [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", n)])),
          flush=True)

    # ---------- Les gares et leurs arrêts proches ----------
    gares = {}
    cherchees = {normaliser(nom) for nom in reseau["gares"]}       # comparées sans accents ni tirets
    trouvees = gares_sncf(cherchees)
    manquantes = cherchees - {normaliser(nom) for nom in trouvees}
    if manquantes:
        print(f"   ATTENTION : gares introuvables dans gtfs.db : {', '.join(sorted(manquantes))} "
              "(vérifie leur nom SNCF dans reseaux.json)", flush=True)
    for nom_gare, (lat, lon) in trouvees.items():
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
    desservis = lieux_desservis(lieux, arrets)
    if len(desservis) < len(lieux):
        print(f"   {len(lieux) - len(desservis)} lieux écartés : aucun arrêt à distance de marche "
              f"({RAYON_DESTINATION} m, {RAYON_GRANDS_SITES} m pour un campus ou un hôpital)", flush=True)
    lieux = desservis
    if lieux:
        par_categorie = Counter(l["cat"] for l in lieux)
        print(f"   {len(lieux)} lieux utiles : " + ", ".join(f"{c} {n}" for c, n in par_categorie.most_common()), flush=True)
        universites = sorted(l["nom"] for l in lieux if l["cat"] == "universite")
        if universites:
            print(f"   Universités : {' | '.join(universites)}", flush=True)

    sortie = {
        "reseau": reseau["nom"],
        "source": reseau["source"],
        "genere_le": datetime.now(ZoneInfo("Europe/Paris")).strftime("%Y-%m-%d %H:%M"),
        "valide_du": debut.isoformat() if debut else None,
        "valide_jusqu_au": fin.isoformat() if fin else None,
        "lignes": lignes,
        "arrets": arrets,
        "parcours": parcours,
        "gares": gares,
        "lieux": lieux,
        "source_lieux": "© les contributeurs d'OpenStreetMap (ODbL)",
    }
    DOSSIER_SORTIE.mkdir(parents=True, exist_ok=True)
    chemin.write_text(json.dumps(sortie, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    ecrire_horaires(code, archive, cles, departs, debut, fin)
    print(f"   {len(lignes)} lignes, {len(arrets)} arrêts -> {chemin} "
          f"({chemin.stat().st_size / 1024:.0f} Ko)", flush=True)


def etat_des_reseaux(reseaux):
    """La liste des réseaux, avec la date de préparation et la validité de leur fichier actuel."""
    print("Réseaux de reseaux.json :\n")
    for code, reseau in reseaux.items():
        chemin = DOSSIER_SORTIE / f"{code}.json"
        etat = "pas encore préparé"
        if chemin.exists():
            try:
                donnees = json.loads(chemin.read_text(encoding="utf-8"))
                fin = donnees.get("valide_jusqu_au")
                etat = f"préparé le {donnees.get('genere_le', '?')}" + (
                    f", valide jusqu'au {date.fromisoformat(fin):%d/%m/%Y}" if fin else ", validité non contrôlée")
            except ValueError:
                etat = "fichier illisible"
        print(f"   {code:<10} {reseau['nom']:<28} {etat}")
    print("\nPour préparer un réseau : python charger_bus.py <code>   (ou : python charger_bus.py tous)")


def ecrire_gares_couvertes(reseaux):
    """La position des gares de tous les réseaux, dans un petit fichier pour le site (bouton « Ma position ») :
    le téléphone trouve la gare la plus proche sans télécharger chaque réseau."""
    gares = []
    for code in reseaux:
        chemin = DOSSIER_SORTIE / f"{code}.json"
        if not chemin.exists():
            continue
        donnees = json.loads(chemin.read_text(encoding="utf-8"))
        for nom, g in donnees.get("gares", {}).items():
            gares.append({"nom": nom, "reseau": code, "lat": g["lat"], "lon": g["lon"]})
    sortie = DOSSIER_SORTIE / "gares.json"
    sortie.write_text(json.dumps({"gares": gares}, ensure_ascii=False), encoding="utf-8")
    print(f"\n{len(gares)} gares couvertes -> {sortie}", flush=True)


def main(arguments=None):
    arguments = sys.argv[1:] if arguments is None else arguments
    reseaux = lire_reseaux()
    if not arguments:
        etat_des_reseaux(reseaux)
        return 0
    codes = list(reseaux) if arguments == ["tous"] else [a.lower() for a in arguments]
    inconnus = [c for c in codes if c not in reseaux]
    if inconnus:
        print(f"Réseau inconnu : {', '.join(inconnus)}. Réseaux possibles : {', '.join(reseaux)}, ou tous")
        return 1
    erreurs = 0
    for code in codes:
        try:
            preparer(code, reseaux[code])
        except Exception as erreur:            # un réseau en panne n'empêche pas les autres
            erreurs += 1
            print(f"   ÉCHEC pour {reseaux[code]['nom']} : {erreur}", flush=True)
    ecrire_gares_couvertes(reseaux)
    return 1 if erreurs else 0


if __name__ == "__main__":
    sys.exit(main())
