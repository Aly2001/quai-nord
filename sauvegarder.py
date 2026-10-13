"""
Sauvegarde quotidienne de l'historique des retards (sncf.db) vers Google Cloud Storage.

Pourquoi : sncf.db est la seule donnée IMPOSSIBLE à recréer (la SNCF ne garde pas
l'historique). Elle doit donc exister à deux endroits : la machine ET le cloud.

Étapes :
  1. copie propre de la base, même pendant que le collecteur écrit dedans
     (fonction « backup » de SQLite, prévue pour ça) ;
  2. compression (gzip) : environ 10 fois plus léger ;
  3. envoi dans le bucket, avec la date dans le nom ;
  4. suppression des sauvegardes les plus anciennes (on en garde 14).

Lancé automatiquement chaque nuit par mettre_a_jour.py (dernière étape).
À la main : python sauvegarder.py

Pour restaurer une sauvegarde (exemple) :
  gcloud storage cp gs://quai-nord-transfert-aly/sauvegardes/sncf_2026-10-14.db.gz .
  gunzip sncf_2026-10-14.db.gz
"""

import gzip
import shutil
import sqlite3
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

BASE = Path("sncf.db")
BUCKET = "gs://quai-nord-transfert-aly/sauvegardes"
A_GARDER = 14


def gcloud(*arguments, capturer=False):
    programme = shutil.which("gcloud")
    if programme is None:
        raise RuntimeError("outil gcloud introuvable")
    resultat = subprocess.run([programme, *arguments], capture_output=capturer, text=True, check=True)
    return resultat.stdout if capturer else None


def main():
    if not BASE.exists():
        raise SystemExit("sncf.db introuvable : rien à sauvegarder")

    jour = datetime.now(ZoneInfo("Europe/Paris")).strftime("%Y-%m-%d")
    copie = Path(f"sncf_{jour}.db")
    archive = Path(f"sncf_{jour}.db.gz")

    try:
        # 1. Copie propre, sans arrêter le collecteur
        source = sqlite3.connect(BASE, timeout=60)
        destination = sqlite3.connect(copie)
        source.backup(destination)
        destination.close()
        source.close()
        passages, = sqlite3.connect(copie).execute("SELECT COUNT(*) FROM passages").fetchone()

        # 2. Compression
        with open(copie, "rb") as entree, gzip.open(archive, "wb") as sortie:
            shutil.copyfileobj(entree, sortie)
        taille = archive.stat().st_size / 1024 / 1024
        print(f"   Copie : {passages} passages, {taille:.1f} Mo compressés", flush=True)

        # 3. Envoi dans le bucket
        gcloud("storage", "cp", str(archive), f"{BUCKET}/{archive.name}", "--quiet")
        print(f"   Envoyée : {BUCKET}/{archive.name}", flush=True)

        # 4. Rotation : on ne garde que les plus récentes
        liste = gcloud("storage", "ls", f"{BUCKET}/", capturer=True).split()
        sauvegardes = sorted(nom for nom in liste if nom.endswith(".db.gz"))
        anciennes = sauvegardes[:-A_GARDER]
        for nom in anciennes:
            gcloud("storage", "rm", nom, "--quiet")
        print(f"   Sauvegardes conservées : {min(len(sauvegardes), A_GARDER)} "
              f"(supprimées : {len(anciennes)})", flush=True)

    except Exception as erreur:
        print(f"   ÉCHEC de la sauvegarde : {erreur}", flush=True)
        sys.exit(1)
    finally:
        # Les fichiers temporaires ne restent jamais sur la machine
        copie.unlink(missing_ok=True)
        archive.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
