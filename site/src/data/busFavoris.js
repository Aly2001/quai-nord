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

// ---------- Les rappels d'un bus favori : chacun posé sur UN bus des horaires (comme un train suivi) ----------
// { heure (minutes du jour : l'heure de CE bus à cet arrêt), repetition: "une" | "semaine" | "tous", jour (pour « une »), avance (min) }
// Rien à taper : on touche un bus, l'application connaît son heure. 5 rappels au plus, tous bus confondus.
export const MAX_RAPPELS = 5;
export const JOURS_DE = { une: null, semaine: [0, 1, 2, 3, 4], tous: [0, 1, 2, 3, 4, 5, 6] };
const lundiZero = (iso) => (new Date(`${iso}T12:00:00`).getDay() + 6) % 7;
const aujourdhui = () => new Date().toLocaleDateString("sv-SE");
const maintenantMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

// Un rappel « une fois » déjà passé ne sert plus ; un ancien rappel « vers 08:00 » (tapé, sans bus choisi) non plus
export function rappelsValides(rappels, jour = aujourdhui(), minute = maintenantMinutes()) {
  return (rappels || []).filter((r) => r && r.repetition && typeof r.heure === "number"
    && !(r.repetition === "une" && (r.jour < jour || (r.jour === jour && r.heure < minute))));
}
// Ce rappel vaut-il pour ce bus, ce jour-là ? (la petite cloche dans la grille)
export function rappelDuBus(favori, heure, jourIso) {
  return rappelsValides(favori.rappels).find((r) => r.heure === heure
    && (r.repetition === "une" ? r.jour === jourIso : JOURS_DE[r.repetition].includes(lundiZero(jourIso))));
}

// Le serveur reçoit le strict nécessaire pour retrouver le bus dans les horaires : le réseau, la ligne,
// la direction, l'arrêt (ses identifiants, et son nom au cas où ils changent) et l'heure de CE bus. Jamais la position.
export function rappelsBusPourLeServeur(liste = lire()) {
  return liste.flatMap((b) => rappelsValides(b.rappels).map((r) => ({
    code: b.code, ligneId: b.ligneId, ligne: b.ligne.nom, direction: b.direction,
    arret: b.arret.nom, ids: b.arret.ids.slice(0, 10), heure: r.heure, avance: r.avance,
    jours: r.repetition === "une" ? [lundiZero(r.jour)] : JOURS_DE[r.repetition], jour: r.repetition === "une" ? r.jour : null,
  }))).slice(0, MAX_RAPPELS);
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
  const nombreRappels = bus.reduce((n, b) => n + rappelsValides(b.rappels).length, 0);
  // Poser (ou remplacer) le rappel d'un bus précis ; le favori est ajouté s'il n'y est pas encore
  const poserRappel = (favori, rappel) => {
    let liste = lire();
    if (!liste.some((x) => idBus(x) === idBus(favori))) {
      const r = ajouterSansPerdre(liste, favori, idBus, MAXIMUM_LISTE);
      if (r.plein) return "plein";
      liste = r.liste;
    }
    ecrire(liste.map((x) => (idBus(x) !== idBus(favori) ? x
      : { ...x, rappel: undefined, rappels: [...rappelsValides(x.rappels).filter((a) => a.heure !== rappel.heure), rappel] })));
    return "pose";
  };
  const arreterRappel = (favori, heure) => ecrire(lire().map((x) => (idBus(x) !== idBus(favori) ? x
    : { ...x, rappel: undefined, rappels: rappelsValides(x.rappels).filter((a) => a.heure !== heure) })));
  return { bus, estFavori, basculer, retirer, poserRappel, arreterRappel, nombreRappels, maximum: MAXIMUM_LISTE };
}
