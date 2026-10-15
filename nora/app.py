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
from datetime import datetime
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

# Le fournisseur du modèle de langage : "gemini" ou "mistral".
# Par défaut : Gemini si sa clé est présente, sinon Mistral.
FOURNISSEUR = os.environ.get("NORA_FOURNISSEUR") or ("gemini" if os.environ.get("GEMINI_API_KEY") else "mistral")
# Les noms de modèles évoluent vite : NORA_MODELE permet d'en changer sans toucher au code
MODELES_PAR_DEFAUT = {"gemini": "gemini-3.8-flash", "mistral": "mistral-small-latest"}
MODELE = os.environ.get("NORA_MODELE", MODELES_PAR_DEFAUT.get(FOURNISSEUR, "mistral-small-latest"))
URL_MISTRAL = "https://api.mistral.ai/v1/chat/completions"
URL_GEMINI = "https://generativelanguage.googleapis.com/v1beta/models/{modele}:generateContent"
DELAI = float(os.environ.get("NORA_DELAI", "45"))                         # secondes avant d'abandonner
NIVEAU_REFLEXION = os.environ.get("NORA_REFLEXION", "low")                 # réflexion de Gemini 3 : low ou high
QUESTIONS_PAR_JOUR = int(os.environ.get("NORA_QUESTIONS_PAR_JOUR", "10"))
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
# Limite de questions par visiteur et par jour (en mémoire)
# ----------------------------------------------------------------------
_compteurs = defaultdict(int)


def adresse_visiteur(requete: Request):
    # Derrière Firebase et Cloud Run, la vraie adresse est la première de X-Forwarded-For
    transmise = requete.headers.get("x-forwarded-for", "")
    return transmise.split(",")[0].strip() or (requete.client.host if requete.client else "inconnu")


def compter_question(visiteur):
    cle = (visiteur, datetime.now(FUSEAU).date().isoformat())
    if _compteurs[cle] >= QUESTIONS_PAR_JOUR:
        raise HTTPException(429, "Vous avez posé vos questions du jour. Nora sera de nouveau disponible demain.")
    _compteurs[cle] += 1
    return QUESTIONS_PAR_JOUR - _compteurs[cle]


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
}


def appeler_mistral(messages, cle):
    reponse = httpx.post(
        URL_MISTRAL,
        headers={"Authorization": f"Bearer {cle}"},
        json={
            "model": MODELE,
            "messages": messages,
            "temperature": 0.2,          # des réponses stables, peu « créatives »
            "max_tokens": 400,           # des réponses courtes : coûts maîtrisés
            "response_format": {"type": "json_object"},
        },
        timeout=DELAI,
    )
    reponse.raise_for_status()
    return reponse.json()["choices"][0]["message"]["content"]


def appeler_gemini(messages, cle):
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
    if MODELE.startswith("gemini-2.5"):
        # Pas de « réflexion » avant de répondre : plus rapide, et la réponse n'est jamais coupée
        configuration["thinkingConfig"] = {"thinkingBudget": 0}
    elif MODELE.startswith("gemini-3"):
        # Réflexion légère : Nora répond à partir de la FAQ, inutile de réfléchir longtemps
        configuration["thinkingConfig"] = {"thinkingLevel": NIVEAU_REFLEXION}
    reponse = httpx.post(
        URL_GEMINI.format(modele=MODELE),
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
    try:
        return (appeler_gemini if FOURNISSEUR == "gemini" else appeler_mistral)(messages, cle)
    except httpx.HTTPStatusError as erreur:
        # Diagnostic pour le développeur, dans le terminal du serveur (jamais la clé, jamais pour le visiteur)
        code = erreur.response.status_code
        explication = EXPLICATIONS.get(code, "erreur du côté du fournisseur")
        print(f"Nora : ERREUR {FOURNISSEUR.upper()} {code} : {explication}. Détail : {erreur.response.text[:300]}",
              flush=True)
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
def verifier_action(action):
    """Une recherche de trajet n'est acceptée que si tous ses paramètres sont valides."""
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
    action = verifier_action(donnees.get("action"))
    return {
        "reponse": "" if action else str(donnees.get("reponse", "")).strip()[:800],
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
    return {"ok": True, "fournisseur": FOURNISSEUR, "modele": MODELE, "questions_faq": len(QUESTIONS_FAQ)}


@app.post("/api/nora", response_model=Reponse)
def nora(question: Question, requete: Request):
    if question.messages[-1].role != "user":
        raise HTTPException(422, "Le dernier message doit venir de la personne.")
    restantes = compter_question(adresse_visiteur(requete))

    debut = time.time()
    messages = [{"role": "system", "content": message_systeme(question.contexte)}]
    messages += [{"role": m.role, "content": m.content} for m in question.messages[-8:]]
    resultat = lire_reponse(appeler_modele(messages))
    # Un journal minimal, sans le contenu des questions (vie privée)
    print(f"Nora : réponse en {time.time() - debut:.1f} s, action={bool(resultat['action'])}", flush=True)
    return {**resultat, "questions_restantes": restantes}
