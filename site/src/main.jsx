import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App.jsx";
import { LangueProvider } from "./langue/langue";

// BrowserRouter « enveloppe » toute l'application :
// il surveille l'adresse dans le navigateur (/, /carte, /trajet...)
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <LangueProvider>
        <App />
      </LangueProvider>
    </BrowserRouter>
  </StrictMode>
);

// Application installable : on enregistre le service worker (mode hors connexion).
// Seulement sur le site construit (npm run build), pas pendant le développement.
// Quand une NOUVELLE version attend, on le signale au site (le bandeau « Mettre à jour »).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  const signaler = (attente) => window.dispatchEvent(new CustomEvent("quai-nord:nouvelle-version", { detail: attente }));
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then((inscription) => {
      if (inscription.waiting && navigator.serviceWorker.controller) signaler(inscription.waiting);
      inscription.addEventListener("updatefound", () => {
        const nouveau = inscription.installing;
        nouveau?.addEventListener("statechange", () => {
          // « installed » avec un contrôleur déjà là : c'est une mise à jour (pas la toute première visite)
          if (nouveau.state === "installed" && navigator.serviceWorker.controller) signaler(nouveau);
        });
      });
      // En revenant sur l'application (elle reste souvent ouverte), on regarde s'il y a du nouveau
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") inscription.update(); });
    }).catch(() => {});
  });
  // La nouvelle version a pris la main : on recharge une seule fois
  let recharge = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (recharge) return;
    recharge = true;
    window.location.reload();
  });
}
