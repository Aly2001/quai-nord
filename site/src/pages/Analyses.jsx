// =====================================================================
//  ANALYSES : ce que les données révèlent, sur toutes les journées complètes, recalculé chaque nuit
//  (site/public/donnees/pages.json, écrit par exporter_pages.py). Chaque chiffre vient de retards CONSTATÉS.
// =====================================================================
import { useTitrePage } from "../components/titrePage";
import { BarresH, BarresJours } from "../components/Graphiques";
import { usePages, nombre, pourcent, dateCourte } from "../data/pages";
import "../components/Graphiques.css";
import "./Prediction.css";
import "./Analyses.css";

export default function Analyses() {
  useTitrePage("Analyses des retards", "Ce que des semaines de données révèlent sur les retards des TER des Hauts-de-France : accumulation au fil du trajet, effet domino, tempête, heures de pointe.");
  const p = usePages();
  const pret = p.etat === "pret";
  const pic = pret ? p.par_jour.reduce((m, j) => (!m || j.taux > m.taux ? j : m), null) : null;
  const premiere = pret ? p.par_position[0] : null;
  const derniere = pret ? p.par_position.at(-1) : null;
  return (
    <div className="constats">
      <p className="surtitre">Analyses</p>
      <h1 className="constats__titre">{pret ? `Ce que ${p.journees} jours de données révèlent` : "Ce que les données révèlent"}</h1>
      <p className="constats__chapo">Chaque chiffre vient des retards réellement constatés sur les TER des Hauts-de-France, jamais des prévisions. Mis à jour chaque nuit.</p>
      {p.etat === "chargement" && <p className="modele__note">Chargement des chiffres…</p>}
      {p.etat === "absent" && <p className="modele__note">Les chiffres de la nuit ne sont pas encore disponibles.</p>}

      {pret && (<>
        <div className="constats__chiffres">
          <Chiffre valeur={nombre(p.passages)} texte="passages en gare" />
          <Chiffre valeur={String(p.journees)} texte="journées complètes" />
          <Chiffre valeur={pourcent(p.taux_perturbe)} texte="perturbés (5 min ou plus, ou supprimés)" />
          <Chiffre valeur={pourcent(p.taux_supprime)} texte="supprimés" />
        </div>

        <Constat sombre numero="Constat 1 · le plus solide" titre="Le retard s'accumule au fil du trajet"
                 texte={`À la première gare, ${pourcent(premiere.taux)} des passages sont perturbés ; plus loin dans le trajet (${derniere.tranche} gare), ${pourcent(derniere.taux)}. Le taux monte à chaque étape.`}
                 consequence="la position de la gare dans le trajet est l'une de ses variables.">
          <BarresH sombre lignes={p.par_position.map((x) => ({ nom: x.tranche, valeur: x.taux, texte: pourcent(x.taux) }))} />
        </Constat>

        {pic && (
          <Constat numero="Constat 2" titre={`Un jour hors norme : ${pic.etiquette}`}
                   texte={`${pourcent(pic.taux)} des passages perturbés ce jour-là, contre ${pourcent(p.taux_perturbe)} en moyenne. Un seul jour suffit à tout changer, puis il en faut plusieurs pour revenir à la normale.`}
                   consequence="les jours exceptionnels faussent le niveau moyen ; il faut des semaines de données.">
            <BarresJours jours={p.par_jour} description="La part des passages perturbés, jour par jour" />
          </Constat>
        )}

        {p.domino.calme.taux !== null && p.domino.agite.taux !== null && (
          <Constat numero="Constat 3 · nouveau" titre="L'effet domino"
                   texte="Quand une ligne a déjà eu des problèmes dans la matinée, le train suivant a beaucoup plus de risque d'être perturbé."
                   consequence="c'est l'information qui multiplie son gain (voir la page Prédiction).">
            <div className="constats__duo">
              <p className="constats__calme"><strong>{pourcent(p.domino.calme.taux)}</strong><small>de trains perturbés quand la ligne allait bien (moins de {p.domino.seuils.calme * 100} % de passages perturbés avant)</small></p>
              <p className="constats__agite"><strong>{pourcent(p.domino.agite.taux)}</strong><small>quand elle avait déjà des problèmes ({p.domino.seuils.agite * 100} % ou plus)</small></p>
            </div>
            <p className="modele__note">Ce qu'on savait 30 min avant le départ du train. {nombre(p.domino.calme.passages)} et {nombre(p.domino.agite.passages)} passages.</p>
          </Constat>
        )}

        <Constat numero="Constat 4" titre="L'heure et le jour de la semaine" texte="Les heures de pointe pèsent plus. À confirmer sur la durée, avec la météo et les vacances.">
          <BarresH lignes={p.par_heure.map((x) => ({ nom: x.tranche, valeur: x.taux, texte: pourcent(x.taux) }))} />
          <BarresH lignes={p.par_jour_semaine.map((x) => ({ nom: x.jour, valeur: x.taux, texte: pourcent(x.taux) }))} />
        </Constat>

        <h2 className="constats__sous-titre">Trois leçons de méthode</h2>
        <Lecon titre="Les retards vont par paliers de 5 minutes" texte="La SNCF arrondit ses annonces : on prédit « 5 min ou plus », pas un nombre exact." />
        <Lecon titre="Compter les trains ou les passages ?" texte="Le même jeu de données donne deux taux différents : toujours dire ce que l'on compte." />
        <Lecon titre="Le piège des trains « survivants »" texte="Une journée n'est analysée que si la collecte a tourné sans interruption (sinon, elle est écartée)." />
        <p className="modele__note">Journées complètes du {dateCourte(p.premiere)} au {dateCourte(p.derniere)} · calculé le {p.genere_le}.</p>
      </>)}
    </div>
  );
}

function Chiffre({ valeur, texte }) {
  return <p className="constats__chiffre"><strong>{valeur}</strong><small>{texte}</small></p>;
}

function Constat({ numero, titre, texte, consequence, sombre, children }) {
  return (
    <section className={sombre ? "modele__carte modele__carte--sombre" : "modele__carte"}>
      <p className={sombre ? "surtitre surtitre--clair" : "surtitre"}>{numero}</p>
      <h2>{titre}</h2>
      <p>{texte}</p>
      {children}
      {consequence && <p><strong>Pour le modèle :</strong> {consequence}</p>}
    </section>
  );
}

function Lecon({ titre, texte }) {
  return <p className="constats__lecon"><strong>{titre}</strong><span>{texte}</span></p>;
}
