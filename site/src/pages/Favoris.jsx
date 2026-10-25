import { ListeFavoris, ListeTrainsFavoris, ListeVilleFavoris } from "../components/Favoris";
import { useTitrePage } from "../components/titrePage";
import "./Plus.css";

export default function Favoris() {
  useTitrePage("Mes favoris", "Vos trains, vos trajets et vos déplacements en ville, gardés sur cet appareil, sans compte.");
  return (
    <div className="plus">
      <h1 className="plus__titre">Mes favoris</h1>
      <p className="plus__aide">Gardés uniquement sur cet appareil, sans compte. Rien n'est envoyé.</p>

      <section className="plus__bloc">
        <h2 className="plus__rubrique">Mes trains</h2>
        <p className="plus__aide">Leur état du jour, en direct. « Surveiller » en affiche un en tête de l'accueil.</p>
        <ListeTrainsFavoris />
      </section>

      <section className="plus__bloc">
        <h2 className="plus__rubrique">Mes trajets en train</h2>
        <ListeFavoris gestion />
      </section>

      <section className="plus__bloc">
        <h2 className="plus__rubrique">En ville</h2>
        <ListeVilleFavoris />
      </section>
    </div>
  );
}
