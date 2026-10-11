import "./GraphiqueBarres.css";

// Un graphique en barres réutilisable.
// donnees   : une liste de { etiquette, taux } (une barre peut aussi avoir sa "couleur")
// seuil     : au-dessus de cette valeur, la barre devient orange
// formater  : comment écrire la valeur au-dessus de la barre (par défaut "15,4 %")
// hauteurMax: hauteur en pixels de la plus haute barre
export default function GraphiqueBarres({
  donnees,
  seuil = 15,
  formater = formaterTaux,
  hauteurMax = 210,
}) {
  const max = Math.max(...donnees.map((d) => d.taux));
  const description = donnees.map((d) => `${d.etiquette} : ${formater(d.taux)}`).join(", ");

  return (
    <div className="graphique">
      <div className="graphique__zone" role="img" aria-label={description}>
        {donnees.map((d) => (
          <div key={d.etiquette} className="graphique__colonne">
            <span className="graphique__valeur">{formater(d.taux)}</span>
            <div
              className={d.taux >= seuil ? "graphique__barre graphique__barre--haute" : "graphique__barre"}
              style={{
                height: `${Math.max(3, (d.taux / max) * hauteurMax)}px`,
                ...(d.couleur && { background: d.couleur }),
              }}
            />
          </div>
        ))}
      </div>
      <div className="graphique__axe">
        {donnees.map((d) => (
          <span key={d.etiquette}>{d.etiquette}</span>
        ))}
      </div>
    </div>
  );
}

// 15.4 → "15,4 %" (virgule à la française)
export function formaterTaux(taux) {
  return taux.toFixed(1).replace(".", ",") + " %";
}
