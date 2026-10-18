import { useEffect } from "react";

// Le titre et la description de chaque page, pour l'onglet du navigateur et pour Google.
// (index.html n'en a qu'un pour tout le site : on le remplace page par page.)
const SUFFIXE = " · Quai Nord";
const DESCRIPTION_PAR_DEFAUT =
  "Quai Nord : horaires, risque de retard et ponctualité des TER des Hauts-de-France, à partir des données ouvertes de la SNCF.";

export function useTitrePage(titre, description = DESCRIPTION_PAR_DEFAUT) {
  useEffect(() => {
    document.title = titre ? `${titre}${SUFFIXE}` : "Quai Nord · Votre TER sera-t-il à l'heure ?";
    let balise = document.querySelector('meta[name="description"]');
    if (!balise) {
      balise = document.createElement("meta");
      balise.setAttribute("name", "description");
      document.head.appendChild(balise);
    }
    balise.setAttribute("content", description);
  }, [titre, description]);
}
