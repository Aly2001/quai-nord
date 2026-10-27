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
const VERSION = "quai-nord-v3";
const ESSENTIEL = ["/", "/manifest.webmanifest", "/icons/icone-192.png", "/icons/favicon-32.png"];
// Une nouvelle version s'installe en arrière-plan, puis ATTEND : c'est le voyageur qui choisit
// le moment (« Mettre à jour »), pour ne jamais recharger la page au milieu d'une recherche.

self.addEventListener("install", (evenement) => {
  evenement.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(ESSENTIEL)));
});

// Le site envoie ce message quand le voyageur touche « Mettre à jour »
self.addEventListener("message", (evenement) => {
  if (evenement.data?.type === "METTRE_A_JOUR") self.skipWaiting();
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
  if (adresse.pathname.startsWith("/api/")) return;                                   // le serveur (direct, Nora) : jamais en mémoire

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

// ---------- Les notifications des trains suivis ----------
// Le serveur envoie { titre, corps, url } : on l'affiche, et le toucher ouvre la bonne page (écran Partir…)
self.addEventListener("push", (evenement) => {
  let message = {};
  try { message = evenement.data ? evenement.data.json() : {}; } catch { message = { corps: evenement.data?.text() }; }
  evenement.waitUntil(self.registration.showNotification(message.titre || "Quai Nord", {
    body: message.corps || "",
    icon: "/icons/icone-192.png",
    badge: "/icons/icone-192.png",
    data: { url: message.url || "/" },
    tag: message.url || "quai-nord",          // une nouvelle alerte pour le même train remplace l'ancienne
  }));
});

self.addEventListener("notificationclick", (evenement) => {
  evenement.notification.close();
  const url = evenement.notification.data?.url || "/";
  evenement.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((fenetres) => {
    for (const fenetre of fenetres) {
      if ("focus" in fenetre) { fenetre.navigate(url); return fenetre.focus(); }
    }
    return self.clients.openWindow(url);
  }));
});
