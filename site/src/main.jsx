import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App.jsx";

// BrowserRouter « enveloppe » toute l'application :
// il surveille l'adresse dans le navigateur (/, /carte, /trajet...)
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);

// Application installable : on enregistre le service worker (mode hors connexion).
// Seulement sur le site construit (npm run build), pas pendant le développement.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
