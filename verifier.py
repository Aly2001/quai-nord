"""
Affiche un résumé de ce que le collecteur a enregistré.
Lancement : python verifier.py
"""

import sqlite3
from datetime import datetime

conn = sqlite3.connect("sncf.db")

nb_ok, nb_erreurs, derniere = conn.execute("""
    SELECT SUM(statut = 'OK'), SUM(statut = 'ERREUR'), MAX(horodatage)
    FROM collectes
""").fetchone()
print(f"Collectes réussies : {nb_ok or 0} | en erreur : {nb_erreurs or 0}")
if derniere:
    print("Dernière collecte  :", datetime.fromtimestamp(derniere))

print("\nPassages enregistrés par jour :")
for jour, nb, nb_trains in conn.execute("""
    SELECT date_service, COUNT(*), COUNT(DISTINCT trip_id)
    FROM passages GROUP BY date_service ORDER BY date_service DESC LIMIT 7
"""):
    print(f"  {jour} : {nb:>8} passages, {nb_trains:>5} trains")

print("\nRépartition des retards à l'arrivée (passages avec un retard connu) :")
for tranche, nb in conn.execute("""
    SELECT CASE
             WHEN retard_arrivee < 60  THEN '1. moins d''1 min'
             WHEN retard_arrivee < 300 THEN '2. 1 à 5 min'
             WHEN retard_arrivee < 900 THEN '3. 5 à 15 min'
             ELSE '4. plus de 15 min'
           END AS tranche, COUNT(*)
    FROM passages WHERE retard_arrivee IS NOT NULL
    GROUP BY tranche ORDER BY tranche
"""):
    print(f"  {tranche[3:]:<18} : {nb}")

print("\nDernières erreurs :")
erreurs = conn.execute("""
    SELECT horodatage, message FROM collectes
    WHERE statut = 'ERREUR' ORDER BY horodatage DESC LIMIT 3
""").fetchall()
for ts, msg in erreurs:
    print(" ", datetime.fromtimestamp(ts), "-", msg)
if not erreurs:
    print("  aucune")

conn.close()
