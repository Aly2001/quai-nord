"""
Génère une page web des horaires PRÉVUS d'une gare, pour demain.

Les horaires viennent du GTFS (gtfs.db) : ce sont les horaires théoriques,
sans les retards. La page est un simple fichier HTML qui s'ouvre dans le
navigateur, sans serveur.

Lancement :
    python page_horaires.py                          -> Boulogne-Tintelleries, demain
    python page_horaires.py "Lille Flandres"         -> une autre gare, demain
    python page_horaires.py "Calais Ville" 2026-10-15 -> une autre gare, une autre date
"""

import html
import sqlite3
import sys
import webbrowser
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

BASE_GTFS = "gtfs.db"
GARE_PAR_DEFAUT = "Tintelleries"
JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet",
        "août", "septembre", "octobre", "novembre", "décembre"]
JOURS_GTFS = ["monday", "tuesday", "wednesday", "thursday", "friday",
              "saturday", "sunday"]
TYPES_TRANSPORT = {"2": "Train", "3": "Car"}   # codes GTFS route_type


# ----------------------------------------------------------------------
# Lecture des données
# ----------------------------------------------------------------------
def table_existe(conn, nom):
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
                        (nom,)).fetchone() is not None


def services_actifs(conn, jour):
    """Renvoie les service_id qui circulent ce jour-là.
    calendar      = règles (ex. : du lundi au vendredi jusqu'en mars)
    calendar_dates = exceptions (1 = ajouté ce jour, 2 = supprimé ce jour)"""
    d = jour.strftime("%Y%m%d")
    actifs = set()
    if table_existe(conn, "calendar"):
        colonne = JOURS_GTFS[jour.weekday()]
        actifs |= {r[0] for r in conn.execute(
            f"SELECT service_id FROM calendar WHERE start_date <= ? "
            f"AND end_date >= ? AND {colonne} = '1'", (d, d))}
    if table_existe(conn, "calendar_dates"):
        exceptions = conn.execute(
            "SELECT service_id, exception_type FROM calendar_dates WHERE date = ?", (d,))
        for service, type_exception in exceptions:
            if type_exception == "1":
                actifs.add(service)
            elif type_exception == "2":
                actifs.discard(service)
    return actifs


def trouver_gare(conn, recherche):
    motif = "%" + recherche.replace("-", "%").replace(" ", "%") + "%"
    lignes = conn.execute(
        "SELECT stop_id, stop_name FROM stops WHERE stop_name LIKE ?", (motif,)).fetchall()
    if not lignes:
        raise SystemExit(f"Aucune gare ne correspond à « {recherche} ». "
                         "Essaie un autre nom, par exemple \"Lille Flandres\".")
    noms = {nom for _, nom in lignes}
    if len(noms) > 1:
        print("Plusieurs gares correspondent :", ", ".join(sorted(noms)))
        print("Je les affiche toutes ensemble ; précise le nom si besoin.")
    nom_affiche = min(noms, key=len)
    return [stop_id for stop_id, _ in lignes], nom_affiche


def en_secondes(heure_gtfs):
    h, m, s = (int(x) for x in heure_gtfs.split(":"))
    return h * 3600 + m * 60 + s


def horaires_du_jour(conn, stop_ids, jour):
    services_jour = services_actifs(conn, jour)
    services_veille = services_actifs(conn, jour - timedelta(days=1))
    marques = ",".join("?" * len(stop_ids))
    lignes = conn.execute(f"""
        SELECT st.trip_id, st.arrival_time, st.departure_time,
               CAST(st.stop_sequence AS INTEGER), t.service_id,
               t.trip_headsign, r.route_short_name, r.route_type
        FROM stop_times st
        JOIN trips t ON t.trip_id = st.trip_id
        LEFT JOIN routes r ON r.route_id = t.route_id
        WHERE st.stop_id IN ({marques})
    """, stop_ids).fetchall()

    passages = []
    for trip_id, arr, dep, ordre, service, numero, ligne, type_route in lignes:
        if not (dep or arr):
            continue
        s_depart = en_secondes(dep or arr)
        s_arrivee = en_secondes(arr or dep)
        # En GTFS, 25:10 = 1h10 le lendemain : un train « de la veille »
        # après minuit circule donc en réalité le jour demandé.
        if service in services_jour and s_depart < 86400:
            decalage = 0
        elif service in services_veille and s_depart >= 86400:
            decalage = 86400
        else:
            continue
        passages.append({
            "trip_id": trip_id, "ordre": ordre,
            "s_depart": s_depart - decalage, "s_arrivee": s_arrivee - decalage,
            "numero": numero or "", "ligne": ligne or "",
            "transport": TYPES_TRANSPORT.get(type_route, "Train"),
        })

    if not passages:
        return [], []

    # Origine et terminus de chaque trajet
    ids = list({p["trip_id"] for p in passages})
    extremites = {}
    for i in range(0, len(ids), 500):           # par paquets (limite SQLite)
        paquet = ids[i:i + 500]
        for trip_id, ordre, nom in conn.execute(f"""
            SELECT st.trip_id, CAST(st.stop_sequence AS INTEGER), s.stop_name
            FROM stop_times st JOIN stops s ON s.stop_id = st.stop_id
            WHERE st.trip_id IN ({",".join("?" * len(paquet))})
        """, paquet):
            premier, dernier = extremites.get(trip_id, ((10**9, ""), (-1, "")))
            if ordre < premier[0]:
                premier = (ordre, nom)
            if ordre > dernier[0]:
                dernier = (ordre, nom)
            extremites[trip_id] = (premier, dernier)

    departs, arrivees = [], []
    for p in passages:
        (ordre_min, origine), (ordre_max, terminus) = extremites[p["trip_id"]]
        if p["ordre"] < ordre_max:
            departs.append({**p, "secondes": p["s_depart"], "vers": terminus})
        if p["ordre"] > ordre_min:
            arrivees.append({**p, "secondes": p["s_arrivee"], "vers": origine})
    departs.sort(key=lambda p: p["secondes"])
    arrivees.sort(key=lambda p: p["secondes"])
    return departs, arrivees


# ----------------------------------------------------------------------
# Génération de la page
# ----------------------------------------------------------------------
def format_heure(secondes):
    return f"{secondes // 3600:02d}:{(secondes % 3600) // 60:02d}"


def bloc_horaires(titre, passages, mot_lien):
    if not passages:
        return (f'<section class="colonne"><h2>{titre}</h2>'
                f'<p class="vide">Aucun {titre.lower()[:-1]} prévu ce jour-là.</p></section>')
    par_heure = defaultdict(list)
    for p in passages:
        par_heure[p["secondes"] // 3600].append(p)

    groupes = []
    for heure in sorted(par_heure):
        lignes = []
        for p in par_heure[heure]:
            details = f'{p["transport"]} {html.escape(p["numero"])}'
            if p["ligne"]:
                details += f' <span class="ligne">ligne {html.escape(p["ligne"])}</span>'
            lignes.append(f"""
                <li>
                  <time>{format_heure(p["secondes"])}</time>
                  <span class="lieu"><span class="lien">{mot_lien}</span> {html.escape(p["vers"])}</span>
                  <span class="details">{details}</span>
                </li>""")
        groupes.append(f"""
            <div class="heure">
              <div class="repere">{heure:02d}h</div>
              <ul>{"".join(lignes)}</ul>
            </div>""")
    return (f'<section class="colonne"><h2>{titre} <span class="compte">{len(passages)}</span></h2>'
            f'{"".join(groupes)}</section>')


def generer_page(nom_gare, jour, departs, arrivees):
    date_texte = f"{JOURS[jour.weekday()]} {jour.day} {MOIS[jour.month - 1]} {jour.year}"
    genere_le = datetime.now(ZoneInfo("Europe/Paris")).strftime("%d/%m/%Y à %H:%M")
    return f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(nom_gare)} : horaires du {date_texte}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;700&family=Barlow:wght@400;500;600&display=swap">
<style>
  :root {{
    --papier: #F5F7F9;
    --encre: #14213D;
    --encre-douce: #5B6478;
    --mer: #1F6F8B;
    --filet: #D5DBE3;
    --signal: #F2C230;
  }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; background: var(--papier); color: var(--encre);
    font-family: "Barlow", system-ui, sans-serif; font-size: 1rem; line-height: 1.45;
  }}
  header {{
    background: var(--encre); color: #fff;
    padding: 2.5rem clamp(1.25rem, 5vw, 4rem) 2rem;
    border-bottom: 6px solid var(--signal);
  }}
  h1 {{
    font-family: "Barlow Condensed", "Arial Narrow", sans-serif; font-weight: 700;
    font-size: clamp(2.6rem, 8vw, 5rem); line-height: .95; margin: 0 0 .6rem;
    letter-spacing: -.01em;
  }}
  .date {{ font-size: 1.25rem; margin: 0; color: #C9D3E3; }}
  .date strong {{ color: #fff; font-weight: 600; }}
  main {{
    display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 26rem), 1fr));
    gap: 2rem clamp(1.5rem, 4vw, 4rem); padding: 2rem clamp(1.25rem, 5vw, 4rem);
    max-width: 82rem;
  }}
  h2 {{
    font-family: "Barlow Condensed", "Arial Narrow", sans-serif; font-weight: 700;
    font-size: 2rem; margin: 0 0 .5rem; padding-bottom: .4rem;
    border-bottom: 2px solid var(--encre); display: flex; align-items: baseline; gap: .6rem;
  }}
  .compte {{ font-size: 1rem; font-weight: 500; color: var(--encre-douce); }}
  .heure {{ display: grid; grid-template-columns: 3.5rem 1fr; border-bottom: 1px solid var(--filet); }}
  .repere {{
    font-family: "Barlow Condensed", "Arial Narrow", sans-serif; font-weight: 700;
    font-size: 1.5rem; color: var(--mer); padding-top: .55rem;
  }}
  ul {{ list-style: none; margin: 0; padding: 0; }}
  li {{
    display: grid; grid-template-columns: 3.6rem 1fr; column-gap: .75rem;
    padding: .6rem 0; border-top: 1px solid var(--filet);
  }}
  li:first-child {{ border-top: 0; }}
  time {{
    font-family: "Barlow Condensed", "Arial Narrow", sans-serif; font-weight: 700;
    font-size: 1.35rem; font-variant-numeric: tabular-nums; grid-row: span 2;
  }}
  .lieu {{ font-weight: 600; font-size: 1.1rem; }}
  .lien {{ font-weight: 400; color: var(--encre-douce); }}
  .details {{ font-size: .9rem; color: var(--encre-douce); }}
  .ligne {{ margin-left: .4rem; padding: 0 .35rem; border: 1px solid var(--filet); border-radius: 3px; }}
  .vide {{ color: var(--encre-douce); }}
  footer {{
    padding: 1.5rem clamp(1.25rem, 5vw, 4rem) 3rem; color: var(--encre-douce);
    font-size: .9rem; max-width: 60rem;
  }}
</style>
</head>
<body>
<header>
  <h1>{html.escape(nom_gare)}</h1>
  <p class="date">Horaires prévus du <strong>{date_texte}</strong></p>
</header>
<main>
  {bloc_horaires("Départs", departs, "vers")}
  {bloc_horaires("Arrivées", arrivees, "de")}
</main>
<footer>
  Horaires théoriques : les retards et suppressions ne sont pas pris en compte.
  Données SNCF Voyageurs (GTFS), licence ODbL. Page générée le {genere_le}.
  Projet personnel, sans lien avec la SNCF : pour une information officielle, consultez SNCF Connect.
</footer>
</body>
</html>"""


# ----------------------------------------------------------------------
if __name__ == "__main__":
    recherche = sys.argv[1] if len(sys.argv) > 1 else GARE_PAR_DEFAUT
    if len(sys.argv) > 2:
        jour = date.fromisoformat(sys.argv[2])
    else:
        jour = datetime.now(ZoneInfo("Europe/Paris")).date() + timedelta(days=1)

    if not Path(BASE_GTFS).exists():
        raise SystemExit("gtfs.db introuvable : lance d'abord python charger_gtfs.py")

    conn = sqlite3.connect(BASE_GTFS)
    stop_ids, nom_gare = trouver_gare(conn, recherche)
    departs, arrivees = horaires_du_jour(conn, stop_ids, jour)
    conn.close()

    nom_fichier = f"horaires_{nom_gare.replace(' ', '_').replace('/', '-')}_{jour}.html"
    Path(nom_fichier).write_text(generer_page(nom_gare, jour, departs, arrivees),
                                 encoding="utf-8")
    print(f"{nom_gare}, {jour} : {len(departs)} départs, {len(arrivees)} arrivées")
    print(f"Page créée : {nom_fichier}")
    webbrowser.open(Path(nom_fichier).resolve().as_uri())
