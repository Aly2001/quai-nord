"""
Le réapprentissage automatique du réseau de neurones (GRU), chaque semaine, sur GitHub Actions.

C'est exactement ce que font les sections 1 à 5, 10 et 11 du notebook (outils/essai_reseau.ipynb),
sans personne devant l'écran :
  1. charger les retards des Hauts-de-France (même filtre que le modèle de chaque nuit) ;
  2. fabriquer les séquences et la fiche de chaque train (mêmes fonctions que la VM) ;
  3. entraîner le réseau sur toutes les journées complètes sauf les deux dernières : l'avant-dernière
     sert à l'arrêt précoce, la dernière n'est vue PAR AUCUN des deux réseaux ;
  4. vérifier que le calcul numpy (celui de la VM) donne la même probabilité que Keras ;
  5. COMPARER le nouveau à l'ancien sur cette dernière journée, jamais vue : on ne remplace JAMAIS
     un réseau par un moins bon ;
  6. s'il est retenu, écrire le nouveau fichier de poids (le workflow l'envoie dans le bucket).

Lancement (TensorFlow nécessaire) :
    python outils/reapprendre_reseau.py retards_hdf.csv reseau_actuel.npz reseau_gru.npz
Code de sortie : 0 = nouveau réseau retenu ; 3 = ancien réseau gardé ; autre = erreur.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import entrainer_modele as em      # noqa: E402
import reseau_numpy as rn          # noqa: E402
import sequences as sq             # noqa: E402

ANCIEN_GARDE = 3
TOLERANCE = 0.01          # le nouveau peut être au plus 1 % moins bon (le hasard de l'apprentissage)
COLONNES = ["date_service", "trip_id", "ligne", "heure_prevue", "ordre_arret", "retard_minutes",
            "supprime", "perturbe", "pluie_mm", "rafales_kmh", "type_observation"]


def garder_le_nouveau(brier_nouveau, brier_ancien):
    """On ne remplace jamais un réseau par un moins bon."""
    return brier_ancien is None or brier_nouveau <= brier_ancien * (1 + TOLERANCE)


def charger(fichier):
    brut = pd.read_csv(fichier, sep=";", usecols=COLONNES, low_memory=False)
    df = brut[(brut["type_observation"] == "CONSTATE") & brut["heure_prevue"].notna()
              & brut["trip_id"].str.contains(":TER:", na=False)].drop(columns="type_observation")
    df = em.preparer_variables(df)
    jours = em.jours_complets(df)
    return df[df["date"].isin(jours)].reset_index(drop=True), jours


def entrainer(df, sequences, jours, graine=0):
    import tensorflow as tf
    from tensorflow.keras.callbacks import EarlyStopping

    app, val, test = df[df["date"] < jours[-2]], df[df["date"] == jours[-2]], df[df["date"] == jours[-1]]
    tf.keras.utils.set_random_seed(graine)
    prep = rn.apprendre_preparation(app)

    def entree(t):
        return {"sequence": sequences[t.index.to_numpy()], **rn.fiche(t, prep)}

    modele = rn.construire_keras(len(prep["vocab"]) + 1)
    modele.fit(entree(app), app["perturbe"].to_numpy("float32"),
               validation_data=(entree(val), val["perturbe"].to_numpy("float32")),
               epochs=15, batch_size=1024, verbose=2,
               callbacks=[EarlyStopping(patience=2, restore_best_weights=True)])
    p_keras = modele.predict(entree(test), batch_size=4096, verbose=0).ravel()
    return modele, prep, test, p_keras


def main(donnees, actuel, sortie):
    print("1. Données...", flush=True)
    df, jours = charger(donnees)
    print(f"   {len(df):,} passages · {len(jours)} journées ({jours[0]:%d/%m} → {jours[-1]:%d/%m})", flush=True)

    print("2. Séquences...", flush=True)
    sequences = sq.construire_sequences(df)

    print("3. Apprentissage...", flush=True)
    modele, prep, test, p_keras = entrainer(df, sequences, jours)
    rn.exporter(modele, prep, sortie, derniere_journee=jours[-2])     # la dernière journée n'a pas été vue

    print("4. Vérification : le calcul numpy de la VM = Keras ?", flush=True)
    poids, prep_relue = rn.charger(sortie)
    p_numpy = rn.predire(poids, sequences[test.index.to_numpy()], rn.fiche(test, prep_relue))
    ecart = float(np.abs(p_numpy - p_keras).max())
    print(f"   écart maximal : {ecart:.2e}", flush=True)
    if ecart > 1e-4:
        Path(sortie).unlink()
        raise SystemExit("Le calcul numpy ne correspond pas à Keras : nouveau réseau abandonné.")

    print(f"5. Comparaison avec l'ancien réseau, sur la journée du {jours[-1]:%d/%m}...", flush=True)
    y = test["perturbe"].to_numpy(float)
    brier_nouveau = float(((p_numpy - y) ** 2).mean())
    brier_ancien = None
    if actuel and Path(actuel).exists():
        poids_a, prep_a = rn.charger(actuel)
        p_ancien = rn.predire(poids_a, sequences[test.index.to_numpy()], rn.fiche(test, prep_a))
        brier_ancien = float(((p_ancien - y) ** 2).mean())
    print(f"   Brier nouveau {brier_nouveau:.4f} · ancien {brier_ancien if brier_ancien is None else round(brier_ancien, 4)}",
          flush=True)

    if not garder_le_nouveau(brier_nouveau, brier_ancien):
        Path(sortie).unlink()
        print("   → le nouveau est moins bon : on GARDE l'ancien réseau.", flush=True)
        return ANCIEN_GARDE
    print(f"   → nouveau réseau retenu (appris jusqu'au {jours[-2]:%d/%m}) : {sortie}", flush=True)
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    sys.exit(main(*sys.argv[1:]))
