"""
Les ALERTES des trains suivis, envoyées toutes les 5 minutes (planifiées sur la VM, avec cron).

  1. On relit les abonnements (un fichier par téléphone, dans le stockage Google Cloud, écrit par le serveur de Nora).
  2. Pour chaque train suivi qui circule aujourd'hui (ou demain, pour une suppression déjà annoncée),
     on le retrouve dans les horaires du jour (site/public/horaires) et dans le direct de la SNCF.
  3. On décide quoi envoyer, UNE SEULE FOIS par événement (l'état est gardé dans alertes_etat.json) :
       - supprimé        : avec le train suivant ;
       - retard (≥ 5 min) : pour information, en conseillant de partir comme prévu (un retard peut se réduire) ;
                            une nouvelle alerte seulement s'il s'aggrave de 10 min ou plus ;
       - retour à l'heure : seulement après une alerte de retard ;
       - le rappel        : « Partez dans 10 min », 10 minutes avant l'heure de départ de chez soi.
  4. La nuit (23 h - 6 h), rien ne part : ce qui reste vrai au matin part à 6 h.

Les clés : la clé privée VAPID (secrets/vapid_private.pem) ne quitte jamais la VM et n'est pas dans Git.
    python alertes.py            (une vérification, comme le fera cron)
    python alertes.py --essai    (n'envoie rien : affiche seulement ce qui partirait)
"""
import json
import sys
import time
import unicodedata
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import requests                    # déjà utilisé par le collecteur sur la VM

RACINE = Path(__file__).resolve().parent
HORAIRES = RACINE / "site" / "public" / "horaires"
FICHIER_ETAT = RACINE / "alertes_etat.json"
CLE_PRIVEE = RACINE / "secrets" / "vapid_private.pem"
SEAU = "quai-nord-transfert-aly"
DIRECT = "https://quai-nord.web.app/api/temps-reel"
SITE = "https://quai-nord.web.app"
PARIS = ZoneInfo("Europe/Paris")

RETARD_MIN = 5            # minutes : à partir de là, on prévient
AGGRAVATION = 10          # minutes de plus pour une nouvelle alerte de retard
RAPPEL_AVANT = 10         # minutes avant le départ de chez soi
NUIT = (23, 6)            # de 23 h à 6 h, aucune notification

TEXTES = {
    "fr": {
        "supprime": ("🔴 Votre {heure} est supprimé", "{de} → {a}. Prochain train : {suivant}.", "{de} → {a}. Touchez pour voir les autres trains."),
        "retard": ("🟠 Votre {heure} a {minutes} min de retard", "Départ annoncé à {nouvelle}. Par prudence, partez comme prévu : un retard peut se réduire."),
        "heure": ("🟢 Votre {heure} est de nouveau à l'heure", "{de} → {a}, d'après la SNCF."),
        "rappel": ("🏠 Partez dans {dans} min pour votre {heure}", "{texte}. {etat}"),
        "etat_heure": "Votre train est à l'heure pour l'instant.",
        "etat_retard": "Retard annoncé : {minutes} min, mais partez comme prévu.",
        "etat_inconnu": "",
    },
    "en": {
        "supprime": ("🔴 Your {heure} is cancelled", "{de} → {a}. Next train: {suivant}.", "{de} → {a}. Tap to see other trains."),
        "retard": ("🟠 Your {heure} is {minutes} min late", "Expected to leave at {nouvelle}. To be safe, leave as planned: a delay can shrink."),
        "heure": ("🟢 Your {heure} is on time again", "{de} → {a}, according to SNCF."),
        "rappel": ("🏠 Leave in {dans} min for your {heure}", "{texte}. {etat}"),
        "etat_heure": "Your train is on time for now.",
        "etat_retard": "{minutes} min delay announced, but leave as planned.",
        "etat_inconnu": "",
    },
}


# ---------- Les petits outils ----------
def normaliser(texte):
    sans = unicodedata.normalize("NFD", texte or "")
    sans = "".join(c for c in sans if unicodedata.category(c) != "Mn").lower()
    return " ".join("".join(c if c.isalnum() else " " for c in sans).split())


def en_minutes(hhmm):
    h, m = map(int, hhmm.split(":"))
    return h * 60 + m


def en_heure(minutes):
    minutes %= 1440
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def jours_a_verifier(train, maintenant):
    """Les jours où ce train suivi peut faire l'objet d'une alerte : aujourd'hui, et demain (suppressions annoncées)."""
    aujourdhui = maintenant.date()
    candidats = [aujourdhui, aujourdhui + timedelta(days=1)]
    if train["repetition"] == "une":
        return [j for j in candidats if j.isoformat() == train.get("jour")]
    return [j for j in candidats if j.weekday() < 5]


def retrouver_train(departs, heure, arrivee_gare):
    """Le train qui part à « heure » et passe ensuite par la gare d'arrivée (comme le site)."""
    cible = normaliser(arrivee_gare)
    for train in departs:
        if train["heure"] == heure and any(cible in normaliser(s["gare"]) for s in train.get("suite", [])):
            return train
    return None


def train_suivant(departs, train, arrivee_gare):
    cible = normaliser(arrivee_gare)
    for autre in departs:
        if autre["heure"] > train["heure"] and any(cible in normaliser(s["gare"]) for s in autre.get("suite", [])):
            return autre["heure"]
    return None


def etat_du_direct(direct, train):
    """{ "supprime": bool, "retard": minutes } d'après le direct de la SNCF (None si le train n'y est pas)."""
    info = (direct or {}).get("trajets", {}).get(train.get("trip_id"))
    if not info:
        return None
    if info.get("statut") == "SUPPRIME":
        return {"supprime": True, "retard": 0}
    arret = info.get("arrets", {}).get(train.get("stop_id"), [None, None, False])
    secondes = arret[1] if arret[1] is not None else (arret[0] or 0)
    return {"supprime": False, "retard": round(secondes / 60)}


# ---------- La décision : quoi envoyer, une seule fois ----------
def decider(train, jour, train_horaire, direct, deja, maintenant, suivant=None):
    """Renvoie (événements à envoyer, nouvel état). deja : ce qui a déjà été envoyé pour ce train ce jour-là.
    Un événement : (type, valeurs) ; types : supprime, retard, heure, rappel."""
    etat = dict(deja)
    evenements = []
    aujourdhui = jour == maintenant.date()
    minutes = maintenant.hour * 60 + maintenant.minute
    depart = en_minutes(train["heure"])
    if aujourdhui and minutes > depart + 5:                       # le train est parti : plus rien à dire
        return evenements, etat
    info = etat_du_direct(direct, train_horaire) if train_horaire else None
    valeurs = {"heure": train["heure"], "de": train["de"], "a": train["a"]}
    if info and info["supprime"]:
        if not etat.get("supprime"):
            evenements.append(("supprime", {**valeurs, "suivant": suivant}))
            etat["supprime"] = True
        return evenements, etat                                    # supprimé : ni retard, ni rappel
    if aujourdhui and info:
        retard = info["retard"]
        deja_retard = etat.get("retard", 0)
        if retard >= RETARD_MIN and (deja_retard == 0 or retard >= deja_retard + AGGRAVATION):
            evenements.append(("retard", {**valeurs, "minutes": retard, "nouvelle": en_heure(depart + retard)}))
            etat["retard"] = retard
        elif retard < 2 and deja_retard > 0:
            evenements.append(("heure", valeurs))
            etat["retard"] = 0
    rappel = train.get("rappel")
    if aujourdhui and rappel and not etat.get("rappel"):
        dans = rappel["minute"] - minutes
        if 0 <= dans <= RAPPEL_AVANT:
            retard = info["retard"] if info else None
            evenements.append(("rappel", {**valeurs, "dans": dans, "texte": rappel["texte"], "retard": retard}))
            etat["rappel"] = True
    return evenements, etat


def composer(type_, valeurs, langue):
    """Le titre et le texte de la notification, dans la langue du téléphone."""
    t = TEXTES.get(langue, TEXTES["fr"])
    if type_ == "supprime":
        titre, avec, sans = t["supprime"]
        return titre.format(**valeurs), (avec if valeurs.get("suivant") else sans).format(**valeurs)
    if type_ == "rappel":
        retard = valeurs.get("retard")
        etat = t["etat_retard"].format(minutes=retard) if retard and retard >= RETARD_MIN else t["etat_heure"] if retard is not None else t["etat_inconnu"]
        titre, corps = t["rappel"]
        return titre.format(**valeurs), corps.format(**valeurs, etat=etat).strip()
    titre, corps = t[type_]
    return titre.format(**valeurs), corps.format(**valeurs)


def la_nuit(maintenant):
    return maintenant.hour >= NUIT[0] or maintenant.hour < NUIT[1]


# ---------- Les fichiers ----------
def lire_departs(cache, index, nom_gare, jour):
    cle = (nom_gare, jour)
    if cle not in cache:
        gare = next((g for g in index["gares"] if normaliser(g["nom"]) == normaliser(nom_gare)), None)
        chemin = HORAIRES / gare["slug"] / f"{jour}.json" if gare else None
        cache[cle] = json.loads(chemin.read_text(encoding="utf-8"))["departs"] if chemin and chemin.exists() else []
    return cache[cle]


def lire_etat():
    try:
        return json.loads(FICHIER_ETAT.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def main(arguments=None):
    arguments = sys.argv[1:] if arguments is None else arguments
    essai = "--essai" in arguments
    maintenant = datetime.now(PARIS)
    from google.cloud import storage
    seau = storage.Client().bucket(SEAU)
    abonnements = [(b, json.loads(b.download_as_text())) for b in seau.list_blobs(prefix="alertes/")]
    if not abonnements:
        print("Aucun abonnement.")
        return 0
    index = json.loads((HORAIRES / "gares.json").read_text(encoding="utf-8"))
    try:
        direct = requests.get(DIRECT, timeout=20).json()
    except Exception as erreur:                                      # sans direct : seulement les rappels
        print(f"Direct indisponible : {erreur}")
        direct = None
    etat, cache, envoyes = lire_etat(), {}, 0
    for blob, abonnement in abonnements:
        for train in abonnement.get("trains", []):
            for jour in jours_a_verifier(train, maintenant):
                departs = lire_departs(cache, index, train["de"], jour.isoformat())
                horaire = retrouver_train(departs, train["heure"], train["a"])
                cle = f"{blob.name}|{jour}|{train['de']}|{train['heure']}"
                suivant = train_suivant(departs, horaire, train["a"]) if horaire else None
                evenements, nouvel = decider(train, jour, horaire, direct, etat.get(cle, {}), maintenant, suivant)
                if not evenements:
                    continue
                if la_nuit(maintenant):
                    continue                                       # rien la nuit ; l'état ne change pas
                tout_envoye = True
                for type_, valeurs in evenements:
                    titre, corps = composer(type_, valeurs, abonnement.get("langue", "fr"))
                    print(f"   {type_:8} {train['heure']} {train['de']} -> {train['a']} : {titre}")
                    if essai:
                        continue
                    if not envoyer(abonnement["abonnement"], titre, corps, SITE + train.get("url", "/"), blob):
                        tout_envoye = False
                        break
                    envoyes += 1
                # On ne note « envoyé » que si l'envoi a réussi : sinon, on réessaiera dans 5 minutes
                if not essai and tout_envoye:
                    etat[cle] = {**nouvel, "le": maintenant.date().isoformat()}
    # On oublie l'état de plus de deux jours
    limite = (maintenant.date() - timedelta(days=2)).isoformat()
    etat = {c: v for c, v in etat.items() if v.get("le", "") >= limite}
    if not essai:
        FICHIER_ETAT.write_text(json.dumps(etat, ensure_ascii=False), encoding="utf-8")
    print(f"{len(abonnements)} abonnement(s), {envoyes} alerte(s) envoyée(s){' (essai : rien envoyé)' if essai else ''}.")
    return 0


def charger_cle():
    """La clé privée VAPID, lue nous-mêmes (au format PEM) : on accepte les deux noms possibles du fichier."""
    from py_vapid import Vapid
    for chemin in (CLE_PRIVEE, CLE_PRIVEE.with_name("private_key.pem")):
        if chemin.exists():
            return Vapid.from_file(str(chemin))
    raise FileNotFoundError(f"Clé privée introuvable : {CLE_PRIVEE} (voir la création des clés, avec vapid --gen)")


_cle = None


def envoyer(abonnement, titre, corps, url, blob):
    """Envoie une notification. Si le téléphone n'existe plus (adresse expirée), on efface son abonnement.
    Une erreur sur un envoi n'arrête jamais les autres : on la note, et on réessaiera au prochain passage."""
    global _cle
    from pywebpush import webpush, WebPushException
    try:
        _cle = _cle or charger_cle()
        webpush(subscription_info=abonnement, data=json.dumps({"titre": titre, "corps": corps, "url": url}),
                vapid_private_key=_cle, vapid_claims={"sub": SITE}, ttl=3600)
        return True
    except WebPushException as erreur:
        statut = getattr(erreur.response, "status_code", None)
        if statut in (404, 410):
            blob.delete()
            print("   Adresse expirée : abonnement effacé.")
        else:
            print(f"   Envoi impossible ({statut}) : {erreur}")
        return False
    except Exception as erreur:                                   # la clé, le réseau… : on continue avec les autres
        print(f"   Envoi impossible : {erreur}")
        return False


if __name__ == "__main__":
    sys.exit(main())
