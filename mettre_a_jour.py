"""
Mise à jour complète du site, en une seule commande.

Enchaîne les 7 étapes, dans l'ordre :
  1. charger_gtfs.py        -> horaires théoriques SNCF du jour
  2. collecter_meteo.py     -> météo observée et prévue (Open-Meteo)
  3. exporter_horaires.py   -> fichiers d'horaires pour le site
  4. construire_retards.py  -> table propre des retards, avec la météo
  5. exporter_risques.py    -> risque de retard de chaque train
  6. publier_site.py        -> remise en ligne du site (Firebase)
  7. sauvegarder.py         -> sauvegarde de sncf.db dans Cloud Storage (facultative)

Si une étape obligatoire échoue, on s'arrête : inutile de continuer avec des données
incomplètes. Une étape FACULTATIVE (la sauvegarde) qui échoue est seulement signalée :
elle ne doit pas faire recommencer toute la mise à jour.
Le collecteur lance ce script automatiquement une fois par jour.
On peut aussi le lancer à la main :
    python mettre_a_jour.py
"""

import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

ETAPES = [
    "charger_gtfs.py",
    "collecter_meteo.py",
    "exporter_horaires.py",
    "construire_retards.py",
    "exporter_risques.py",
    "publier_site.py",
    "sauvegarder.py",
]
FACULTATIVES = {"sauvegarder.py"}
FICHIER_SUIVI = Path("derniere_mise_a_jour.txt")   # date de la dernière réussite


# Sous Windows, quand l'affichage est redirigé vers un fichier (le journal), Python utilise
# par défaut l'encodage « cp1252 », qui ne connaît pas des caractères comme « ≥ ».
# On impose l'UTF-8 à ce script ET aux scripts qu'il lance.
ENVIRONNEMENT = os.environ.copy()
ENVIRONNEMENT["PYTHONUTF8"] = "1"
ENVIRONNEMENT["PYTHONIOENCODING"] = "utf-8"
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def horodatage():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def main():
    debut_total = time.time()
    print(f"[{horodatage()}] Début de la mise à jour", flush=True)

    for numero, script in enumerate(ETAPES, start=1):
        print(f"\n[{horodatage()}] Étape {numero}/{len(ETAPES)} : {script}", flush=True)
        debut = time.time()
        # sys.executable = le même Python que celui qui lance ce script
        resultat = subprocess.run([sys.executable, script], env=ENVIRONNEMENT)
        duree = time.time() - debut
        if resultat.returncode != 0:
            if script in FACULTATIVES:
                print(f"[{horodatage()}] AVERTISSEMENT : {script} a échoué (étape facultative), on continue.",
                      flush=True)
                continue
            print(f"[{horodatage()}] ÉCHEC de {script} après {duree:.0f} s : mise à jour arrêtée.", flush=True)
            sys.exit(1)
        print(f"[{horodatage()}] {script} terminé en {duree:.0f} s", flush=True)

    FICHIER_SUIVI.write_text(datetime.now().strftime("%Y-%m-%d"), encoding="utf-8")
    print(f"\n[{horodatage()}] Mise à jour terminée en {time.time() - debut_total:.0f} s", flush=True)


if __name__ == "__main__":
    main()
