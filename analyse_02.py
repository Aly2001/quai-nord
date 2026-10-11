"""
Analyse exploratoire des retards : première vue d'ensemble.

5 questions :
  1. Quel est le taux de retard heure par heure (sur un seul jour) ?
  2. Quelles lignes sont les plus touchées ?
  3. Quelles gares des Hauts-de-France sont les plus touchées ?
  4. Le retard augmente-t-il au fil du trajet ?
  5. Taux "par passage" ou "par train" : quelle différence ?

Lancement : python analyse_02.py
"""

import sqlite3

import matplotlib
matplotlib.use("Agg")            # crée l'image sans ouvrir de fenêtre
import matplotlib.pyplot as plt
import pandas as pd

JOUR = "20261009"     # le jour analysé pour l'étude par heure
MIN_PASSAGES = 30     # en dessous, un taux n'est pas jugé fiable


def titre(texte):
    print("\n" + "=" * 60 + f"\n{texte}\n" + "=" * 60)


def tableau(groupe):
    """Taux de retard (%) et nombre de passages, fiable si assez de passages."""
    t = groupe["en_retard"].agg(["mean", "count"])
    t["taux_%"] = (t["mean"] * 100).round(1)
    t = t.rename(columns={"count": "passages"})[["taux_%", "passages"]]
    t["fiable"] = t["passages"] >= MIN_PASSAGES
    return t


# ----------------------------------------------------------------------
# Chargement et préparation
# ----------------------------------------------------------------------
conn = sqlite3.connect("analyse.db")
df = pd.read_sql("SELECT * FROM retards", conn)
conn.close()

fiables = df[df["type_observation"] == "CONSTATE"].copy()
fiables = fiables.dropna(subset=["heure_prevue"])          # trains inconnus du GTFS
fiables["heure"] = pd.to_datetime(fiables["heure_prevue"]).dt.hour

titre("0. Données utilisées")
print(f"Passages au total          : {len(df)}")
print(f"Passages fiables utilisés  : {len(fiables)}")
print(f"Taux de retard global      : {fiables['en_retard'].mean() * 100:.1f} %")

# ----------------------------------------------------------------------
titre(f"1. Taux de retard par heure (journée du {JOUR})")
jour = fiables[fiables["date_service"] == JOUR]
par_heure = tableau(jour.groupby("heure")).sort_index()
print(par_heure.to_string())

# Graphique : seulement les heures fiables
a_tracer = par_heure[par_heure["fiable"]]
if not a_tracer.empty:
    plt.figure(figsize=(9, 4.5))
    plt.bar(a_tracer.index, a_tracer["taux_%"], color="#1F6F8B")
    plt.xticks(a_tracer.index, [f"{h}h" for h in a_tracer.index])
    plt.ylabel("Passages avec ≥ 5 min de retard (%)")
    plt.title(f"Taux de retard par heure prévue ({JOUR[6:]}/{JOUR[4:6]}/{JOUR[:4]})")
    plt.grid(axis="y", alpha=0.3)
    plt.tight_layout()
    plt.savefig("graph_retard_par_heure.png", dpi=150)
    print("\nGraphique enregistré : graph_retard_par_heure.png")

# ----------------------------------------------------------------------
titre("2. Lignes les plus touchées (France, lignes fiables)")
par_ligne = tableau(fiables.dropna(subset=["ligne"]).groupby("ligne"))
par_ligne = par_ligne[par_ligne["fiable"]].sort_values("taux_%", ascending=False)
print(par_ligne.head(10).to_string())

# ----------------------------------------------------------------------
titre("3. Gares des Hauts-de-France les plus touchées")
hdf = fiables[fiables["hauts_de_france"] == 1]
par_gare = tableau(hdf.groupby("gare"))
par_gare = par_gare[par_gare["fiable"]].sort_values("taux_%", ascending=False)
if par_gare.empty:
    print(f"Pas encore de gare avec au moins {MIN_PASSAGES} passages.")
else:
    print(par_gare.head(10).to_string())

# ----------------------------------------------------------------------
titre("4. Le retard augmente-t-il au fil du trajet ?")
avec_ordre = fiables.dropna(subset=["ordre_arret"])
tranches = pd.cut(avec_ordre["ordre_arret"], bins=[-1, 0, 3, 7, 12, 100],
                  labels=["1re gare", "2e-4e", "5e-8e", "9e-13e", "14e et +"])
print(tableau(avec_ordre.groupby(tranches, observed=True)).to_string())

# ----------------------------------------------------------------------
titre("5. Taux par passage ou par train ?")
# Pour chaque train, on garde son dernier passage observé (le plus loin dans le trajet)
derniers = (avec_ordre.sort_values("ordre_arret")
            .groupby(["trip_id", "date_service"]).tail(1))
print(f"Par passage : {avec_ordre['en_retard'].mean() * 100:5.1f} %  "
      f"({len(avec_ordre)} passages)")
print(f"Par train   : {derniers['en_retard'].mean() * 100:5.1f} %  "
      f"({len(derniers)} trains, retard à la dernière gare observée)")
