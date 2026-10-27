// =====================================================================
//  LES TRAINS SUIVIS : un geste (« Suivre ce train »), puis Quai Nord s'occupe du reste.
//   - « une fois »   : un voyage ponctuel ; il disparaît tout seul 30 min après l'arrivée du train ;
//   - « semaine »    : un train habituel, suivi du lundi au vendredi.
//  Chaque train suivi peut avoir son « aller à la gare » : d'où l'on part, et l'itinéraire choisi.
//  Tout reste sur l'appareil (stockage local) : pas de compte, rien n'est envoyé.
// =====================================================================
import { useEffect, useState } from "react";
import { busDirects, arretsProches, distance, minutesAPied, rayonMarche } from "./bus";
import { prochainsPassages, MARGE_ARRET } from "./trajetBus";
import { synchroniserNotifications, trainsPourLeServeur } from "./notifications";

const CLE = "quai-nord:trains-suivis";
const EVENEMENT = "quai-nord:suivis-modifies";
const MAXIMUM = 5;
export const APRES_ARRIVEE = 30;                  // minutes : un voyage ponctuel est oublié 30 min après l'arrivée
export const BOUGE = 300;                         // mètres : au-delà, « vous n'êtes plus au même endroit »

// ---------- Les heures et les jours ----------
export const enMinutesDuJour = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const jourSuivant = (iso) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + 1); return isoLocal(d); };
const estEnSemaine = (iso) => { const j = new Date(`${iso}T12:00:00`).getDay(); return j >= 1 && j <= 5; };
// L'heure d'arrivée peut passer minuit (« 23:50 → 00:40 ») : on compte alors 24 h de plus
const arriveeEnMinutes = (s) => { const a = enMinutesDuJour(s.arrivee); return a < enMinutesDuJour(s.heure) ? a + 1440 : a; };

export const idSuivi = (s) => `${s.de}|${s.a}|${s.heure}|${s.repetition === "semaine" ? "semaine" : s.jour}`;

// Le PROCHAIN jour où ce train suivi circule, à partir de maintenant (ou null s'il est passé)
export function prochaineOccasion(suivi, maintenant = new Date()) {
  const aujourdhui = isoLocal(maintenant);
  const minutes = maintenant.getHours() * 60 + maintenant.getMinutes();
  if (suivi.repetition !== "semaine") {
    if (suivi.jour > aujourdhui) return suivi.jour;
    if (suivi.jour === aujourdhui && minutes <= arriveeEnMinutes(suivi) + APRES_ARRIVEE) return suivi.jour;
    return null;
  }
  let jour = aujourdhui;
  // aujourd'hui, si c'est un jour de semaine et que le train n'est pas encore arrivé ; sinon le prochain jour de semaine
  if (!(estEnSemaine(jour) && minutes <= arriveeEnMinutes(suivi) + APRES_ARRIVEE)) {
    do { jour = jourSuivant(jour); } while (!estEnSemaine(jour));
  }
  return jour;
}

// Le ménage : les voyages ponctuels passés disparaissent. Renvoie { gardes, retires }.
export function nettoyer(suivis, maintenant = new Date()) {
  const gardes = [], retires = [];
  for (const s of suivis) (prochaineOccasion(s, maintenant) ? gardes : retires).push(s);
  return { gardes, retires };
}

// Le prochain train suivi, tous trains confondus : { suivi, jour, depart } (depart : une Date), ou null
export function prochainTrainSuivi(suivis, maintenant = new Date()) {
  let meilleur = null;
  for (const suivi of suivis) {
    const jour = prochaineOccasion(suivi, maintenant);
    if (!jour) continue;
    const depart = new Date(`${jour}T${suivi.heure}:00`);
    if (!meilleur || depart < meilleur.depart) meilleur = { suivi, jour, depart };
  }
  return meilleur;
}

// ---------- Où en est le voyage, maintenant ? (la même règle partout : Favoris, accueil, écran Partir) ----------
//   « avant »   : il est encore temps ; on affiche l'heure de départ de chez soi ;
//   « presse »  : l'heure de départ de chez soi est passée, le train n'est pas encore parti ;
//   « enroute » : le train est parti, il n'est pas encore arrivé ;
//   « arrive »  : il est arrivé (le voyage d'un jour disparaît 30 min plus tard) ;
//   « autrejour » : le voyage est un autre jour (demain, lundi…).
export function etapeDuVoyage(suivi, jour, maintenant = new Date()) {
  if (!jour || jour !== isoLocal(maintenant)) return { etape: "autrejour" };
  const minutes = maintenant.getHours() * 60 + maintenant.getMinutes();
  const depart = enMinutesDuJour(suivi.heure);
  const arrivee = arriveeEnMinutes(suivi);
  const partirDeChezSoi = suivi.aller?.departMaison;
  if (minutes >= arrivee) return { etape: "arrive" };
  if (minutes >= depart) return { etape: "enroute", minutes: arrivee - minutes };
  if (partirDeChezSoi !== undefined && minutes >= partirDeChezSoi) return { etape: "presse", minutes: depart - minutes };
  return { etape: "avant", minutes: partirDeChezSoi !== undefined ? partirDeChezSoi - minutes : depart - minutes };
}

// ---------- L'aller à la gare : arriver AVANT le train, avec une marge ----------
// Grande gare (Lille, Amiens, Paris…) : 10 min pour trouver son quai ; petite gare : 5 min.
const GRANDES_GARES = /lille|amiens|paris|arras|dunkerque|calais ville|douai|lens|valenciennes|creil|saint-quentin|beauvais|compi/i;
export const margeEnGare = (nomGare) => (GRANDES_GARES.test(nomGare || "") ? 10 : 5);

// Le meilleur moyen d'être à la gare AU PLUS TARD à « limite » (minutes du jour), en partant de A :
//   { mode: "bus", ligne, direction, arretDepart, arretArrivee, heureBus, arriveeGare, departMaison, marcheAvant, marcheApres }
//   { mode: "pied", departMaison, arriveeGare, marche }
// On prend le DERNIER bus qui arrive à temps (on ne fait pas partir le voyageur trop tôt pour rien),
// et la marche quand elle reste raisonnable (20 min) ou qu'aucun bus n'arrive à temps.
export const TRES_LOIN = 15_000;          // mètres : au-delà, on n'est pas dans la ville de la gare
export const MARCHE_MAX = 45;            // minutes : au-delà, on ne conseille plus la marche

// Quand l'aller n'a pas de sens, on le dit au lieu d'inventer :
//   { mode: "loin", metres }   : on est dans une autre ville (il faut d'abord un train, ou une autre adresse) ;
//   { mode: "aucun", marche, metres } : pas de bus direct, et trop loin à pied.
export function allerALaGare(reseau, horaires, A, gare, dateIso, limite) {
  const metres = Math.round(distance(A.lat, A.lon, gare.lat, gare.lon));
  if (metres > TRES_LOIN) return { mode: "loin", metres };
  const aPied = minutesAPied(metres);
  const pied = { mode: "pied", marche: aPied, arriveeGare: limite, departMaison: limite - aPied, metres };
  const aucun = { mode: "aucun", marche: aPied, metres };
  if (!reseau || !horaires) return aPied <= MARCHE_MAX ? pied : aucun;
  const prochesA = arretsProches(reseau, A.lat, A.lon, rayonMarche(A.cat));
  const idsA = new Set(prochesA.map(([id]) => id));
  const prochesGare = arretsProches(reseau, gare.lat, gare.lon, rayonMarche("gare")).filter(([id]) => !idsA.has(id));
  let meilleur = null;
  for (const b of busDirects(reseau, prochesA, prochesGare, 12)) {
    const marcheAvant = minutesAPied(b.depart.marche);
    const marcheApres = minutesAPied(b.arrivee.marche);
    const passages = prochainsPassages(reseau, horaires, b.ligneId, b.depart.id, b.arrivee.id, dateIso, 0, 400);
    const aTemps = passages.filter((p) => p.arrivee + marcheApres <= limite);
    const dernier = aTemps[aTemps.length - 1];
    if (!dernier) continue;
    const option = {
      mode: "bus", ligne: b.ligne, ligneId: b.ligneId, direction: b.direction, arrets: b.arrets,
      arretDepart: b.depart, arretArrivee: b.arrivee, heureBus: dernier.depart, arriveeGare: dernier.arrivee + marcheApres,
      departMaison: dernier.depart - marcheAvant - MARGE_ARRET, marcheAvant, marcheApres,
    };
    if (!meilleur || option.departMaison > meilleur.departMaison) meilleur = option;
  }
  if (!meilleur) return aPied <= MARCHE_MAX ? pied : aucun;
  // À pied, c'est plus simple quand c'est court, ou quand le bus ne fait presque rien gagner
  if (aPied <= 15 || (aPied <= MARCHE_MAX && pied.departMaison >= meilleur.departMaison)) return pied;
  return meilleur;
}

// ---------- Le stockage ----------
function lire() {
  try {
    const liste = JSON.parse(localStorage.getItem(CLE) || "[]");
    return Array.isArray(liste) ? liste : [];
  } catch {
    return [];
  }
}
function ecrire(liste) {
  try { localStorage.setItem(CLE, JSON.stringify(liste)); } catch { /* stockage indisponible */ }
  window.dispatchEvent(new Event(EVENEMENT));
  synchroniserNotifications(trainsPourLeServeur(liste, idSuivi));     // le serveur des alertes, s'il est utilisé
}
export const trainsSuivisPourLeServeur = () => trainsPourLeServeur(lire(), idSuivi);

export function useSuivis() {
  const [etat, setEtat] = useState(() => {
    const { gardes, retires } = nettoyer(lire());
    if (retires.length) { try { localStorage.setItem(CLE, JSON.stringify(gardes)); } catch { /* tant pis */ } }
    return { suivis: gardes, retires };
  });
  useEffect(() => {
    const relire = () => setEtat((e) => ({ ...e, suivis: nettoyer(lire()).gardes }));
    window.addEventListener(EVENEMENT, relire);
    window.addEventListener("storage", relire);
    return () => { window.removeEventListener(EVENEMENT, relire); window.removeEventListener("storage", relire); };
  }, []);

  const suivre = (suivi) => {
    const liste = lire().filter((s) => idSuivi(s) !== idSuivi(suivi));
    ecrire([suivi, ...liste].slice(0, MAXIMUM));
  };
  const nePlusSuivre = (suivi) => ecrire(lire().filter((s) => idSuivi(s) !== idSuivi(suivi)));
  const toutArreter = () => ecrire([]);
  const enregistrerAller = (suivi, aller) => ecrire(lire().map((s) => (idSuivi(s) === idSuivi(suivi) ? { ...s, aller } : s)));
  const trouver = (id) => etat.suivis.find((s) => idSuivi(s) === id) || null;
  const estSuivi = (de, a, heure) => etat.suivis.some((s) => s.de === de && s.a === a && s.heure === heure);

  return { ...etat, suivre, nePlusSuivre, toutArreter, enregistrerAller, trouver, estSuivi };
}
