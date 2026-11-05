// =====================================================================
//  PRÉDICTION : « Le modèle en test ». En toute transparence : ce qu'il prédit, où il en est (il n'est pas
//  encore branché), son historique RÉEL nuit par nuit, et ce que l'essai à blanc a montré.
//  Les chiffres viennent de site/public/donnees/pages.json, recalculé chaque nuit (exporter_pages.py).
// =====================================================================
import { useTitrePage } from "../components/titrePage";
import { Courbes, BarresDoubles } from "../components/Graphiques";
import { usePages, nombre, pourcent, dateCourte, etatDuModele } from "../data/pages";
import "../components/Graphiques.css";
import "./Prediction.css";

const GITHUB = "https://github.com/Aly2001/quai-nord";

export default function Prediction() {
  useTitrePage("Le modèle en test", "Le modèle de prédiction des retards de Quai Nord : ce qu'il prédit, son historique réel, et pourquoi il n'est pas encore branché.");
  const pages = usePages();
  const modele = pages.modele;
  const etat = etatDuModele(modele);
  const historique = modele?.historique || [];
  const essai = modele?.essai?.nuits || [];
  const tempete = essai.reduce((m, n) => (!m || n.etat_ligne > m.etat_ligne ? n : m), null);
  const derniere = essai.at(-1);
  const parDate = Object.fromEntries(essai.map((n) => [n.date, n.etat_ligne]));
  return (
    <div className="modele">
      <p className="surtitre">Prédiction</p>
      <h1 className="modele__titre">Le modèle en test</h1>
      <p className="modele__chapo">Quai Nord apprend à prédire si un TER sera <strong>perturbé</strong> : 5 min de retard ou plus, ou supprimé.
        Il n'est <strong>pas encore branché</strong> : en attendant, le site affiche le taux de chaque ligne.</p>

      {pages.etat === "chargement" && <p className="modele__note">Chargement des chiffres…</p>}
      {pages.etat === "absent" && <p className="modele__note">Les chiffres de la nuit ne sont pas encore disponibles.</p>}

      {pages.etat === "pret" && (<>
        <p className="modele__bandeau"><span aria-hidden="true">🧪</span>
          <span><strong>En apprentissage chaque nuit</strong>
            <small>{pages.journees} journées · {nombre(pages.passages)} passages · mis à jour le {dateCourte(pages.genere_le)}</small></span></p>

        {etat && (
          <section className="modele__carte">
            <h2>Deux conditions pour le brancher</h2>
            <p>Les deux, {modele.conditions.jours / 7} semaines d'affilée, sur des jours que le modèle n'a jamais vus.</p>
            <Jauge nom="Faire mieux que le taux de la ligne" valeur={pourcent(etat.gain, 2)} cible={`${modele.conditions.gain_min} % ou plus`} ok={etat.gainOk}
                   detail="Le gain : de combien il se trompe moins que la réponse simple." />
            <Jauge nom="Annoncer le bon niveau" valeur={`${etat.ecart > 0 ? "+" : ""}${String(etat.ecart).replace(".", ",")} pts`} cible={`moins de ${modele.conditions.ecart_max} points`} ok={etat.ecartOk}
                   detail={`La dernière nuit : ${pourcent(etat.annonce)} annoncé, ${pourcent(etat.reel)} réellement perturbés.`} />
          </section>
        )}

        {historique.length > 1 && (
          <section className="modele__carte">
            <h2>Nuit après nuit</h2>
            <p>Chaque nuit, le modèle apprend sur les jours anciens et il est examiné sur les 4 derniers.</p>
            <Courbes etiquettes={historique.map((n) => dateCourte(n.date))} min={-8} max={24} seuil={modele.conditions.gain_min} legendeSeuil={`objectif ${modele.conditions.gain_min} %`}
                     series={[{ nom: "actuel", couleur: "#14213D", valeurs: historique.map((n) => n.gain) },
                       { nom: "etat", couleur: "#C98A00", valeurs: historique.map((n) => parDate[n.date] ?? null) }]}
                     description="Le gain du modèle sur le taux de la ligne, nuit par nuit" />
            <Legende items={[["#14213D", "Le modèle actuel"], ...(essai.length ? [["#C98A00", "Avec l'état de la ligne (essai)"]] : [])]} />
            <p className="modele__note">Gain sur le taux de la ligne, en %. Lu dans modele/historique.csv.</p>
          </section>
        )}

        {tempete && derniere && (
          <section className="modele__carte modele__carte--sombre">
            <p className="surtitre surtitre--clair">La découverte de l'essai</p>
            <h2>L'effet domino</h2>
            <p>Quand une ligne a déjà eu des problèmes le matin, les trains suivants en ont souvent aussi. En donnant au modèle cette seule
              information, connue 30 min avant le départ, son gain change d'échelle :</p>
            <div className="modele__duo">
              <p><small>Les jours de la tempête (nuit du {dateCourte(tempete.date)})</small><strong>{pourcent(tempete.actuel)} → {pourcent(tempete.etat_ligne)}</strong></p>
              <p><small>Nuit du {dateCourte(derniere.date)}</small><strong>{pourcent(derniere.actuel)} → {pourcent(derniere.etat_ligne)}</strong></p>
            </div>
            <p className="modele__note modele__note--clair">Il ne voit jamais le retard du train qu'il prédit : un contrôle le vérifie. Essai à blanc du {dateCourte(modele.essai.date)}.</p>
          </section>
        )}

        {historique.length > 1 && (
          <section className="modele__carte">
            <h2>Le niveau annoncé suit le passé</h2>
            <BarresDoubles etiquettes={historique.map((n) => dateCourte(n.date))} a={historique.map((n) => n.annonce)} b={historique.map((n) => n.reel)}
                           max={Math.max(40, ...historique.map((n) => Math.max(n.annonce, n.reel)))} couleurs={["#F2C230", "#14213D"]}
                           description="Le risque annoncé et la part réellement perturbée, nuit par nuit" />
            <Legende items={[["#F2C230", "Risque annoncé"], ["#14213D", "Réellement perturbés"]]} />
            <p>Trop bas pendant la tempête, un peu trop haut quand le calme revient. La version avec l'état de la ligne réduit cet écart : il doit passer sous 2 points.</p>
          </section>
        )}
      </>)}

      <section className="modele__carte">
        <h2>Ce qu'il ne pourra jamais prédire</h2>
        <p>Une panne, un obstacle sur la voie, un malaise à bord. Le modèle estime un risque : jamais une certitude.</p>
        <a href={GITHUB} target="_blank" rel="noopener noreferrer">Le code et la méthode sur GitHub →</a>
      </section>
    </div>
  );
}

function Jauge({ nom, valeur, cible, ok, detail }) {
  return (
    <div className="jauge">
      <span className="jauge__nom">{nom}</span>
      <span className="jauge__ligne"><strong className={ok ? "jauge__valeur jauge__valeur--ok" : "jauge__valeur"}>{valeur}</strong><span>objectif : {cible}</span></span>
      <small>{detail}</small>
    </div>
  );
}

export function Legende({ items }) {
  return <p className="legende">{items.map(([c, t]) => <span key={t}><span className="legende__trait" style={{ background: c }} />{t}</span>)}</p>;
}
