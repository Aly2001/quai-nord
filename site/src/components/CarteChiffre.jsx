import "./CarteChiffre.css";

// Une petite carte qui affiche un grand chiffre et sa légende.
// Elle reçoit DEUX props : valeur et texte.
export default function CarteChiffre({ valeur, texte }) {
  return (
    <div className="carte-chiffre">
      <span className="carte-chiffre__valeur">{valeur}</span>
      <span className="carte-chiffre__texte">{texte}</span>
    </div>
  );
}
