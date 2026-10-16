import { RESEAUX } from "../data/bus";
import "./Footer.css";

// Les noms courts des réseaux de bus, tram et métro (« ilévia (Lille) » -> « ilévia »), lus dans la liste unique
const NOMS_RESEAUX = RESEAUX.map((r) => r.nom.replace(/ \(.*\)$/, ""));
const LISTE_RESEAUX = `${NOMS_RESEAUX.slice(0, -1).join(", ")} et ${NOMS_RESEAUX[NOMS_RESEAUX.length - 1]}`;

export default function Footer() {
  return (
    <footer className="pied">
      <div className="conteneur pied__contenu">
        <span className="pied__logo">Quai <span>Nord</span></span>
        <p className="pied__texte">
          Projet d'Aly Keita, sans lien avec la SNCF. Données SNCF Voyageurs (GTFS et GTFS-RT, licence ODbL),
          Open-Meteo (CC BY 4.0), réseaux {LISTE_RESEAUX} (Licence Ouverte), © les contributeurs d'OpenStreetMap.
        </p>
      </div>
    </footer>
  );
}
