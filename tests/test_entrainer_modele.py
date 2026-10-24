"""Tests de entrainer_modele.py, sur une petite base inventée (aucune vraie donnée nécessaire)."""
import json
import sqlite3

import numpy as np
import pandas as pd
import pytest

import entrainer_modele as em


@pytest.fixture
def base(tmp_path):
    """12 jours de TER inventés : la ligne K16 souvent perturbée, la P72 rarement, et une journée incomplète."""
    rng = np.random.default_rng(0)
    lignes = []
    for jour in pd.date_range("2026-10-13", periods=12):
        n = 60 if jour == pd.Timestamp("2026-10-17") else 400          # le 17 : collecte interrompue
        for _ in range(n):
            ligne = rng.choice(["K16", "P72", "C40"])
            heure = int(rng.integers(5, 23))
            p = {"K16": 0.35, "P72": 0.05, "C40": 0.2}[ligne] + (0.1 if heure >= 18 else 0)
            lignes.append((jour.strftime("%Y%m%d"), f"X_F:TER:FR:{ligne}", ligne, f"{jour:%Y-%m-%d} {heure:02d}:10:00",
                           int(rng.integers(0, 15)), float(rng.exponential(0.2)), float(rng.normal(30, 8)),
                           int(rng.random() < p), 1, "CONSTATE"))
    chemin = tmp_path / "analyse.db"
    with sqlite3.connect(chemin) as conn:
        conn.execute("""CREATE TABLE retards (date_service TEXT, trip_id TEXT, ligne TEXT, heure_prevue TEXT, ordre_arret INT,
                        pluie_mm REAL, rafales_kmh REAL, perturbe INT, hauts_de_france INT, type_observation TEXT)""")
        conn.executemany("INSERT INTO retards VALUES (?,?,?,?,?,?,?,?,?,?)", lignes)
        conn.execute("INSERT INTO retards VALUES ('20261013','Y_F:OUI:FR:L','K16','2026-10-13 08:00:00',1,0,0,1,1,'CONSTATE')")
    return chemin


def test_seuls_les_ter_constates_sont_lus(base):
    df = em.charger(base)
    assert len(df) == 11 * 400 + 60                     # le TGV (OUI) est écarté


def test_la_numerotation_des_arrets_commence_a_zero(base):
    df = em.preparer_variables(pd.DataFrame({"date_service": [20261013, 20261013], "heure_prevue": ["2026-10-13 07:05:00"] * 2,
                                             "ordre_arret": [0, 14]}))
    assert list(df["position"].astype(str)) == ["1er", "15e et +"]
    assert list(df["heure"]) == [7, 7]


def test_les_journees_incompletes_et_le_jour_meme_sont_ecartees(base):
    df = em.preparer_variables(em.charger(base))
    jours = em.jours_complets(df, aujourd_hui="2026-10-24")
    assert pd.Timestamp("2026-10-17") not in jours       # 60 passages au lieu de 400
    assert pd.Timestamp("2026-10-24") not in jours       # aujourd'hui (et après) : jamais
    assert len(jours) == 10


def test_le_modele_bat_la_constante_et_le_rapport_est_ecrit(base, tmp_path, monkeypatch):
    monkeypatch.setattr(em, "BASE_ANALYSE", str(base))
    monkeypatch.setattr(em, "DOSSIER_MODELE", tmp_path / "modele")
    assert em.main() == 0
    rapport = json.loads((tmp_path / "modele" / "rapport_modele.json").read_text(encoding="utf-8"))
    assert rapport["scores_brier"]["modele"] < rapport["scores_brier"]["constante"]
    assert len(rapport["jours_test"]) == em.JOURS_TEST
    assert (tmp_path / "modele" / "modele_perturbations.joblib").exists()
