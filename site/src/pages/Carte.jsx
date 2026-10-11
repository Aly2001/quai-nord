import { useState } from "react";
import { gares, contourRegion } from "../data/gares";
import "./Carte.css";

// Classe de couleur selon le taux de retard
function classeTaux(taux) {
  if (taux === null) return "inconnu";
  if (taux > 20) return "fort";
  if (taux >= 15) return "moyen";
  return "faible";
}

// 27.8 → "27,8 %"
function formater(taux) {
  return taux.toFixed(1).replace(".", ",") + " %";
}

export default function Carte() {
  // L'état : le nom de la gare sélectionnée (Creil au départ)
  const [choix, setChoix] = useState("Creil");

  // Données CALCULÉES à partir des données de base (pas besoin d'état pour ça)
  const mesurees = gares
    .filter((g) => g.taux !== null)
    .sort((a, b) => b.taux - a.taux);              // du plus en retard au moins en retard
  const gareChoisie = gares.find((g) => g.nom === choix);
  const rang = mesurees.findIndex((g) => g.nom === choix) + 1;

  return (
    <>
      <div className="carte__entete">
        <p className="surtitre">Carte des gares</p>
        <h1 className="carte__titre">Où les trains sont-ils en retard ?</h1>
        <p className="texte-doux carte__chapo">
          Part des passages avec 5 minutes de retard ou plus, gare par gare.
          Une gare n'est colorée qu'à partir de 30 passages observés.
        </p>
      </div>

      <div className="carte__mise-en-page">
        {/* ---------- La carte ---------- */}
        <section aria-label="Carte des Hauts-de-France" className="carte__cadre">
          <div className="carte__zone">
            <svg viewBox="0 0 520 634" aria-hidden="true" className="carte__fond">
              <path d={contourRegion} />
            </svg>

            {gares.map((g) => (
              <div key={g.nom} className="gare" style={{ left: `${g.x}%`, top: `${g.y}%` }}>
                <button
                  type="button"
                  className={`gare__point gare__point--${classeTaux(g.taux)}${g.nom === choix ? " gare__point--choisi" : ""}`}
                  aria-label={g.taux === null ? `${g.nom} : données insuffisantes` : `${g.nom} : ${formater(g.taux)}`}
                  aria-pressed={g.nom === choix}
                  onClick={() => setChoix(g.nom)}
                />
                <span className="gare__nom" aria-hidden="true">{g.nom}</span>
              </div>
            ))}
          </div>

          <div className="legende">
            <span><i className="pastille gare__point--faible" />moins de 15 %</span>
            <span><i className="pastille gare__point--moyen" />15 à 20 %</span>
            <span><i className="pastille gare__point--fort" />plus de 20 %</span>
            <span><i className="pastille gare__point--inconnu" />moins de 30 passages</span>
          </div>
        </section>

        {/* ---------- Le panneau de droite ---------- */}
        <aside className="carte__panneau">
          <div className="fiche">
            <p className="fiche__surtitre">Gare sélectionnée</p>
            <h2 className="fiche__nom">{gareChoisie.nom}</h2>

            {gareChoisie.taux === null ? (
              <>
                <p className="fiche__taux">–</p>
                <p className="fiche__detail">
                  Moins de 30 passages observés pour l'instant : pas assez de données
                  pour un taux fiable.
                </p>
              </>
            ) : (
              <>
                <p className="fiche__taux">{formater(gareChoisie.taux)}</p>
                <p className="fiche__detail">
                  des {gareChoisie.passages} passages observés avaient 5 min de retard ou plus.
                  Rang {rang} sur {mesurees.length} gares mesurées.
                </p>
              </>
            )}
          </div>

          <div className="classement">
            <h2>Classement (au moins 30 passages)</h2>
            <ol>
              {mesurees.map((g, index) => (
                <li key={g.nom}>
                  <button
                    type="button"
                    className={g.nom === choix ? "classement__ligne classement__ligne--choisie" : "classement__ligne"}
                    onClick={() => setChoix(g.nom)}
                  >
                    <span className="classement__rang">{index + 1}</span>
                    <span className="classement__nom">{g.nom}</span>
                    <span className={`classement__taux classement__taux--${classeTaux(g.taux)}`}>
                      {formater(g.taux)}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>

          <p className="texte-doux">
            Mesures du 9 octobre 2026, retards constatés uniquement. Les échantillons
            restent petits : ce classement évoluera avec les prochains jours de collecte.
          </p>
        </aside>
      </div>
    </>
  );
}
