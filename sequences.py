"""
Les SÉQUENCES du réseau de neurones : ce qu'on savait de la ligne, ce jour-là, avant de prédire un train.

Pour chaque passage d'un TER à une gare, on fabrique la liste des LONGUEUR derniers passages de la même
ligne, le même jour, qui étaient déjà JUGÉS (perturbés ou non) 30 min avant le départ de son train.
Même règle que « l'état de la ligne » du modèle logistique (entrainer_modele.py) : jamais d'information
venue de l'avenir. La seule différence : au lieu d'UN chiffre (la part de perturbés), le réseau reçoit
la liste complète, dans l'ordre, et peut y voir une tendance (« ça empire depuis une heure »).

Ce fichier sert À LA FOIS à l'essai (notebook Colab) et, si le réseau gagne, à la prédiction sur la VM :
le même code des deux côtés, pour que le modèle reçoive exactement les mêmes informations.

Résultat : un tenseur de forme (N, LONGUEUR, 6), en float32.
  Chaque passage de la séquence est décrit par 6 nombres, déjà ramenés à des valeurs proches de 0-1 :
    0  present        1 pour un vrai passage, 0 pour le remplissage du petit matin
    1  retard         retard en minutes / 60, borné entre -0,1 et 1 (de -6 à +60 min)
    2  perturbe       1 si retard de 5 min ou plus, ou supprimé
    3  supprime       1 si supprimé (train entier ou arrêt sauté)
    4  il_y_a         il y a combien de temps il a été jugé, en heures / 12, borné à 1
    5  position       rang de l'arrêt dans son trajet / 30, borné à 1
  Le remplissage est fait de zéros AU DÉBUT : le passage le plus récent est toujours à la fin.
"""
import numpy as np
import pandas as pd

LONGUEUR = 20                             # les 20 derniers passages jugés de la ligne
NB_INFOS = 6
AVANCE = pd.Timedelta(minutes=30)         # le risque est annoncé 30 min avant le départ du train
CONNU_APRES = pd.Timedelta(minutes=5)     # un passage est jugé 5 min après son heure prévue
INFOS = ["present", "retard", "perturbe", "supprime", "il_y_a", "position"]


def construire_sequences(df, longueur=LONGUEUR):
    """df : une ligne par passage, avec les colonnes date (jour de service), trip_id, ligne,
    heure_prevue, retard_minutes, perturbe, supprime, ordre_arret.
    Renvoie un tableau numpy (len(df), longueur, 6), dans le MÊME ordre que df."""
    df = df.reset_index(drop=True)
    sortie = np.zeros((len(df), longueur, NB_INFOS), dtype=np.float32)
    moment = pd.to_datetime(df["heure_prevue"])
    # La question est posée 30 min avant le départ du train (son premier passage du jour)
    question = moment.groupby([df["date"], df["trip_id"]]).transform("min") - AVANCE
    connu = moment + CONNU_APRES

    infos = np.column_stack([
        np.ones(len(df)),
        np.clip(df["retard_minutes"].fillna(0).to_numpy(float) / 60, -0.1, 1),
        df["perturbe"].fillna(0).to_numpy(float),
        df["supprime"].fillna(0).to_numpy(float),
        np.zeros(len(df)),                                           # « il y a » : dépend de la question
        np.clip(df["ordre_arret"].fillna(0).to_numpy(float) / 30, 0, 1),
    ]).astype(np.float32)
    connu_ns = connu.to_numpy("datetime64[ns]").astype(np.int64)
    question_ns = question.to_numpy("datetime64[ns]").astype(np.int64)

    for _, lignes in df.groupby(["date", "ligne"], sort=False).indices.items():
        # Les passages de cette ligne ce jour-là, du plus tôt au plus tard jugé
        ordre = lignes[np.argsort(connu_ns[lignes], kind="stable")]
        faits_connus = connu_ns[ordre]
        # Pour chaque question : combien de passages étaient déjà jugés (connu <= question)
        combien = np.searchsorted(faits_connus, question_ns[lignes], side="right")
        # On ajoute `longueur` lignes vides devant, pour que le remplissage tombe tout seul au début
        faits = np.vstack([np.zeros((longueur, NB_INFOS), np.float32), infos[ordre]])
        quand = np.concatenate([np.zeros(longueur, np.int64), faits_connus])
        fenetres = combien[:, None] + np.arange(longueur)[None, :]   # indices dans `faits`
        seq = faits[fenetres]
        il_y_a_h = (question_ns[lignes][:, None] - quand[fenetres]) / 3.6e12
        seq[:, :, 4] = np.where(seq[:, :, 0] > 0, np.clip(il_y_a_h / 12, 0, 1), 0)
        sortie[lignes] = seq
    return sortie
