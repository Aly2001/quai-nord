import { NavLink, useLocation } from "react-router-dom";
import { PRINCIPAUX, menuActif } from "./navigation";
import { AvatarNora } from "./NoraConversation";
import "./BarreOnglets.css";

// La barre du bas, sur téléphone : les quatre choses qu'on fait tous les jours.
// Le reste (carte, analyses, aide…) est dans le menu ☰, en haut à droite.
const ICONES = {
  "/": <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  "/bus": <><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z" /><circle cx="12" cy="11" r="2.2" /><path d="M3 21h18" /></>,
  "/favoris": <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9z" />,
};

export default function BarreOnglets() {
  const { pathname } = useLocation();
  // Sur la page Nora, la zone de saisie occupe le bas de l'écran : pas de barre
  if (pathname.startsWith("/nora")) return null;
  const actif = menuActif(pathname);

  return (
    <nav aria-label="Navigation principale" className="onglets">
      {PRINCIPAUX.map((o) => (
        <NavLink key={o.lien} to={o.lien} end className={o.lien === actif ? "onglet onglet--actif" : "onglet"}
                 aria-current={o.lien === actif ? "page" : undefined}>
          <span className="onglet__icone">
            {o.lien === "/nora" ? <AvatarNora taille={26} /> : (
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none"
                   stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {ICONES[o.lien]}
              </svg>
            )}
          </span>
          {o.label}
        </NavLink>
      ))}
    </nav>
  );
}
