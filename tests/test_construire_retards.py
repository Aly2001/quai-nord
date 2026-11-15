"""La table des retards mise à jour par morceaux doit être identique à une reconstruction complète."""
import csv
import sqlite3
from datetime import date

import construire_retards as cr

AUJOURD_HUI = date(2026, 11, 15)


def preparer(dossier):
    g = sqlite3.connect(dossier / "gtfs.db")
    g.executescript("""
        CREATE TABLE stops(stop_id, stop_name, hauts_de_france, stop_lat, stop_lon);
        CREATE TABLE routes(route_id, route_short_name, route_long_name);
        CREATE TABLE trips(trip_id, route_id, trip_headsign);
        CREATE TABLE stop_times(trip_id, stop_id, stop_sequence, arrival_time, departure_time);
        INSERT INTO stops VALUES ('BT', 'Boulogne Tintelleries', 1, '50.72', '1.61'),
                                 ('CV', 'Calais Ville', 1, '50.95', '1.85'),
                                 ('PN', 'Paris Nord', 0, '48.88', '2.35');
        INSERT INTO routes VALUES ('R1', 'K12', 'Boulogne - Calais');
        INSERT INTO trips VALUES ('T1', 'R1', '847000'), ('T2', 'R1', '847002');
        INSERT INTO stop_times VALUES ('T1', 'BT', 1, '07:13:00', '07:13:00'), ('T1', 'CV', 2, '07:39:00', '07:39:00'),
                                      ('T2', 'BT', 1, '25:10:00', '25:10:00'), ('T2', 'PN', 2, '26:00:00', '26:00:00');
    """)
    g.commit()
    g.close()
    s = sqlite3.connect(dossier / "sncf.db")
    s.execute("""CREATE TABLE passages(trip_id, date_service, stop_id, stop_sequence, heure_arrivee, retard_arrivee,
                 heure_depart, retard_depart, statut_arret, statut_train, premiere_vue, derniere_vue)""")
    return s


def ajouter(sncf, jour, retard, statut="PREVU"):
    for trip, gare in (("T1", "BT"), ("T1", "CV"), ("T2", "BT"), ("T2", "PN")):
        sncf.execute("INSERT OR REPLACE INTO passages VALUES (?,?,?,1,100,?,100,?,'PREVU',?,1,200)",
                     (trip, jour, gare, retard, retard, statut))
    sncf.commit()


def ouvrir(dossier, analyse="analyse.db"):
    conn = sqlite3.connect(dossier / "sncf.db")
    conn.execute(f"ATTACH DATABASE '{dossier / 'gtfs.db'}' AS g")
    conn.execute(f"ATTACH DATABASE '{dossier / analyse}' AS a")
    return conn


def contenu(conn):
    return sorted(conn.execute("SELECT * FROM a.retards").fetchall(), key=repr)


def test_mise_a_jour_par_morceaux_identique_a_la_reconstruction(tmp_path):
    sncf = preparer(tmp_path)
    for jour in range(1, 13):                       # 12 jours anciens
        ajouter(sncf, f"202611{jour:02d}", 60 * jour)
    conn = ouvrir(tmp_path)
    cr.construire(conn, False, aujourd_hui=AUJOURD_HUI)            # 1re fois : complète
    assert conn.execute("SELECT COUNT(*) FROM a.retards").fetchone()[0] == 48

    ajouter(sncf, "20261114", 900, "SUPPRIME")       # un jour récent change
    ajouter(sncf, "20261115", 30)                    # un nouveau jour arrive
    cr.construire(conn, False, aujourd_hui=AUJOURD_HUI)            # cette fois : par morceaux

    complete = ouvrir(tmp_path, "complete.db")
    cr.construire(complete, False, complet=True, aujourd_hui=AUJOURD_HUI)
    assert contenu(conn) == contenu(complete)


def test_colonnes_changees_reconstruction_complete(tmp_path):
    preparer(tmp_path)
    conn = ouvrir(tmp_path)
    conn.execute("CREATE TABLE a.retards(ancienne_colonne)")
    conn.execute("INSERT INTO a.retards VALUES (1)")
    cr.construire(conn, False, aujourd_hui=AUJOURD_HUI)
    assert "ancienne_colonne" not in cr.colonnes_existantes(conn)


def test_export_csv_sans_tout_charger(tmp_path):
    sncf = preparer(tmp_path)
    ajouter(sncf, "20261110", 400)
    conn = ouvrir(tmp_path)
    cr.construire(conn, False, aujourd_hui=AUJOURD_HUI)
    conn.close()
    cr.exporter_csv(tmp_path / "analyse.db", tmp_path / "retards.csv")
    with open(tmp_path / "retards.csv", encoding="utf-8-sig", newline="") as f:
        lignes = list(csv.DictReader(f, delimiter=";"))
    assert len(lignes) == 3                          # Paris Nord n'est pas dans la région
    assert {l["gare"] for l in lignes} == {"Boulogne Tintelleries", "Calais Ville"}
