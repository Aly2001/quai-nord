"""Le collecteur ne doit jamais s'arrêter, même quand la base est occupée,
et la mise à jour ne doit jamais tourner deux fois en même temps."""
import sqlite3

import collecteur as co
import mettre_a_jour as maj


def test_base_en_mode_wal(tmp_path):
    conn = co.ouvrir_base(tmp_path / "sncf.db")
    co.creer_tables(conn)
    assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    conn.close()


def test_une_lecture_longue_ne_bloque_plus_l_ecriture(tmp_path):
    base = tmp_path / "sncf.db"
    conn = co.ouvrir_base(base)
    co.creer_tables(conn)
    lecteur = sqlite3.connect(f"file:{base}?mode=ro", uri=True)
    lecteur.execute("BEGIN")
    lecteur.execute("SELECT COUNT(*) FROM collectes").fetchone()   # lecture « en cours », comme la mise à jour
    conn.execute("INSERT INTO collectes VALUES (1, 0, 0, 'OK', NULL)")
    conn.commit()                                                  # avant : « database is locked »
    lecteur.close()
    assert conn.execute("SELECT COUNT(*) FROM collectes").fetchone()[0] == 1


def test_base_occupee_le_collecteur_ne_plante_pas(tmp_path, monkeypatch):
    base = tmp_path / "sncf.db"
    conn = co.ouvrir_base(base)
    co.creer_tables(conn)
    conn.close()
    conn = sqlite3.connect(base, timeout=0.1)
    autre = sqlite3.connect(base)
    autre.execute("BEGIN EXCLUSIVE")                               # quelqu'un écrit et garde la base

    def flux_en_panne():
        raise RuntimeError("réseau coupé")
    monkeypatch.setattr(co, "telecharger_flux", flux_en_panne)
    co.une_collecte(conn)                                          # ne doit lever aucune erreur
    autre.rollback()
    co.une_collecte(conn)                                          # la base est libre : l'échec est noté
    assert conn.execute("SELECT statut FROM collectes").fetchall() == [("ERREUR",)]


def test_une_seule_mise_a_jour_a_la_fois(tmp_path):
    chemin = tmp_path / "verrou"
    premiere = maj.prendre_le_verrou(chemin)
    assert premiere is not None
    assert maj.prendre_le_verrou(chemin) is None                   # la 2e voit la 1re
    premiere.close()                                               # la 1re se termine
    assert maj.prendre_le_verrou(chemin) is not None
