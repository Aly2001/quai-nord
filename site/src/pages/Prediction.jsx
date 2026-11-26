// =====================================================================
//  PRÉDICTION : « Le modèle en test ». En toute transparence : ce qu'il prédit, où il en est (il n'est pas
//  encore branché), son historique RÉEL nuit par nuit, et ce que l'essai à blanc a montré.
//  Les chiffres viennent de site/public/donnees/pages.json, recalculé chaque nuit (exporter_pages.py).
// =====================================================================
import { useTitrePage } from "../components/titrePage";
import { Courbes, BarresDoubles } from "../components/Graphiques";
import { usePages, nombre, pourcent, dateCourte, etatDuModele, candidats, progressionReseau, courbesReseau, resumeEssaiReseau } from "../data/pages";
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
  // Le réseau de neurones : les trois candidats, sa progression vers le branchement, ses courbes
  const trois = candidats(modele);
  const progression = progressionReseau(modele);
  const reseau = resumeEssaiReseau(modele);
  const courbes = courbesReseau(modele, historique.map((n) => n.date));
  const journeesReseau = modele?.reseau?.journees || [];
  const niveauReseau = journeesReseau.length > 1
    ? journeesReseau.map((j) => ({ etiquette: dateCourte(j.journee), annonce: j.annonce_reseau, reel: j.reel }))
    : (modele?.reseau?.essai?.nuits || []).filter((n) => n.annonce_reseau !== null)
      .map((n) => ({ etiquette: dateCourte(n.date), annonce: n.annonce_reseau, reel: n.reel }));
  return (
    <div className="modele">
      <p className="surtitre">Prédiction</p>
      <h1 className="modele__titre">Le modèle en test</h1>
      <p className="modele__chapo">Quai Nord apprend à prédire si un TER sera <strong>perturbé</strong> : 5 min de retard ou plus, ou supprimé.
        Rien n'est <strong>branché</strong> tant que les conditions ne sont pas tenues : en attendant, le site affiche le taux de chaque ligne.</p>

      {pages.etat === "chargement" && <p className="modele__note">Chargement des chiffres…</p>}
      {pages.etat === "absent" && <p className="modele__note">Les chiffres de la nuit ne sont pas encore disponibles.</p>}

      {pages.etat === "pret" && (<>
        <p className="modele__bandeau"><span aria-hidden="true">🧪</span>
          <span><strong>En apprentissage chaque nuit</strong>
            <small>{pages.journees} journées · {nombre(pages.passages)} passages · mis à jour le {dateCourte(pages.genere_le)}</small></span></p>

        {trois && (
          <section className="modele__carte modele__carte--nouveau">
            <h2>Trois candidats</h2>
            <p>Le même examen pour les trois : des journées qu'ils n'ont jamais vues.</p>
            {trois.liste.map((c) => (
              <div key={c.cle} className={`candidat${c.enTete ? " candidat--tete" : ""}`}>
                <span className="candidat__nom">{c.nom}{c.enTete && <span className="candidat__tete">en tête</span>}</span>
                <strong className="candidat__gain">{pourcent(c.gain)}</strong>
                <small>{c.detail}</small>
              </div>
            ))}
            <p className="modele__note">Gain sur le taux de la ligne, {trois.quand}.</p>
          </section>
        )}

        {trois && progression && (
          <section className="modele__carte modele__carte--nouveau">
            <h2>Le réseau vers le branchement</h2>
            <p>Gain ≥ {modele.conditions.gain_min} % <strong>et</strong> écart &lt; {modele.conditions.ecart_max} points,
              {" "}{modele.conditions.jours} journées d'affilée, en conditions réelles.</p>
            <div className="progression" role="img"
                 aria-label={`${progression.suite} journées tenues d'affilée sur ${progression.objectif}`}>
              {Array.from({ length: progression.objectif }, (_, i) => {
                const c = progression.cases[i];
                return <span key={i} className={c ? (c.ok ? "progression__case progression__case--ok" : "progression__case progression__case--ko") : "progression__case"}
                             title={c ? `${dateCourte(c.journee)} : gain ${pourcent(c.gain)}, écart ${c.ecart > 0 ? "+" : ""}${c.ecart} pt` : undefined} />;
              })}
            </div>
            <p className="modele__note">
              {progression.derniere
                ? `${progression.suite} journée${progression.suite > 1 ? "s" : ""} tenue${progression.suite > 1 ? "s" : ""} d'affilée sur ${progression.objectif}`
                  + (progression.derniere.ok ? "" : progression.derniere.gainOk
                    ? ` · le ${dateCourte(progression.derniere.journee)}, il a annoncé ${String(Math.abs(progression.derniere.ecart)).replace(".", ",")} point${Math.abs(progression.derniere.ecart) >= 2 ? "s" : ""} trop ${progression.derniere.ecart > 0 ? "haut" : "bas"}`
                    : ` · le ${dateCourte(progression.derniere.journee)}, gain de ${pourcent(progression.derniere.gain)} seulement`)
                : "Les premières journées réelles arrivent chaque nuit."}
            </p>
          </section>
        )}

        {etat && !trois && (
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
                       { nom: "etat", couleur: "#C98A00", valeurs: historique.map((n) => n.gain_etat ?? parDate[n.date] ?? null) },
                       { nom: "reseau-rejoue", couleur: "#2E9E6A", pointilles: true, valeurs: courbes.rejoue },
                       { nom: "reseau", couleur: "#2E9E6A", valeurs: courbes.reel }]}
                     description="Le gain des modèles sur le taux de la ligne, nuit par nuit" />
            <Legende items={[["#14213D", "Logistique"], ["#C98A00", "+ état de la ligne"],
              ...(reseau ? [["#2E9E6A", "Réseau (pointillé : nuits rejouées)"]] : [])]} />
            <p className="modele__note">Gain sur le taux de la ligne, en %. Lu dans modele/historique.csv.</p>
          </section>
        )}

        {reseau && (
          <section className="modele__carte modele__carte--sombre modele__carte--nouveau">
            <p className="surtitre surtitre--vert">Le réseau de neurones</p>
            <h2>Il lit la journée de la ligne</h2>
            <p>Au lieu d'un seul chiffre, il lit les 20 derniers trains de la ligne, dans l'ordre : retards, suppressions,
              il y a combien de temps. Il voit si ça empire.</p>
            <p className="flux"><span>20 derniers trains</span><span aria-hidden="true">→</span><span><b>GRU</b> · mémoire</span>
              <span aria-hidden="true">→</span><span>+ ligne, heure, météo</span><span aria-hidden="true">→</span><span>risque %</span></p>
            <div className="modele__duo">
              <p><small>{reseau.nuits} nuits rejouées</small><strong>≈ {pourcent(reseau.gain)}</strong></p>
              {reseau.stabilite !== null && <p><small>Stabilité (3 essais)</small><strong>± {String(reseau.stabilite).replace(".", ",")} pt</strong></p>}
            </div>
            <p className="modele__note modele__note--clair">{nombre(reseau.poids)} poids appris · réappris chaque lundi · il ne voit jamais le retard du train qu'il prédit.</p>
          </section>
        )}

        {!reseau && tempete && derniere && (
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

        {niveauReseau.length > 1 && (
          <section className="modele__carte">
            <h2>Le niveau annoncé</h2>
            <BarresDoubles etiquettes={niveauReseau.map((n) => n.etiquette)} a={niveauReseau.map((n) => n.annonce)} b={niveauReseau.map((n) => n.reel)}
                           max={Math.max(40, ...niveauReseau.map((n) => Math.max(n.annonce, n.reel)))} couleurs={["#2E9E6A", "#14213D"]}
                           description="Le risque annoncé par le réseau et la part réellement perturbée" />
            <Legende items={[["#2E9E6A", "Annoncé par le réseau"], ["#14213D", "Réellement perturbés"]]} />
            <p>{journeesReseau.length > 1 ? "Ses vraies journées" : "Les nuits rejouées"} : l'écart doit rester sous {modele.conditions.ecart_max} points.</p>
          </section>
        )}

        {niveauReseau.length <= 1 && historique.length > 1 && (
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
