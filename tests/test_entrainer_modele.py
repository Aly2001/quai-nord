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
        for i in range(n):
            ligne = rng.choice(["K16", "P72", "C40"])
            heure = int(rng.integers(5, 23))
            p = {"K16": 0.35, "P72": 0.05, "C40": 0.2}[ligne] + (0.1 if heure >= 18 else 0)
            lignes.append((jour.strftime("%Y%m%d"), f"X_F:TER:FR:{ligne}:{i}", ligne, f"{jour:%Y-%m-%d} {heure:02d}:10:00",
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



def test_chaque_nuit_ajoute_une_ligne_a_l_historique(base, tmp_path, monkeypatch):
    monkeypatch.setattr(em, "BASE_ANALYSE", str(base))
    monkeypatch.setattr(em, "DOSSIER_MODELE", tmp_path / "modele")
    chemin = tmp_path / "modele" / "historique.csv"
    chemin.parent.mkdir(parents=True, exist_ok=True)
    chemin.write_text("date,examen,journees,constante,ligne,modele,gain_pct,annonce_pct,reel_pct\n"
                      "2026-10-20,x,10,0.2,0.2,0.2,1,10,10\n", encoding="utf-8")   # une nuit précédente
    em.main()
    em.main()                                                   # relancé le même jour : la ligne du jour est remplacée
    lignes = chemin.read_text(encoding="utf-8").splitlines()
    assert lignes[0].startswith("date,examen,journees")         # l'en-tête, une seule fois
    assert len(lignes) == 3                                      # en-tête + la nuit précédente + aujourd'hui (une seule fois)
    assert lignes[1].startswith("2026-10-20")                    # rien n'est effacé des jours précédents
    rapport = json.loads((tmp_path / "modele" / "rapport_modele.json").read_text(encoding="utf-8"))
    assert 0 < rapport["calibration"]["annonce_pct"] < 100


def _journee():
    """Une ligne, un jour : 4 trains à 7 h, 8 h, 9 h et 10 h ; les deux premiers perturbés."""
    return em.etat_de_la_ligne(pd.DataFrame({
        "date": pd.Timestamp("2026-11-10"), "ligne": "K16",
        "trip_id": ["T7", "T8", "T9", "T10"],
        "heure_prevue": ["2026-11-10 07:00:00", "2026-11-10 08:00:00", "2026-11-10 09:00:00", "2026-11-10 10:00:00"],
        "perturbe": [1, 1, 0, 0]}))


def test_etat_de_la_ligne_ce_qu_on_savait_30_min_avant():
    etat = _journee().set_index("trip_id")
    assert etat.at["T7", "vus"] == 0 and np.isnan(etat.at["T7", "part_matin"])     # 1er train : rien vu
    assert etat.at["T9", "vus"] == 2 and etat.at["T9", "part_matin"] == 1.0         # 7 h et 8 h jugés avant 8 h 30
    assert etat.at["T10", "part_matin"] == pytest.approx(2 / 3)


def test_etat_de_la_ligne_jamais_d_information_venue_de_l_avenir():
    avant = _journee().set_index("trip_id")
    df = pd.DataFrame({"date": pd.Timestamp("2026-11-10"), "ligne": "K16", "trip_id": ["T7", "T8", "T9", "T10"],
                       "heure_prevue": ["2026-11-10 07:00:00", "2026-11-10 08:00:00", "2026-11-10 09:00:00",
                                        "2026-11-10 10:00:00"], "perturbe": [1, 1, 1, 1]})   # 9 h et 10 h changent
    apres = em.etat_de_la_ligne(df).set_index("trip_id")
    assert apres.at["T9", "part_matin"] == avant.at["T9", "part_matin"]        # son propre sort n'y est pas


def test_l_historique_suit_les_deux_versions(base, tmp_path, monkeypatch):
    dossier = tmp_path / "modele"
    dossier.mkdir()
    (dossier / "historique.csv").write_text(
        "date,examen,journees,constante,ligne,modele,gain_pct,annonce_pct,reel_pct\n"
        "2026-10-01,27/09-30/09,20,0.15,0.14,0.13,1.0,20.0,19.0\n", encoding="utf-8")
    monkeypatch.setattr(em, "BASE_ANALYSE", str(base))
    monkeypatch.setattr(em, "DOSSIER_MODELE", dossier)
    assert em.main() == 0
    import csv
    with open(dossier / "historique.csv", newline="", encoding="utf-8") as f:
        lignes = list(csv.DictReader(f))
    assert lignes[0]["gain_pct"] == "1.0" and lignes[0]["gain_etat_pct"] == ""     # l'ancienne nuit est gardée
    assert lignes[-1]["gain_etat_pct"] != "" and lignes[-1]["annonce_etat_pct"] != ""
    assert (dossier / "modele_etat_ligne.joblib").exists()
