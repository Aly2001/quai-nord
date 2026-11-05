// Les bus favoris : une LIGNE, à un ARRÊT, dans une DIRECTION, dans une ville. 5 au plus (listeLimitee.js).
// Ils s'affichent dans En ville, onglet « Prochains passages », pour la ville choisie.
import { useEffect, useState } from "react";
import { ajouterSansPerdre, MAXIMUM_LISTE } from "./listeLimitee";
import { synchroniserNotifications } from "./notifications";
import { trainsSuivisPourLeServeur } from "./suivi";

const CLE = "quai-nord-bus-favoris";
const EVENEMENT = "quai-nord-bus-favoris";
export const idBus = (b) => `${b.code}|${b.ligneId}|${b.direction}|${b.arret.nom}`;

function lire() {
  try { const l = JSON.parse(localStorage.getItem(CLE)); return Array.isArray(l) ? l : []; } catch { return []; }
}
function ecrire(liste) {
  try { localStorage.setItem(CLE, JSON.stringify(liste)); } catch { /* stockage plein ou interdit : tant pis */ }
  window.dispatchEvent(new Event(EVENEMENT));
  // Un rappel ajouté, changé ou retiré : le serveur des alertes est tenu à jour (s'il est utilisé)
  synchroniserNotifications(trainsSuivisPourLeServeur());
}

// ---------- Le rappel d'un bus favori : { heure (minutes du jour), jours (0 = lundi … 6 = dimanche), avance (min) } ----------
// Le serveur reçoit le strict nécessaire pour retrouver le bus dans les horaires : le réseau, la ligne,
// la direction et l'arrêt (ses identifiants, et son nom au cas où les identifiants changent). Jamais la position.
export function rappelsBusPourLeServeur(liste = lire()) {
  return liste.filter((b) => b.rappel).map((b) => ({
    code: b.code, ligneId: b.ligneId, ligne: b.ligne.nom, direction: b.direction,
    arret: b.arret.nom, ids: b.arret.ids.slice(0, 10),
    heure: b.rappel.heure, jours: b.rappel.jours, avance: b.rappel.avance,
  }));
}
export const DEFAUT_RAPPEL = { heure: 8 * 60, jours: [0, 1, 2, 3, 4], avance: 5 };

export function useBusFavoris() {
  const [bus, setBus] = useState(lire);
  useEffect(() => {
    const relire = () => setBus(lire());
    window.addEventListener(EVENEMENT, relire);
    window.addEventListener("storage", relire);
    return () => { window.removeEventListener(EVENEMENT, relire); window.removeEventListener("storage", relire); };
  }, []);
  const estFavori = (b) => bus.some((x) => idBus(x) === idBus(b));
  // Renvoie « plein » quand il y en a déjà 5 : rien n'est retiré sans le choix du voyageur
  const basculer = (b) => {
    const liste = lire();
    if (liste.some((x) => idBus(x) === idBus(b))) { ecrire(liste.filter((x) => idBus(x) !== idBus(b))); return "retire"; }
    const r = ajouterSansPerdre(liste, b, idBus, MAXIMUM_LISTE);
    if (r.plein) return "plein";
    ecrire(r.liste);
    return "ajoute";
  };
  const retirer = (cle) => ecrire(lire().filter((x) => idBus(x) !== cle));
  const regler = (cle, rappel) => ecrire(lire().map((x) => (idBus(x) === cle ? { ...x, rappel: rappel || undefined } : x)));
  return { bus, estFavori, basculer, retirer, regler, maximum: MAXIMUM_LISTE };
}
