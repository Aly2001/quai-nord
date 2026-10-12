"""
Remet le site en ligne avec les données du jour (Firebase Hosting).

Le script fait exactement ce qu'on tapait à la main, dans le dossier site :
    npm run build                              -> fabrique le site dans site/dist
    firebase deploy --only hosting             -> l'envoie sur quai-nord.web.app

Il est lancé automatiquement chaque matin, en 6e étape de mettre_a_jour.py.
Firebase n'envoie que les fichiers qui ont changé : c'est rapide.

Condition : avoir fait une fois « firebase login » sur ce PC (la connexion est mémorisée).
"""

import shutil
import subprocess
import sys
from pathlib import Path

SITE = Path("site")


def lancer(commande):
    # shutil.which retrouve le programme, y compris sous Windows où il s'appelle
    # « npm.cmd » ou « firebase.cmd »
    programme = shutil.which(commande[0])
    if programme is None:
        print(f"   Programme introuvable : {commande[0]}. Est-il bien installé ?", flush=True)
        sys.exit(1)
    print(f"   > {' '.join(commande)}", flush=True)
    subprocess.run([programme, *commande[1:]], cwd=SITE, check=True)


def main():
    if not (SITE / "firebase.json").exists():
        print("   site/firebase.json introuvable : la mise en ligne n'est pas configurée, étape ignorée.")
        return

    try:
        lancer(["npm", "run", "build"])
        # --non-interactive : ne jamais attendre une réponse au clavier (personne n'est là pour répondre)
        lancer(["firebase", "deploy", "--only", "hosting", "--non-interactive"])
    except subprocess.CalledProcessError as erreur:
        print(f"   Échec de la commande (code {erreur.returncode}).", flush=True)
        print("   Si Firebase demande une connexion, lance une fois « firebase login » dans un terminal.", flush=True)
        sys.exit(1)

    print("   Site en ligne mis à jour : https://quai-nord.web.app", flush=True)


if __name__ == "__main__":
    main()
