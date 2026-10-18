"""
Serveur de Nora, l'assistante de Quai Nord (FastAPI).

Pour chaque question, le serveur envoie au modèle de langage (Gemini ou Mistral) :
  1. les RÈGLES de Nora           (nora/regles.txt)
  2. la BASE DE CONNAISSANCES     (la FAQ du site, site/src/data/faq.json)
  3. le CONTEXTE DU TRAJET        (facultatif : le train que la personne regarde)
  4. la conversation

Puis il VÉRIFIE la réponse avant de la renvoyer au site :
  - les sources citées doivent exister dans la FAQ ;
  - une recherche de trajet doit avoir des paramètres valides.
Le modèle ne donne jamais d'horaire : c'est l'application qui cherche les trains.

Fournisseur du modèle : Gemini (clé dans GEMINI_API_KEY) ou Mistral (clé dans MISTRAL_API_KEY).
Lancement en local, après avoir défini la clé dans le terminal :
    uvicorn nora.app:app --reload --port 8000
Puis ouvrir http://localhost:8000/docs pour essayer.
"""

import json
import os
import re
import time
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ----------------------------------------------------------------------
# Réglages (modifiables par variables d'environnement)
# ----------------------------------------------------------------------
RACINE = Path(__file__).resolve().parent.parent
FICHIER_REGLES = Path(__file__).resolve().parent / "regles.txt"
FICHIER_FAQ = RACINE / "site" / "src" / "data" / "faq.json"
FICHIER_RESEAUX = RACINE / "site" / "src" / "data" / "reseaux.json"     # la liste UNIQUE des réseaux

# Le fournisseur du modèle de langage : "gemini" ou "mistral".
# Par défaut : Gemini si sa clé est présente, sinon Mistral.
FOURNISSEUR = os.environ.get("NORA_FOURNISSEUR") or ("gemini" if os.environ.get("GEMINI_API_KEY") else "mistral")
# Les noms de modèles évoluent vite : NORA_MODELE permet d'en changer sans toucher au code
MODELES_PAR_DEFAUT = {"gemini": "gemini-flash-lite-latest", "mistral": "mistral-small-latest"}
MODELE = os.environ.get("NORA_MODELE", MODELES_PAR_DEFAUT.get(FOURNISSEUR, "mistral-small-latest"))
URL_MISTRAL = "https://api.mistral.ai/v1/chat/completions"
URL_GEMINI = "https://generativelanguage.googleapis.com/v1beta/models/{modele}:generateContent"
# Secondes avant d'abandonner un essai. Firebase coupe les réponses au-delà de 60 s :
# avec 3 essais au maximum, 15 s par essai garde une marge.
DELAI = float(os.environ.get("NORA_DELAI", "15"))
NIVEAU_REFLEXION = os.environ.get("NORA_REFLEXION", "low")                 # réflexion de Gemini 3 : low ou high
# Modèle de secours, utilisé si le modèle principal est saturé (erreurs 503 ou 429)
MODELE_SECOURS = os.environ.get("NORA_MODELE_SECOURS", "gemini-flash-latest")
CODES_SATURATION = {429, 503}
QUESTIONS_PAR_JOUR = int(os.environ.get("NORA_QUESTIONS_PAR_JOUR", "10"))
# Le plafond de TOUT le site : une marge sous le quota gratuit de Gemini (environ 500 requêtes par jour
# pour Flash-Lite, par projet Google, vérifiable dans Google AI Studio)
QUESTIONS_TOTAL_PAR_JOUR = int(os.environ.get("NORA_QUESTIONS_TOTAL_PAR_JOUR", "400"))
# Google remet le quota à zéro à minuit, heure de Californie (9 h en France la plupart de l'année) :
# nos compteurs repartent au même moment
FUSEAU_QUOTA = ZoneInfo("America/Los_Angeles")
ORIGINES = os.environ.get("NORA_ORIGINES", "http://localhost:5173").split(",")
FUSEAU = ZoneInfo("Europe/Paris")

JOURS = {"aujourd'hui", "demain", "après-demain"}
FORMAT_HEURE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")

# ----------------------------------------------------------------------
# Le cerveau : règles + base de connaissances, chargés une fois au démarrage
# ----------------------------------------------------------------------
REGLES = FICHIER_REGLES.read_text(encoding="utf-8")
_faq = json.loads(FICHIER_FAQ.read_text(encoding="utf-8"))
QUESTIONS_FAQ = {q["question"] for groupe in _faq["faq"] for q in groupe["questions"]}
BASE_CONNAISSANCES = "\n\n".join(
    f"Q : {q['question']}\nR : {' '.join(q['reponse'])}"
    for groupe in _faq["faq"] for q in groupe["questions"]
)


JOURS_SEMAINE = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août",
        "septembre", "octobre", "novembre", "décembre"]


def date_en_francais(moment):
    return (f"{JOURS_SEMAINE[moment.weekday()]} {moment.day} {MOIS[moment.month - 1]} "
            f"{moment.year}, {moment:%H:%M}")


def message_systeme(contexte):
    texte = REGLES.replace("{date_heure}", date_en_francais(datetime.now(FUSEAU)))
    # La liste des villes vient de reseaux.json : une ville ajoutée est connue de Nora sans toucher aux règles
    texte = texte.replace("{villes_bus}", villes_couvertes(detail=True))
    texte = texte.replace("{villes_bus_court}", VILLES_COUVERTES)
    texte += "\n\nBASE DE CONNAISSANCES\n\n" + BASE_CONNAISSANCES
    if contexte:
        texte += "\n\nCONTEXTE DU TRAJET\n\n" + contexte
    return texte


# ----------------------------------------------------------------------
# Ce que le site envoie, et ce que le serveur renvoie
# ----------------------------------------------------------------------
class Message(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(min_length=1, max_length=600)


class Question(BaseModel):
    messages: list[Message] = Field(min_length=1, max_length=12)
    contexte: str | None = Field(default=None, max_length=600)


class Reponse(BaseModel):
    reponse: str
    sources: list[str]
    lien_sncf: bool
    action: dict | None
    questions_restantes: int


# ----------------------------------------------------------------------
# Les limites de questions (en mémoire) : par visiteur, et pour tout le site
# ----------------------------------------------------------------------
_compteurs = defaultdict(int)      # (visiteur, jour) -> questions posées
_total = defaultdict(int)          # jour -> questions posées sur tout le site


def jour_quota(maintenant=None):
    """Le « jour » au sens du quota de Google : il change à minuit en Californie."""
    return (maintenant or datetime.now(FUSEAU_QUOTA)).astimezone(FUSEAU_QUOTA).date().isoformat()


def reprise(maintenant=None):
    """Quand les questions reviennent, en heure française : « demain à 9 h » ou « aujourd'hui à 9 h »."""
    maintenant = (maintenant or datetime.now(FUSEAU_QUOTA)).astimezone(FUSEAU_QUOTA)
    minuit = datetime.combine(maintenant.date() + timedelta(days=1), datetime.min.time(), FUSEAU_QUOTA)
    en_france = minuit.astimezone(FUSEAU)
    jour = "aujourd'hui" if en_france.date() == maintenant.astimezone(FUSEAU).date() else "demain"
    return f"{jour} à {en_france.hour} h"


def adresse_visiteur(requete: Request):
    # Derrière Firebase et Cloud Run, la vraie adresse est la première de X-Forwarded-For
    transmise = requete.headers.get("x-forwarded-for", "")
    return transmise.split(",")[0].strip() or (requete.client.host if requete.client else "inconnu")


def refuser(code, message, **details):
    """Un refus 429 que le site sait afficher : « limite_visiteur » ou « plafond_site »."""
    raise HTTPException(429, {"code": code, "message": message, "reprise": reprise(), **details})


def compter_question(visiteur):
    jour = jour_quota()
    for cle in [c for c in _compteurs if c[1] != jour]:          # on oublie les jours passés
        del _compteurs[cle]
    for ancien in [j for j in _total if j != jour]:
        del _total[ancien]
    if _total[jour] >= QUESTIONS_TOTAL_PAR_JOUR:
        refuser("plafond_site", "Nora a reçu beaucoup de questions aujourd'hui.")
    if _compteurs[(visiteur, jour)] >= QUESTIONS_PAR_JOUR:
        refuser("limite_visiteur", f"Vous avez posé vos {QUESTIONS_PAR_JOUR} questions du jour.", limite=QUESTIONS_PAR_JOUR)
    _compteurs[(visiteur, jour)] += 1
    _total[jour] += 1
    return QUESTIONS_PAR_JOUR - _compteurs[(visiteur, jour)]


def rendre_question(visiteur):
    """Une question restée sans réponse (panne) n'est pas comptée au visiteur."""
    cle = (visiteur, jour_quota())
    if _compteurs[cle] > 0:
        _compteurs[cle] -= 1


# ----------------------------------------------------------------------
# L'appel au modèle : la SEULE partie qui dépend du fournisseur
# ----------------------------------------------------------------------
ERREUR_VISITEUR = "Nora ne répond pas pour le moment. Réessayez dans un instant."
EXPLICATIONS = {
    400: "requête refusée : avec Gemini, c'est souvent une clé invalide ou mal copiée",
    401: "clé refusée : vérifie qu'elle est bien copiée et active",
    403: "accès refusé : vérifie que la clé est autorisée pour ce service",
    404: "modèle introuvable : vérifie le nom du modèle (réglage NORA_MODELE)",
    422: "requête refusée (paramètre invalide)",
    429: "trop de requêtes : limite de l'offre gratuite atteinte, réessaie dans une minute",
    503: "modèle saturé chez le fournisseur (forte demande, temporaire), même après les nouveaux essais",
}


def appeler_mistral(messages, cle, modele):
    reponse = httpx.post(
        URL_MISTRAL,
        headers={"Authorization": f"Bearer {cle}"},
        json={
            "model": modele,
            "messages": messages,
            "temperature": 0.2,          # des réponses stables, peu « créatives »
            "max_tokens": 400,           # des réponses courtes : coûts maîtrisés
            "response_format": {"type": "json_object"},
        },
        timeout=DELAI,
    )
    reponse.raise_for_status()
    return reponse.json()["choices"][0]["message"]["content"]


def appeler_gemini(messages, cle, modele):
    # Gemini range les règles à part (« systemInstruction ») et appelle l'assistant « model »
    systeme = "\n\n".join(m["content"] for m in messages if m["role"] == "system")
    contenus = [{"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]}
                for m in messages if m["role"] != "system"]
    configuration = {
        "temperature": 0.2,
        # Les modèles Gemini récents « réfléchissent » avant de répondre, et cette réflexion
        # compte dans la longueur autorisée : on laisse une marge pour que le JSON ne soit pas coupé
        "maxOutputTokens": 2048,
        "responseMimeType": "application/json",   # Gemini répond directement en JSON
    }
    if modele.startswith("gemini-2.5"):
        # Pas de « réflexion » avant de répondre : plus rapide, et la réponse n'est jamais coupée
        configuration["thinkingConfig"] = {"thinkingBudget": 0}
    elif modele.startswith("gemini-3"):
        # Réflexion légère : Nora répond à partir de la FAQ, inutile de réfléchir longtemps
        configuration["thinkingConfig"] = {"thinkingLevel": NIVEAU_REFLEXION}
    reponse = httpx.post(
        URL_GEMINI.format(modele=modele),
        headers={"x-goog-api-key": cle},
        json={"systemInstruction": {"parts": [{"text": systeme}]}, "contents": contenus,
              "generationConfig": configuration},
        timeout=DELAI,
    )
    reponse.raise_for_status()
    parties = reponse.json()["candidates"][0]["content"]["parts"]
    # On ne garde que le texte de la réponse (pas les éventuelles « pensées » du modèle)
    return "".join(p.get("text", "") for p in parties if not p.get("thought"))


def appeler_modele(messages):
    nom_cle = "GEMINI_API_KEY" if FOURNISSEUR == "gemini" else "MISTRAL_API_KEY"
    # .strip() : retire un éventuel espace ou retour à la ligne invisible autour de la clé
    cle = (os.environ.get(nom_cle) or "").strip().strip('"')
    if not cle:
        print(f"Nora : ERREUR : la variable {nom_cle} n'est pas définie dans ce terminal", flush=True)
        raise HTTPException(500, "Nora n'est pas configurée (clé absente).")
    appeler = appeler_gemini if FOURNISSEUR == "gemini" else appeler_mistral
    # Les essais successifs : le modèle principal deux fois, puis le modèle de secours (Gemini)
    essais = [MODELE, MODELE]
    if FOURNISSEUR == "gemini" and MODELE_SECOURS and MODELE_SECOURS != MODELE:
        essais.append(MODELE_SECOURS)
    try:
        for numero, modele in enumerate(essais):
            try:
                return appeler(messages, cle, modele)
            except httpx.HTTPStatusError as erreur:
                dernier = numero == len(essais) - 1
                if erreur.response.status_code in CODES_SATURATION and not dernier:
                    print(f"Nora : {modele} saturé (code {erreur.response.status_code}), nouvel essai…", flush=True)
                    time.sleep(1)
                    continue
                raise
            except httpx.TimeoutException:
                # Un modèle trop lent est traité comme saturé : on passe à l'essai suivant
                if numero < len(essais) - 1:
                    print(f"Nora : {modele} trop lent (plus de {DELAI:.0f} s), nouvel essai…", flush=True)
                    continue
                raise
    except httpx.HTTPStatusError as erreur:
        # Diagnostic pour le développeur, dans le terminal du serveur (jamais la clé, jamais pour le visiteur)
        code = erreur.response.status_code
        explication = EXPLICATIONS.get(code, "erreur du côté du fournisseur")
        print(f"Nora : ERREUR {FOURNISSEUR.upper()} {code} : {explication}. Détail : {erreur.response.text[:300]}",
              flush=True)
        texte = erreur.response.text.lower()
        if code == 429 and ("perday" in texte or "per day" in texte):
            # Le quota du JOUR de Google est épuisé (avant notre plafond) : inutile de réessayer avant la remise
            # à zéro, on ferme Nora pour tout le site jusque-là, avec le message de pause
            _total[jour_quota()] = QUESTIONS_TOTAL_PAR_JOUR
            refuser("plafond_site", "Nora a reçu beaucoup de questions aujourd'hui.")
        raise HTTPException(502, ERREUR_VISITEUR)
    except httpx.HTTPError as erreur:
        print(f"Nora : ERREUR DE CONNEXION à {FOURNISSEUR} : {type(erreur).__name__} : {erreur}", flush=True)
        raise HTTPException(502, ERREUR_VISITEUR)
    except (KeyError, IndexError, ValueError, TypeError):
        print(f"Nora : ERREUR : réponse de {FOURNISSEUR} dans un format inattendu", flush=True)
        raise HTTPException(502, ERREUR_VISITEUR)


# ----------------------------------------------------------------------
# La vérification de ce que dit le modèle
# ----------------------------------------------------------------------
SENS_BUS = {"depuis_gare", "vers_gare"}


def sans_accents(texte):
    import unicodedata
    texte = unicodedata.normalize("NFD", str(texte)).encode("ascii", "ignore").decode().lower()
    return " ".join("".join(c if c.isalnum() else " " for c in texte).split())


# Les réseaux couverts, lus dans la même liste que le site et charger_bus.py
RESEAUX = json.loads(FICHIER_RESEAUX.read_text(encoding="utf-8"))["reseaux"]


def villes_couvertes(detail=False):
    """« Lille, Calais, … et Arras », les villes avec métro et tram d'abord. En détail, pour les règles de Nora :
    « Lille (avec le métro et le tram ; aussi Roubaix, Tourcoing), …, Amiens (aussi Longueau), … »."""
    noms = []
    for r in sorted(RESEAUX, key=lambda r: -len(r["modes"])):
        if not detail:
            noms.append(r["ville"])
            continue
        premier = sans_accents(r["ville"]).split()[0]
        autres = [g for g in r["gares"] if sans_accents(g).split()[0] != premier]
        precisions = (["avec le métro et le tram"] if len(r["modes"]) > 1 else []) + ([f"aussi {', '.join(autres)}"] if autres else [])
        noms.append(r["ville"] + (f" ({' ; '.join(precisions)})" if precisions else ""))
    return ", ".join(noms[:-1]) + " et " + noms[-1]


VILLES_COUVERTES = villes_couvertes()
MOTS_GARE_INUTILES = {"la", "gare", "de", "du", "d", "l", "sncf", "ville", "centre"}


def reseau_de_ville(texte):
    """« Boulogne-sur-Mer », « Roubaix » -> le réseau (boulogne, lille), ou None."""
    cherche = sans_accents(texte)
    return next((r for r in RESEAUX if cherche and (cherche in r["villes"] or cherche == sans_accents(r["ville"]))), None)


def reseau_de_gare(gare):
    """Le réseau d'une gare citée (« Lille Flandres », « gare Boulogne ville », « Longueau »), ou None.
    On compare le premier mot utile au début des noms de gares et aux villes du réseau."""
    mots = [m for m in sans_accents(gare).split() if m not in MOTS_GARE_INUTILES]
    if not mots:
        return None
    for r in RESEAUX:
        noms = [sans_accents(g).split() for g in r["gares"]] + [v.split() for v in r["villes"]]
        if any(n and n[0] == mots[0] for n in noms):
            return r
    return None


def lieu_est_la_ville(action):
    """Vrai si le « lieu » n'est que le nom de la ville ou d'une de ses gares (« Calais », « Calais Ville »)."""
    lieu = " ".join(m for m in sans_accents(action.get("lieu", "")).split() if m not in MOTS_GARE_INUTILES | {"centre", "a", "au", "pour"})
    reseau = next((r for r in RESEAUX if r["code"] == action.get("reseau")), None)
    if not lieu or not reseau:
        return False
    noms = set(reseau["villes"]) | {sans_accents(reseau["ville"])} | {" ".join(m for m in sans_accents(g).split() if m not in MOTS_GARE_INUTILES) for g in reseau["gares"]}
    return lieu in noms


def verifier_bus(action):
    """Le PÉRIMÈTRE des transports, vérifié par le code (et non seulement par les règles de l'IA) :
    une gare d'un côté du trajet, dans une ville couverte, et un lieu précis de l'autre."""
    sens = str(action.get("sens", "")).strip()
    lieu = str(action.get("lieu", "")).strip()
    # « la gare de Boulogne Ville » -> « Boulogne Ville » : l'IA ajoute parfois ces mots
    mots_gare = str(action.get("gare", "")).strip().split()
    while mots_gare and sans_accents(mots_gare[0]) in {"la", "gare", "de", "du", "sncf", "l"}:
        mots_gare.pop(0)
    gare = " ".join(mots_gare)
    if sens not in SENS_BUS or not lieu or len(lieu) > 80 or len(gare) > 60:
        return None
    par_ville = reseau_de_ville(action.get("ville", ""))
    par_gare = reseau_de_gare(gare) if gare else None
    if par_ville and par_gare and par_ville["code"] != par_gare["code"]:
        return None                       # une gare d'une autre ville : hors périmètre
    reseau = par_ville or par_gare
    if not reseau:
        return None                       # une ville non couverte
    return {"type": "itineraire_bus", "sens": sens, "gare": gare, "ville": reseau["ville"],
            "reseau": reseau["code"], "lieu": lieu}


def verifier_action(action):
    """Une action n'est acceptée que si tous ses paramètres sont valides."""
    if isinstance(action, dict) and action.get("type") == "itineraire_bus":
        return verifier_bus(action)
    if not isinstance(action, dict) or action.get("type") != "rechercher_trajet":
        return None
    de, a = str(action.get("de", "")).strip(), str(action.get("a", "")).strip()
    jour, heure = str(action.get("jour", "")).strip().lower(), str(action.get("heure", "")).strip()
    if not de or not a or len(de) > 60 or len(a) > 60:
        return None
    if jour not in JOURS:
        jour = "aujourd'hui"
    if not FORMAT_HEURE.match(heure):
        heure = datetime.now(FUSEAU).strftime("%H:%M")
    return {"type": "rechercher_trajet", "de": de, "a": a, "jour": jour, "heure": heure}


def lire_reponse(texte):
    try:
        donnees = json.loads(texte)
    except json.JSONDecodeError:
        # Le modèle n'a pas respecté le format : on garde le texte, sans source ni action
        return {"reponse": texte.strip()[:800], "sources": [], "lien_sncf": False, "action": None}
    action_proposee = donnees.get("action")
    action = verifier_action(action_proposee)
    reponse = "" if action else str(donnees.get("reponse", "")).strip()[:800]
    if action and action.get("type") == "itineraire_bus" and lieu_est_la_ville(action):
        # « Bus pour Calais » : le nom de la ville n'est pas une destination. On demande où, sans chercher.
        reponse = (f"Où allez-vous à {action['ville']} ? Dites-moi un lieu ou une adresse, "
                   "par exemple « la mairie », « la plage » ou « 10 rue Royale ».")
        action = None
    if action is None and isinstance(action_proposee, dict) and action_proposee.get("type") == "itineraire_bus" and not reponse:
        # L'IA a proposé un bus hors du périmètre : le code refuse à sa place
        ville = str(action_proposee.get("ville", "")).strip()[:40]
        if ville and not reseau_de_ville(ville) and not reseau_de_gare(str(action_proposee.get("gare", ""))):
            # Une ville dont on ne connaît pas encore les bus : non clair, la ville reprise, et le train proposé
            reponse = (f"Je ne connais pas encore les bus de {ville}, désolée. Je les connais à {VILLES_COUVERTES}. "
                       "De nouvelles villes arrivent au fil du temps : peut-être bientôt la vôtre. "
                       "Je peux aussi vous dire si votre TER des Hauts-de-France risque d'être en retard.")
        else:
            reponse = (f"Je peux vous aider pour les bus, trams et métros entre une gare et votre destination, à {VILLES_COUVERTES}. "
                       "Par exemple : « Je suis à la gare de Lille Flandres, je vais à l'université ».")
    return {
        "reponse": reponse,
        # Seules les sources qui existent VRAIMENT dans la FAQ sont gardées
        "sources": [s for s in donnees.get("sources", []) if s in QUESTIONS_FAQ][:3],
        "lien_sncf": bool(donnees.get("lien_sncf", False)),
        "action": action,
    }


# ----------------------------------------------------------------------
# L'application
# ----------------------------------------------------------------------
app = FastAPI(title="Nora, l'assistante de Quai Nord")
app.add_middleware(CORSMiddleware, allow_origins=ORIGINES, allow_methods=["POST", "GET"], allow_headers=["*"])


@app.get("/api/sante")
def sante():
    return {"ok": True, "fournisseur": FOURNISSEUR, "modele": MODELE, "questions_faq": len(QUESTIONS_FAQ),
            # Pour surveiller le quota : questions posées aujourd'hui sur tout le site, et le plafond
            "questions_aujourdhui": _total[jour_quota()], "plafond": QUESTIONS_TOTAL_PAR_JOUR}


@app.post("/api/nora", response_model=Reponse)
def nora(question: Question, requete: Request):
    if question.messages[-1].role != "user":
        raise HTTPException(422, "Le dernier message doit venir de la personne.")
    visiteur = adresse_visiteur(requete)
    restantes = compter_question(visiteur)

    debut = time.time()
    messages = [{"role": "system", "content": message_systeme(question.contexte)}]
    messages += [{"role": m.role, "content": m.content} for m in question.messages[-8:]]
    try:
        resultat = lire_reponse(appeler_modele(messages))
    except HTTPException:
        rendre_question(visiteur)          # pas de réponse : la question ne compte pas pour le visiteur
        raise
    # Un journal minimal, sans le contenu des questions (vie privée)
    print(f"Nora : réponse en {time.time() - debut:.1f} s, action={bool(resultat['action'])}", flush=True)
    return {**resultat, "questions_restantes": restantes}
