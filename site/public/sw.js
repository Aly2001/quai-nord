// =====================================================================
//  Service worker de Quai Nord : le petit programme qui permet
//  à l'application de fonctionner HORS CONNEXION.
//
//  Il se place entre le site et internet, et décide pour chaque requête :
//  - le code du site (/assets/...)      -> d'abord la mémoire (il ne change jamais de nom)
//  - les données (/horaires/...)        -> d'abord internet (données fraîches),
//                                          la mémoire seulement si le réseau manque
//  - les pages (/, /trajet, /carte...)  -> d'abord internet, sinon la page en mémoire
//  - le temps réel                      -> jamais en mémoire (une info périmée serait trompeuse)
// =====================================================================
const VERSION = "quai-nord-v1";
const ESSENTIEL = ["/", "/manifest.webmanifest", "/icons/icone-192.png", "/icons/favicon-32.png"];

self.addEventListener("install", (evenement) => {
  evenement.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(ESSENTIEL)));
  self.skipWaiting();
});

self.addEventListener("activate", (evenement) => {
  // On supprime les mémoires des anciennes versions
  evenement.waitUntil(
    caches.keys().then((noms) => Promise.all(noms.filter((n) => n !== VERSION).map((n) => caches.delete(n))))
  );
  self.clients.claim();
});

function reseauPuisMemoire(requete, cleMemoire) {
  return fetch(requete)
    .then((reponse) => {
      if (reponse.ok) {
        const copie = reponse.clone();
        caches.open(VERSION).then((cache) => cache.put(cleMemoire || requete, copie));
      }
      return reponse;
    })
    .catch(() => caches.match(cleMemoire || requete));
}

self.addEventListener("fetch", (evenement) => {
  const requete = evenement.request;
  const adresse = new URL(requete.url);
  if (requete.method !== "GET" || adresse.origin !== self.location.origin) return;  // autres sites : on ne touche à rien
  if (adresse.pathname.endsWith("temps_reel.json")) return;                           // jamais de direct périmé

  if (requete.mode === "navigate") {
    // Toutes les pages de l'application sont la même page index.html
    evenement.respondWith(reseauPuisMemoire(requete, "/"));
  } else if (adresse.pathname.startsWith("/assets/")) {
    evenement.respondWith(
      caches.match(requete).then((enMemoire) => enMemoire || reseauPuisMemoire(requete))
    );
  } else {
    evenement.respondWith(reseauPuisMemoire(requete));
  }
});
