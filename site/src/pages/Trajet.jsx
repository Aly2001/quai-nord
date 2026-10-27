import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import RechercheTrajet from "../components/RechercheTrajet";
import { useLangue } from "../langue/langue";
import Fraicheur from "../components/Fraicheur";
import DecorVoies from "../components/DecorVoies";
import { BoutonFavori, EtoileTrain } from "../components/Favoris";
import { BoutonPartager } from "../components/Bandeaux";
import { BoutonSuivre } from "../components/Suivre";
import NoraPanneau from "../components/NoraPanneau";
import { AvatarNora } from "../components/NoraConversation";
import { reseauDeGare, transportsDuReseau, infosReseau, libelleGare } from "../data/bus";
import { questionsDuTrain, accueilDuTrain, accueilSupprime } from "../data/questionsTrain";
import {
  DOSSIER, useIndexHoraires, useRisques, trouverGare, normaliser, dateLongue, etiquetteJour,
  joursAVenir, aujourdhuiIso, ajouterJours, heureActuelle, risqueDuTrain, niveauRisque,
  useMeteo, meteoDuTrain, useTempsReel, infoDirect, ajouterMinutes,
  trajetsDirects, trajetsAvecCorrespondance, garderMeilleurs, formatDuree,
} from "../data/horaires";
import "./Trajet.css";
import { useTitrePage } from "../components/titrePage";

export default function Trajet() {
  const { t: tx } = useLangue();           // « tx » : ici, « t » désigne déjà un trajet
  // La recherche est stockée dans l'ADRESSE : /trajet?de=Calais&a=Lille&jour=...&heure=...
  const [params, setParams] = useSearchParams();
  const de = params.get("de") || "";
  const a = params.get("a") || "";
  const jour = params.get("jour") || "";
  const heure = params.get("heure") || "00:00";
  useTitrePage(de && a ? `${de} → ${a}` : "Résultats", `Les TER de ${de || "votre gare"} à ${a || "votre destination"} et leur risque de retard, avec Quai Nord.`);

  const { index, erreur } = useIndexHoraires();
  const risques = useRisques();
  const meteo = useMeteo();
  const [horaires, setHoraires] = useState(null);          // départs de la gare choisie
  const [fichiersCorresp, setFichiersCorresp] = useState(null);  // départs des gares de correspondance
  // Sur téléphone, le formulaire est replié derrière le bouton « Modifier la recherche »
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [aProposOuvert, setAProposOuvert] = useState(false);
  // Le panneau de Nora, ouvert depuis un train : { titre, contexte } ou null
  const [nora, setNora] = useState(null);

  const gareDepart = index ? trouverGare(index.gares, de) : null;
  const jourValide = index ? joursAVenir(index.jours).includes(jour) : false;
  const cible = normaliser(a);

  // Jamais de train avant l'heure choisie. Et aujourd'hui, jamais de train déjà parti.
  const maintenant = heureActuelle();
  const debut = jour === aujourdhuiIso() && maintenant > heure ? maintenant : heure;
  const aujourdhui = jour === aujourdhuiIso();
  const tempsReel = useTempsReel(jourValide);           // aujourd'hui : retards et suppressions ; après : suppressions

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
  // Le réseau de la gare d'arrivée : connu tout de suite grâce à reseaux.json, sans rien télécharger
  const reseauArrivee = reseauDeGare(nomArrivee);
  const pret = horaires && fichiersCorresp;
  // Le trajet le plus court (le premier en cas d'égalité) reçoit le badge « Le plus rapide »
  const indexRapide = trajets.reduce((meilleur, t, i) => (t.dureeMin < trajets[meilleur].dureeMin ? i : meilleur), 0);

  return (
    <>
      {/* ---------- Bandeau bleu nuit, dans la continuité de l'accueil ---------- */}
      <section className="bandeau-resultats">
        <DecorVoies cadrage="xMidYMid slice" discret />
        <div className="conteneur bandeau-resultats__contenu">
          <p className="bandeau-resultats__surtitre cache-telephone">{tx("res.surtitre")}</p>
          <h1 className="bandeau-resultats__titre">
            {gareDepart ? gareDepart.nom : de || tx("res.ouallez")}
            {a && <> <span aria-hidden="true">→</span><span className="visuellement-cache"> {tx("res.vers")} </span> {nomArrivee}</>}
          </h1>
          {jourValide && (
            <p className="bandeau-resultats__date">
              {tx("res.date", { jour: nomDuJourTraduit(jour, tx), date: dateLongue(jour), heure: debut })}
            </p>
          )}
          <Fraicheur tempsReel={tempsReel} sombre pastilles libelleDirect={aujourdhui ? tx("res.direct") : tx("res.infos")} />
          {gareDepart && a && <BoutonFavori de={gareDepart.nom} a={nomArrivee} />}
        </div>
      </section>

      <div className="trajet__mise-en-page">
        {/* Visible seulement sur téléphone : ouvre ou ferme le formulaire, en haut de la page */}
        <button type="button" className="trajet__bouton-modifier" aria-expanded={formulaireOuvert}
                aria-controls="formulaire-recherche" onClick={() => setFormulaireOuvert(!formulaireOuvert)}>
          {formulaireOuvert ? tx("res.fermer") : tx("res.ouvrir")}
        </button>

        <aside id="formulaire-recherche" aria-label={tx("res.modifier")}
               className={formulaireOuvert ? "trajet__formulaire trajet__formulaire--ouvert" : "trajet__formulaire"}>
          {/* heure : celle du début des résultats (l'heure actuelle si c'est aujourd'hui) */}
          <RechercheTrajet key={params.toString()} initial={{ de, a, jour, heure: debut }}
                           onRechercher={(valeurs) => { setFormulaireOuvert(false); setParams(valeurs); }}
                           texteBouton={tx("res.maj")} />
        </aside>

        <section className="resultats" aria-live="polite">
          {erreur && <p className="resultats__message resultats__message--erreur">{erreur}</p>}

          {index && de && !gareDepart && (
            <p className="resultats__message">{tx("res.introuvable", { gare: de })}</p>
          )}

          {index && jour && !jourValide && (
            <p className="resultats__message">{tx("res.jour.perime")}</p>
          )}

          {gareDepart && jourValide && !pret && <p className="resultats__message">{tx("res.recherche")}</p>}

          {pret && jourValide && (
            <>
              {/* La gare d'arrivée est couverte par les bus : Nora le fait savoir, sans qu'on ait à la chercher */}
              {trajets.length > 0 && reseauArrivee && (
                <CarteNoraArrivee gare={libelleGare(nomArrivee)} reseau={reseauArrivee} onOuvrir={() => setNora({
                  titre: `Arrivée à ${libelleGare(nomArrivee)}`,
                  contexte: `Le voyageur arrive en train à la gare de ${nomArrivee} et cherche ${transportsDuReseau(reseauArrivee).replace(/^le /, "un ").replace(/ le /g, " un ")} pour continuer (ville : ${infosReseau(reseauArrivee).ville}).`,
                  accueil: `Depuis la gare de ${libelleGare(nomArrivee)}, où allez-vous ?`,
                  suggestions: ["au centre-ville", "à l'université", "à l'hôpital", "à la mairie"].map((lieu) => ({
                    texte: lieu.charAt(0).toUpperCase() + lieu.slice(1),
                    question: `Je suis à la gare de ${nomArrivee}, je vais ${lieu}.`,
                  })),
                })} />
              )}

              <h2 className="resultats__compte">
                {tx("res.compte", { nombre: trajets.length, heure: debut })}
                <span className="resultats__detail">
                  {tx("res.directs", { nombre: nbDirects, directs: nbDirects, autres: trajets.length - nbDirects })}
                </span>
              </h2>

              {trajets.length === 0 && (
                <p className="resultats__message">{tx("res.aucun", { heure: debut })}</p>
              )}

              <AlerteReseau trajets={trajets} tempsReel={tempsReel} aujourdhui={aujourdhui} />

              <ol className="liste-trajets">
                {trajets.map((t, i) => {
                  // Le prochain trajet qui n'est pas supprimé : proposé quand celui-ci l'est
                  const suivant = trajets.slice(i + 1).findIndex((u) => !trajetSupprime(u, tempsReel));
                  const iSuivant = suivant === -1 ? null : i + 1 + suivant;
                  return (
                    <CarteTrajet key={`${t.heure}-${t.arrivee}-${i}`} cle={`${t.heure}-${t.arrivee}-${i}`} rang={i}
                                 choisie={nora?.cle === `${t.heure}-${t.arrivee}-${i}`} trajet={t} jour={jour}
                                 risques={risques} meteo={meteo} tempsReel={tempsReel} aujourdhui={aujourdhui}
                                 suivant={iSuivant === null ? null : { rang: iSuivant, heure: trajets[iSuivant].heure }}
                                 onDemanderNora={setNora}
                                 reseauArrivee={reseauDeGare(t.gareArrivee)}
                                 rapide={trajets.length > 1 && i === indexRapide} />
                  );
                })}
              </ol>

              <div className="a-propos">
                {/* Sur téléphone, le texte est replié ; sur ordinateur, il reste affiché */}
                <button type="button" className="a-propos__bouton" aria-expanded={aProposOuvert}
                        onClick={() => setAProposOuvert(!aProposOuvert)}>
                  {tx("res.apropos")} {aProposOuvert ? "▴" : "▾"}
                </button>
                <p className={aProposOuvert ? "texte-doux trajet__note a-propos__texte--ouvert" : "texte-doux trajet__note"}>
                {tx("res.note", { date: index.genere_le, jours: risques ? tx("res.jours", { nombre: risques.jours_observes }) : "" })}{" "}
                <Link to="/faq">{tx("res.faq")}</Link>
              </p>
              </div>
            </>
          )}
        </section>
      </div>

      {nora && (
        <NoraPanneau titre={nora.titre} contexte={nora.contexte} accueil={nora.accueil}
                     suggestions={nora.suggestions} questionInitiale={nora.question} onFermer={() => setNora(null)} />
      )}
    </>
  );
}

// =====================================================================
//  Une carte de trajet (direct ou avec correspondance)
// =====================================================================
// Le texte envoyé à Nora pour qu'elle réponde sur CE train, avec SES vrais chiffres
function contexteNora(t, jour, risque, pourcentage, niveau, meteoDepart = null) {
  const [premier, dernier] = [t.troncons[0], t.troncons[t.troncons.length - 1]];
  let texte = `${premier.train.transport} ${premier.train.numero}${premier.train.ligne ? ` (ligne ${premier.train.ligne})` : ""}, `
    + `départ ${t.heure} de ${t.gareDepart}, arrivée ${t.arrivee} à ${t.gareArrivee}, le ${jour}. `;
  if (t.correspondance) {
    texte += `Une correspondance à ${t.correspondance.gare} (${t.correspondance.attente} min), `
      + `puis le train ${dernier.train.transport} ${dernier.train.numero}. `;
  }
  texte += risque
    ? `Risque de retard estimé (5 min ou plus) : ${pourcentage} %, niveau ${niveau.mot.toLowerCase()}, `
      + `basé sur ${risque.n} passages observés de ${risque.source}.`
    : "Pas encore assez de données pour estimer son risque de retard.";
  if (meteoDepart) {
    texte += ` Météo prévue au départ : ${Math.round(meteoDepart.temperature)} °C, pluie ${meteoDepart.pluie} mm/h, `
      + `rafales ${Math.round(meteoDepart.rafales)} km/h${meteoDepart.neige > 0 ? ", neige" : ""}.`;
  }
  return texte;
}

// La carte jaune de Nora, quand la gare d'arrivée est desservie : la vraie question du voyageur, et ce que Nora apporte
function CarteNoraArrivee({ gare, reseau, onOuvrir }) {
  const { t: tx } = useLangue();
  const plusieurs = infosReseau(reseau).modes.length > 1;
  return (
    <section className="carte-arrivee" aria-label={tx("arrivee.aria")}>
      <AvatarNora taille={52} expression="souriant" />
      <div className="carte-arrivee__texte">
        <p className="carte-arrivee__titre">{tx("arrivee.titre", { gare })}</p>
        <p>{tx(plusieurs ? "arrivee.texte.tous" : "arrivee.texte.bus")}</p>
      </div>
      <button type="button" className="carte-arrivee__bouton" onClick={onOuvrir}>
        <AvatarNora taille={28} />
        {tx(plusieurs ? "arrivee.trajet" : "arrivee.bus")}
      </button>
    </section>
  );
}

// Un trajet dont un des trains est annoncé supprimé par la SNCF (d'après le direct)
function trajetSupprime(t, tempsReel) {
  return t.troncons.some((tr) => infoDirect(tempsReel, tr.train.trip_id, tr.depart.stop_id, tr.arrivee.stop_id)?.supprime);
}

// Le bandeau d'alerte, aujourd'hui seulement : au moins 3 trajets supprimés, et au moins 1 sur 5
function AlerteReseau({ trajets, tempsReel, aujourdhui }) {
  const { t: tx } = useLangue();
  if (!aujourdhui || !tempsReel) return null;
  const supprimes = trajets.filter((t) => trajetSupprime(t, tempsReel)).length;
  if (supprimes < 3 || supprimes / trajets.length < 0.2) return null;
  return (
    <section className="alerte-reseau" role="alert">
      <span aria-hidden="true">⚠️</span>
      <div>
        <p className="alerte-reseau__titre">{tx("alerte.titre")}</p>
        <p>{tx("alerte.texte", { supprimes, total: trajets.length })}</p>
      </div>
    </section>
  );
}

function CarteTrajet({ trajet: t, jour, risques, meteo, tempsReel, onDemanderNora, reseauArrivee = null, cle, choisie = false, rapide = false,
                       aujourdhui = true, suivant = null, rang = 0 }) {
  const { t: tx, langue } = useLangue();           // « tx » : ici, « t » désigne déjà un trajet
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

  const meteoDepart = meteoDuTrain(meteo, premier.depart.stop_id, jour, t.heure);
  const questions = questionsDuTrain(t, pourcentage, meteoDepart, reseauArrivee, langue);
  const directs = t.troncons.map((tr) => infoDirect(tempsReel, tr.train.trip_id, tr.depart.stop_id, tr.arrivee.stop_id));
  const supprime = directs.some((d) => d?.supprime);
  const ouvrirNora = (question = null) => onDemanderNora({
    cle,
    titre: `${premier.train.transport} ${premier.train.numero} · ${t.heure} ${t.gareDepart} → ${t.gareArrivee}`,
    contexte: (supprime ? "IMPORTANT : d'après le temps réel de la SNCF, ce train est annoncé SUPPRIMÉ. "
      + "Ne parle pas de son risque de retard : dis qu'il est supprimé, et propose le train suivant. " : "")
      + contexteNora(t, jour, risque, pourcentage, niveau, meteoDepart),
    // Le direct passe avant le risque : un train supprimé n'a pas de « risque », il ne roule pas
    accueil: supprime ? accueilSupprime(t.heure, aujourdhui, suivant?.heure, langue) : accueilDuTrain(t.heure, texteRisque, langue),
    suggestions: questions,
    question,
  });
  const classes = ["trajet-carte", `trajet-carte--${niveau ? niveau.classe : "inconnu"}`];
  if (supprime) classes.push("trajet-carte--supprime");
  if (choisie) classes.push("trajet-carte--choisie");          // le train dont parle Nora

  return (
    <li className={classes.join(" ")} id={`trajet-${rang}`}>
      <div className="trajet-carte__principal">
        {rapide && (
          <span className="trajet-carte__rapide">
            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" fill="currentColor"><path d="M13 2L4 14h7l-1 8 9-12h-7z" /></svg>
            {tx("res.rapide")}
          </span>
        )}
        <div className="trajet-carte__horaires">
          <Heure prevue={t.heure} retard={aujourdhui && !supprime ? directs[0]?.retardDepart : null} />
          <span className="trajet-carte__ligne" aria-hidden="true">
            <span className="trajet-carte__duree">{formatDuree(t.dureeMin)}</span>
          </span>
          <Heure prevue={t.arrivee} retard={aujourdhui && !supprime ? directs[directs.length - 1]?.retardArrivee : null} fin />
        </div>
        <div className="trajet-carte__gares">
          <span>{t.gareDepart}</span>
          <span className="visuellement-cache">{tx("res.duree", { duree: formatDuree(t.dureeMin) })}</span>
          <span>{t.gareArrivee}</span>
        </div>

        <div className="trajet-carte__bas">
          {!t.correspondance && <EtoileTrain trajet={t} />}
          <BoutonSuivre trajet={t} jour={jour} />
          <BoutonPartager titre={tx("pwa.partage.train", { heure: t.heure, de: t.gareDepart, a: t.gareArrivee })}
                          chemin={`/trajet?${new URLSearchParams({ de: t.gareDepart, a: t.gareArrivee, jour, heure: t.heure })}`} />
          <button type="button" className="trajet-carte__details" aria-expanded={details}
                  onClick={() => setDetails(!details)}>
            {tx("res.details")}
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none"
                 stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d={details ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
            </svg>
          </button>
          <div className="trajet-carte__badges">
            <BadgeMeteo meteo={meteoDepart} />
            {t.troncons.map((tr, i) => (
              <span key={i} className="trajet-carte__train">
                {i > 0 && <span className="trajet-carte__chevron" aria-label={tx("res.puis")}>›</span>}
                <span className="badge badge--train">
                  <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor"
                       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="3" width="14" height="14" rx="3" /><path d="M5 11h14M9 21l1.5-4M15 21l-1.5-4" /></svg>
                  {tr.train.transport} {tr.train.numero}
                </span>
                {tr.train.ligne && <span className="badge badge--ligne">{tr.train.ligne}</span>}
              </span>
            ))}
            <span className="trajet-carte__direct">
              {t.correspondance
                ? tx("res.correspondance", { gare: t.correspondance.gare, minutes: t.correspondance.attente })
                : premier.arrets.length > 0 ? tx("res.avecarrets", { nombre: premier.arrets.length }) : tx("res.sansarret")}
            </span>
          </div>
        </div>

        {correspondanceFragile && (
          <p className="alerte-correspondance">
            <strong>{tx("res.fragile.titre", { minutes: t.correspondance.attente })}</strong>{" "}
            {tx("res.fragile", { pourcentage: Math.round(risquePremier.taux * 100) })}
          </p>
        )}

        <LigneDirect directs={directs} trajet={t} aujourdhui={aujourdhui} jour={jour} frais={Boolean(tempsReel)}
                     suivant={suivant} />

        {details && (
          <ol className="arrets">
            {t.troncons.map((tr, i) => (
              <li key={i} className="arrets__troncon">
                {i > 0 && (
                  <p className="arrets__changement">
                    {tx("res.changement", { gare: t.correspondance.gare, minutes: t.correspondance.attente })}
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
        <p className="risque-boite__titre">
          {tx("res.risque")}
          <Link to="/faq#risque" className="risque-boite__aide" aria-label={tx("res.risque.aide")}>?</Link>
        </p>
        {niveau ? (
          <>
            <p className="risque-boite__valeur">
              {texteRisque.replace(" %", "\u00a0%")} <span className="risque-boite__mot">{tx(`niveau.${niveau.classe}`)}</span>
            </p>
            <div className="risque-boite__piste" role="img"
                 aria-label={tx("res.risque.label", { risque: texteRisque, niveau: tx(`niveau.${niveau.classe}`).toLowerCase() })}>
              <span className="risque-boite__jauge" style={{ width: `${Math.max(pourcentage, 3)}%` }} />
            </div>
            <p className="risque-boite__source">
              {tx("res.base", { nombre: risque.n, source: sourceTraduite(risque.source, tx) })}
              {t.correspondance ? tx("res.deuxieme") : ""}
            </p>
          </>
        ) : (
          <p className="risque-boite__vide">{tx("res.peu")}</p>
        )}
      </div>

      {/* Nora, sous chaque train : UN bouton ; les questions de ce train s'affichent dans Nora */}
      <div className="carte-nora">
        <button type="button" className="carte-nora__bouton" onClick={() => ouvrirNora()}>
          <AvatarNora taille={30} />
          {tx("res.nora")}
        </button>
      </div>
    </li>
  );
}

// Une heure : prévue, ou, s'il y a un retard annoncé (1 min ou plus), l'heure prévue barrée et la nouvelle en orange
function Heure({ prevue, retard, fin = false }) {
  const minutes = Math.round((retard ?? 0) / 60);
  if (minutes < 1) return <span className="trajet-carte__heure">{prevue}</span>;
  return (
    <span className={`trajet-carte__heure-direct${fin ? " trajet-carte__heure-direct--fin" : ""}`}>
      <s>{prevue}</s>
      <span className="trajet-carte__heure trajet-carte__heure--retard">{ajouterMinutes(prevue, minutes)}</span>
    </span>
  );
}

// ---------- L'état en direct : aujourd'hui, tout ; demain et après-demain, seulement les suppressions ----------
function LigneDirect({ directs, trajet: t, aujourdhui = true, jour, frais = false, suivant = null }) {
  const { t: tx } = useLangue();           // « tx » : ici, « t » désigne déjà un trajet
  if (directs.some((d) => d?.supprime)) {
    const quand = aujourdhui ? tx("direct.pasaujourdhui")
      : tx(jour === ajouterJours(aujourdhuiIso(), 1) ? "direct.demain" : "direct.cejour");
    return (
      <div className="direct direct--supprime">
        <p className="direct__ligne">
          <span className="direct__puce">{tx("direct.supprime")}</span>
          {t.correspondance ? tx("direct.untrain") : quand}
        </p>
        {suivant && (
          <button type="button" className="direct__suivant"
                  onClick={() => document.getElementById(`trajet-${suivant.rang}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>
            {tx("direct.suivant", { heure: suivant.heure })}
          </button>
        )}
      </div>
    );
  }
  if (!aujourdhui) {
    // Pour un autre jour, aucun retard « en direct » n'a de sens : seulement l'absence d'annonce
    return frais ? <p className="direct direct--prevu">{tx("direct.prevu")}</p> : null;
  }
  if (directs.every((d) => !d)) return null;              // aucun train dans le flux : on ne dit rien

  const minutes = (s) => Math.round((s ?? 0) / 60);
  const [d1, d2] = [directs[0], directs[directs.length - 1]];

  // Avec correspondance : le 1er train a-t-il plus de retard que le temps de changement ?
  if (t.correspondance && d1) {
    const retardArriveeHub = minutes(d1.retardArrivee);
    const marge = t.correspondance.attente - retardArriveeHub;
    if (marge < 3) {
      return (
        <p className="direct direct--supprime">
          <span className="direct__puce">{tx("direct.compromise")}</span>
          {tx("direct.compromise.texte", { retard: retardArriveeHub, minutes: t.correspondance.attente })}
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
        {tx("direct.retard")}
      </p>
    );
  }
  return (
    <p className="direct direct--heure">
      <span className="direct__puce">{tx("direct.heure")}</span>
      {tx("direct.heure.texte")}
    </p>
  );
}

// ---------- La météo prévue au départ ----------
function BadgeMeteo({ meteo: m }) {
  const { t: tx } = useLangue();           // « tx » : ici, « t » désigne déjà un trajet
  if (!m) return null;
  const vent = m.rafales >= 50;
  let icone = "soleil";
  let texte = tx("meteo.sec", { temperature: Math.round(m.temperature) });
  if (m.neige > 0) { icone = "neige"; texte = tx("meteo.neige", { temperature: Math.round(m.temperature) }); }
  else if (m.pluie >= 0.2) { icone = "pluie"; texte = tx("meteo.pluie", { pluie: m.pluie.toFixed(1).replace(".", ",") }); }
  if (vent) texte += tx("meteo.rafales", { vent: Math.round(m.rafales) });
  if (vent && icone === "soleil") { icone = "vent"; texte = tx("meteo.vent", { vent: Math.round(m.rafales) }); }

  return (
    <span className={`badge badge--meteo${vent || icone !== "soleil" ? " badge--meteo-alerte" : ""}`}
          title={tx("meteo.titre", { point: m.point })}>
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

// « Aujourd'hui », « Demain », « Après-demain » dans la langue choisie (sinon la date)
function nomDuJourTraduit(dateIso, tx) {
  const nom = etiquetteJour(dateIso);
  const cles = { "Aujourd'hui": "jour.aujourdhui", Demain: "jour.demain", "Après-demain": "jour.apresdemain" };
  return cles[nom] ? tx(cles[nom]) : nom;
}

// La source du risque (« ce train », « la ligne K21 vers 7 h », « les trains de 7 h »), dans la langue choisie
function sourceTraduite(source, tx) {
  if (source === "ce train") return tx("source.train");
  const ligne = source.match(/^la ligne (.+) vers (\d+) h$/);
  if (ligne) return tx("source.ligne", { ligne: ligne[1], heure: ligne[2] });
  const heure = source.match(/^les trains de (\d+) h$/);
  return heure ? tx("source.heure", { heure: heure[1] }) : source;
}
