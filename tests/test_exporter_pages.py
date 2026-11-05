"""Les chiffres des pages Analyses et Prédiction, sur une base fabriquée."""
import numpy as np
import pandas as pd

import entrainer_modele as em
import exporter_pages as ep


def base(chocs=True):
    rng = np.random.default_rng(3)
    lignes = []
    for d in pd.date_range("2026-10-10", "2026-10-30"):
        for li in range(6):
            choc = chocs and rng.random() < 0.2
            for k in range(20):
                h0 = 5 * 60 + k * 45
                p = 0.12 + (0.5 if choc and k > 4 else 0)
                for s in range(10):
                    t = d + pd.Timedelta(minutes=h0 + 6 * s)
                    pert = int(rng.random() < p + 0.01 * s)
                    lignes.append((int(d.strftime("%Y%m%d")), f"OCE{li}{k}:TER:x", f"L{li}", t.strftime("%Y-%m-%d %H:%M:%S"), s, pert, int(pert and rng.random() < 0.1)))
    return em.preparer_variables(pd.DataFrame(lignes, columns=["date_service", "trip_id", "ligne", "heure_prevue", "ordre_arret", "perturbe", "supprime"]))


def test_les_constats():
    r = ep.analyses(base())
    assert r["passages"] == 21 * 6 * 20 * 10
    assert [p["tranche"] for p in r["par_position"]] == ["1re gare", "2e à 4e", "5e à 8e", "9e à 13e"]
    assert r["par_position"][0]["taux"] < r["par_position"][-1]["taux"]            # le retard s'accumule
    assert len(r["par_jour"]) == 21 and r["par_jour"][0]["etiquette"] == "sam. 10/10"
    assert r["domino"]["agite"]["taux"] > r["domino"]["calme"]["taux"]             # l'effet domino


def test_pas_d_effet_domino_invente():
    sans = ep.analyses(base(chocs=False))["domino"]                                # sans journées de panne
    avec = ep.analyses(base())["domino"]
    assert abs(sans["agite"]["taux"] - sans["calme"]["taux"]) < 5                  # presque rien (le hasard)
    assert avec["agite"]["taux"] - avec["calme"]["taux"] > 20                      # avec des pannes : nettement


def test_le_modele_lit_l_historique_et_l_essai():
    m = ep.modele()
    assert m["conditions"] == {"gain_min": 3.0, "ecart_max": 2.0, "jours": 14}
    assert m["essai"]["nuits"][-1]["etat_ligne"] == 5.65
