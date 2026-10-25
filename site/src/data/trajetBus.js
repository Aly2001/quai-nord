// =====================================================================
//  Le bus de N'IMPORTE QUEL point A à N'IMPORTE QUEL point B, avec les heures de passage
// =====================================================================
// Les horaires (fichier {ville}_horaires.json, préparé par charger_bus.py) :
//   debut   : le premier jour décrit (« 2026-10-21 ») ;
//   jours   : des calendriers, une suite de 0 et de 1 (un caractère par jour depuis debut) ;
//   departs : pour chaque parcours (dans le même ordre que reseau.parcours), { calendrier: [minutes de départ] }.
// L'heure à un arrêt = le départ du voyage au premier arrêt + la durée jusqu'à cet arrêt (parcours.minutes).
import { DOSSIER_BUS, RESEAUX_BUS, arretsProches, busDirects, distance, minutesAPied, rayonMarche } from "./bus";

const MINUTES_PAR_JOUR = 1440;
export const MARCHE_CONSEILLEE = 20;      // minutes : en dessous, sans bus direct, on conseille la marche

// ---------- Le fichier d'horaires d'une ville : téléchargé une fois, seulement quand on cherche un bus ----------
const enCours = new Map();
export function chargerHoraires(code) {
  if (!RESEAUX_BUS.includes(code)) return Promise.resolve(null);
  if (!enCours.has(code)) {
    enCours.set(code, fetch(`${DOSSIER_BUS}/${code}_horaires.json`)
      .then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((h) => { if (!h) enCours.delete(code); return h; }));
  }
  return enCours.get(code);
}

// ---------- Les dates ----------
const enJours = (iso) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000);
export const minutesEnHeure = (m) => {
  const j = ((Math.round(m) % MINUTES_PAR_JOUR) + MINUTES_PAR_JOUR) % MINUTES_PAR_JOUR;
  return `${String(Math.floor(j / 60)).padStart(2, "0")}:${String(j % 60).padStart(2, "0")}`;
};

// Les calendriers qui circulent ce jour-là (un ensemble de numéros, en texte comme dans le fichier)
export function calendriersDuJour(horaires, dateIso) {
  const actifs = new Set();
  if (!horaires?.debut) return actifs;
  const rang = enJours(dateIso) - enJours(horaires.debut);
  horaires.jours.forEach((motif, n) => { if (rang >= 0 && motif[rang] === "1") actifs.add(String(n)); });
  return actifs;
}

// ---------- Les prochains passages d'une ligne, d'un arrêt à un autre ----------
// Tous les parcours de la ligne qui passent par idDepart PUIS par idArrivee comptent (une ligne a souvent
// plusieurs variantes). Les voyages de la veille qui roulent après minuit (« 25:10 ») comptent aussi.
// Renvoie [{ depart, arrivee }] en minutes depuis minuit du jour demandé, à partir de « apres ».
export function prochainsPassages(reseau, horaires, ligneId, idDepart, idArrivee, dateIso, apres, nombre = 3) {
  if (!horaires) return [];
  const aujourdhui = calendriersDuJour(horaires, dateIso);
  const hier = calendriersDuJour(horaires, new Date(Date.UTC(...dateIso.split("-").map((x, i) => (i === 1 ? x - 1 : +x))) - 86_400_000)
    .toISOString().slice(0, 10));
  const passages = new Map();
  reseau.parcours.forEach((p, k) => {
    if (p.ligne !== ligneId) return;
    const i = p.arrets.indexOf(idDepart);
    const j = p.arrets.indexOf(idArrivee, i + 1);
    if (i < 0 || j < 0) return;
    const aI = p.minutes ? p.minutes[i] : i * 2;
    const aJ = p.minutes ? p.minutes[j] : j * 2;
    for (const [calendrier, departs] of Object.entries(horaires.departs[k] || {})) {
      for (const [actifs, decalage] of [[aujourdhui, 0], [hier, -MINUTES_PAR_JOUR]]) {
        if (!actifs.has(calendrier)) continue;
        for (const d of departs) {
          const depart = d + aI + decalage;
          // origine : le départ de la course à son premier arrêt (pour afficher toute la course)
          if (depart >= apres && depart < MINUTES_PAR_JOUR * 1.5) {
            passages.set(depart, { depart, arrivee: depart + (aJ - aI), parcours: k, montee: i, descente: j, origine: d + decalage });
          }
        }
      }
    }
  });
  return [...passages.values()].sort((x, y) => x.depart - y.depart).slice(0, nombre);
}

// ---------- Le trajet complet : de A à B ----------
// A et B : { lat, lon, cat? }. maintenant : minutes depuis minuit. Renvoie :
//   { metres, minutesAPied, bus, conseil, lendemain }, avec conseil :
//   "bus"        : un bus fait gagner du temps ;
//   "pied"       : à pied, c'est plus rapide (bus : les bus possibles, s'il y en a, plus lents) ;
//   "demain"     : une ligne directe existe, mais plus aucun bus aujourd'hui (lendemain : le premier de demain) ;
//   "aucun"      : aucune ligne directe, et c'est loin à pied.
const lendemainIso = (iso) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + 1)).toISOString().slice(0, 10);

export function trajetEntrePoints(reseau, horaires, A, B, dateIso, maintenant, nombre = 12) {
  const metres = Math.round(distance(A.lat, A.lon, B.lat, B.lon));
  const aPied = minutesAPied(metres);
  const prochesA = arretsProches(reseau, A.lat, A.lon, rayonMarche(A.cat));
  const idsA = new Set(prochesA.map(([id]) => id));
  // Les arrêts du côté de B, sans ceux qui sont aussi près de A (monter et descendre au même endroit)
  const prochesB = arretsProches(reseau, B.lat, B.lon, rayonMarche(B.cat)).filter(([id]) => !idsA.has(id));

  // TOUTES les lignes directes (jusqu'à 12) : c'est au voyageur de choisir, on conseille seulement la plus rapide
  const lignes = busDirects(reseau, prochesA, prochesB, 12).map((b) => {
    const marcheAvant = minutesAPied(b.depart.marche);
    const marcheApres = minutesAPied(b.arrivee.marche);
    const passages = prochainsPassages(reseau, horaires, b.ligneId, b.depart.id, b.arrivee.id, dateIso, maintenant + marcheAvant);
    const premier = passages[0];
    return { ...b, marcheAvant, marcheApres, passages, arriveeFinale: premier ? premier.arrivee + marcheApres : null };
  });
  const duree = (b) => (b.arriveeFinale === null ? b.minutesTotal : b.arriveeFinale - maintenant);
  // Sans fichier d'horaires, on garde les lignes (sans heures) ; avec, il faut un bus aujourd'hui
  const aujourdhui = lignes.filter((b) => !horaires || b.passages.length > 0).sort((x, y) => duree(x) - duree(y));
  const plusRapides = aujourdhui.filter((b) => duree(b) < aPied);

  if (plusRapides.length) return { metres, minutesAPied: aPied, bus: aujourdhui.slice(0, nombre), conseil: "bus" };
  if (aujourdhui.length) return { metres, minutesAPied: aPied, bus: aujourdhui.slice(0, nombre), conseil: "pied" };
  if (lignes.length && horaires && aPied > MARCHE_CONSEILLEE) {
    // Une ligne existe, mais plus de bus aujourd'hui : le premier de demain
    const demain = lendemainIso(dateIso);
    const premiers = lignes.map((b) => ({ ...b, passages: prochainsPassages(reseau, horaires, b.ligneId, b.depart.id, b.arrivee.id, demain, 0, 1) }))
      .filter((b) => b.passages.length).sort((x, y) => x.passages[0].depart - y.passages[0].depart);
    if (premiers.length) return { metres, minutesAPied: aPied, bus: [], conseil: "demain", lendemain: premiers[0] };
  }
  return { metres, minutesAPied: aPied, bus: [], conseil: aPied <= MARCHE_CONSEILLEE ? "pied" : "aucun" };
}

// ---------- Le détail d'une course : tous ses arrêts, avec l'heure de passage ----------
// role : « avant » (avant la montée), « montee », « trajet », « descente », « apres »
export function arretsDeLaCourse(reseau, passage, joli = (n) => n) {
  const p = reseau.parcours[passage.parcours];
  return p.arrets.map((id, x) => ({
    id,
    nom: joli(reseau.arrets[id]?.[0] || id),
    minute: passage.origine + (p.minutes ? p.minutes[x] : x * 2),
    role: x < passage.montee ? "avant" : x === passage.montee ? "montee" : x < passage.descente ? "trajet"
      : x === passage.descente ? "descente" : "apres",
  }));
}
