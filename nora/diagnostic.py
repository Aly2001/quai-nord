"""
Diagnostic de Nora : vérifie tout ce dont le serveur a besoin, et dit clairement ce qui ne va pas.
Les clés ne sont JAMAIS affichées (seulement leur longueur).

Lancement, depuis le dossier projet-sncf, DANS LE MÊME TERMINAL que celui où la clé est définie :
    python nora\\diagnostic.py
"""

import os
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
tout_va_bien = True


def ok(message):
    print(f"  [OK]       {message}")


def probleme(message, solution):
    global tout_va_bien
    tout_va_bien = False
    print(f"  [PROBLÈME] {message}")
    print(f"             -> {solution}")


print("\n1. Les fichiers")
app = RACINE / "nora" / "app.py"
if app.exists() and "FOURNISSEUR =" in app.read_text(encoding="utf-8"):
    ok("nora/app.py est la dernière version (Gemini et Mistral)")
else:
    probleme("nora/app.py est absent ou c'est une ancienne version",
             "remplace nora/app.py par la dernière version envoyée")
faq = RACINE / "site" / "src" / "data" / "faq.json"
if faq.exists():
    ok("site/src/data/faq.json est bien à sa place")
else:
    probleme("site/src/data/faq.json est introuvable", "place faq.json dans site/src/data/")

print("\n2. Les librairies")
try:
    import fastapi, httpx, uvicorn  # noqa: F401
    ok("fastapi, httpx et uvicorn sont installés")
except ImportError as erreur:
    probleme(f"librairie manquante : {erreur.name}", "lance : python -m pip install -r nora/requirements.txt")
    sys.exit(1)

print("\n3. Les clés (dans CE terminal)")
cles = {}
for nom in ("MISTRAL_API_KEY", "GEMINI_API_KEY"):
    valeur = os.environ.get(nom, "")
    if valeur:
        propre = valeur.strip().strip('"“”«» ')
        if propre != valeur:
            probleme(f"{nom} contient des espaces ou des guillemets en trop",
                     f'redéfinis-la : $env:{nom} = "ta-cle"  (guillemets droits, sans espace)')
        else:
            ok(f"{nom} est définie ({len(valeur)} caractères)")
        cles[nom] = propre
    else:
        print(f"  [--]       {nom} n'est pas définie dans ce terminal")
if not cles:
    probleme("aucune clé n'est définie dans ce terminal",
             'définis-en une DANS CE TERMINAL : $env:MISTRAL_API_KEY = "ta-cle"  (ou GEMINI_API_KEY)')

fournisseur = os.environ.get("NORA_FOURNISSEUR") or ("gemini" if "GEMINI_API_KEY" in cles else "mistral")
print(f"\n   Le serveur utilisera : {fournisseur.upper()}")

print("\n4. L'accès à Internet")
try:
    httpx.get("https://www.google.com", timeout=10)
    ok("Internet fonctionne")
except httpx.HTTPError:
    probleme("impossible de joindre Internet", "vérifie ta connexion, ton pare-feu ou ton antivirus")

print("\n5. Les clés sont-elles acceptées ?")
if "MISTRAL_API_KEY" in cles:
    try:
        r = httpx.get("https://api.mistral.ai/v1/models",
                      headers={"Authorization": f"Bearer {cles['MISTRAL_API_KEY']}"}, timeout=15)
        if r.status_code == 200:
            ok("Mistral accepte la clé")
        else:
            probleme(f"Mistral refuse la clé (code {r.status_code}) : {r.text[:150]}",
                     "401 : clé mal copiée ou pas encore active ; 403 : offre Experiment non activée "
                     "ou téléphone non vérifié (console.mistral.ai)")
    except httpx.HTTPError as erreur:
        probleme(f"impossible de joindre Mistral : {type(erreur).__name__}", "vérifie ta connexion")
if "GEMINI_API_KEY" in cles:
    try:
        r = httpx.get("https://generativelanguage.googleapis.com/v1beta/models",
                      headers={"x-goog-api-key": cles["GEMINI_API_KEY"]}, timeout=15)
        if r.status_code == 200:
            noms = [m["name"].split("/")[-1] for m in r.json().get("models", [])]
            flash = [n for n in noms if "flash" in n][:5]
            ok("Gemini accepte la clé")
            print(f"             modèles « flash » disponibles : {', '.join(flash) or 'aucun'}")
            if "gemini-3.8-flash" not in noms and flash:
                print(f'             -> gemini-3.8-flash absent de la liste : essaie $env:NORA_MODELE = "{flash[0]}"')
        else:
            probleme(f"Gemini refuse la clé (code {r.status_code}) : {r.text[:150]}",
                     "400 : clé invalide ou mal copiée ; 403 : clé non autorisée pour l'API Gemini")
    except httpx.HTTPError as erreur:
        probleme(f"impossible de joindre Gemini : {type(erreur).__name__}", "vérifie ta connexion")

print("\n6. Un vrai essai de réponse (comme Nora)")
modele = os.environ.get("NORA_MODELE", "gemini-3.8-flash" if fournisseur == "gemini" else "mistral-small-latest")
print(f"   Modèle essayé : {modele}")
try:
    if fournisseur == "gemini" and "GEMINI_API_KEY" in cles:
        configuration = {"temperature": 0.2, "maxOutputTokens": 2048, "responseMimeType": "application/json"}
        if modele.startswith("gemini-2.5"):
            configuration["thinkingConfig"] = {"thinkingBudget": 0}
        r = httpx.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{modele}:generateContent",
            headers={"x-goog-api-key": cles["GEMINI_API_KEY"]},
            json={"contents": [{"role": "user", "parts": [{"text": 'Réponds en JSON : {"reponse": "bonjour"}'}]}],
                  "generationConfig": configuration},
            timeout=30)
    elif fournisseur == "mistral" and "MISTRAL_API_KEY" in cles:
        r = httpx.post(
            "https://api.mistral.ai/v1/chat/completions",
            headers={"Authorization": f"Bearer {cles['MISTRAL_API_KEY']}"},
            json={"model": modele, "max_tokens": 50, "response_format": {"type": "json_object"},
                  "messages": [{"role": "user", "content": 'Réponds en JSON : {"reponse": "bonjour"}'}]},
            timeout=30)
    else:
        r = None
        probleme(f"pas de clé pour {fournisseur}", f"définis la clé de {fournisseur} dans ce terminal")
    if r is not None:
        if r.status_code == 200:
            ok("le modèle a bien répondu : Nora est prête à fonctionner")
        else:
            conseils = {
                429: "quota épuisé ou à zéro : attends une minute ; si le détail parle de « limit: 0 », "
                     "ce projet n'a pas de quota gratuit pour ce modèle : essaie "
                     '$env:NORA_MODELE = "gemini-2.5-flash-lite", ou crée la clé dans un autre projet',
                400: "un réglage est refusé par ce modèle : envoie-moi ce message",
                403: "la clé n'a pas le droit d'utiliser ce modèle",
                404: "modèle introuvable : choisis-en un dans la liste de l'étape 5 avec $env:NORA_MODELE",
            }
            probleme(f"le modèle refuse de répondre (code {r.status_code}) : {r.text[:400]}",
                     conseils.get(r.status_code, "envoie-moi ce message"))
except httpx.HTTPError as erreur:
    probleme(f"impossible de joindre le service : {type(erreur).__name__}", "vérifie ta connexion")

print("\n" + ("TOUT EST PRÊT : lance le serveur avec  python -m uvicorn nora.app:app --reload --port 8000"
              if tout_va_bien else "CORRIGE LES PROBLÈMES CI-DESSUS, puis relance ce diagnostic."))
