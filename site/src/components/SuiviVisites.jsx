import { useEffect } from "react";
import { useLocation } from "react-router-dom";

// Compte une visite à chaque changement de page.
// Avec React Router, on change de page SANS recharger le site :
// l'outil de statistiques ne le verrait pas tout seul, alors on le prévient.
// Le compte est anonyme (aucun cookie, aucune donnée personnelle).
export default function SuiviVisites() {
  const location = useLocation();

  useEffect(() => {
    // L'adresse (/trajet, /carte...) sans la recherche du voyageur (?de=...&a=...)
    const page = location.pathname;
    // La provenance, si le lien était étiqueté : ?utm_source=linkedin
    const source = new URLSearchParams(location.search).get("utm_source");

    function compter() {
      window.goatcounter.count({
        path: page,
        referrer: source || document.referrer || undefined,
      });
    }

    // Le script GoatCounter se charge en parallèle du site : on attend qu'il soit prêt
    if (window.goatcounter?.count) {
      compter();
    } else {
      const minuteur = setInterval(() => {
        if (window.goatcounter?.count) { clearInterval(minuteur); compter(); }
      }, 300);
      setTimeout(() => clearInterval(minuteur), 10_000);   // on abandonne après 10 s
      return () => clearInterval(minuteur);
    }
  }, [location.pathname]);   // eslint-disable-line react-hooks/exhaustive-deps

  return null;   // ce composant n'affiche rien
}
