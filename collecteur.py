"""
Collecteur des retards SNCF (flux temps réel GTFS-RT).

Toutes les 5 minutes, le script :
  1. télécharge le flux temps réel des trains SNCF ;
  2. extrait, pour chaque train et chaque gare, l'heure prévue et le retard ;
  3. enregistre tout dans une base SQLite (fichier sncf.db).

Si un même train est vu plusieurs fois, on garde la dernière information
(la plus récente est la plus fiable). On obtient donc une ligne par
train, par jour et par gare.

Une fois par jour (à partir de 4 h du matin, ou au démarrage si elle n'a pas
encore été faite), le collecteur lance aussi la MISE À JOUR DU SITE
(mettre_a_jour.py) en arrière-plan, sans interrompre la collecte.
Son journal est écrit dans mise_a_jour.log.

Lancement :  python collecteur.py
Arrêt     :  Ctrl + C
"""

import json
import logging
import os
import sqlite3
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from google.transit import gtfs_realtime_pb2

# ----------------------------------------------------------------------
# Configuration
# ----------------------------------------------------------------------
URL_FLUX = "https://proxy.transport.data.gouv.fr/resource/sncf-gtfs-rt-trip-updates"
FICHIER_BASE = "sncf.db"
INTERVALLE_SECONDES = 300          # 5 minutes
FUSEAU = ZoneInfo("Europe/Paris")
HEURE_MISE_A_JOUR = 4               # la mise à jour quotidienne se fait à partir de 4 h
FICHIER_SUIVI = Path("derniere_mise_a_jour.txt")
JOURNAL_MISE_A_JOUR = "mise_a_jour.log"
DOSSIER_SITE = Path("site/public/horaires")   # où le site lit ses fichiers

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
    handlers=[logging.FileHandler("collecteur.log", encoding="utf-8"),
              logging.StreamHandler()],
)
log = logging.getLogger(__name__)

STATUTS_TRAIN = {0: "PREVU", 1: "AJOUTE", 2: "NON_PLANIFIE", 3: "SUPPRIME"}
STATUTS_ARRET = {0: "PREVU", 1: "SAUTE", 2: "PAS_DE_DONNEES"}


# ----------------------------------------------------------------------
# Base de données
# ----------------------------------------------------------------------
def creer_tables(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS passages (
            trip_id          TEXT NOT NULL,
            date_service     TEXT NOT NULL,   -- AAAAMMJJ
            stop_id          TEXT NOT NULL,
            stop_sequence    INTEGER,
            heure_arrivee    INTEGER,         -- timestamp Unix (heure réelle estimée)
            retard_arrivee   INTEGER,         -- en secondes
            heure_depart     INTEGER,
            retard_depart    INTEGER,
            statut_arret     TEXT,
            statut_train     TEXT,
            premiere_vue     INTEGER,         -- 1re fois que le passage a été collecté
            derniere_vue     INTEGER,         -- dernière mise à jour
            PRIMARY KEY (trip_id, date_service, stop_id)
        );

        -- Journal des collectes : utile pour vérifier que tout tourne bien
        CREATE TABLE IF NOT EXISTS collectes (
            horodatage       INTEGER,
            nb_trains        INTEGER,
            nb_passages      INTEGER,
            statut           TEXT,
            message          TEXT
        );
    """)
    conn.commit()


def valeur(message, champ):
    """Renvoie la valeur d'un champ s'il est rempli, sinon None."""
    return getattr(message, champ) if message.HasField(champ) else None


# ----------------------------------------------------------------------
# Collecte
# ----------------------------------------------------------------------
def telecharger_flux():
    reponse = requests.get(URL_FLUX, timeout=30)
    reponse.raise_for_status()
    flux = gtfs_realtime_pb2.FeedMessage()
    flux.ParseFromString(reponse.content)
    return flux


def extraire_passages(flux, maintenant):
    """Transforme le flux en une liste de lignes prêtes pour la base."""
    date_du_jour = datetime.fromtimestamp(maintenant, FUSEAU).strftime("%Y%m%d")
    lignes = []
    nb_trains = 0

    for entite in flux.entity:
        if not entite.HasField("trip_update"):
            continue
        nb_trains += 1
        maj = entite.trip_update
        trip = maj.trip
        date_service = trip.start_date or date_du_jour
        statut_train = STATUTS_TRAIN.get(trip.schedule_relationship, "INCONNU")

        for arret in maj.stop_time_update:
            arrivee = arret.arrival if arret.HasField("arrival") else None
            depart = arret.departure if arret.HasField("departure") else None
            lignes.append((
                trip.trip_id,
                date_service,
                arret.stop_id,
                arret.stop_sequence if arret.HasField("stop_sequence") else None,
                valeur(arrivee, "time") if arrivee else None,
                valeur(arrivee, "delay") if arrivee else None,
                valeur(depart, "time") if depart else None,
                valeur(depart, "delay") if depart else None,
                STATUTS_ARRET.get(arret.schedule_relationship, "INCONNU"),
                statut_train,
                maintenant,
                maintenant,
            ))
    return nb_trains, lignes


def enregistrer(conn, lignes):
    # "UPSERT" : on insère, ou on met à jour si le passage existe déjà.
    # premiere_vue n'est jamais écrasée.
    conn.executemany("""
        INSERT INTO passages VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT (trip_id, date_service, stop_id) DO UPDATE SET
            stop_sequence  = excluded.stop_sequence,
            heure_arrivee  = excluded.heure_arrivee,
            retard_arrivee = excluded.retard_arrivee,
            heure_depart   = excluded.heure_depart,
            retard_depart  = excluded.retard_depart,
            statut_arret   = excluded.statut_arret,
            statut_train   = excluded.statut_train,
            derniere_vue   = excluded.derniere_vue
    """, lignes)
    conn.commit()


def ecrire_temps_reel(flux, maintenant):
    """Écrit l'état EN DIRECT des trains pour le site (temps_reel.json).
    Pour chaque train : son statut, et pour chaque gare [retard arrivée, retard départ, arrêt supprimé]."""
    if not DOSSIER_SITE.exists():
        return
    trajets = {}
    for entite in flux.entity:
        if not entite.HasField("trip_update"):
            continue
        maj = entite.trip_update
        arrets = {}
        for arret in maj.stop_time_update:
            arrivee = valeur(arret.arrival, "delay") if arret.HasField("arrival") else None
            depart = valeur(arret.departure, "delay") if arret.HasField("departure") else None
            arrets[arret.stop_id] = [arrivee, depart, 1 if arret.schedule_relationship == 1 else 0]
        trajets[maj.trip.trip_id] = {
            "statut": STATUTS_TRAIN.get(maj.trip.schedule_relationship, "INCONNU"),
            "arrets": arrets,
        }
    # Écriture dans un fichier temporaire, puis remplacement d'un coup :
    # le site ne lit jamais un fichier à moitié écrit.
    temporaire = DOSSIER_SITE / "temps_reel.tmp"
    temporaire.write_text(json.dumps({"maj": maintenant, "trajets": trajets}), encoding="utf-8")
    os.replace(temporaire, DOSSIER_SITE / "temps_reel.json")


def une_collecte(conn):
    maintenant = int(time.time())
    try:
        flux = telecharger_flux()
        nb_trains, lignes = extraire_passages(flux, maintenant)
        enregistrer(conn, lignes)
        try:
            ecrire_temps_reel(flux, maintenant)
        except Exception as erreur:            # le site est secondaire : la collecte continue
            log.warning("Fichier temps réel non écrit : %s", erreur)
        conn.execute("INSERT INTO collectes VALUES (?,?,?,?,?)",
                     (maintenant, nb_trains, len(lignes), "OK", None))
        conn.commit()
        log.info("Collecte OK : %d trains, %d passages", nb_trains, len(lignes))
    except Exception as erreur:   # on ne s'arrête jamais pour une erreur réseau
        conn.execute("INSERT INTO collectes VALUES (?,?,?,?,?)",
                     (maintenant, 0, 0, "ERREUR", str(erreur)[:500]))
        conn.commit()
        log.error("Échec de la collecte : %s", erreur)


# ----------------------------------------------------------------------
# Mise à jour quotidienne du site
# ----------------------------------------------------------------------
mise_a_jour_en_cours = None      # le processus en cours, s'il y en a un
prochain_essai = 0               # après un échec, on attend avant de réessayer
DELAI_APRES_ECHEC = 3600         # 1 heure


def mise_a_jour_necessaire():
    """Vrai si la mise à jour du jour n'a pas encore réussi."""
    maintenant = datetime.now(FUSEAU)
    aujourd_hui = maintenant.strftime("%Y-%m-%d")
    derniere = FICHIER_SUIVI.read_text(encoding="utf-8").strip() if FICHIER_SUIVI.exists() else ""
    if derniere == aujourd_hui:
        return False
    # Jamais faite : on la lance tout de suite. Sinon, on attend 4 h du matin.
    return derniere == "" or maintenant.hour >= HEURE_MISE_A_JOUR


def lancer_mise_a_jour_si_besoin():
    global mise_a_jour_en_cours, prochain_essai
    if mise_a_jour_en_cours is not None:
        code = mise_a_jour_en_cours.poll()          # None = encore en cours
        if code is None:
            return
        if code == 0:
            log.info("Mise à jour du site terminée avec succès")
        else:
            log.error("La mise à jour du site a échoué : voir %s. Nouvel essai dans 1 h.",
                      JOURNAL_MISE_A_JOUR)
            prochain_essai = time.time() + DELAI_APRES_ECHEC
        mise_a_jour_en_cours = None
        return

    if time.time() >= prochain_essai and mise_a_jour_necessaire():
        log.info("Lancement de la mise à jour quotidienne du site (journal : %s)", JOURNAL_MISE_A_JOUR)
        journal = open(JOURNAL_MISE_A_JOUR, "a", encoding="utf-8")
        # Popen lance le script SANS attendre la fin : la collecte continue pendant ce temps
        # UTF-8 imposé : sous Windows, l'écriture dans un fichier se ferait sinon en « cp1252 »,
        # qui ne sait pas écrire certains caractères (comme « ≥ ») et fait planter les scripts.
        environnement = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}
        mise_a_jour_en_cours = subprocess.Popen(
            [sys.executable, "mettre_a_jour.py"], stdout=journal, stderr=subprocess.STDOUT,
            env=environnement)


def main():
    conn = sqlite3.connect(FICHIER_BASE, timeout=30)
    creer_tables(conn)
    log.info("Démarrage du collecteur (toutes les %d s). Ctrl+C pour arrêter.",
             INTERVALLE_SECONDES)
    try:
        while True:
            debut = time.time()
            une_collecte(conn)
            try:
                lancer_mise_a_jour_si_besoin()
            except Exception as erreur:              # la collecte ne doit jamais s'arrêter
                log.error("Impossible de lancer la mise à jour : %s", erreur)
            time.sleep(max(0, INTERVALLE_SECONDES - (time.time() - debut)))
    except KeyboardInterrupt:
        log.info("Arrêt demandé. À bientôt !")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
