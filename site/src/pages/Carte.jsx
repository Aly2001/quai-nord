import { useEffect, useState } from "react";
import { gares, contourRegion } from "../data/gares";
import { DOSSIER, useRisques, normaliser } from "../data/horaires";
import "./Carte.css";
import { useTitrePage } from "../components/titrePage";

// ---------- Réglages ----------
const HAUTEUR = 770;                  // la carte est un peu plus haute que la région, pour Paris
const ECHELLE_Y = 634 / HAUTEUR;      // les positions des gares sont données pour une hauteur de 634
const PARIS = { x: 39.0, y: 89.5 };   // sous Creil, hors de la région
const MIN_LIGNE = 100;                // passages minimum pour colorer une ligne
const MIN_GARE = 30;                  // passages minimum pour colorer une gare
const EST_PARIS = (nom) => /^paris.*nord$/.test(normaliser(nom));

// Niveau selon la part de passages à l'heure
function niveau(mesure, minimum) {
  if (!mesure || mesure.n < minimum) return "inconnu";
  const alheure = 1 - mesure.taux;
  if (alheure >= 0.85) return "bon";
  if (alheure >= 0.7) return "moyen";
  return "mauvais";
}

const pourcent = (mesure) => `${Math.round((1 - mesure.taux) * 100)}\u00a0%`;

// Retrouver une gare de la carte à partir de son nom SNCF
function gareDeLaCarte(nomSncf) {
  const n = normaliser(nomSncf);
  return gares.find((g) => g.sncf.some((c) => normaliser(c) === n)) || null;
}

// Les chiffres d'une gare de la carte, à partir de ses noms SNCF
function mesureGare(risques, gare) {
  if (!risques?.par_gare) return null;
  for (const nom of gare.sncf) {
    if (risques.par_gare[nom]) return risques.par_gare[nom];
  }
  return null;
}

export default function Carte() {
  useTitrePage("Carte des gares", "La carte des gares TER des Hauts-de-France et de leur ponctualité mesurée, mise à jour chaque jour.");
  const risques = useRisques();
  const [lignes, setLignes] = useState({});
  const [choix, setChoix] = useState("Lille Flandres");
  const [recherche, setRecherche] = useState("");

  useEffect(() => {
    fetch(`${DOSSIER}/lignes.json`)
      .then((reponse) => reponse.json())
      .then(setLignes)
      .catch(() => setLignes({}));
  }, []);

  // ---------- Les tracés : chaque ligne relie les gares de la carte qu'elle dessert ----------
  const traces = Object.entries(lignes).map(([ligne, noms]) => {
    const points = [];
    for (const nom of noms) {
      const p = EST_PARIS(nom) ? PARIS : gareDeLaCarte(nom);
      if (p && points[points.length - 1] !== p) points.push(p);
    }
    const mesure = risques?.par_ligne?.[ligne];
    return { ligne, points, noms, mesure, niveau: niveau(mesure, MIN_LIGNE) };
  }).filter((t) => t.points.length >= 2);

  // Ordre de dessin : les lignes en difficulté par-dessus, pour qu'on les voie
  const ORDRE = { inconnu: 0, bon: 1, moyen: 2, mauvais: 3 };
  const dessin = [...traces].sort((a, b) => ORDRE[a.niveau] - ORDRE[b.niveau]);
  const versParis = traces.some((t) => t.points.includes(PARIS));

  // ---------- Les lignes les moins ponctuelles ----------
  const classement = traces
    .filter((t) => t.mesure && t.mesure.n >= MIN_LIGNE)
    .sort((a, b) => b.mesure.taux - a.mesure.taux)
    .slice(0, 5);

  const gareChoisie = gares.find((g) => g.nom === choix);
  const mesureChoisie = gareChoisie ? mesureGare(risques, gareChoisie) : null;

  function chercher(texte) {
    setRecherche(texte);
    const trouvee = gares.find((g) => normaliser(g.nom) === normaliser(texte));
    if (trouvee) setChoix(trouvee.nom);
  }

  return (
    <div className="carte">
      {/* ---------- Le panneau de gauche ---------- */}
      <aside className="carte__panneau">
        <div>
          <h1 className="carte__titre">Carte de la ponctualité</h1>
          <p className="carte__chapo">
            Les lignes de la région, colorées selon la part de passages arrivés à l'heure
            (moins de 5 minutes de retard).
          </p>
        </div>

        <div className="carte__recherche">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none"
               stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" />
          </svg>
          <label htmlFor="carte-recherche" className="visuellement-cache">Rechercher une gare</label>
          <input id="carte-recherche" type="text" list="carte-gares" placeholder="Rechercher une gare"
                 value={recherche} onChange={(e) => chercher(e.target.value)} />
          <datalist id="carte-gares">
            {gares.map((g) => <option key={g.nom} value={g.nom} />)}
          </datalist>
        </div>

        {gareChoisie && (
          <div className="fiche" aria-live="polite">
            <p className="fiche__surtitre">Gare sélectionnée</p>
            <h2 className="fiche__nom">{gareChoisie.nom}</h2>
            {mesureChoisie && mesureChoisie.n >= MIN_GARE ? (
              <>
                <p className={`fiche__taux fiche__taux--${niveau(mesureChoisie, MIN_GARE)}`}>
                  {pourcent(mesureChoisie)} à l'heure
                </p>
                <p className="fiche__detail">sur {mesureChoisie.n.toLocaleString("fr-FR")} passages observés</p>
              </>
            ) : (
              <p className="fiche__detail">Pas encore assez de passages observés pour un chiffre fiable.</p>
            )}
          </div>
        )}

        <section className="carte__bloc" aria-labelledby="titre-legende">
          <h2 id="titre-legende">Légende</h2>
          <p className="legende__ligne"><span className="trait trait--bon" />85 % à l'heure ou plus</p>
          <p className="legende__ligne"><span className="trait trait--moyen" />De 70 à 85 % à l'heure</p>
          <p className="legende__ligne"><span className="trait trait--mauvais" />Moins de 70 % à l'heure</p>
          <p className="legende__ligne"><span className="trait trait--inconnu" />Pas assez de données</p>
          {versParis && (
            <p className="legende__ligne">
              <span className="legende__fleche" aria-hidden="true">▼</span>Vers Paris Gare du Nord (hors région)
            </p>
          )}
        </section>

        {classement.length > 0 && (
          <section className="carte__bloc" aria-labelledby="titre-classement">
            <h2 id="titre-classement">Lignes les moins ponctuelles</h2>
            <ol className="carte__classement">
              {classement.map((t) => (
                <li key={t.ligne}>
                  <span><strong>{t.ligne}</strong> · {t.noms[0]} → {t.noms[t.noms.length - 1]}</span>
                  <strong className={`classement__valeur classement__valeur--${t.niveau}`}>{pourcent(t.mesure)}</strong>
                </li>
              ))}
            </ol>
          </section>
        )}

        <p className="carte__note">
          Retards constatés depuis le début de la collecte, mis à jour chaque nuit.
          {risques ? ` ${risques.passages.toLocaleString("fr-FR")} passages analysés.` : ""}
        </p>
      </aside>

      {/* ---------- La carte ---------- */}
      <section aria-label="Carte des Hauts-de-France" className="carte__cadre">
        <div className="carte__zone">
          <svg viewBox={`0 0 520 ${HAUTEUR}`} className="carte__dessin" aria-hidden="true">
            <path d={contourRegion} className="carte__region" />
            {dessin.map((t) => (
              <polyline key={t.ligne} className={`trace trace--${t.niveau}`}
                        points={t.points.map((p) => `${p.x * 5.2},${(p === PARIS ? p.y : p.y * ECHELLE_Y) * HAUTEUR / 100}`).join(" ")} />
            ))}
            {versParis && (
              <path className="carte__fleche"
                    d={`M${PARIS.x * 5.2 - 9} ${PARIS.y * HAUTEUR / 100 - 18} L${PARIS.x * 5.2} ${PARIS.y * HAUTEUR / 100 - 2} L${PARIS.x * 5.2 + 9} ${PARIS.y * HAUTEUR / 100 - 18} Z`} />
            )}
          </svg>

          {gares.map((g) => (
            <div key={g.nom} className="gare" style={{ left: `${g.x}%`, top: `${g.y * ECHELLE_Y}%` }}>
              <button type="button"
                      className={`gare__point gare__point--${niveau(mesureGare(risques, g), MIN_GARE)}${g.nom === choix ? " gare__point--choisi" : ""}`}
                      aria-pressed={g.nom === choix}
                      aria-label={g.nom}
                      onClick={() => { setChoix(g.nom); setRecherche(""); }} />
              <span className="gare__nom" aria-hidden="true">{g.nom}</span>
            </div>
          ))}

          {versParis && (
            <div className="carte__paris" style={{ left: `${PARIS.x}%`, top: `${PARIS.y}%` }}>
              <strong>Paris Gare du Nord</strong>
              <span>hors région · terminus</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
