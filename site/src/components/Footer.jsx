import "./Footer.css";

export default function Footer() {
  return (
    <footer className="pied">
      <div className="conteneur pied__contenu">
        <span className="pied__logo">Quai <span>Nord</span></span>
        <p className="pied__texte">
          Projet personnel, sans lien avec la SNCF. Données SNCF Voyageurs (GTFS et GTFS-RT, licence ODbL),
          Open-Meteo (CC BY 4.0), réseaux Imag'in et Marinéo (Licence Ouverte), © les contributeurs d'OpenStreetMap.
        </p>
      </div>
    </footer>
  );
}
