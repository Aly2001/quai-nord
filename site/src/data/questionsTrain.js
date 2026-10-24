import { infosReseau, libelleGare } from "./bus";

// Les questions préparées pour un train, proposées DANS Nora une fois le train choisi
// (seulement celles auxquelles Nora sait répondre ; plus de répétition sous chaque carte)
export function questionsDuTrain(t, pourcentage, meteoDepart, reseauArrivee) {
  const questions = [];
  const chiffre = pourcentage === null ? null : pourcentage < 1 ? "moins de 1" : String(pourcentage);
  questions.push(chiffre !== null
    ? { texte: `Pourquoi ${chiffre} % de risque ?`, question: `Pourquoi ce train a-t-il ${chiffre} % de risque de retard ?` }
    : { texte: "Sera-t-il à l'heure ?", question: "Ce train sera-t-il à l'heure ?" });
  if (pourcentage !== null && pourcentage >= 15) {
    questions.push({ texte: "S'il est en retard, quel train ensuite ?", question: "Et s'il est en retard, quel train prendre ensuite ?" });
  }
  if (reseauArrivee) {
    const plusieurs = infosReseau(reseauArrivee).modes.length > 1;
    questions.push({
      texte: `${plusieurs ? "Bus, tram ou métro" : "Bus"} à l'arrivée à ${libelleGare(t.gareArrivee)} ?`,
      question: `Quel ${plusieurs ? "transport" : "bus"} prendre à l'arrivée à la gare de ${t.gareArrivee} ?`,
    });
  }
  if (meteoDepart && (meteoDepart.pluie >= 0.5 || meteoDepart.rafales >= 50)) {
    questions.push({ texte: "Pluie au départ ?", question: "Quel temps fera-t-il au départ de ce train ?" });
  }
  return questions;
}

// La première phrase de Nora sur un train, écrite par le site (sans Gemini) : l'information d'abord
export function accueilDuTrain(heure, texteRisque) {
  return texteRisque
    ? `Le train de ${heure} a ${texteRisque} de risque de retard. Que voulez-vous savoir ?`
    : `Que voulez-vous savoir sur le train de ${heure} ?`;
}

// Un train annoncé supprimé : Nora le dit tout de suite (sans Gemini), et propose le suivant
export function accueilSupprime(heure, aujourdhui, heureSuivant = null) {
  const debut = aujourdhui
    ? `Le train de ${heure} est supprimé aujourd'hui, d'après la SNCF.`
    : `Le train de ${heure} est déjà annoncé supprimé par la SNCF.`;
  return heureSuivant ? `${debut} 👉 Le prochain : ${heureSuivant}.` : debut;
}
