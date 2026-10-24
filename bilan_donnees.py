"""
Bilan des données collectées : AVANT le machine learning, savoir ce qu'on a vraiment.

Le script LIT les bases sans jamais les modifier (ouverture en lecture seule) :
  - sncf.db     : la collecte en temps réel (tables collectes et passages) ;
  - analyse.db  : la table propre des retards (construite chaque nuit par construire_retards.py).

Il répond à cinq questions :
  1. Depuis quand collecte-t-on, et la collecte a-t-elle eu des trous ?
  2. Combien de jours, de trains et de passages ?
  3. Combien de retards sont CONSTATÉS (et pas seulement prévus), dans les Hauts-de-France ?
  4. Quel est le taux de retard (5 min ou plus), et varie-t-il d'un jour à l'autre ?
  5. La météo est-elle bien reliée aux passages ?

Lancement, sur la VM, dans ~/quai-nord : python bilan_donnees.py
(La collecte peut continuer pendant ce temps : rien n'est écrit.)
"""
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

FUSEAU = ZoneInfo("Europe/Paris")
INTERVALLE = 5 * 60            # une collecte toutes les 5 minutes
TROU = 30 * 60                 # au-delà de 30 minutes sans collecte, on parle d'un trou


def ouvrir(chemin):
    """Ouvre une base en LECTURE SEULE (impossible de la modifier par erreur), ou None si elle manque."""
    if not Path(chemin).exists():
        print(f"   {chemin} introuvable : lance le script depuis le dossier du projet (~/quai-nord).")
        return None
    return sqlite3.connect(f"file:{chemin}?mode=ro", uri=True, timeout=30)


def date(horodatage):
    return datetime.fromtimestamp(horodatage, FUSEAU).strftime("%d/%m/%Y %H:%M")


def jour(aaaammjj):
    return f"{aaaammjj[6:8]}/{aaaammjj[4:6]}/{aaaammjj[:4]}"


def nombre(n):
    """12345 -> « 12 345 » (espace des milliers, à la française)."""
    return f"{n or 0:,}".replace(",", " ")


def pourcent(n, total):
    return f"{100 * n / total:.1f} %" if total else "—"


def titre(texte):
    print(f"\n{'=' * 64}\n{texte}\n{'=' * 64}")


# ---------------------------------------------------------------------
# 1. La collecte : régularité et trous
# ---------------------------------------------------------------------
def bilan_collecte(conn):
    titre("1. LA COLLECTE (sncf.db, table collectes)")
    nb, debut, fin = conn.execute("SELECT COUNT(*), MIN(horodatage), MAX(horodatage) FROM collectes").fetchone()
    if not nb:
        print("   Aucune collecte enregistrée.")
        return
    attendues = (fin - debut) // INTERVALLE + 1
    print(f"   Première collecte : {date(debut)}")
    print(f"   Dernière collecte : {date(fin)}  (il y a {(datetime.now().timestamp() - fin) / 60:.0f} min)")
    print(f"   {nb} collectes, pour {attendues} attendues toutes les 5 min : {pourcent(nb, attendues)} de régularité")
    for statut, n in conn.execute("SELECT statut, COUNT(*) FROM collectes GROUP BY statut ORDER BY 2 DESC"):
        print(f"      statut « {statut} » : {n}")
    # Les trous : deux collectes consécutives séparées de plus de 30 minutes
    trous, precedente = [], None
    for (h,) in conn.execute("SELECT horodatage FROM collectes ORDER BY horodatage"):
        if precedente and h - precedente > TROU:
            trous.append((precedente, h))
        precedente = h
    if trous:
        total = sum(b - a for a, b in trous) / 3600
        print(f"   {len(trous)} trou(s) de plus de 30 min, {total:.1f} h au total. Les plus longs :")
        for a, b in sorted(trous, key=lambda t: t[0] - t[1])[:8]:
            print(f"      du {date(a)} au {date(b)}  ({(b - a) / 3600:.1f} h)")
    else:
        print("   Aucun trou de plus de 30 min : collecte continue.")


# ---------------------------------------------------------------------
# 2. Les passages bruts
# ---------------------------------------------------------------------
def bilan_passages(conn):
    titre("2. LES PASSAGES BRUTS (sncf.db, table passages)")
    total, jours, trains = conn.execute(
        "SELECT COUNT(*), COUNT(DISTINCT date_service), COUNT(DISTINCT trip_id || date_service) FROM passages").fetchone()
    print(f"   {nombre(total)} passages (un train à une gare un jour donné)")
    print(f"   {jours} jours de service, {nombre(trains)} trains-jours")
    print("   Passages par jour (pour repérer un jour anormalement vide) :")
    for d, n in conn.execute("SELECT date_service, COUNT(*) FROM passages GROUP BY date_service ORDER BY date_service"):
        print(f"      {jour(d)} : {nombre(n):>7}")


# ---------------------------------------------------------------------
# 3, 4, 5. La table d'analyse
# ---------------------------------------------------------------------
def bilan_analyse(conn):
    titre("3. LES RETARDS PRÊTS POUR L'ANALYSE (analyse.db, table retards)")
    colonnes = [c[1] for c in conn.execute("PRAGMA table_info(retards)")]
    if not colonnes:
        print("   Table retards absente : lance d'abord python construire_retards.py")
        return
    total, constates, hdf, hdf_constates = conn.execute("""
        SELECT COUNT(*), SUM(type_observation = 'CONSTATE'), SUM(hauts_de_france = 1),
               SUM(hauts_de_france = 1 AND type_observation = 'CONSTATE') FROM retards""").fetchone()
    print(f"   {nombre(total)} lignes, dont {nombre(constates)} retards CONSTATÉS ({pourcent(constates, total)})")
    print(f"   Hauts-de-France : {nombre(hdf)} lignes, dont {nombre(hdf_constates)} constatées")
    print("   (Seuls les retards CONSTATÉS serviront à apprendre : une prévision n'est pas ce qui s'est passé.)")

    filtre = "hauts_de_france = 1 AND type_observation = 'CONSTATE' AND supprime = 0"
    jours, trains, lignes, gares = conn.execute(f"""
        SELECT COUNT(DISTINCT date_service), COUNT(DISTINCT numero_train), COUNT(DISTINCT ligne), COUNT(DISTINCT gare)
        FROM retards WHERE {filtre}""").fetchone()
    print(f"   Exemples utiles (Hauts-de-France, constatés) : {jours} jours, {trains} trains, {lignes} lignes, {gares} gares")

    titre("4. LE TAUX DE RETARD (5 min ou plus, Hauts-de-France, constatés)")
    retards, n = conn.execute(f"SELECT SUM(en_retard), COUNT(*) FROM retards WHERE {filtre}").fetchone()
    print(f"   Global : {pourcent(retards or 0, n)} des passages en retard")
    print("   Jour par jour :")
    for d, r, m in conn.execute(f"""
            SELECT date_service, SUM(en_retard), COUNT(*) FROM retards WHERE {filtre}
            GROUP BY date_service ORDER BY date_service"""):
        print(f"      {jour(d)} : {pourcent(r, m):>7}  sur {nombre(m):>6} passages")
    print("   Par jour de la semaine :")
    noms = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"]
    for js, r, m in conn.execute(f"""
            SELECT CAST(strftime('%w', substr(date_service,1,4) || '-' || substr(date_service,5,2) || '-' || substr(date_service,7,2)) AS INTEGER),
                   SUM(en_retard), COUNT(*) FROM retards WHERE {filtre} GROUP BY 1 ORDER BY 1"""):
        print(f"      {noms[js]:<9} : {pourcent(r, m):>7}  sur {nombre(m):>7} passages")

    titre("5. LA MÉTÉO RELIÉE AUX PASSAGES")
    meteo = [c for c in colonnes if any(m in c for m in ("pluie", "temp", "vent", "rafale", "meteo", "precip"))]
    if not meteo:
        print("   Aucune colonne météo dans la table : meteo.db manquait lors de la construction.")
        return
    for c in meteo:
        (remplies,) = conn.execute(f"SELECT COUNT({c}) FROM retards WHERE {filtre}").fetchone()
        print(f"   {c:<22} : renseignée pour {pourcent(remplies, n)} des passages")


def verdict(conn_analyse):
    titre("VERDICT POUR LE MACHINE LEARNING")
    if conn_analyse is None:
        return
    (jours,) = conn_analyse.execute(
        "SELECT COUNT(DISTINCT date_service) FROM retards WHERE hauts_de_france = 1 AND type_observation = 'CONSTATE'").fetchone()
    if jours >= 28:
        print(f"   {jours} jours de retards constatés : assez pour apprendre sur 3 semaines et tester sur la dernière.")
    elif jours >= 14:
        print(f"   {jours} jours : on peut déjà analyser et faire un premier modèle, mais le test sera fragile.")
    else:
        print(f"   {jours} jours seulement : on analyse, et on attend d'avoir au moins 2 à 4 semaines pour le modèle.")


def main():
    print(f"Bilan des données Quai Nord, le {datetime.now(FUSEAU):%d/%m/%Y à %H:%M}")
    temps_reel = ouvrir("sncf.db")
    if temps_reel:
        bilan_collecte(temps_reel)
        bilan_passages(temps_reel)
    analyse = ouvrir("analyse.db")
    if analyse:
        bilan_analyse(analyse)
    verdict(analyse)
    return 0


if __name__ == "__main__":
    sys.exit(main())
