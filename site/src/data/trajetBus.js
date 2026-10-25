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
          if (depart >= apres && depart < MINUTES_PAR_JOUR * 1.5) passages.set(depart, { depart, arrivee: depart + (aJ - aI) });
        }
      }
    }
  });
  return [...passages.values()].sort((x, y) => x.depart - y.depart).slice(0, nombre);
}

// ---------- Le trajet complet : de A à B ----------
// A et B : { lat, lon, cat? }. maintenant : minutes depuis minuit. Renvoie :
//   { metres, minutesAPied, bus: [proposition avec ses prochains passages], conseil: "bus" | "pied" | "aucun" }
export function trajetEntrePoints(reseau, horaires, A, B, dateIso, maintenant, nombre = 3) {
  const metres = Math.round(distance(A.lat, A.lon, B.lat, B.lon));
  const aPied = minutesAPied(metres);
  const prochesA = arretsProches(reseau, A.lat, A.lon, rayonMarche(A.cat));
  const idsA = new Set(prochesA.map(([id]) => id));
  // Les arrêts du côté de B, sans ceux qui sont aussi près de A (monter et descendre au même endroit)
  const prochesB = arretsProches(reseau, B.lat, B.lon, rayonMarche(B.cat)).filter(([id]) => !idsA.has(id));

  const bus = busDirects(reseau, prochesA, prochesB, 6)
    .map((b) => {
      const marcheAvant = minutesAPied(b.depart.marche);
      const marcheApres = minutesAPied(b.arrivee.marche);
      const passages = prochainsPassages(reseau, horaires, b.ligneId, b.depart.id, b.arrivee.id, dateIso, maintenant + marcheAvant);
      const premier = passages[0];
      return { ...b, marcheAvant, marcheApres, passages, arriveeFinale: premier ? premier.arrivee + marcheApres : null };
    })
    // Sans horaires (fichier absent) on garde la proposition ; avec, il faut un bus aujourd'hui
    .filter((b) => !horaires || b.passages.length > 0)
    // Le bus doit faire gagner du temps sur la marche (départ attendu compris)
    .filter((b) => (b.arriveeFinale === null ? b.minutesTotal : b.arriveeFinale - maintenant) < aPied)
    .sort((x, y) => (x.arriveeFinale ?? x.minutesTotal) - (y.arriveeFinale ?? y.minutesTotal))
    .slice(0, nombre);

  const conseil = bus.length ? "bus" : aPied <= MARCHE_CONSEILLEE ? "pied" : "aucun";
  return { metres, minutesAPied: aPied, bus, conseil };
}
