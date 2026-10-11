"""
Vérification des données météo (meteo.db).

Lancement :
    python verifier_meteo.py                          -> Boulogne-sur-Mer, hier
    python verifier_meteo.py Calais 2026-10-09        -> un autre point, une autre date
"""

import sqlite3
import sys
from datetime import date, timedelta

point = sys.argv[1] if len(sys.argv) > 1 else "Boulogne-sur-Mer"
jour = sys.argv[2] if len(sys.argv) > 2 else (date.today() - timedelta(days=1)).isoformat()

conn = sqlite3.connect("meteo.db")

# ---------- 1. Données complètes ? 24 heures par point et par jour ----------
print("1. Heures enregistrées par jour (on attend 24 pour chaque point)")
for d, nb_points, mini, maxi in conn.execute("""
    SELECT substr(heure, 1, 10) AS d, COUNT(DISTINCT point), MIN(n), MAX(n)
    FROM (SELECT point, heure, COUNT(*) OVER (PARTITION BY point, substr(heure, 1, 10)) AS n FROM meteo)
    GROUP BY d ORDER BY d
"""):
    alerte = "" if mini == maxi == 24 else "   <-- incomplet"
    print(f"   {d} : {nb_points} points, de {mini} à {maxi} heures{alerte}")

# ---------- 2. Valeurs plausibles ? ----------
print("\n2. Valeurs extrêmes (doivent rester réalistes)")
r = conn.execute("""
    SELECT MIN(temperature), MAX(temperature), MIN(pluie_mm), MAX(pluie_mm),
           MAX(rafales_kmh), SUM(rafales_kmh < vent_kmh)
    FROM meteo
""").fetchone()
print(f"   Température : de {r[0]} à {r[1]} °C")
print(f"   Pluie       : de {r[2]} à {r[3]} mm par heure (jamais négative)")
print(f"   Rafales max : {r[4]} km/h")
print(f"   Heures où les rafales sont plus faibles que le vent moyen : {r[5]} (on attend 0)")

# ---------- 3. Le détail d'une journée, pour comparer avec une source officielle ----------
print(f"\n3. {point}, le {jour}, heure par heure")
print("   Heure | Pluie (mm) | Temp. (°C) | Vent (km/h) | Rafales (km/h) | Type")
lignes = conn.execute("""
    SELECT substr(heure, 12, 5), pluie_mm, temperature, vent_kmh, rafales_kmh, observe
    FROM meteo WHERE point = ? AND heure LIKE ? ORDER BY heure
""", (point, jour + "%")).fetchall()
for h, pluie, temp, vent, raf, obs in lignes:
    print(f"   {h} | {pluie:>10} | {temp:>10} | {vent:>11} | {raf:>14} | {'observé' if obs else 'prévu'}")
if not lignes:
    print("   Aucune donnée : vérifie le nom du point et la date.")
    print("   Points disponibles :", ", ".join(p for (p,) in conn.execute("SELECT DISTINCT point FROM meteo")))

total = sum(l[1] or 0 for l in lignes)
print(f"\n   Pluie totale sur la journée : {total:.1f} mm")
conn.close()
