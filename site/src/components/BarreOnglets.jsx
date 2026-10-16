import { NavLink, useLocation } from "react-router-dom";
import "./BarreOnglets.css";

// Barre d'onglets en bas de l'écran, comme dans une vraie application.
// Visible seulement sur téléphone (voir BarreOnglets.css) ; sur ordinateur, le menu du haut reste.
const ONGLETS = [
  { label: "Accueil", lien: "/", icone: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" /> },
  { label: "Carte", lien: "/carte", icone: <><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z" /><path d="M9 4v14M15 6v14" /></> },
  { label: "Prédiction", lien: "/prediction", icone: <><path d="M4 16a8 8 0 0 1 16 0" /><path d="M12 16l-4-5" /></> },
  { label: "Analyses", lien: "/analyses", icone: <path d="M5 20V11M12 20V5M19 20v-6" /> },
  { label: "Plus", lien: "/plus", icone: <><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></> },
];

export default function BarreOnglets() {
  // Les résultats (/trajet) sont la suite d'une recherche lancée depuis l'accueil :
  // l'onglet Accueil reste allumé. Idem pour la FAQ et les sources, rangées dans « Plus ».
  const { pathname } = useLocation();
  const parent = pathname.startsWith("/trajet") ? "/"
    : pathname.startsWith("/faq") || pathname.startsWith("/sources") ? "/plus" : null;
  // Sur la page Nora, la zone de saisie occupe le bas de l'écran : pas de barre d'onglets
  if (pathname.startsWith("/nora")) return null;

  return (
    <nav aria-label="Navigation principale" className="onglets">
      {ONGLETS.map((o) => (
        <NavLink key={o.lien} to={o.lien} end
                 className={({ isActive }) => (isActive || parent === o.lien ? "onglet onglet--actif" : "onglet")}>
          <span className="onglet__icone">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none"
                 stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {o.icone}
            </svg>
          </span>
          {o.label}
        </NavLink>
      ))}
    </nav>
  );
}
