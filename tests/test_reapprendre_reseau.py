"""Le réapprentissage automatique ne remplace jamais un réseau par un moins bon."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("reapprendre_reseau", Path(__file__).parent.parent / "outils" / "reapprendre_reseau.py")
rr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rr)


def test_premier_reseau_toujours_retenu():
    assert rr.garder_le_nouveau(0.20, None)


def test_meilleur_ou_presque_egal_retenu():
    assert rr.garder_le_nouveau(0.150, 0.160)
    assert rr.garder_le_nouveau(0.1615, 0.160)          # 0,9 % moins bon : le hasard de l'apprentissage


def test_moins_bon_refuse():
    assert not rr.garder_le_nouveau(0.170, 0.160)
