import { Link, NavLink } from "react-router-dom";

const PAGES = [
  { label: "Accueil", lien: "/" },
  { label: "Carte", lien: "/carte" },
  { label: "Prédiction", lien: "/prediction" },
  { label: "Analyses", lien: "/analyses" },
  { label: "Questions", lien: "/faq" },
];

export default function Header() {
  return (
    <header className="entete">
      <div className="conteneur entete__barre">
        <Link to="/" className="logo">
          Quai <span>Nord</span>
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
      </div>
    </header>
  );
}
