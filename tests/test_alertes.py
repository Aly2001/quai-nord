"""Les alertes : quoi envoyer, une seule fois, et jamais la nuit."""
from datetime import date, datetime
from zoneinfo import ZoneInfo

import alertes as al

PARIS = ZoneInfo("Europe/Paris")
TRAIN = {"de": "Boulogne - Tintelleries", "a": "Calais Ville", "heure": "07:13", "arrivee": "07:39", "repetition": "une",
         "jour": "2026-10-28", "rappel": {"minute": 422, "texte": "À pied, 6 min"}, "url": "/partir?id=x"}
HORAIRE = {"heure": "07:13", "trip_id": "T1", "stop_id": "BT", "suite": [{"gare": "Calais Ville", "heure": "07:39", "stop_id": "CV"}]}
JOUR = date(2026, 10, 28)
a = lambda hh, mm, j=28: datetime(2026, 10, j, hh, mm, tzinfo=PARIS)
direct = lambda statut="PREVU", retard=0: {"trajets": {"T1": {"statut": statut, "arrets": {"BT": [None, retard * 60, False]}}}}


def test_les_jours_a_verifier():
    assert al.jours_a_verifier(TRAIN, a(20, 0, 27)) == [JOUR]                  # la veille : pour une suppression annoncée
    semaine = dict(TRAIN, repetition="semaine", jour=None)
    assert al.jours_a_verifier(semaine, datetime(2026, 10, 30, 20, 0, tzinfo=PARIS)) == [date(2026, 10, 30)]   # vendredi : pas samedi


def test_retrouver_le_train():
    assert al.retrouver_train([HORAIRE], "07:13", "Calais Ville") is HORAIRE
    assert al.retrouver_train([HORAIRE], "07:13", "Lille Flandres") is None


def test_supprime_une_seule_fois_et_avec_le_suivant():
    ev, etat = al.decider(TRAIN, JOUR, HORAIRE, direct("SUPPRIME"), {}, a(6, 30), suivant="07:43")
    assert [e[0] for e in ev] == ["supprime"]
    titre, corps = al.composer(*ev[0], "fr")
    assert "supprimé" in titre and "07:43" in corps
    assert al.decider(TRAIN, JOUR, HORAIRE, direct("SUPPRIME"), etat, a(6, 35))[0] == []      # déjà envoyé


def test_retard_aggravation_et_retour_a_l_heure():
    ev, etat = al.decider(TRAIN, JOUR, HORAIRE, direct(retard=8), {}, a(6, 30))
    assert ev[0][0] == "retard" and "partez comme prévu" in al.composer(*ev[0], "fr")[1]
    assert al.decider(TRAIN, JOUR, HORAIRE, direct(retard=12), etat, a(6, 35))[0] == []        # +4 min : on ne redit rien
    ev2, etat = al.decider(TRAIN, JOUR, HORAIRE, direct(retard=20), etat, a(6, 40))
    assert ev2[0][0] == "retard"                                                                # +12 min : nouvelle alerte
    ev3, _ = al.decider(TRAIN, JOUR, HORAIRE, direct(retard=0), etat, a(6, 45))
    assert ev3[0][0] == "heure"


def test_le_rappel_dix_minutes_avant_de_partir():
    assert al.decider(TRAIN, JOUR, HORAIRE, direct(), {}, a(6, 40))[0] == []                   # 22 min avant : trop tôt
    ev, etat = al.decider(TRAIN, JOUR, HORAIRE, direct(), {}, a(6, 55))                        # 7 min avant 07:02
    assert ev[0][0] == "rappel"
    titre, corps = al.composer(*ev[0], "en")
    assert "Leave in 7 min" in titre and "on time" in corps
    assert al.decider(TRAIN, JOUR, HORAIRE, direct(), etat, a(6, 57))[0] == []                 # une seule fois


def test_rien_apres_le_depart_et_rien_la_nuit():
    assert al.decider(TRAIN, JOUR, HORAIRE, direct(retard=9), {}, a(7, 30))[0] == []
    assert al.la_nuit(a(23, 30)) and al.la_nuit(a(5, 59)) and not al.la_nuit(a(6, 0))



def test_un_train_disparu_des_horaires_une_alerte_et_pas_de_rappel():
    # Le 06:24 n'est plus dans les horaires du jour : à l'heure du rappel, on prévient qu'il ne circule pas
    ev, etat = al.decider(TRAIN, JOUR, None, direct(), {}, a(6, 55), proche="07:27")
    assert [e[0] for e in ev] == ["disparu"]                                  # et surtout pas « rappel »
    titre, corps = al.composer(*ev[0], "fr")
    assert "ne circule pas aujourd'hui" in titre and "07:27" in corps
    assert al.decider(TRAIN, JOUR, None, direct(), etat, a(6, 58), proche="07:27")[0] == []    # une seule fois
    # Sans fichier d'horaires pour ce jour, on ne conclut rien
    assert al.decider(TRAIN, JOUR, None, direct(), {}, a(6, 55), departs_charges=False)[0] == []


def test_le_train_le_plus_proche():
    departs = [dict(HORAIRE, heure=h) for h in ("05:49", "07:13", "07:27")]
    assert al.train_le_plus_proche(departs, "06:24", "Calais Ville") == "07:13"
