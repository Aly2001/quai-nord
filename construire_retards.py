"""
Construction de la table propre des retards.

Le script relie :
  - les observations du collecteur  (sncf.db  : table passages)
  - les horaires théoriques          (gtfs.db  : tables stops, trips, routes, stop_times)
et produit une table claire, prête pour l'analyse :
  - analyse.db : table "retards" (une ligne par train, par jour et par gare)
  - retards_hdf.csv : la même chose pour les Hauts-de-France (Excel / Power BI)

La table est entièrement reconstruite à chaque lancement.
Lancement : python construire_retards.py
(Le collecteur peut continuer à tourner pendant ce temps.)
"""

import os
import sqlite3

import pandas as pd

BASE_TEMPS_REEL = "sncf.db"
BASE_GTFS = "gtfs.db"
BASE_ANALYSE = "analyse.db"
BASE_METEO = "meteo.db"        # facultatif : créé par collecter_meteo.py
EXPORT_CSV = "retards_hdf.csv"
SEUIL_RETARD = 300   # 5 minutes, en secondes


def colonne_ou_null(conn, table, colonne):
    """Renvoie 't.colonne' si la colonne existe dans la table GTFS, sinon NULL.
    (Tous les fichiers GTFS n'ont pas exactement les mêmes colonnes.)"""
    colonnes = [ligne[1] for ligne in conn.execute(f"PRAGMA g.table_info({table})")]
    return colonne if colonne in colonnes else "NULL"


def heure_gtfs_en_secondes(champ):
    """Expression SQL qui convertit une heure GTFS 'HH:MM:SS' en secondes.
    Attention : en GTFS, l'heure peut dépasser 24 (ex. 25:10:00 = 1h10 le
    lendemain), c'est pourquoi on ne peut pas utiliser une heure classique."""
    return f"""(
        CAST(substr({champ}, 1, instr({champ}, ':') - 1) AS INTEGER) * 3600
      + CAST(substr({champ}, instr({champ}, ':') + 1, 2) AS INTEGER) * 60
      + CAST(substr({champ}, instr({champ}, ':') + 4, 2) AS INTEGER)
    )"""


def colonnes_meteo(avec_meteo):
    """Les colonnes météo à ajouter, ou des colonnes vides si meteo.db n'existe pas encore."""
    noms = ["pluie_mm", "neige_cm", "temperature", "vent_kmh", "rafales_kmh"]
    if avec_meteo:
        return ",\n            ".join(f"mt.{n} AS {n}" for n in noms)
    return ",\n            ".join(f"NULL AS {n}" for n in noms)


def construire(conn, avec_meteo):
    print("1. Construction de la table des retards...")
    numero_train = colonne_ou_null(conn, "trips", "trip_headsign")
    nom_ligne = colonne_ou_null(conn, "routes", "route_long_name")
    date_iso = ("substr(p.date_service, 1, 4) || '-' || "
                "substr(p.date_service, 5, 2) || '-' || "
                "substr(p.date_service, 7, 2)")
    secondes = heure_gtfs_en_secondes("COALESCE(st.arrival_time, st.departure_time)")
    heure_prevue = f"datetime({date_iso}, '+' || {secondes} || ' seconds')"

    # Météo : la pluie et les rafales d'une heure H concernent l'heure qui PRÉCÈDE H.
    # Un passage à 7 h 24 est donc relié à la ligne météo de 8 h (pluie entre 7 h et 8 h).
    jointure_meteo = f"""
        LEFT JOIN m.gare_point gp ON gp.stop_id = p.stop_id
        LEFT JOIN m.meteo      mt ON mt.point = gp.point
                                 AND mt.heure = strftime('%Y-%m-%d %H:00:00', {heure_prevue}, '+1 hour')
    """ if avec_meteo else ""

    conn.executescript(f"""
        DROP TABLE IF EXISTS a.retards;

        CREATE TABLE a.retards AS
        SELECT
            -- Identification
            p.trip_id,
            t.{numero_train}                        AS numero_train,
            p.date_service,
            r.route_short_name                      AS ligne,
            r.{nom_ligne}                           AS nom_ligne,

            -- La gare
            p.stop_id,
            s.stop_name                             AS gare,
            s.hauts_de_france,
            CAST(s.stop_lat AS REAL)                AS latitude,
            CAST(s.stop_lon AS REAL)                AS longitude,
            CAST(st.stop_sequence AS INTEGER)       AS ordre_arret,

            -- Horaire prévu (date du service + heure GTFS)
            {heure_prevue}                          AS heure_prevue,

            -- Retard : à l'arrivée, ou au départ pour la 1re gare du trajet
            COALESCE(p.retard_arrivee, p.retard_depart)          AS retard_secondes,
            ROUND(COALESCE(p.retard_arrivee, p.retard_depart) / 60.0, 1)
                                                    AS retard_minutes,
            CASE WHEN COALESCE(p.retard_arrivee, p.retard_depart) >= {SEUIL_RETARD}
                 THEN 1 ELSE 0 END                  AS en_retard,

            -- Supprimé : le train entier, ou seulement cet arrêt (« sauté »). Un train supprimé
            -- n'a pas de retard : sans cette colonne, les pires perturbations (tempêtes) seraient invisibles.
            CASE WHEN p.statut_train = 'SUPPRIME' OR p.statut_arret = 'SAUTE'
                 THEN 1 ELSE 0 END                  AS supprime,
            -- Perturbé : ce qui compte pour le voyageur, en retard de 5 min ou plus OU supprimé
            CASE WHEN p.statut_train = 'SUPPRIME' OR p.statut_arret = 'SAUTE'
                      OR COALESCE(p.retard_arrivee, p.retard_depart) >= {SEUIL_RETARD}
                 THEN 1 ELSE 0 END                  AS perturbe,

            -- Statuts
            p.statut_train,
            p.statut_arret,

            -- Le retard a-t-il été constaté, ou n'était-ce qu'une prévision ?
            -- Une suppression est « constatée » dès que l'heure prévue du passage est dépassée
            CASE WHEN p.derniere_vue >= COALESCE(p.heure_arrivee, p.heure_depart)
                      OR ((p.statut_train = 'SUPPRIME' OR p.statut_arret = 'SAUTE')
                          AND CAST(strftime('%s', {heure_prevue}) AS INTEGER) <= CAST(strftime('%s', 'now') AS INTEGER))
                 THEN 'CONSTATE' ELSE 'PREVISION' END AS type_observation,

            -- Météo au lieu et à l'heure du passage
            {colonnes_meteo(avec_meteo)}

        FROM passages p
        JOIN      g.stops      s  ON s.stop_id = p.stop_id
        LEFT JOIN g.trips      t  ON t.trip_id = p.trip_id
        LEFT JOIN g.routes     r  ON r.route_id = t.route_id
        LEFT JOIN g.stop_times st ON st.trip_id = p.trip_id
                                 AND st.stop_id = p.stop_id
        {jointure_meteo}
        -- Un retard mesuré, OU une suppression (qui n'a pas de retard, mais compte autant pour le voyageur)
        WHERE COALESCE(p.retard_arrivee, p.retard_depart) IS NOT NULL
           OR p.statut_train = 'SUPPRIME' OR p.statut_arret = 'SAUTE';

        CREATE INDEX a.idx_retards_gare ON retards(gare);
        CREATE INDEX a.idx_retards_date ON retards(date_service);
    """)
    conn.commit()


def resume(conn):
    total, constates, avec_ligne, hdf = conn.execute("""
        SELECT COUNT(*),
               SUM(type_observation = 'CONSTATE'),
               SUM(ligne IS NOT NULL),
               SUM(hauts_de_france = 1)
        FROM a.retards
    """).fetchone()
    if not total:
        print("   La table est vide : laisse tourner le collecteur un peu plus.")
        return
    print(f"   {total} lignes créées")
    print(f"   Retards constatés (fiables) : {100 * constates / total:5.1f} %")
    print(f"   Ligne connue                : {100 * avec_ligne / total:5.1f} %")
    print(f"   Passages Hauts-de-France    : {hdf}")
    (supprimes,) = conn.execute(
        "SELECT SUM(supprime) FROM a.retards WHERE hauts_de_france = 1 AND type_observation = 'CONSTATE'").fetchone()
    print(f"   Passages supprimés (HdF)    : {supprimes or 0}")

    print("\n2. Ponctualité dans les Hauts-de-France (retards constatés)")
    print("   Heure | Passages | En retard (≥ 5 min)")
    for heure, nb, pct in conn.execute("""
        SELECT strftime('%H', heure_prevue) AS h, COUNT(*),
               100.0 * SUM(en_retard) / COUNT(*)
        FROM a.retards
        WHERE hauts_de_france = 1 AND type_observation = 'CONSTATE' AND supprime = 0
              AND heure_prevue IS NOT NULL
        GROUP BY h ORDER BY h
    """):
        barre = "█" * round(pct / 5)
        print(f"   {heure}h  | {nb:>8} | {pct:5.1f} % {barre}")


def exporter_csv():
    conn = sqlite3.connect(BASE_ANALYSE)
    df = pd.read_sql("SELECT * FROM retards WHERE hauts_de_france = 1", conn)
    conn.close()
    df.to_csv(EXPORT_CSV, index=False, encoding="utf-8-sig", sep=";")
    print(f"\n3. Export : {len(df)} lignes dans {EXPORT_CSV} (ouvrable dans Excel)")


if __name__ == "__main__":
    for fichier in (BASE_TEMPS_REEL, BASE_GTFS):
        if not os.path.exists(fichier):
            raise SystemExit(f"Fichier introuvable : {fichier}. "
                             "Lance d'abord le collecteur et charger_gtfs.py.")

    conn = sqlite3.connect(BASE_TEMPS_REEL, timeout=30)
    conn.execute(f"ATTACH DATABASE '{BASE_GTFS}' AS g")
    conn.execute(f"ATTACH DATABASE '{BASE_ANALYSE}' AS a")
    avec_meteo = os.path.exists(BASE_METEO)
    if avec_meteo:
        conn.execute(f"ATTACH DATABASE '{BASE_METEO}' AS m")
    else:
        print("(meteo.db introuvable : les colonnes météo resteront vides. Lance collecter_meteo.py.)")
    construire(conn, avec_meteo)
    resume(conn)
    conn.close()
    exporter_csv()
    print("\nTerminé !")
