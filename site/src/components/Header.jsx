import { Link, NavLink } from "react-router-dom";
import { AvatarNora } from "./NoraConversation";

const PAGES = [
  { label: "Accueil", lien: "/" },
  { label: "Carte", lien: "/carte" },
  { label: "Prédiction", lien: "/prediction" },
  { label: "Analyses", lien: "/analyses" },
  { label: "Questions", lien: "/faq" },
  { label: "Nora", lien: "/nora" },
];

export default function Header() {
  return (
    <header className="entete">
      <div className="conteneur entete__barre">
        <Link to="/" className="logo">
          {/* La même pastille QN que l'icône de l'application */}
          <svg viewBox="0 0 100 100" width="34" height="34" aria-hidden="true" className="logo__pastille">
            <rect width="100" height="100" rx="22" fill="#FFFFFF" />
            <text x="50" y="63" textAnchor="middle" fontFamily="'Barlow Condensed', sans-serif"
                  fontWeight="700" fontSize="50" fill="#14213D">QN</text>
            <rect x="22" y="73" width="56" height="6" rx="1" fill="#F2C230" />
          </svg>
          <span className="logo__texte">Quai <span>Nord</span></span>
        </Link>

        <nav aria-label="Navigation principale" className="menu">
          {PAGES.map((page) => (
            // NavLink sait tout seul si sa page est active :
            // plus besoin de la prop pageActive !
            <NavLink
              key={page.lien}
              to={page.lien}
              end
              className={({ isActive }) =>
                isActive ? "menu__lien menu__lien--actif" : "menu__lien"
              }
            >
              {page.label}
            </NavLink>
          ))}
        </nav>

        {/* Sur téléphone, le menu laisse sa place à la barre d'onglets : Nora reste accessible ici */}
        <NavLink to="/nora" className="entete__nora" aria-label="Demander à Nora, l'assistante IA">
          <AvatarNora taille={30} />
          Nora
        </NavLink>
      </div>
    </header>
  );
}
