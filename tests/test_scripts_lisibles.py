"""Chaque script du projet doit au moins pouvoir être lu par Python : une faute de syntaxe dans une étape
facultative (la sauvegarde !) ne bloque pas la nuit, et pourrait passer inaperçue pendant des jours."""
from pathlib import Path

import pytest

RACINE = Path(__file__).resolve().parent.parent
SCRIPTS = sorted(p for dossier in (RACINE, RACINE / "outils", RACINE / "nora") for p in dossier.glob("*.py"))


@pytest.mark.parametrize("script", SCRIPTS, ids=lambda p: p.name)
def test_le_script_est_lisible(script):
    compile(script.read_text(encoding="utf-8"), str(script), "exec")     # lève SyntaxError sinon
