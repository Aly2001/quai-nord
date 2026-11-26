"""Le réseau recalculé avec numpy doit donner EXACTEMENT la même probabilité que Keras."""
import numpy as np
import pandas as pd
import pytest

import reseau_numpy as rn


def trains(n=300, graine=0):
    rng = np.random.default_rng(graine)
    return pd.DataFrame({
        "ligne": rng.choice(["K12", "K16", "P20", "rare"], n, p=[0.4, 0.3, 0.29, 0.01]),
        "heure": rng.integers(0, 24, n), "jour_semaine": rng.integers(0, 7, n),
        "ordre_arret": rng.integers(0, 15, n).astype(float),
        "pluie_mm": np.where(rng.random(n) < 0.1, np.nan, rng.random(n) * 3),
        "rafales_kmh": rng.random(n) * 60})


def test_preparation_apprise_sur_l_apprentissage_seulement():
    app = trains(1000)
    prep = rn.apprendre_preparation(app)
    assert "rare" not in prep["vocab"] and set(prep["vocab"].values()) == {1, 2, 3}   # 0 = ligne rare/inconnue
    f = rn.fiche(pd.concat([app.head(5), app.head(1).assign(ligne="jamais vue")]), prep)
    assert f["ligne"][-1] == 0 and f["nombres"].shape == (6, 3) and not np.isnan(f["nombres"]).any()


def test_export_puis_lecture(tmp_path):
    class Couche:
        def __init__(self, *tableaux): self.tableaux = tableaux
        def get_weights(self): return list(self.tableaux)

    class Modele:
        couches = {"gru": Couche(np.ones((6, 96)), np.ones((32, 96)), np.ones((2, 96))),
                   "emb_ligne": Couche(np.ones((4, 8))), "emb_heure": Couche(np.ones((24, 4))),
                   "emb_jour": Couche(np.ones((7, 3))), "cachee": Couche(np.ones((50, 32)), np.ones(32)),
                   "sortie": Couche(np.ones((32, 1)), np.ones(1))}
        def get_layer(self, nom): return self.couches[nom]

    prep = rn.apprendre_preparation(trains(1000))
    rn.exporter(Modele(), prep, tmp_path / "reseau_gru.npz")
    poids, relue = rn.charger(tmp_path / "reseau_gru.npz")
    assert relue == prep and poids["gru_1"].shape == (32, 96) and poids["sortie_1"].shape == (1,)


def test_numpy_identique_a_keras(tmp_path):
    pytest.importorskip("tensorflow")                    # seulement là où TensorFlow est installé
    import tensorflow as tf
    tf.keras.utils.set_random_seed(1)
    app = trains(1000)
    prep = rn.apprendre_preparation(app)
    modele = rn.construire_keras(len(prep["vocab"]) + 1)
    rng = np.random.default_rng(2)
    seq = (rng.random((300, 20, 6)) * (rng.random((300, 20, 1)) < 0.7)).astype("float32")   # avec du « remplissage »
    entrees = rn.fiche(trains(300, graine=3), prep)
    y = (rng.random(300) < 0.3).astype("float32")
    modele.fit({"sequence": seq, **entrees}, y, epochs=2, verbose=0)    # des poids « appris », pas ceux du départ
    attendu = modele.predict({"sequence": seq, **entrees}, verbose=0).ravel()

    rn.exporter(modele, prep, tmp_path / "reseau_gru.npz")
    poids, _ = rn.charger(tmp_path / "reseau_gru.npz")
    p, etapes = rn.predire(poids, seq, entrees, detail=True)
    assert np.abs(p - attendu).max() < 1e-4
    assert etapes["journee"].shape == (300, 32) and etapes["concat"].shape == (300, 50)
    assert etapes["cachee"].shape == (300, 32)
