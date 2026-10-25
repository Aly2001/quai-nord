import { ListeFavoris } from "../components/Favoris";
import { useTitrePage } from "../components/titrePage";
import "./Plus.css";

export default function Favoris() {
  useTitrePage("Mes favoris", "Vos trajets favoris, gardés sur cet appareil, sans compte.");
  return (
    <div className="plus">
      <h1 className="plus__titre">Mes favoris</h1>
      <section className="plus__bloc">
        <p className="plus__aide">Gardés uniquement sur cet appareil, sans compte. Rien n'est envoyé.</p>
        <ListeFavoris gestion />
        <p className="plus__aide">Après une recherche de train, touchez ☆ « Ajouter aux favoris » pour la retrouver ici.</p>
      </section>
    </div>
  );
}
