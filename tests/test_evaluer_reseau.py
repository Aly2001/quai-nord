"""La note de chaque nuit du réseau : seulement des journées qu'il n'a jamais vues, une seule fois chacune."""
import csv
import json
import sqlite3

import numpy as np
import pandas as pd
import pytest

import evaluer_reseau as ev


@pytest.fixture
def projet(tmp_path, monkeypatch):
    """Une petite base de 12 journées et un fichier de poids (des poids au hasard : on teste le circuit)."""
    rng = np.random.default_rng(0)
    lignes = []
    for d in pd.date_range("2026-11-01", periods=12):
        for l in ("K12", "K16", "P20"):
            for h in range(6, 22):
                for s in range(4):
                    pert = int(rng.random() < 0.2)
                    lignes.append((f"{d:%Y%m%d}", f"X:TER:{l}{h}{d:%d}", l, f"{d:%Y-%m-%d} {h:02d}:{12 * s:02d}:00", s,
                                   float(rng.integers(5, 20) if pert else 0), 0, rng.random(), rng.random() * 40,
                                   pert, 1, "CONSTATE"))
    base = tmp_path / "analyse.db"
    with sqlite3.connect(base) as conn:
        conn.execute("CREATE TABLE retards(date_service, trip_id, ligne, heure_prevue, ordre_arret, retard_minutes, "
                     "supprime, pluie_mm, rafales_kmh, perturbe, hauts_de_france, type_observation)")
        conn.executemany("INSERT INTO retards VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", lignes)

    formes = {"gru_0": (6, 96), "gru_1": (32, 96), "gru_2": (2, 96), "emb_ligne_0": (4, 8), "emb_heure_0": (24, 4),
              "emb_jour_0": (7, 3), "cachee_0": (50, 32), "cachee_1": (32,), "sortie_0": (32, 1), "sortie_1": (1,)}
    poids = {k: (rng.standard_normal(f) * 0.1).astype("float32") for k, f in formes.items()}
    prep = {"vocab": {"K12": 1, "K16": 2, "P20": 3}, "mediane": [1, 0.5, 20], "moyenne": [1.5, 0.5, 20],
            "ecart": [1, 0.3, 12], "derniere_journee": "2026-11-09"}
    fichier = tmp_path / "modele" / "reseau_gru.npz"
    fichier.parent.mkdir()
    np.savez(fichier, preparation=json.dumps(prep), **poids)

    monkeypatch.setattr(ev, "BASE_ANALYSE", str(base))
    monkeypatch.setattr(ev, "POIDS", fichier)
    monkeypatch.setattr(ev, "HISTORIQUE", tmp_path / "modele" / "historique_reseau.csv")
    monkeypatch.setattr(ev, "recuperer_poids", lambda: None)
    monkeypatch.setattr(ev, "charger", lambda base=None: ev.em.preparer_variables(pd.read_sql(
        "SELECT * FROM retards", sqlite3.connect(base or ev.BASE_ANALYSE))))
    return tmp_path


def lire(projet):
    with open(projet / "modele" / "historique_reseau.csv", newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def test_seulement_les_journees_jamais_vues(projet):
    assert ev.main(aujourd_hui="2026-11-13") == 0
    notes = lire(projet)
    assert [n["journee"] for n in notes] == ["2026-11-10", "2026-11-11", "2026-11-12"]   # après le 09/11
    assert all(n["poids_jusqu_au"] == "2026-11-09" for n in notes)
    assert all(0 < float(n["annonce_reseau_pct"]) < 100 for n in notes)


def test_une_journee_n_est_notee_qu_une_fois(projet):
    ev.main(aujourd_hui="2026-11-12")
    ev.main(aujourd_hui="2026-11-13")
    assert [n["journee"] for n in lire(projet)] == ["2026-11-10", "2026-11-11", "2026-11-12"]


def test_ancien_fichier_sans_date_on_prend_la_veille_du_depot():
    assert ev.derniere_journee_vue({}, "2026-11-26") == pd.Timestamp("2026-11-25")
    assert ev.derniere_journee_vue({"derniere_journee": "2026-11-20"}, "2026-11-26") == pd.Timestamp("2026-11-20")
    assert ev.derniere_journee_vue({}, None) is None
