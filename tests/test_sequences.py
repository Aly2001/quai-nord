"""Les séquences du réseau : ce qu'on savait de la ligne 30 min avant le départ, jamais plus."""
import numpy as np
import pandas as pd
import pytest

import sequences as sq


def journee(perturbes=(1, 1, 0, 0), ligne="K12"):
    """Une ligne, un jour : 4 trains (1 arrêt chacun) à 7 h, 8 h, 9 h et 10 h."""
    return pd.DataFrame({
        "date": pd.Timestamp("2026-11-10"), "ligne": ligne,
        "trip_id": [f"{ligne}-7", f"{ligne}-8", f"{ligne}-9", f"{ligne}-10"],
        "heure_prevue": ["2026-11-10 07:00:00", "2026-11-10 08:00:00", "2026-11-10 09:00:00", "2026-11-10 10:00:00"],
        "retard_minutes": [12.0, 7.0, 1.0, 0.0], "perturbe": list(perturbes), "supprime": 0, "ordre_arret": 3})


def test_forme_du_tenseur():
    seq = sq.construire_sequences(journee())
    assert seq.shape == (4, sq.LONGUEUR, 6) and seq.dtype == np.float32


def test_le_premier_train_ne_sait_rien():
    seq = sq.construire_sequences(journee())
    assert not seq[0].any()                                   # que du remplissage


def test_seuls_les_passages_connus_30_min_avant():
    seq = sq.construire_sequences(journee())
    # Train de 9 h : question à 8 h 30. Connus : 7 h (jugé 7 h 05) et 8 h (jugé 8 h 05).
    presents = seq[2][:, 0]
    assert presents.sum() == 2 and presents[-2:].tolist() == [1, 1]   # les plus récents à la fin
    assert seq[2][-1, 1] == pytest.approx(7 / 60)                      # le dernier connu : 8 h, 7 min de retard
    assert seq[2][-1, 4] == pytest.approx((25 / 60) / 12)              # jugé il y a 25 min (8 h 05 → 8 h 30)


def test_jamais_d_information_venue_de_l_avenir():
    avant = sq.construire_sequences(journee(perturbes=(1, 1, 0, 0)))
    apres = sq.construire_sequences(journee(perturbes=(1, 1, 1, 1)))   # le sort de 9 h et 10 h change
    assert np.array_equal(avant[2], apres[2])                         # le train de 9 h n'en sait rien


def test_les_autres_lignes_ne_comptent_pas():
    deux = pd.concat([journee(ligne="K12"), journee(ligne="P20")], ignore_index=True)
    assert np.array_equal(sq.construire_sequences(deux)[2], sq.construire_sequences(journee())[2])


def test_on_garde_les_20_derniers():
    n = 30
    df = pd.DataFrame({"date": pd.Timestamp("2026-11-10"), "ligne": "K12", "trip_id": [f"T{i}" for i in range(n)],
                       "heure_prevue": pd.date_range("2026-11-10 05:00", periods=n, freq="10min").astype(str),
                       "retard_minutes": np.arange(n, dtype=float), "perturbe": 0, "supprime": 0, "ordre_arret": 1})
    dernier = sq.construire_sequences(df)[-1]
    assert dernier[:, 0].sum() == sq.LONGUEUR
    # Le dernier train part à 9 h 50 → question à 9 h 20 → connus jusqu'au passage de 9 h 10 (n° 25).
    # Son retard final (25 min) n'est pas encore connu à 9 h 20 : on n'en voit que 10 min.
    assert dernier[-1, 1] == pytest.approx(10 / 60) and dernier[0, 1] == pytest.approx(6 / 60)


def test_le_retard_pas_encore_connu_reste_cache():
    """Le train de 8 h arrive avec 40 min de retard. À 8 h 30 (question du train de 9 h),
    on sait seulement qu'il a AU MOINS 30 min de retard : le réseau ne doit voir que 30."""
    df = journee()
    df.loc[1, "retard_minutes"] = 40.0
    seq = sq.construire_sequences(df)
    assert seq[2][-1, 1] == pytest.approx(30 / 60)
    assert seq[3][-1, 1] < 0.1                              # le train de 10 h : le dernier connu est celui de 9 h
    assert seq[3][-2, 1] == pytest.approx(40 / 60)          # à 9 h 30, le retard de 40 min du 8 h est connu
