import { Link } from "react-router-dom";
import { ListeFavoris } from "../components/Favoris";
import "./Plus.css";

export default function Plus() {
  return (
    <div className="plus">
      <h1 className="plus__titre">Plus</h1>

      <section className="plus__bloc">
        <h2 className="plus__rubrique">Mes trajets favoris</h2>
        <p className="plus__aide">Enregistrés uniquement sur cet appareil.</p>
        <ListeFavoris gestion />
      </section>

      <section className="plus__bloc">
        <h2 className="plus__rubrique">Installer l'application</h2>
        <details className="plus__details">
          <summary>Sur iPhone (Safari)</summary>
          <p>Appuyez sur le bouton Partager, en bas de l'écran, puis sur « Sur l'écran d'accueil ».</p>
        </details>
        <details className="plus__details">
          <summary>Sur Android (Chrome)</summary>
          <p>Ouvrez le menu ⋮ en haut à droite, puis « Installer l'application » ou « Ajouter à l'écran d'accueil ».</p>
        </details>
      </section>

      <section className="plus__bloc">
        <h2 className="plus__rubrique">Aide et informations</h2>
        <nav aria-label="Aide et informations" className="plus__liens">
          <Link to="/faq">Questions fréquentes</Link>
          <Link to="/faq#risque">Comment est calculé le risque ?</Link>
          <Link to="/faq#donnees">Données et licences</Link>
          <a href="https://github.com/Aly2001/quai-nord" target="_blank" rel="noopener noreferrer">Code source sur GitHub ↗</a>
        </nav>
      </section>

      <p className="plus__mention">
        Projet personnel, sans lien avec la SNCF. Données SNCF Voyageurs (ODbL) et Open-Meteo (CC BY 4.0).
      </p>
    </div>
  );
}
