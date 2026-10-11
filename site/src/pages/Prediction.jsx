import { useState } from "react";
import { trajet, trains } from "../data/prediction";
import "./Prediction.css";

// Niveau de risque en mots, selon le pourcentage
function niveau(risque) {
  if (risque >= 50) return { mot: "Risque élevé", classe: "eleve" };
  if (risque >= 25) return { mot: "Risque modéré", classe: "modere" };
  return { mot: "Risque faible", classe: "faible" };
}

export default function Prediction() {
  // L'état : le numéro du train étudié (le 07:24 au départ)
  const [numeroChoisi, setNumeroChoisi] = useState("847103");
  const train = trains.find((t) => t.numero === numeroChoisi);
  const n = niveau(train.risque);

  return (
    <>
      <div className="prediction__entete">
        <p className="surtitre">Prédiction</p>
        <h1 className="prediction__titre">Quel risque pour votre train ?</h1>
        <p className="texte-doux">
          {trajet.depart} → {trajet.arrivee} · {trajet.jour} · résultats d'exemple
        </p>
      </div>

      <div className="prediction__mise-en-page">
        {/* ---------- Le résultat principal ---------- */}
        <section aria-label="Résultat" className={`resultat resultat--${n.classe}`}>
          <p className="resultat__train">
            <strong>TER {train.numero}</strong> · départ {train.depart} · arrivée prévue {train.arrivee}
          </p>

          <div className="resultat__chiffre">
            <p className="resultat__risque">{train.risque} %</p>
            <div>
              <p className="resultat__niveau">{n.mot}</p>
              <p className="resultat__legende">d'arriver avec 5 min de retard ou plus</p>
            </div>
          </div>

          <div
            className="echelle"
            role="img"
            aria-label={`Échelle de risque de 0 à 100 %, curseur à ${train.risque} %`}
          >
            <div className="echelle__rempli" style={{ width: `${train.risque}%` }} />
            <div className="echelle__curseur" style={{ left: `${train.risque}%` }} />
          </div>
          <div className="echelle__graduations">
            <span>0 %</span><span>faible</span><span>modéré</span><span>élevé</span><span>100 %</span>
          </div>

          <p className="resultat__explication">
            Comment le lire : sur 100 trains circulant dans des conditions semblables, environ{" "}
            {train.risque} sont arrivés avec au moins 5 minutes de retard. Les incidents
            imprévisibles (panne, obstacle sur la voie) ne peuvent pas être prédits.
          </p>
        </section>

        <div className="prediction__colonnes">
          {/* ---------- Les facteurs ---------- */}
          <section className="bloc-blanc">
            <h2>Ce qui pèse sur ce trajet</h2>
            {train.facteurs.map((f) => (
              <div key={f.nom} className="facteur">
                <div className="facteur__ligne">
                  <span className="facteur__nom">{f.nom}</span>
                  <span className={`facteur__effet facteur__effet--${f.effet === "réduit" ? "reduit" : "augmente"}`}>
                    {f.effet}
                  </span>
                </div>
                <div className="facteur__piste">
                  <div
                    className={`facteur__jauge facteur__jauge--${f.effet === "réduit" ? "reduit" : "augmente"}`}
                    style={{ width: `${f.force}%` }}
                  />
                </div>
                <p className="facteur__detail">{f.detail}</p>
              </div>
            ))}
          </section>

          {/* ---------- Les autres trains (cliquables) ---------- */}
          <section className="bloc-blanc">
            <h2>Comparer les trains du jour</h2>
            <ul className="autres">
              {trains.map((t) => (
                <li key={t.numero}>
                  <button
                    type="button"
                    className={t.numero === numeroChoisi ? "autre autre--choisi" : "autre"}
                    aria-pressed={t.numero === numeroChoisi}
                    onClick={() => setNumeroChoisi(t.numero)}
                  >
                    <span className="autre__heure">{t.depart}</span>
                    <span className="autre__info">arrivée {t.arrivee}, {t.info}</span>
                    <span className={`autre__risque autre__risque--${niveau(t.risque).classe}`}>
                      {t.risque} %
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
