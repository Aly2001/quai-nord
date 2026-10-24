# ======================================================================
#  Image Docker du serveur de Nora (déployée sur Google Cloud Run)
#  Elle ne contient QUE le serveur, la FAQ et la liste des réseaux : ni les bases de données,
#  ni le site, ni aucune clé (la clé est fournie par Secret Manager).
# ======================================================================
FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONUTF8=1

# Les librairies du serveur : UNE seule liste, nora/requirements.txt (la même pour les tests et l'image)
COPY nora/requirements.txt nora/requirements.txt
RUN pip install --no-cache-dir -r nora/requirements.txt

COPY nora/ nora/
COPY site/src/data/faq.json site/src/data/faq.json
COPY site/src/data/reseaux.json site/src/data/reseaux.json

# Cloud Run indique le port à utiliser dans la variable PORT
CMD exec uvicorn nora.app:app --host 0.0.0.0 --port ${PORT:-8080}
