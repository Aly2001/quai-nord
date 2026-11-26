"""
Le réseau de neurones séquentiel (GRU) de Quai Nord, recalculé « à la main » avec numpy.

L'APPRENTISSAGE se fait dans Colab, avec TensorFlow (outils/essai_reseau.ipynb).
La PRÉDICTION se fait ici, sans TensorFlow : une fois les poids appris, prédire n'est qu'une suite de
produits de matrices, d'additions et de fonctions d'activation. Ça tient dans la petite machine (1 Go).

Le fichier de poids (reseau_gru.npz) contient :
  - les poids de chaque couche, sous le nom qu'ils ont dans Keras ;
  - la PRÉPARATION de la fiche du train (numéro de chaque ligne, médiane, moyenne et écart-type),
    calculée sur les jours d'apprentissage : la même ici que dans Colab.

Le calcul, pour un paquet de B trains (les formes sont entre parenthèses) :
  1. GRU : lit la séquence (B, 20, 6), passage par passage   → résumé de la journée (B, 32)
  2. embeddings : ligne → (B, 8), heure → (B, 4), jour → (B, 3)
  3. concaténer avec position, pluie, rafales (B, 3)          → (B, 50)
  4. couche cachée : ReLU(x · W₁ + b₁)                         → (B, 32)
  5. sortie : sigmoïde(x · W₂ + b₂)                            → (B, 1) = la probabilité p
"""
import json

import numpy as np

NOMBRES = ["ordre_arret", "pluie_mm", "rafales_kmh"]
FREQUENCE_MIN = 200          # une ligne vue moins de 200 fois n'a pas son propre vecteur (numéro 0)


# ---------- La fiche du train : la même préparation dans Colab et sur la VM ----------

def apprendre_preparation(apprentissage):
    """Ce qu'on apprend des jours d'apprentissage SEULEMENT (sinon : fuite d'information)."""
    lignes = apprentissage["ligne"].value_counts()
    vocab = {ligne: k + 1 for k, ligne in enumerate(lignes[lignes >= FREQUENCE_MIN].index)}
    mediane = apprentissage[NOMBRES].median()
    rempli = apprentissage[NOMBRES].fillna(mediane)
    return {"vocab": vocab,
            "mediane": mediane.tolist(),
            "moyenne": rempli.mean().tolist(),
            "ecart": rempli.std().replace(0, 1).tolist()}


def fiche(trains, preparation):
    """Les entrées « fiche » du réseau, pour un tableau de trains (colonnes ligne, heure, jour_semaine,
    ordre_arret, pluie_mm, rafales_kmh)."""
    nombres = trains[NOMBRES].fillna(dict(zip(NOMBRES, preparation["mediane"])))
    return {
        "ligne": trains["ligne"].map(preparation["vocab"]).fillna(0).to_numpy("int32"),
        "heure": trains["heure"].to_numpy("int32"),
        "jour": trains["jour_semaine"].to_numpy("int32"),
        "nombres": ((nombres.to_numpy("float64") - preparation["moyenne"]) / preparation["ecart"])
        .astype("float32"),
    }


# ---------- Le réseau Keras (dans Colab seulement : TensorFlow n'est pas installé sur la VM) ----------

def construire_keras(nb_lignes, longueur=20, nb_infos=6):
    """La structure du schéma, en Keras. Les noms des couches servent à l'export des poids."""
    import tensorflow as tf
    from tensorflow.keras import Model, layers

    seq = layers.Input((longueur, nb_infos), name="sequence")
    ligne = layers.Input((), dtype="int32", name="ligne")
    heure = layers.Input((), dtype="int32", name="heure")
    jour = layers.Input((), dtype="int32", name="jour")
    nombres = layers.Input((3,), name="nombres")

    journee = layers.GRU(32, name="gru")(seq)                          # (B, 32) : le résumé de la journée
    e_ligne = layers.Embedding(nb_lignes, 8, name="emb_ligne")(ligne)   # (B, 8)
    e_heure = layers.Embedding(24, 4, name="emb_heure")(heure)          # (B, 4)
    e_jour = layers.Embedding(7, 3, name="emb_jour")(jour)              # (B, 3)
    x = layers.Concatenate(name="concat")([journee, e_ligne, e_heure, e_jour, nombres])   # (B, 50)
    x = layers.Dense(32, activation="relu", name="cachee")(x)           # (B, 32)
    x = layers.Dropout(0.2)(x)
    p = layers.Dense(1, activation="sigmoid", name="sortie")(x)         # (B, 1) : la probabilité

    modele = Model([seq, ligne, heure, jour, nombres], p)
    modele.compile(optimizer=tf.keras.optimizers.Adam(1e-3), loss="binary_crossentropy")
    return modele


# ---------- Enregistrer et relire les poids ----------

def exporter(modele, preparation, chemin, derniere_journee=None):
    """Dans Colab : enregistre les poids du modèle Keras et la préparation dans un seul fichier.
    derniere_journee : la dernière journée vue à l'apprentissage. La note de chaque nuit
    (evaluer_reseau.py) ne juge le réseau QUE sur des journées postérieures : jamais vues."""
    from datetime import date
    preparation = {**preparation, "entraine_le": date.today().isoformat(),
                   "derniere_journee": None if derniere_journee is None else str(derniere_journee)[:10]}
    poids = {}
    for nom in ("gru", "emb_ligne", "emb_heure", "emb_jour", "cachee", "sortie"):
        for i, tableau in enumerate(modele.get_layer(nom).get_weights()):
            poids[f"{nom}_{i}"] = tableau
    np.savez(chemin, preparation=json.dumps(preparation), **poids)


def charger(chemin):
    with np.load(chemin) as f:
        poids = {cle: f[cle] for cle in f.files if cle != "preparation"}
        preparation = json.loads(str(f["preparation"]))
    return poids, preparation


# ---------- Le calcul (le passage avant), couche par couche ----------

def sigmoide(z):
    return 1 / (1 + np.exp(-z))


def gru(sequences, noyau, noyau_rec, biais):
    """La couche GRU de Keras (reset_after=True), écrite à la main.
    sequences : (B, T, 6) ; noyau : (6, 3×32) ; noyau_rec : (32, 3×32) ; biais : (2, 3×32).
    Les 3 blocs de 32 colonnes sont, dans l'ordre : porte de mise à jour z, porte de remise à zéro r,
    candidat h̃."""
    n = noyau_rec.shape[0]
    h = np.zeros((sequences.shape[0], n), dtype=np.float32)       # la mémoire : vide au départ
    for t in range(sequences.shape[1]):                           # un passage à la fois, dans l'ordre
        x = sequences[:, t, :] @ noyau + biais[0]                 # ce qu'apporte le passage t
        rec = h @ noyau_rec + biais[1]                            # ce qu'apporte la mémoire
        z = sigmoide(x[:, :n] + rec[:, :n])                       # combien garder de l'ancienne mémoire
        r = sigmoide(x[:, n:2 * n] + rec[:, n:2 * n])             # quelle part du passé sert à lire ce passage
        candidat = np.tanh(x[:, 2 * n:] + r * rec[:, 2 * n:])     # la nouvelle information
        h = z * h + (1 - z) * candidat                            # mélange : ancienne mémoire + nouveauté
    return h


def predire(poids, sequences, entrees, detail=False):
    """La probabilité d'être perturbé pour chaque train. Avec detail=True, renvoie aussi les nombres
    de chaque étape (pour suivre un train à la main)."""
    journee = gru(sequences, poids["gru_0"], poids["gru_1"], poids["gru_2"])          # (B, 32)
    e_ligne = poids["emb_ligne_0"][entrees["ligne"]]                                   # (B, 8)
    e_heure = poids["emb_heure_0"][entrees["heure"]]                                   # (B, 4)
    e_jour = poids["emb_jour_0"][entrees["jour"]]                                      # (B, 3)
    x = np.concatenate([journee, e_ligne, e_heure, e_jour, entrees["nombres"]], axis=1)  # (B, 50)
    cachee = np.maximum(0, x @ poids["cachee_0"] + poids["cachee_1"])                  # (B, 32) ReLU
    z = cachee @ poids["sortie_0"] + poids["sortie_1"]                                 # (B, 1)
    p = sigmoide(z).ravel()
    if detail:
        return p, {"journee": journee, "concat": x, "cachee": cachee, "z": z.ravel()}
    return p
