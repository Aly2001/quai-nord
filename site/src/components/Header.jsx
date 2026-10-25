import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { AvatarNora } from "./NoraConversation";
import { GROUPES } from "./navigation";

// Ordinateur : les pages d'avant, plus « En ville », sans icônes, rangées à droite
const PAGES_ORDINATEUR = [
  { label: "Accueil", lien: "/" },
  { label: "En ville", lien: "/bus" },          // le bus, le tram, le métro : on peut aussi les chercher sur ordinateur
  { label: "Carte", lien: "/carte" },
  { label: "Prédiction", lien: "/prediction" },
  { label: "Analyses", lien: "/analyses" },
  { label: "Questions", lien: "/faq" },
  { label: "Nora", lien: "/nora" },
];
import "./Header.css";

export default function Header() {
  const { pathname } = useLocation();
  const [ouvert, setOuvert] = useState(false);          // le menu ☰ (téléphone) ou « Plus » (ordinateur)
  const zone = useRef(null);
  const entete = useRef(null);
  const [hauteur, setHauteur] = useState(80);

  // Le menu se ferme quand on change de page, avec Échap, ou en touchant à côté
  useEffect(() => { setOuvert(false); }, [pathname]);
  useEffect(() => {
    if (!ouvert) return undefined;
    if (entete.current) setHauteur(entete.current.getBoundingClientRect().bottom);   // le menu s'ouvre juste dessous
    const echap = (e) => { if (e.key === "Escape") setOuvert(false); };
    const dehors = (e) => { if (zone.current && !zone.current.contains(e.target)) setOuvert(false); };
    document.addEventListener("keydown", echap);
    document.addEventListener("mousedown", dehors);
    return () => { document.removeEventListener("keydown", echap); document.removeEventListener("mousedown", dehors); };
  }, [ouvert]);

  return (
    <header className="entete" ref={entete}>
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

        {/* Ordinateur : le menu d'avant, inchangé */}
        <nav aria-label="Navigation principale" className="menu">
          {PAGES_ORDINATEUR.map((page) => (
            <NavLink key={page.lien} to={page.lien} end
                     className={({ isActive }) => (isActive ? "menu__lien menu__lien--actif" : "menu__lien")}>
              {page.label}
            </NavLink>
          ))}
        </nav>

        <div className="entete__droite" ref={zone}>
          <button type="button" className="entete__plus" aria-expanded={ouvert} aria-controls="menu-plus"
                  onClick={() => setOuvert((o) => !o)}>
            <svg className="entete__burger" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none"
                 stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {ouvert ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
            <span className="visuellement-cache">{ouvert ? "Fermer le menu" : "Ouvrir le menu"}</span>
          </button>

          {ouvert && (
            <div id="menu-plus" className="menu-plus" role="dialog" aria-label="Plus de pages"
                 style={{ "--hauteur-entete": `${hauteur}px` }}>
              {GROUPES.map((g) => (
                <section key={g.titre}>
                  <p className="menu-plus__groupe">{g.titre}</p>
                  {g.pages.map((p) => (
                    <Link key={p.lien} to={p.lien} className="menu-plus__lien">
                      <span className="menu-plus__emoji" aria-hidden="true">{p.emoji}</span>
                      <span><strong>{p.label}</strong><small>{p.detail}</small></span>
                    </Link>
                  ))}
                </section>
              ))}
            </div>
          )}

          {/* Ordinateur : Nora reste à droite, comme avant. Téléphone : elle est dans la barre du bas */}
          <NavLink to="/nora" className="entete__nora" aria-label="Demander à Nora, l'assistante IA">
            <AvatarNora taille={30} />
            Nora
          </NavLink>
        </div>
      </div>
    </header>
  );
}
