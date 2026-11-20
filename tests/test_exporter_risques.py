"""Le risque de chaque train, calculé en une seule lecture de la table."""
import sqlite3

import exporter_risques as er


def test_la_plus_frequente_egalite_la_plus_petite():
    assert er.la_plus_frequente({"P20": 3, "K12": 3, "K90": 1}) == "K12"
    assert er.la_plus_frequente(None) is None


def test_une_seule_lecture_compte_juste(tmp_path):
    base = tmp_path / "analyse.db"
    with sqlite3.connect(base) as conn:
        conn.execute("CREATE TABLE retards(numero_train, ligne, gare, heure_prevue, date_service, en_retard, "
                     "type_observation, supprime)")
        conn.executemany("INSERT INTO retards VALUES (?,?,?,?,?,?,?,?)", [
            ("847000", "K12", "Calais Ville", "2026-11-10 07:13:00", "20261110", 1, "CONSTATE", 0),
            ("847000", "K12", "Calais Ville", "2026-11-11 07:13:00", "20261111", 0, "CONSTATE", 0),
            ("847000", None, "Boulogne", "2026-11-11 07:40:00", "20261111", 0, "CONSTATE", 0),
            ("847000", "K12", "Calais Ville", "2026-11-12 07:13:00", "20261112", 1, "PREVISION", 0),   # pas constaté
            ("847000", "K12", "Calais Ville", "2026-11-12 07:13:00", "20261112", 0, "CONSTATE", 1),    # supprimé
        ])
    c = er.compter(base)
    assert (c["total"], c["retards"], len(c["jours"])) == (3, 1, 2)
    assert c["train"]["847000"] == [1, 3]
    assert c["ligne_heure"][("K12", "07")] == [1, 2]
    assert c["train_ligne"]["847000"] == {"K12": 2}
