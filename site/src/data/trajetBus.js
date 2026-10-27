// =====================================================================
//  Le bus de N'IMPORTE QUEL point A à N'IMPORTE QUEL point B, avec les heures de passage
// =====================================================================
// Les horaires (fichier {ville}_horaires.json, préparé par charger_bus.py) :
//   debut   : le premier jour décrit (« 2026-10-21 ») ;
//   jours   : des calendriers, une suite de 0 et de 1 (un caractère par jour depuis debut) ;
//   departs : pour chaque parcours (dans le même ordre que reseau.parcours), { calendrier: [minutes de départ] }.
// L'heure à un arrêt = le départ du voyage au premier arrêt + la durée jusqu'à cet arrêt (parcours.minutes).
import { DOSSIER_BUS, RESEAUX_BUS, arretsProches, busDirects, distance, minutesAPied, rayonMarche, joliNom } from "./bus";

const MINUTES_PAR_JOUR = 1440;
export const MARCHE_CONSEILLEE = 20;      // minutes : en dessous, sans bus direct, on conseille la marche
export const MARGE_ARRET = 2;             // minutes : on vise d'être à l'arrêt au moins 2 min AVANT le bus

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
  // Un arrêt qui porte le NOM de la destination (« rue Pascal » -> l'arrêt Pascal) compte aussi, jusqu'à 1,2 km :
  // une rue entière est placée en son milieu, et son arrêt peut être à un bout
  const idsB = new Set(prochesB.map(([id]) => id));
  for (const [id, m] of arretsNommesComme(reseau, B)) if (!idsB.has(id) && !idsA.has(id)) { prochesB.push([id, m]); idsB.add(id); }
  const descentes = new Map(prochesB);           // les arrêts où l'on peut descendre, et la marche jusqu'à B (mètres)

  // TOUTES les lignes directes (jusqu'à 12) : c'est au voyageur de choisir, on conseille seulement la plus rapide
  const lignes = busDirects(reseau, prochesA, prochesB, 12).map((b) => {
    const marcheAvant = minutesAPied(b.depart.marche);
    const marcheApres = minutesAPied(b.arrivee.marche);
    // Un bus qu'on attraperait de justesse n'est pas proposé : il faut être à l'arrêt avec un peu de marge
    const passages = prochainsPassages(reseau, horaires, b.ligneId, b.depart.id, b.arrivee.id, dateIso, maintenant + marcheAvant + MARGE_ARRET);
    const premier = passages[0];
    return { ...b, marcheAvant, marcheApres, passages, arriveeFinale: premier ? premier.arrivee + marcheApres : null };
  });
  const duree = (b) => (b.arriveeFinale === null ? b.minutesTotal : b.arriveeFinale - maintenant);
  // Sans fichier d'horaires, on garde les lignes (sans heures) ; avec, il faut un bus aujourd'hui
  const aujourdhui = lignes.filter((b) => !horaires || b.passages.length > 0).sort((x, y) => duree(x) - duree(y));
  const plusRapides = aujourdhui.filter((b) => duree(b) < aPied);

  if (plusRapides.length) return { metres, minutesAPied: aPied, bus: aujourdhui.slice(0, nombre), conseil: "bus", descentes };
  if (aujourdhui.length) return { metres, minutesAPied: aPied, bus: aujourdhui.slice(0, nombre), conseil: "pied", descentes };
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

// ---------- Le panneau d'un arrêt : les prochains passages, ligne par ligne ----------
// ids : les identifiants d'un même arrêt (ses différents quais). Renvoie, pour chaque ligne et direction,
// les prochains passages : [{ ligne, direction, ligneId, heures: [minutes] }], du plus proche au plus lointain.
export function passagesALArret(reseau, horaires, ids, dateIso, apres, parLigne = 2) {
  if (!horaires) return [];
  const aujourdhui = calendriersDuJour(horaires, dateIso);
  const veille = new Date(Date.UTC(+dateIso.slice(0, 4), +dateIso.slice(5, 7) - 1, +dateIso.slice(8, 10) - 1)).toISOString().slice(0, 10);
  const hier = calendriersDuJour(horaires, veille);
  const quais = new Set(ids);
  const groupes = new Map();
  reseau.parcours.forEach((p, k) => {
    p.arrets.forEach((id, i) => {
      if (!quais.has(id) || i === p.arrets.length - 1) return;       // au terminus, le bus ne repart pas
      const decalageArret = p.minutes ? p.minutes[i] : i * 2;
      const ligne = reseau.lignes[p.ligne];
      const direction = joliNom(p.direction);
      const cle = `${p.ligne}|${direction}`;
      const groupe = groupes.get(cle) || { ligneId: p.ligne, ligne, direction, heures: new Set() };
      for (const [calendrier, departs] of Object.entries(horaires.departs[k] || {})) {
        for (const [actifs, decalage] of [[aujourdhui, 0], [hier, -MINUTES_PAR_JOUR]]) {
          if (!actifs.has(calendrier)) continue;
          for (const d of departs) {
            const m = d + decalageArret + decalage;
            if (m >= apres && m < apres + 180) groupe.heures.add(m);   // les 3 prochaines heures
          }
        }
      }
      groupes.set(cle, groupe);
    });
  });
  return [...groupes.values()]
    .map((g) => ({ ...g, heures: [...g.heures].sort((a, b) => a - b).slice(0, parLigne) }))
    .filter((g) => g.heures.length)
    .sort((a, b) => a.heures[0] - b.heures[0]);
}

// Les arrêts proches d'un point, regroupés par nom (plusieurs quais = un seul arrêt), du plus proche au plus loin
export function arretsAutour(reseau, lat, lon, rayon = 600) {
  const groupes = new Map();
  for (const [id, metres] of arretsProches(reseau, lat, lon, rayon)) {
    const nom = joliNom(reseau.arrets[id][0]);
    const g = groupes.get(nom) || { nom, ids: [], metres };
    g.ids.push(id);
    g.metres = Math.min(g.metres, metres);
    groupes.set(nom, g);
  }
  return [...groupes.values()].sort((a, b) => a.metres - b.metres);
}

// ---------- Le DIRECT des bus (Lille pour l'instant) ----------
// Le serveur renvoie, pour chaque « ligne|arrêt », les heures ATTENDUES (en secondes) des prochains bus.
// On les relie à nos horaires prévus : pour chaque passage prévu, l'heure attendue la plus proche
// (entre 3 min d'avance et 30 min de retard), chacune utilisée une seule fois.
export const RESEAUX_EN_DIRECT = ["lille"];
const directEnCours = new Map();
export function chargerDirectBus(code) {
  if (!RESEAUX_EN_DIRECT.includes(code)) return Promise.resolve(null);
  const garde = directEnCours.get(code);
  if (garde && Date.now() - garde.a < 60_000) return garde.promesse;
  const promesse = fetch(`/api/bus-direct/${code}?t=${Date.now()}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  directEnCours.set(code, { a: Date.now(), promesse });
  return promesse;
}

// Minuit (heure locale) du jour, en secondes : pour passer des minutes du jour aux heures du flux
const minuitDe = (dateIso) => new Date(`${dateIso}T00:00:00`).getTime() / 1000;

// Les heures attendues pour une liste de minutes prévues : [{ prevue, attendue|null }]
export function relierAuDirect(prevues, attendues, dateIso) {
  if (!attendues?.length) return prevues.map((prevue) => ({ prevue, attendue: null }));
  const minuit = minuitDe(dateIso);
  const libres = attendues.map((sec) => (sec - minuit) / 60);
  const pris = new Set();
  return prevues.map((prevue) => {
    let meilleure = -1;
    libres.forEach((m, i) => {
      const ecart = m - prevue;
      if (pris.has(i) || ecart < -3 || ecart > 30) return;
      if (meilleure < 0 || Math.abs(ecart) < Math.abs(libres[meilleure] - prevue)) meilleure = i;
    });
    if (meilleure < 0) return { prevue, attendue: null };
    pris.add(meilleure);
    return { prevue, attendue: Math.round(libres[meilleure]) };
  });
}

// Un bus proposé, avec le direct : ses passages prennent l'heure attendue (et gardent l'heure prévue)
export function busAvecDirect(b, direct, dateIso) {
  if (!direct) return b;
  const liens = relierAuDirect(b.passages.map((p) => p.depart), direct.passages[`${b.ligneId}|${b.depart.id}`], dateIso);
  const passages = b.passages.map((p, i) => {
    const attendue = liens[i].attendue;
    if (attendue === null) return p;
    const retard = attendue - p.depart;
    return { ...p, prevue: p.depart, depart: attendue, arrivee: p.arrivee + retard, origine: p.origine + retard, direct: true };
  });
  const premier = passages[0];
  return { ...b, passages, arriveeFinale: premier ? premier.arrivee + b.marcheApres : b.arriveeFinale };
}

// Les arrêts dont le nom reprend un mot distinctif de la destination (« rue Pascal » -> « Pascal »), à 1,2 km au plus
const MOTS_GENERIQUES = new Set(["rue", "avenue", "boulevard", "place", "chemin", "route", "allee", "impasse", "quai",
  "square", "cours", "de", "du", "des", "la", "le", "les", "l", "d", "et", "saint", "sainte", "gare"]);
export function arretsNommesComme(reseau, B, rayon = 1200) {
  const motsB = joliNom(B.nom || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .split(/[^a-z0-9]+/).filter((m) => m.length >= 4 && !MOTS_GENERIQUES.has(m));
  if (!motsB.length || B.lat === undefined) return [];
  const resultat = [];
  for (const [id, [nom, lat, lon]] of Object.entries(reseau.arrets)) {
    const motsArret = nom.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9]+/);
    if (!motsB.some((m) => motsArret.includes(m))) continue;
    const m = Math.round(distance(B.lat, B.lon, lat, lon));
    if (m <= rayon) resultat.push([id, m]);
  }
  return resultat;
}

// Les AUTRES arrêts où descendre du même bus, avec l'heure et la marche jusqu'à la destination :
// [{ nom, minute, marche }] — pour proposer « ou descendez à Pascal », du plus tôt arrivé au plus tard
export function autresDescentes(reseau, b, descentes) {
  const p = b.passages?.[0];
  if (!p || p.parcours === undefined || !descentes) return [];
  const parcours = reseau.parcours[p.parcours];
  const options = [];
  parcours.arrets.forEach((id, x) => {
    if (x <= p.montee || id === b.arrivee.id || !descentes.has(id)) return;
    const minute = p.origine + (parcours.minutes ? parcours.minutes[x] : x * 2);
    const marche = minutesAPied(descentes.get(id));
    options.push({ id, nom: joliNom(reseau.arrets[id][0]), minute, marche, arriveeFinale: minute + marche });
  });
  return options.sort((x, y) => x.arriveeFinale - y.arriveeFinale).slice(0, 2);
}
