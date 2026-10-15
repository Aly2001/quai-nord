import { Link } from "react-router-dom";
import { useBus, libelleGare } from "../data/bus";
import { AvatarNora } from "./NoraConversation";
import "./BusDepuisGare.css";

// La carte d'accueil qui fait découvrir l'aide de Nora pour les bus, gare par gare
const VILLES = { calais: "Calais", boulogne: "Boulogne-sur-Mer" };

export default function BusDepuisGare() {
  const reseaux = useBus();
  if (!reseaux) return null;
  const gares = Object.entries(reseaux).flatMap(([code, reseau]) =>
    Object.keys(reseau.gares).map((nom) => ({ nom, ville: VILLES[code] })));
  if (gares.length === 0) return null;

  return (
    <section className="bus-gare" aria-labelledby="titre-bus-gare">
      <div className="bus-gare__entete">
        <AvatarNora taille={44} />
        <div>
          <p className="bus-gare__nouveau">Nouveau</p>
          <h2 id="titre-bus-gare" className="bus-gare__titre">Votre bus depuis la gare</h2>
          <p className="bus-gare__texte">Nora vous indique la ligne, l'arrêt et la direction, dans les deux sens.</p>
        </div>
      </div>
      <div className="bus-gare__gares">
        {gares.map((g) => (
          <Link key={g.nom} to={`/nora?${new URLSearchParams({ gare: g.nom })}`} className="bus-gare__gare">
            <strong>{libelleGare(g.nom).replace(/ \(.*\)$/, "")}</strong>
            <span>{g.ville}</span>
          </Link>
        ))}
      </div>
      <p className="bus-gare__exemple">Par exemple : « Je suis à la gare de Calais Ville, je vais à l'université. »</p>
    </section>
  );
}
