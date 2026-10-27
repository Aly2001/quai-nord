import { infosReseau, libelleGare } from "./bus";
import { traduire } from "../langue/langue";

// Les questions préparées pour un train, proposées DANS Nora une fois le train choisi
// (seulement celles auxquelles Nora sait répondre ; plus de répétition sous chaque carte)
export function questionsDuTrain(t, pourcentage, meteoDepart, reseauArrivee, langue = "fr") {
  const tr = (cle, v) => traduire(langue, cle, v);
  const questions = [];
  const chiffre = pourcentage === null ? null : pourcentage < 1 ? tr("nora.q.moins") : String(pourcentage);
  questions.push(chiffre !== null
    ? { texte: tr("nora.q.pourquoi", { chiffre }), question: tr("nora.q.pourquoi.long", { chiffre }) }
    : { texte: tr("nora.q.heure"), question: tr("nora.q.heure.long") });
  if (pourcentage !== null && pourcentage >= 15) {
    questions.push({ texte: tr("nora.q.ensuite"), question: tr("nora.q.ensuite.long") });
  }
  if (reseauArrivee) {
    const plusieurs = infosReseau(reseauArrivee).modes.length > 1;
    questions.push({
      texte: tr(plusieurs ? "nora.q.arrivee.tous" : "nora.q.arrivee.bus", { gare: libelleGare(t.gareArrivee) }),
      question: tr(plusieurs ? "nora.q.arrivee.long.tous" : "nora.q.arrivee.long.bus", { gare: t.gareArrivee }),
    });
  }
  if (meteoDepart && (meteoDepart.pluie >= 0.5 || meteoDepart.rafales >= 50)) {
    questions.push({ texte: tr("nora.q.meteo"), question: tr("nora.q.meteo.long") });
  }
  return questions;
}

// La première phrase de Nora sur un train, écrite par le site (sans Gemini) : l'information d'abord
export function accueilDuTrain(heure, texteRisque, langue = "fr") {
  return texteRisque
    ? traduire(langue, "nora.train.risque", { heure, risque: texteRisque })
    : traduire(langue, "nora.train.question", { heure });
}

// Un train annoncé supprimé : Nora le dit tout de suite (sans Gemini), et propose le suivant
export function accueilSupprime(heure, aujourdhui, heureSuivant = null, langue = "fr") {
  const debut = traduire(langue, aujourdhui ? "nora.train.supprime" : "nora.train.supprime.avance", { heure });
  return heureSuivant ? debut + traduire(langue, "nora.train.prochain", { heure: heureSuivant }) : debut;
}
