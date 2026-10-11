import sqlite3
conn=sqlite3.connect("sncf.db")
import sqlite3

conn = sqlite3.connect("sncf.db")

print("Valeurs de retard les plus fréquentes :")
print("retard (min) | nombre de passages")
for retard, nb in conn.execute("""
    SELECT retard_arrivee / 60.0, COUNT(*)
    FROM passages
    WHERE retard_arrivee IS NOT NULL
    GROUP BY retard_arrivee
    ORDER BY COUNT(*) DESC
    LIMIT 15
"""):
    print(f"{retard:>12.1f} | {nb}")

conn.close()