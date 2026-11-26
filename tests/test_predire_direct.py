"""Le risque en direct : les trains des prochaines heures, avec seulement ce qu'on savait déjà."""
import json
import sqlite3

import numpy as np
import pandas as pd
import pytest

import predire_direct as pdx

JOUR = "20261126"


@pytest.fixture
def bases(tmp_path):
    """Une ligne K12 : un train par heure de 6 h à 22 h, 3 arrêts dans la région (+0, +15, +30 min)."""
    g = sqlite3.connect(tmp_path / "gtfs.db")
    g.executescript("""
        CREATE TABLE stops(stop_id, stop_name, hauts_de_france, stop_lat, stop_lon);
        CREATE TABLE routes(route_id, route_short_name, route_long_name);
        CREATE TABLE trips(trip_id, route_id, service_id, trip_headsign);
        CREATE TABLE stop_times(trip_id, stop_id, stop_sequence, arrival_time, departure_time);
        CREATE TABLE calendar_dates(service_id, date, exception_type);
        INSERT INTO stops VALUES ('A', 'Boulogne', 1, '50.7', '1.6'), ('B', 'Calais', 1, '50.9', '1.8'),
                                 ('C', 'Dunkerque', 1, '51.0', '2.3');
        INSERT INTO routes VALUES ('R', 'K12', 'Boulogne - Dunkerque');
    """)
    g.execute("INSERT INTO calendar_dates VALUES ('S', ?, '1')", (JOUR,))
    for h in range(6, 23):
        trip = f"T{h}:TER:x"
        g.execute("INSERT INTO trips VALUES (?, 'R', 'S', ?)", (trip, str(847000 + h)))
        for k, gare in enumerate("ABC"):
            heure = f"{h:02d}:{15 * k:02d}:00"
            g.execute("INSERT INTO stop_times VALUES (?,?,?,?,?)", (trip, gare, k, heure, heure))
    g.commit()
    s = sqlite3.connect(tmp_path / "sncf.db")
    s.execute("""CREATE TABLE passages(trip_id, date_service, stop_id, stop_sequence, heure_arrivee, retard_arrivee,
                 heure_depart, retard_depart, statut_arret, statut_train, premiere_vue, derniere_vue)""")
    s.commit()

    rng = np.random.default_rng(0)
    formes = {"gru_0": (6, 96), "gru_1": (32, 96), "gru_2": (2, 96), "emb_ligne_0": (2, 8), "emb_heure_0": (24, 4),
              "emb_jour_0": (7, 3), "cachee_0": (50, 32), "cachee_1": (32,), "sortie_0": (32, 1), "sortie_1": (1,)}
    poids = {k: (rng.standard_normal(f) * 0.5).astype("float32") for k, f in formes.items()}
    prep = {"vocab": {"K12": 1}, "mediane": [1, 0, 20], "moyenne": [1, 0.2, 20], "ecart": [1, 0.5, 10],
            "entraine_le": "2026-11-26", "derniere_journee": "2026-11-23"}
    np.savez(tmp_path / "reseau_gru.npz", preparation=json.dumps(prep), **poids)
    return tmp_path


def observer(dossier, heure, retard_min):
    """Le collecteur a vu le train de `heure` h passer aux 3 arrêts avec ce retard."""
    s = sqlite3.connect(dossier / "sncf.db")
    base = pd.Timestamp("2026-11-26").value // 10**9 - 3600          # minuit à Paris, en secondes UTC
    for k, gare in enumerate("ABC"):
        prevu = base + heure * 3600 + 15 * k * 60
        s.execute("INSERT INTO passages VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                  (f"T{heure}:TER:x", JOUR, gare, k, prevu + 60 * retard_min, 60 * retard_min,
                   prevu + 60 * retard_min, 60 * retard_min, "PREVU", "PREVU", prevu - 3600, prevu + 7200))
    s.commit()


def calculer(dossier, maintenant):
    return pdx.calculer(maintenant, dossier / "sncf.db", dossier / "gtfs.db", dossier / "absent.db",
                        dossier / "reseau_gru.npz")


def test_seulement_les_trains_des_3_prochaines_heures(bases):
    r = calculer(bases, "2026-11-26 14:05")
    heures = sorted({a["heure"] for t in r["trains"].values() for a in t["arrets"]})
    assert heures[0] == "14:15" and heures[-1] == "17:00"                  # de maintenant à +3 h
    assert set(r["trains"]) == {"847014", "847015", "847016", "847017"}
    assert all(0 < a["risque"] < 1 for t in r["trains"].values() for a in t["arrets"])
    assert r["reseau"]["appris_jusqu_au"] == "2026-11-23"
    assert r["trains"]["847014"]["arrets"][0]["stop_id"] == "B" and isinstance(r["maj"], int)


def test_interrupteur_eteint_par_defaut(bases, monkeypatch):
    monkeypatch.setattr(pdx, "INTERRUPTEUR", bases / "afficher_direct")
    assert calculer(bases, "2026-11-26 14:05")["afficher"] is False
    (bases / "afficher_direct").touch()
    assert calculer(bases, "2026-11-26 14:05")["afficher"] is True


def test_ce_qui_s_est_passe_avant_compte(bases):
    sans = calculer(bases, "2026-11-26 14:05")["trains"]["847016"]["arrets"][0]["risque"]
    observer(bases, 12, 25)                                               # le train de 12 h : 25 min de retard
    avec = calculer(bases, "2026-11-26 14:05")["trains"]["847016"]["arrets"][0]["risque"]
    assert avec != sans


def test_jamais_d_information_venue_de_l_avenir(bases):
    observer(bases, 12, 25)
    avant = calculer(bases, "2026-11-26 14:05")
    observer(bases, 14, 40)       # le train de 14 h (déjà parti, mais jugé APRÈS la question du 14 h 15)
    apres = calculer(bases, "2026-11-26 14:05")
    # Le train de 14 h a sa question à 13 h 30 : il ne voit pas ses propres retards
    assert avant["trains"]["847014"] == apres["trains"]["847014"]


def test_rien_observe_le_matin_ca_marche_quand_meme(bases):
    r = calculer(bases, "2026-11-26 05:40")
    assert "847006" in r["trains"]
