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
    1  retard         retard VISIBLE au moment de la question, en minutes / 60, borné entre -0,1 et 1 :
                      un train de 8 h qui arrivera avec 40 min de retard n'en montre que 30 à 8 h 30
                      (il n'est pas encore arrivé). Jamais le retard final s'il n'était pas encore connu.
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


def question_par_defaut(df):
    """L'heure de la question : le premier passage du train ce jour-là, moins 30 min."""
    moment = pd.to_datetime(df["heure_prevue"])
    return moment.groupby([df["date"], df["trip_id"]]).transform("min") - AVANCE


def construire_sequences(df, longueur=LONGUEUR, cibles=None, question=None):
    """df : les passages OBSERVÉS (une ligne par passage), avec les colonnes date (jour de service),
    trip_id, ligne, heure_prevue, retard_minutes, perturbe, supprime, ordre_arret.
    cibles : les passages à PRÉDIRE (par défaut : df lui-même, comme à l'apprentissage) ;
             colonnes date, ligne et, si question n'est pas donnée, trip_id et heure_prevue.
    question : l'heure de la question pour chaque cible (par défaut : départ du train − 30 min).
               En direct, c'est « maintenant » si le train part dans plus de 30 min.
    Renvoie un tableau numpy (len(cibles), longueur, 6), dans le MÊME ordre que cibles."""
    df = df.reset_index(drop=True)
    cibles = df if cibles is None else cibles.reset_index(drop=True)
    if question is None:
        question = question_par_defaut(cibles)
    question_ns = pd.to_datetime(pd.Series(question).reset_index(drop=True)).to_numpy("datetime64[ns]").astype(np.int64)
    sortie = np.zeros((len(cibles), longueur, NB_INFOS), dtype=np.float32)

    connu = pd.to_datetime(df["heure_prevue"]) + CONNU_APRES
    infos = np.column_stack([
        np.ones(len(df)),
        np.clip(df["retard_minutes"].fillna(0).to_numpy(float) / 60, -0.1, 1),
        df["perturbe"].fillna(0).to_numpy(float),
        df["supprime"].fillna(0).to_numpy(float),
        np.zeros(len(df)),                                           # « il y a » : dépend de la question
        np.clip(df["ordre_arret"].fillna(0).to_numpy(float) / 30, 0, 1),
    ]).astype(np.float32)
    connu_ns = connu.to_numpy("datetime64[ns]").astype(np.int64)
    evenements = df.groupby(["date", "ligne"], sort=False).indices

    for cle, lignes in cibles.groupby(["date", "ligne"], sort=False).indices.items():
        passes = evenements.get(cle)
        if passes is None:
            continue                                                  # rien d'observé : que du remplissage
        # Les passages de cette ligne ce jour-là, du plus tôt au plus tard jugé
        ordre = passes[np.argsort(connu_ns[passes], kind="stable")]
        faits_connus = connu_ns[ordre]
        # Pour chaque question : combien de passages étaient déjà jugés (connu <= question)
        combien = np.searchsorted(faits_connus, question_ns[lignes], side="right")
        # On ajoute `longueur` lignes vides devant, pour que le remplissage tombe tout seul au début
        faits = np.vstack([np.zeros((longueur, NB_INFOS), np.float32), infos[ordre]])
        quand = np.concatenate([np.zeros(longueur, np.int64), faits_connus])
        fenetres = combien[:, None] + np.arange(longueur)[None, :]   # indices dans `faits`
        seq = faits[fenetres]
        il_y_a_h = (question_ns[lignes][:, None] - quand[fenetres]) / 3.6e12
        present = seq[:, :, 0] > 0
        seq[:, :, 4] = np.where(present, np.clip(il_y_a_h / 12, 0, 1), 0)
        # Le retard visible à l'heure de la question : au plus le temps écoulé depuis l'heure prévue
        # (heure prévue = heure « connu » − 5 min). Le retard final n'est connu qu'à l'arrivée du train.
        ecoule_h = il_y_a_h + CONNU_APRES / pd.Timedelta(hours=1)
        seq[:, :, 1] = np.where(present, np.minimum(seq[:, :, 1], ecoule_h), 0)
        sortie[lignes] = seq
    return sortie
