import { Link } from "react-router-dom";
import { RESEAUX } from "../data/bus";
import "./Plus.css";
import "./Sources.css";

// Toutes les sources de données de Quai Nord, avec leur licence (citer la source est une obligation de ces licences).
// Les réseaux de bus, tram et métro viennent de la liste unique reseaux.json : un nouveau réseau y apparaît tout seul.
const TRANSPORTS = { metro: "métro", tram: "tram", bus: "bus" };

export default function Sources() {
  const reseaux = RESEAUX.map((r) => `${r.nom.replace(/ \(.*\)$/, "")} (${r.ville}${r.modes.length > 1
    ? ` : ${r.modes.map((m) => TRANSPORTS[m]).join(", ")}` : ""})`).join(" · ");
  const sources = [
    { nom: "SNCF Voyageurs", detail: "Horaires (GTFS) et temps réel (GTFS-RT)", licence: "Licence ODbL" },
    { nom: "Open-Meteo", detail: "Météo prévue au départ des trains", licence: "Licence CC BY 4.0" },
    { nom: "Bus, trams et métros", detail: reseaux, licence: "Licence Ouverte, via transport.data.gouv.fr" },
    { nom: "OpenStreetMap", detail: "Lieux autour des gares (universités, hôpitaux…)", licence: "© les contributeurs d'OpenStreetMap, licence ODbL" },
  ];
  return (
    <div className="plus sources">
      <Link to="/plus" className="sources__retour">‹ Plus</Link>
      <h1 className="plus__titre">Sources et licences</h1>
      <p className="sources__intro">
        Quai Nord est un projet personnel, <strong>sans lien avec la SNCF</strong>. Il réutilise des données ouvertes :
      </p>
      <ul className="sources__liste">
        {sources.map((s) => (
          <li key={s.nom}>
            <strong>{s.nom}</strong>
            <span>{s.detail}</span>
            <span className="sources__licence">{s.licence}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
