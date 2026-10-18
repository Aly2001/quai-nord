import { Link } from "react-router-dom";
import { ListeFavoris } from "../components/Favoris";
import "./Plus.css";
import { useTitrePage } from "../components/titrePage";

export default function Plus() {
  useTitrePage("Plus", "Vos trajets favoris, l'installation de l'application et les informations sur Quai Nord.");
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
        <h2 className="plus__rubrique">À propos</h2>
        <div className="plus__apropos">
          <p>
            Quai Nord est né d'une question simple : mon TER sera-t-il à l'heure&nbsp;? Conçu et développé
            par <strong>Aly Keita</strong>, de la collecte des données en temps réel jusqu'à l'assistante IA.
          </p>
          <div className="plus__boutons">
            <a href="https://www.linkedin.com/in/aly-keita-306703340/" target="_blank" rel="noopener noreferrer"
               className="plus__bouton plus__bouton--plein">LinkedIn ↗</a>
            <a href="https://github.com/Aly2001/quai-nord" target="_blank" rel="noopener noreferrer"
               className="plus__bouton">Code sur GitHub ↗</a>
          </div>
        </div>
      </section>

      <section className="plus__bloc">
        <h2 className="plus__rubrique">Aide et informations</h2>
        <nav aria-label="Aide et informations" className="plus__liens">
          <Link to="/faq">Questions fréquentes</Link>
          <Link to="/faq#risque">Comment est calculé le risque ?</Link>
          <Link to="/sources">Sources et licences</Link>
        </nav>
      </section>
    </div>
  );
}
