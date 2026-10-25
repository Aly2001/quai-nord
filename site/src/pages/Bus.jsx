import { Link } from "react-router-dom";
import { useTitrePage } from "../components/titrePage";
import "./Plus.css";

// En attendant le formulaire « D'où partez-vous ? Où allez-vous ? » (la prochaine étape),
// Nora sait déjà trouver le bus, le tram ou le métro dans les six villes.
export default function Bus() {
  useTitrePage("Bus, tram et métro", "Le bus, le tram ou le métro dans six villes des Hauts-de-France.");
  return (
    <div className="plus">
      <h1 className="plus__titre">Bus, tram et métro</h1>
      <section className="plus__bloc">
        <p>Le formulaire arrive très bientôt. En attendant, Nora trouve votre bus, votre tram ou votre métro
          à Lille, Calais, Boulogne-sur-Mer, Dunkerque, Amiens et Arras.</p>
        <div className="plus__boutons">
          <Link to="/nora" className="plus__bouton plus__bouton--plein">Demander à Nora</Link>
        </div>
      </section>
    </div>
  );
}
