import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import RechercheTrajet from "../components/RechercheTrajet";
import Fraicheur from "../components/Fraicheur";
import DecorVoies from "../components/DecorVoies";
import { BoutonFavori } from "../components/Favoris";
import {
  DOSSIER, useIndexHoraires, useRisques, trouverGare, normaliser, dateLongue, etiquetteJour,
  joursAVenir, aujourdhuiIso, heureActuelle, risqueDuTrain, niveauRisque,
  useMeteo, meteoDuTrain, useTempsReel, infoDirect, ajouterMinutes,
  trajetsDirects, trajetsAvecCorrespondance, garderMeilleurs, formatDuree,
} from "../data/horaires";
import "./Trajet.css";

export default function Trajet() {
  // La recherche est stockée dans l'ADRESSE : /trajet?de=Calais&a=Lille&jour=...&heure=...
  const [params, setParams] = useSearchParams();
  const de = params.get("de") || "";
  const a = params.get("a") || "";
  const jour = params.get("jour") || "";
  const heure = params.get("heure") || "00:00";

  const { index, erreur } = useIndexHoraires();
  const risques = useRisques();
  const meteo = useMeteo();
  const [horaires, setHoraires] = useState(null);          // départs de la gare choisie
  const [fichiersCorresp, setFichiersCorresp] = useState(null);  // départs des gares de correspondance
  // Sur téléphone, le formulaire est replié derrière le bouton « Modifier la recherche »
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [aProposOuvert, setAProposOuvert] = useState(false);

  const gareDepart = index ? trouverGare(index.gares, de) : null;
  const jourValide = index ? joursAVenir(index.jours).includes(jour) : false;
  const cible = normaliser(a);

  // Jamais de train avant l'heure choisie. Et aujourd'hui, jamais de train déjà parti.
  const maintenant = heureActuelle();
  const debut = jour === aujourdhuiIso() && maintenant > heure ? maintenant : heure;
  const tempsReel = useTempsReel(jourValide && jour === aujourdhuiIso());

  // ---------- 1. Charger les départs de la gare choisie ----------
  useEffect(() => {
    if (!gareDepart || !jourValide) return;
    let annule = false;
    setHoraires(null);
    fetch(`${DOSSIER}/${gareDepart.slug}/${jour}.json`)
      .then((reponse) => reponse.json())
      .then((donnees) => { if (!annule) setHoraires(donnees); })
      .catch(() => { if (!annule) setHoraires({ departs: [] }); });
    return () => { annule = true; };
  }, [gareDepart?.slug, jour, jourValide]);

  // Les départs utiles : à partir de l'heure choisie
  const departs = (horaires?.departs || []).filter((t) => t.heure >= debut);

  // ---------- 2. Charger les gares de correspondance sur le chemin ----------
  // On ne charge que celles réellement desservies par les trains au départ (souvent 2 à 5).
  const slugParNom = Object.fromEntries((index?.gares || []).map((g) => [g.nom, g.slug]));
  const estCorrespondance = new Set(index?.correspondances || []);
  const garesUtiles = [...new Set(departs.flatMap((t) => t.suite.map((s) => s.gare)))]
    .filter((nom) => estCorrespondance.has(slugParNom[nom]) && nom !== gareDepart?.nom)
    .sort();
  const cleGares = garesUtiles.join("|");

  useEffect(() => {
    if (!horaires || !cible || garesUtiles.length === 0) { setFichiersCorresp({}); return; }
    let annule = false;
    setFichiersCorresp(null);
    Promise.all(garesUtiles.map((nom) =>
      fetch(`${DOSSIER}/${slugParNom[nom]}/${jour}.json`)
        .then((reponse) => reponse.json())
        .then((donnees) => [nom, donnees])
        .catch(() => [nom, null])
    )).then((paires) => {
      if (!annule) setFichiersCorresp(Object.fromEntries(paires.filter(([, d]) => d)));
    });
    return () => { annule = true; };
  }, [horaires, cleGares, cible, jour]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- 3. Calculer les trajets ----------
  const directs = cible && gareDepart ? trajetsDirects(departs, gareDepart.nom, cible) : [];
  const avecCorresp = cible && gareDepart && fichiersCorresp
    ? trajetsAvecCorrespondance(departs, gareDepart.nom, cible, fichiersCorresp) : [];
  const trajets = garderMeilleurs(directs, avecCorresp);
  const nbDirects = trajets.filter((t) => !t.correspondance).length;
  const nomArrivee = trajets[0]?.gareArrivee || a;
  const pret = horaires && fichiersCorresp;

  return (
    <>
      {/* ---------- Bandeau bleu nuit, dans la continuité de l'accueil ---------- */}
      <section className="bandeau-resultats">
        <DecorVoies cadrage="xMidYMid slice" discret />
        <div className="conteneur bandeau-resultats__contenu">
          <p className="bandeau-resultats__surtitre cache-telephone">Résultats de recherche</p>
          <h1 className="bandeau-resultats__titre">
            {gareDepart ? gareDepart.nom : de || "Où allez-vous\u00a0?"}
            {a && <> <span aria-hidden="true">→</span><span className="visuellement-cache"> vers </span> {nomArrivee}</>}
          </h1>
          {jourValide && (
            <p className="bandeau-resultats__date">
              {etiquetteJour(jour)}, {dateLongue(jour)} · départ à partir de {debut}
            </p>
          )}
          <Fraicheur tempsReel={tempsReel} sombre />
          {gareDepart && a && <BoutonFavori de={gareDepart.nom} a={nomArrivee} />}
        </div>
      </section>

      <div className="trajet__mise-en-page">
        {/* Visible seulement sur téléphone : ouvre ou ferme le formulaire, en haut de la page */}
        <button type="button" className="trajet__bouton-modifier" aria-expanded={formulaireOuvert}
                aria-controls="formulaire-recherche" onClick={() => setFormulaireOuvert(!formulaireOuvert)}>
          {formulaireOuvert ? "Fermer la recherche ▴" : "Modifier la recherche ▾"}
        </button>

        <aside id="formulaire-recherche" aria-label="Modifier la recherche"
               className={formulaireOuvert ? "trajet__formulaire trajet__formulaire--ouvert" : "trajet__formulaire"}>
          {/* heure : celle du début des résultats (l'heure actuelle si c'est aujourd'hui) */}
          <RechercheTrajet key={params.toString()} initial={{ de, a, jour, heure: debut }}
                           onRechercher={(valeurs) => { setFormulaireOuvert(false); setParams(valeurs); }}
                           texteBouton="Mettre à jour" />
        </aside>

        <section className="resultats" aria-live="polite">
          {erreur && <p className="resultats__message resultats__message--erreur">{erreur}</p>}

          {index && de && !gareDepart && (
            <p className="resultats__message">
              Gare de départ « {de} » introuvable. Quai Nord couvre les gares des Hauts-de-France :
              choisis une gare dans la liste qui s'affiche pendant la saisie.
            </p>
          )}

          {index && jour && !jourValide && (
            <p className="resultats__message">Ce jour n'est plus disponible. Choisis aujourd'hui, demain ou après-demain.</p>
          )}

          {gareDepart && jourValide && !pret && <p className="resultats__message">Recherche des trains…</p>}

          {pret && jourValide && (
            <>
              <h2 className="resultats__compte">
                {trajets.length} trajet{trajets.length > 1 ? "s" : ""} à partir de {debut}
                <span className="resultats__detail">
                  {nbDirects} direct{nbDirects > 1 ? "s" : ""}, {trajets.length - nbDirects} avec correspondance
                </span>
              </h2>

              {trajets.length === 0 && (
                <p className="resultats__message">
                  Aucun trajet trouvé après {debut} ce jour-là, même avec une correspondance.
                  Essaie le jour suivant ou une heure plus tôt.
                </p>
              )}

              <ol className="liste-trajets">
                {trajets.map((t, i) => (
                  <CarteTrajet key={`${t.heure}-${t.arrivee}-${i}`} trajet={t} jour={jour}
                               risques={risques} meteo={meteo} tempsReel={tempsReel} />
                ))}
              </ol>

              <div className="a-propos">
                {/* Sur téléphone, le texte est replié ; sur ordinateur, il reste affiché */}
                <button type="button" className="a-propos__bouton" aria-expanded={aProposOuvert}
                        onClick={() => setAProposOuvert(!aProposOuvert)}>
                  À propos des données {aProposOuvert ? "▴" : "▾"}
                </button>
                <p className={aProposOuvert ? "texte-doux trajet__note a-propos__texte--ouvert" : "texte-doux trajet__note"}>
                Horaires théoriques SNCF (GTFS), générés le {index.genere_le}. Une seule correspondance au
                maximum, de 5 min à 1 h 30, dans la même gare. Le risque de retard est estimé à partir des retards observés par
                Quai Nord, ajusté vers la moyenne quand un train a peu d'observations
                {risques ? ` (${risques.jours_observes} jour${risques.jours_observes > 1 ? "s" : ""} de collecte)` : ""} :
                ce n'est pas encore une prédiction. Météo prévue au départ : Open-Meteo (CC BY 4.0).
                Pour une information officielle, consultez SNCF Connect.{" "}
                <Link to="/faq">Questions fréquentes</Link>
              </p>
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}

// =====================================================================
//  Une carte de trajet (direct ou avec correspondance)
// =====================================================================
function CarteTrajet({ trajet: t, jour, risques, meteo, tempsReel }) {
  const [details, setDetails] = useState(false);
  const [premier, dernier] = [t.troncons[0], t.troncons[t.troncons.length - 1]];

  // Le risque affiché : celui du train qui arrive à destination
  const risque = risqueDuTrain(risques, dernier.train);
  const pourcentage = risque ? Math.round(risque.taux * 100) : null;
  const niveau = pourcentage !== null ? niveauRisque(pourcentage) : null;
  // Aucun train n'a un risque nul : sous 1 %, on écrit « < 1 % » plutôt que « 0 % »
  const texteRisque = pourcentage === null ? "" : pourcentage < 1 ? "< 1 %" : `${pourcentage} %`;

  // Correspondance : risque que le 1er train arrive avec 5 min de retard ou plus
  const risquePremier = t.correspondance ? risqueDuTrain(risques, premier.train) : null;
  const correspondanceFragile = t.correspondance && t.correspondance.attente <= 10 && risquePremier
    && risquePremier.taux >= 0.15;

  const directs = t.troncons.map((tr) => infoDirect(tempsReel, tr.train.trip_id, tr.depart.stop_id, tr.arrivee.stop_id));
  const supprime = directs.some((d) => d?.supprime);
  const classes = ["trajet-carte", `trajet-carte--${niveau ? niveau.classe : "inconnu"}`];
  if (supprime) classes.push("trajet-carte--supprime");

  return (
    <li className={classes.join(" ")}>
      <div className="trajet-carte__principal">
        <div className="trajet-carte__horaires">
          <span className="trajet-carte__heure">{t.heure}</span>
          <span className="trajet-carte__ligne" aria-hidden="true">
            <span className="trajet-carte__duree">{formatDuree(t.dureeMin)}</span>
          </span>
          <span className="trajet-carte__heure">{t.arrivee}</span>
        </div>
        <div className="trajet-carte__gares">
          <span>{t.gareDepart}</span>
          <span className="visuellement-cache">durée {formatDuree(t.dureeMin)}</span>
          <span>{t.gareArrivee}</span>
        </div>

        <div className="trajet-carte__bas">
          <button type="button" className="trajet-carte__details" aria-expanded={details}
                  onClick={() => setDetails(!details)}>
            Détails
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none"
                 stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d={details ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
            </svg>
          </button>
          <div className="trajet-carte__badges">
            <BadgeMeteo meteo={meteoDuTrain(meteo, premier.depart.stop_id, jour, t.heure)} />
            {t.troncons.map((tr, i) => (
              <span key={i} className="trajet-carte__train">
                {i > 0 && <span className="trajet-carte__chevron" aria-label="puis">›</span>}
                <span className="badge">{tr.train.transport} {tr.train.numero}</span>
                {tr.train.ligne && <span className="badge badge--ligne">{tr.train.ligne}</span>}
              </span>
            ))}
            <span className="trajet-carte__direct">
              {t.correspondance
                ? `1 correspondance à ${t.correspondance.gare} · ${t.correspondance.attente} min`
                : `Direct${premier.arrets.length > 0 ? `, ${premier.arrets.length} arrêt${premier.arrets.length > 1 ? "s" : ""}` : ""}`}
            </span>
          </div>
        </div>

        {correspondanceFragile && (
          <p className="alerte-correspondance">
            <strong>Correspondance courte ({t.correspondance.attente} min).</strong>{" "}
            Le premier train arrive avec 5 min de retard ou plus dans {Math.round(risquePremier.taux * 100)} % des cas observés.
          </p>
        )}

        <LigneDirect directs={directs} trajet={t} />

        {details && (
          <ol className="arrets">
            {t.troncons.map((tr, i) => (
              <li key={i} className="arrets__troncon">
                {i > 0 && (
                  <p className="arrets__changement">
                    Changement à {t.correspondance.gare} · {t.correspondance.attente} min d'attente
                  </p>
                )}
                <ol className="arrets__liste">
                  <li><span className="arrets__heure">{tr.depart.heure}</span><strong>{tr.depart.gare}</strong>
                    <span className="arrets__train">{tr.train.transport} {tr.train.numero}</span></li>
                  {tr.arrets.map((s) => (
                    <li key={s.gare + s.heure}><span className="arrets__heure">{s.heure}</span>{s.gare}</li>
                  ))}
                  <li><span className="arrets__heure">{tr.arrivee.heure}</span><strong>{tr.arrivee.gare}</strong></li>
                </ol>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* ---------- La boîte de risque (à la place du prix) ---------- */}
      <div className="risque-boite">
        <p className="risque-boite__titre">Risque de retard</p>
        {niveau ? (
          <>
            <p className="risque-boite__valeur">
              {texteRisque.replace(" %", "\u00a0%")} <span className="risque-boite__mot">{niveau.mot}</span>
            </p>
            <div className="risque-boite__piste" role="img"
                 aria-label={`Risque de retard de 5 minutes ou plus : ${texteRisque}, niveau ${niveau.mot.toLowerCase()}`}>
              <span className="risque-boite__jauge" style={{ width: `${Math.max(pourcentage, 3)}%` }} />
            </div>
            <p className="risque-boite__source">
              Basé sur {risque.n} passage{risque.n > 1 ? "s" : ""} observé{risque.n > 1 ? "s" : ""} de {risque.source}
              {t.correspondance ? " (du 2e train)" : ""}
            </p>
          </>
        ) : (
          <p className="risque-boite__vide">Pas encore assez de données pour ce train</p>
        )}
      </div>
    </li>
  );
}

// ---------- L'état en direct (seulement pour aujourd'hui) ----------
function LigneDirect({ directs, trajet: t }) {
  if (directs.every((d) => !d)) return null;              // aucun train dans le flux : on ne dit rien

  if (directs.some((d) => d?.supprime)) {
    return (
      <p className="direct direct--supprime">
        <span className="direct__puce">Supprimé</span>
        {t.correspondance ? "Un des trains de ce trajet est annoncé supprimé." : "Ce train est annoncé supprimé sur ce trajet."}
      </p>
    );
  }

  const minutes = (s) => Math.round((s ?? 0) / 60);
  const [d1, d2] = [directs[0], directs[directs.length - 1]];

  // Avec correspondance : le 1er train a-t-il plus de retard que le temps de changement ?
  if (t.correspondance && d1) {
    const retardArriveeHub = minutes(d1.retardArrivee);
    const marge = t.correspondance.attente - retardArriveeHub;
    if (marge < 3) {
      return (
        <p className="direct direct--supprime">
          <span className="direct__puce">Correspondance compromise</span>
          Le premier train a {retardArriveeHub} min de retard pour {t.correspondance.attente} min de changement.
        </p>
      );
    }
  }

  const retardDepart = minutes(d1?.retardDepart);
  const retardArrivee = minutes(d2?.retardArrivee);
  const pire = Math.max(retardDepart, retardArrivee);
  if (pire >= 1) {
    return (
      <p className="direct direct--retard">
        <span className="direct__puce">+{pire} min</span>
        Départ prévu à {ajouterMinutes(t.heure, retardDepart)}
        {d2 ? `, arrivée à ${ajouterMinutes(t.arrivee, retardArrivee)}` : ""}
      </p>
    );
  }
  return (
    <p className="direct direct--heure">
      <span className="direct__puce">À l'heure</span>
      Selon les dernières informations en direct
    </p>
  );
}

// ---------- La météo prévue au départ ----------
function BadgeMeteo({ meteo: m }) {
  if (!m) return null;
  const vent = m.rafales >= 50;
  let icone = "soleil";
  let texte = `Sec, ${Math.round(m.temperature)} °C`;
  if (m.neige > 0) { icone = "neige"; texte = `Neige, ${Math.round(m.temperature)} °C`; }
  else if (m.pluie >= 0.2) { icone = "pluie"; texte = `Pluie ${m.pluie.toFixed(1).replace(".", ",")} mm`; }
  if (vent) texte += ` · rafales ${Math.round(m.rafales)} km/h`;
  if (vent && icone === "soleil") { icone = "vent"; texte = `Rafales ${Math.round(m.rafales)} km/h`; }

  return (
    <span className={`badge badge--meteo${vent || icone !== "soleil" ? " badge--meteo-alerte" : ""}`}
          title={`Météo prévue au départ (point ${m.point})`}>
      <IconeMeteo type={icone} />
      {texte}
    </span>
  );
}

function IconeMeteo({ type }) {
  const traits = {
    soleil: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
    pluie: <><path d="M7 15a4 4 0 1 1 1-7.9A5 5 0 0 1 18 9a3 3 0 0 1 0 6z" /><path d="M9 18l-1 3M13 18l-1 3M17 18l-1 3" /></>,
    neige: <><path d="M7 14a4 4 0 1 1 1-7.9A5 5 0 0 1 18 8a3 3 0 0 1 0 6z" /><path d="M9 18h.01M13 20h.01M17 18h.01" /></>,
    vent: <path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8" />,
  };
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {traits[type]}
    </svg>
  );
}
