// Les bus favoris : une LIGNE, à un ARRÊT, dans une DIRECTION, dans une ville. 5 au plus (listeLimitee.js).
// Ils s'affichent dans En ville, onglet « Prochains passages », pour la ville choisie.
import { useEffect, useState } from "react";
import { ajouterSansPerdre, MAXIMUM_LISTE } from "./listeLimitee";

const CLE = "quai-nord-bus-favoris";
const EVENEMENT = "quai-nord-bus-favoris";
export const idBus = (b) => `${b.code}|${b.ligneId}|${b.direction}|${b.arret.nom}`;

function lire() {
  try { const l = JSON.parse(localStorage.getItem(CLE)); return Array.isArray(l) ? l : []; } catch { return []; }
}
function ecrire(liste) {
  try { localStorage.setItem(CLE, JSON.stringify(liste)); } catch { /* stockage plein ou interdit : tant pis */ }
  window.dispatchEvent(new Event(EVENEMENT));
}

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
  return { bus, estFavori, basculer, retirer, maximum: MAXIMUM_LISTE };
}
