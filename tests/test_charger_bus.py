"""
Tests de charger_bus.py, sur un petit réseau inventé (aucun téléchargement).
Lancement, depuis le dossier projet-sncf : python -m pytest tests -q
"""
import io
import json
import sys
import zipfile
from datetime import date
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import charger_bus as cb  # noqa: E402


def faux_gtfs(fin="20271231", avec_calendrier=True):
    """Un mini réseau : un métro, un tram, un bus, une ligne scolaire et un bus à la demande."""
    fichiers = {
        "routes.txt": "route_id,route_short_name,route_long_name,route_type,route_color\n"
                      "M1,M1,Métro 1,1,FFCC00\nT,R,Tram Roubaix,0,\nB1,L1,Liane 1,3,0000FF\n"
                      "S12,S12,Collège Adam de la Halle,3,\nTAD,F1,Flex,715,\nSC,40,Ligne scolaire Lycée,3,\n",
        "stops.txt": "stop_id,stop_name,stop_lat,stop_lon,location_type\n"
                     "G,Gare,50.6370,3.0700,0\nA,Mairie,50.6400,3.0800,0\nZ,Zone,50.6,3.0,1\n",
        "trips.txt": "route_id,service_id,trip_id,trip_headsign\n"
                     "M1,S,v1,CHU\nM1,S,v2,CHU\nT,S,v3,Roubaix\nB1,S,v4,\nS12,S,v5,Collège\nTAD,S,v6,\nSC,S,v7,Lycée\n",
        "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n" + "".join(
            f"{v},08:00:00,08:00:00,G,1\n{v},08:06:00,08:06:00,A,2\n" for v in ["v1", "v2", "v3", "v4", "v5", "v6", "v7"]),
    }
    if avec_calendrier:
        fichiers["calendar.txt"] = ("service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,"
                                    f"start_date,end_date\nS,1,1,1,1,1,0,0,20260901,{fin}\n")
        fichiers["calendar_dates.txt"] = "service_id,date,exception_type\nS,20261225,2\n"
    tampon = io.BytesIO()
    with zipfile.ZipFile(tampon, "w") as z:
        for nom, contenu in fichiers.items():
            z.writestr(nom, contenu)
    return tampon.getvalue()


@pytest.fixture
def reseau_test(tmp_path, monkeypatch):
    """Prépare le faux réseau dans un dossier temporaire, sans gtfs.db ni OpenStreetMap."""
    monkeypatch.setattr(cb, "DOSSIER_SORTIE", tmp_path / "bus")
    monkeypatch.setattr(cb, "DOSSIER_ZIP", tmp_path / "zips")
    monkeypatch.setattr(cb, "gares_sncf", lambda noms: {"Lille Flandres": (50.6370, 3.0700)})
    monkeypatch.setattr(cb, "lieux_utiles", lambda gares, anciens: [])
    (tmp_path / "zips").mkdir()
    reseau = {"code": "test", "nom": "Réseau test", "gares": ["lille flandres", "lille europe"],
              "source": "test", "exclure": ["^s ?\\d+$"]}

    def preparer(contenu):
        (tmp_path / "zips" / "test.zip").write_bytes(contenu)
        cb.preparer("test", reseau)
        return json.loads((tmp_path / "bus" / "test.json").read_text(encoding="utf-8"))
    return preparer


# ---------- La liste unique ----------
def test_la_liste_des_reseaux_est_complete():
    reseaux = cb.lire_reseaux()
    assert {"calais", "boulogne", "lille", "dunkerque", "amiens", "arras"} <= set(reseaux)
    for code, r in reseaux.items():
        assert r["code"] == code and code.isalpha() and code.islower()
        for champ in ("nom", "ville", "villes", "gares", "url", "source", "site", "exclure"):
            assert champ in r, f"{code} : champ {champ} manquant"
        # Les noms de gares doivent déjà être « normalisés », sinon ils ne seraient jamais trouvés
        assert all(g == cb.normaliser(g) for g in r["gares"]), code


# ---------- La validité ----------
def test_validite_lue_dans_le_calendrier():
    archive = zipfile.ZipFile(io.BytesIO(faux_gtfs()))
    assert cb.periode_validite(archive) == (date(2026, 9, 1), date(2027, 12, 31))


def test_un_jour_retire_ne_compte_pas():
    archive = zipfile.ZipFile(io.BytesIO(faux_gtfs()))
    # Les jours RETIRÉS (exception_type 2, ici le 25/12) ne comptent pas, les jours AJOUTÉS (1) oui
    assert cb.periode_validite(archive)[1] == date(2027, 12, 31)


def test_fichier_expire_refuse():
    with pytest.raises(ValueError, match="EXPIRÉ"):
        cb.controler_validite(date(2026, 1, 1), date(2026, 6, 30), aujourd_hui=date(2026, 10, 16))


def test_expiration_proche_signalee():
    avertissements = cb.controler_validite(date(2026, 1, 1), date(2026, 10, 31), aujourd_hui=date(2026, 10, 16))
    assert any("expire dans 15 jours" in a for a in avertissements)


def test_fichier_valide_sans_avertissement():
    assert cb.controler_validite(date(2026, 1, 1), date(2027, 7, 2), aujourd_hui=date(2026, 10, 16)) == []


def test_futur_reseau_signale():
    avertissements = cb.controler_validite(date(2026, 11, 1), date(2027, 7, 2), aujourd_hui=date(2026, 10, 16))
    assert any("futur réseau" in a for a in avertissements)


# ---------- Les types de transport et les lignes écartées ----------
@pytest.mark.parametrize("route_type, mode", [("0", "tram"), ("900", "tram"), ("1", "metro"), ("401", "metro"),
                                              ("3", "bus"), ("700", "bus"), ("", "bus"), (None, "bus")])
def test_mode_transport(route_type, mode):
    assert cb.mode_transport(route_type) == mode


def test_lignes_ecartees():
    assert cb.ligne_exclue({"route_short_name": "40", "route_long_name": "Ligne scolaire Lycée"})
    assert cb.ligne_exclue({"route_short_name": "TAD 3", "route_long_name": ""})
    assert cb.ligne_exclue({"route_short_name": "F1", "route_type": "715"})
    assert cb.ligne_exclue({"route_short_name": "S12"}, ["^s ?\\d+$"])
    assert not cb.ligne_exclue({"route_short_name": "S12"})                # motif propre à Arras seulement
    assert not cb.ligne_exclue({"route_short_name": "L1", "route_long_name": "Liane 1", "route_type": "3"})
    assert not cb.ligne_exclue({"route_short_name": "CIT3", "route_long_name": "Citadine Sud"})


# ---------- La préparation complète ----------
def test_preparation_complete(reseau_test):
    donnees = reseau_test(faux_gtfs())
    noms = {l["nom"]: l["mode"] for l in donnees["lignes"].values()}
    assert noms == {"M1": "metro", "R": "tram", "L1": "bus"}           # scolaires et TAD écartées
    assert {p["ligne"] for p in donnees["parcours"]} == {"M1", "T", "B1"}
    assert donnees["valide_jusqu_au"] == "2027-12-31"
    assert "Z" not in donnees["arrets"]                                  # une zone n'est pas un point d'arrêt
    assert donnees["gares"]["Lille Flandres"]["arrets_proches"][0] == ["G", 0]


def test_fichier_expire_garde_l_ancien(reseau_test, tmp_path):
    reseau_test(faux_gtfs())
    avant = (tmp_path / "bus" / "test.json").read_text(encoding="utf-8")
    with pytest.raises(ValueError):
        reseau_test(faux_gtfs(fin="20260101"))
    assert (tmp_path / "bus" / "test.json").read_text(encoding="utf-8") == avant


def test_sans_calendrier_on_continue(reseau_test):
    donnees = reseau_test(faux_gtfs(avec_calendrier=False))
    assert donnees["valide_jusqu_au"] is None and donnees["lignes"]


# ---------- Le lancement ----------
def test_reseau_inconnu(capsys):
    assert cb.main(["paris"]) == 1
    assert "Réseau inconnu" in capsys.readouterr().out


def test_sans_argument_affiche_la_liste(capsys):
    assert cb.main([]) == 0
    sortie = capsys.readouterr().out
    assert "lille" in sortie and "calais" in sortie


# ---------- Les lieux utiles : les bâtiments d'un campus ----------
def test_batiments_d_un_campus_ecartes():
    campus = [{"nom": "Université d'Artois", "cat": "universite", "lat": 50.2870, "lon": 2.7700}]
    batiments = [
        {"nom": "A - Accueil", "cat": "universite", "lat": 50.30, "lon": 2.80},             # nom d'une aile
        {"nom": "Amphithéâtre Derisbourg", "cat": "universite", "lat": 50.2872, "lon": 2.7702},  # sur le campus
        {"nom": "IUT de Béthune", "cat": "universite", "lat": 50.52, "lon": 2.63},           # isolé : gardé
    ]
    assert [b["nom"] for b in cb.batiments_utiles(batiments, campus)] == ["IUT de Béthune"]


def test_lieux_utiles_garde_le_campus(monkeypatch):
    elements = [
        {"tags": {"amenity": "university", "name": "Université d'Artois"}, "center": {"lat": 50.2870, "lon": 2.7700}},
        {"tags": {"building": "university", "name": "B - Agence Comptable"}, "center": {"lat": 50.2871, "lon": 2.7701}},
        {"tags": {"building": "university", "name": "Bibliothèque"}, "center": {"lat": 50.2869, "lon": 2.7699}},
        {"tags": {"amenity": "townhall", "name": "Hôtel de ville"}, "lat": 50.2910, "lon": 2.7770},
    ]
    monkeypatch.setattr(cb, "demander_overpass", lambda requete: elements if "university" in requete else [])
    monkeypatch.setattr(cb.time, "sleep", lambda s: None)
    lieux = cb.lieux_utiles({"Arras": (50.2870, 2.7810)}, [])
    assert sorted(l["nom"] for l in lieux) == ["Hôtel de ville", "Université d'Artois"]


@pytest.mark.parametrize("nom", ["C1 - Lettres et Arts", "C1 — Lettres", "C2 \u2011 UFR d'Histoire", "D -Langues",
                                 "D\u00a0-\u00a0Langues étrangères", "B2: Amphis", "Bâtiment E", "Amphithéâtre Derisbourg"])
def test_noms_de_parties_ecartes(nom):
    assert cb.batiments_utiles([{"nom": nom, "cat": "universite", "lat": 50.0, "lon": 2.0}], []) == []


@pytest.mark.parametrize("nom", ["IUT de Béthune", "CESI École d'ingénieurs - campus d'Arras", "INSPÉ Lille"])
def test_vrais_etablissements_gardes(nom):
    assert len(cb.batiments_utiles([{"nom": nom, "cat": "universite", "lat": 50.0, "lon": 2.0}], [])) == 1


def test_ufr_declaree_comme_universite_gardee_sans_sa_lettre(monkeypatch):
    # Ce qu'on a vu à Arras : les UFR sont déclarées comme universités, avec la lettre du bâtiment devant
    elements = [
        {"tags": {"amenity": "university", "name": "Université d'Artois"}, "center": {"lat": 50.2870, "lon": 2.7700}},
        {"tags": {"amenity": "university", "name": "F - UFR d'Economie, Gestion"}, "center": {"lat": 50.2875, "lon": 2.7705}},
        {"tags": {"amenity": "university", "name": "C1 - Lettres et Arts"}, "center": {"lat": 50.2880, "lon": 2.7710}},
        {"tags": {"amenity": "college", "name": "CESI École d'ingénieurs - campus d'Arras"}, "center": {"lat": 50.29, "lon": 2.78}},
    ]
    monkeypatch.setattr(cb, "demander_overpass", lambda requete: elements if "university" in requete else [])
    monkeypatch.setattr(cb.time, "sleep", lambda s: None)
    noms = sorted(l["nom"] for l in cb.lieux_utiles({"Arras": (50.2870, 2.7810)}, []))
    assert noms == ["CESI École d'ingénieurs - campus d'Arras", "Lettres et Arts", "UFR d'Economie, Gestion",
                    "Université d'Artois"]


# ---------- Les voyages sur réservation ----------
def test_voyages_sur_reservation_ecartes(reseau_test):
    contenu = faux_gtfs()
    # On rend le bus L1 entièrement « sur réservation » (pickup_type 2 à tous ses arrêts)
    tampon = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(contenu)) as source, zipfile.ZipFile(tampon, "w") as z:
        for nom in source.namelist():
            texte = source.read(nom).decode()
            if nom == "stop_times.txt":
                lignes = texte.splitlines()
                texte = lignes[0] + ",pickup_type,drop_off_type\n" + "".join(
                    l + (",2,2\n" if l.startswith("v4,") else ",0,0\n") for l in lignes[1:])
            z.writestr(nom, texte)
    donnees = reseau_test(tampon.getvalue())
    assert {l["nom"] for l in donnees["lignes"].values()} == {"M1", "R"}


def test_arret_sur_reservation():
    assert cb.arret_sur_reservation({"pickup_type": "2"})
    assert cb.arret_sur_reservation({"pickup_type": "0", "drop_off_type": "2"})
    assert not cb.arret_sur_reservation({"pickup_type": "0", "drop_off_type": ""})
    assert not cb.arret_sur_reservation({})


# ---------- Les lieux desservis ----------
def test_lieux_sans_arret_proche_ecartes():
    arrets = {"G": ["Gare", 50.6370, 3.0700]}
    lieux = [{"nom": "Près", "cat": "mairie", "lat": 50.6380, "lon": 3.0700},          # environ 110 m
             {"nom": "Courtrai", "cat": "universite", "lat": 50.8270, "lon": 3.2650}]   # en Belgique
    assert [l["nom"] for l in cb.lieux_desservis(lieux, arrets)] == ["Près"]


def test_lieu_desservi_a_la_limite_d_un_carre():
    # Le lieu et l'arrêt sont dans deux « carrés » voisins : il doit quand même être trouvé
    arrets = {"A": ["Arrêt", 50.6449, 3.0700]}
    assert len(cb.lieux_desservis([{"nom": "L", "cat": "poste", "lat": 50.6451, "lon": 3.0700}], arrets)) == 1


def test_motifs_de_la_liste_valides():
    # Les lignes scolaires S de Lille et d'Arras sont écartées, pas les lignes normales
    reseaux = cb.lire_reseaux()
    # Les lignes Tempo d'Amiens (T31 à T49) sont scolaires
    assert cb.ligne_exclue({"route_short_name": "T40"}, reseaux["amiens"]["exclure"])
    assert not cb.ligne_exclue({"route_short_name": "N1"}, reseaux["amiens"]["exclure"])
    for code in ("lille", "arras"):
        assert cb.ligne_exclue({"route_short_name": "S45"}, reseaux[code]["exclure"])
        assert not cb.ligne_exclue({"route_short_name": "L1"}, reseaux[code]["exclure"])
        assert not cb.ligne_exclue({"route_short_name": "CIT1"}, reseaux[code]["exclure"])


def test_grand_site_accepte_plus_loin():
    # Le point central d'un campus est souvent à plus de 500 m de l'arrêt le plus proche
    arrets = {"M": ["Métro", 50.6100, 3.1400]}
    a_700_m = 50.6100 + 0.0063                     # environ 700 m plus au nord
    lieux = [{"nom": "IMT Nord Europe", "cat": "universite", "lat": a_700_m, "lon": 3.1400},
             {"nom": "Bureau de poste", "cat": "poste", "lat": a_700_m, "lon": 3.1400}]
    assert [l["nom"] for l in cb.lieux_desservis(lieux, arrets)] == ["IMT Nord Europe"]



def test_lycee_range_comme_college_reclasse():
    # Un lycée avec des BTS est souvent rangé « college » (enseignement supérieur) dans OpenStreetMap
    assert cb.categorie_lieu({"amenity": "college", "name": "Lycée Madeleine Michelis"}) == "lycee"
    assert cb.categorie_lieu({"amenity": "college", "name": "Cité Scolaire Delambre-Montaigne"}) == "lycee"
    assert cb.categorie_lieu({"amenity": "college", "name": "UniLaSalle Amiens"}) == "universite"


def test_batiment_declare_comme_universite_ecarte(monkeypatch):
    elements = [
        {"tags": {"amenity": "university", "name": "Bâtiment A - Accueil"}, "center": {"lat": 49.89, "lon": 2.30}},
        {"tags": {"amenity": "university", "name": "Université de Picardie Jules Verne"}, "center": {"lat": 49.89, "lon": 2.29}},
    ]
    monkeypatch.setattr(cb, "demander_overpass", lambda requete: elements if "university" in requete else [])
    monkeypatch.setattr(cb.time, "sleep", lambda s: None)
    assert [l["nom"] for l in cb.lieux_utiles({"Amiens": (49.89, 2.31)}, [])] == ["Université de Picardie Jules Verne"]



def test_lignes_scolaires_de_calais_et_boulogne():
    reseaux = cb.lire_reseaux()
    # Calais : les TS (transport scolaire) ; les lignes 1 à 13, ATC, B et M restent
    assert cb.ligne_exclue({"route_short_name": "TS12"}, reseaux["calais"]["exclure"])
    for nom in ("1", "13", "ATC", "B", "M"):
        assert not cb.ligne_exclue({"route_short_name": nom}, reseaux["calais"]["exclure"])
    # Boulogne : les 24 lignes scolaires sont numérotées (153, 206...), les lignes régulières sont des lettres
    assert cb.ligne_exclue({"route_short_name": "153"}, reseaux["boulogne"]["exclure"])
    for nom in ("A", "B1", "K2", "NEMO", "NAV1", "TH02"):
        assert not cb.ligne_exclue({"route_short_name": nom}, reseaux["boulogne"]["exclure"])
