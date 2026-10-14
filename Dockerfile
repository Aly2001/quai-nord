# ======================================================================
#  Image Docker du serveur de Nora (déployée sur Google Cloud Run)
#  Elle ne contient QUE le serveur et la FAQ : ni les bases de données,
#  ni le site, ni aucune clé (la clé est fournie par Secret Manager).
# ======================================================================
FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONUTF8=1

# Les librairies du serveur seulement (pas pytest, inutile en production)
RUN pip install --no-cache-dir fastapi "uvicorn[standard]" httpx

COPY nora/ nora/
COPY site/src/data/faq.json site/src/data/faq.json

# Cloud Run indique le port à utiliser dans la variable PORT
CMD exec uvicorn nora.app:app --host 0.0.0.0 --port ${PORT:-8080}
