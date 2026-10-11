// Outils partagés pour lire les horaires exportés par exporter_horaires.py
import { useEffect, useState } from "react";

export const DOSSIER = `${import.meta.env.BASE_URL}horaires`;   // = "/horaires" en local

// ---------- Un HOOK personnalisé : charge gares.json une seule fois ----------
// Un hook est une fonction qui commence par "use" et qui utilise useState / useEffect.
// Plusieurs pages peuvent l'appeler : le fichier n'est téléchargé qu'une fois (cache).
let cache = null;

export function useIndexHoraires() {
  const [index, setIndex] = useState(cache);
  const [erreur, setErreur] = useState(null);

  useEffect(() => {
    if (cache) return;
    fetch(`${DOSSIER}/gares.json`)
      .then((reponse) => reponse.json())
      .then((donnees) => { cache = donnees; setIndex(donnees); })
      .catch(() => setErreur("Horaires introuvables : lance python exporter_horaires.py dans le dossier projet-sncf."));
  }, []);

  return { index, erreur };
}

// ---------- Texte ----------
// "Lille-Flandres" et "lille flandres" deviennent tous les deux "lille flandres"
export function normaliser(texte) {
  return (texte || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")   // enlève les accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Trouve une gare à partir de ce que l'utilisateur a tapé
export function trouverGare(gares, texte) {
  const cherche = normaliser(texte);
  if (!cherche) return null;
  return (
    gares.find((g) => normaliser(g.nom) === cherche) ||          // nom exact
    gares.find((g) => normaliser(g.nom).startsWith(cherche)) ||  // début du nom
    gares.find((g) => normaliser(g.nom).includes(cherche)) ||    // n'importe où
    null
  );
}

// ---------- Dates ----------
function versIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function aujourdhuiIso() {
  return versIso(new Date());
}

export function ajouterJours(dateIso, nombre) {
  const d = new Date(dateIso + "T12:00:00");
  d.setDate(d.getDate() + nombre);
  return versIso(d);
}

// On reste sur l'actualité : aujourd'hui, demain et après-demain seulement.
// Un jour passé disparaît tout seul, même si l'export est ancien.
export function joursAVenir(jours) {
  const auj = aujourdhuiIso();
  const limite = ajouterJours(auj, 2);
  return jours.filter((j) => j >= auj && j <= limite);
}

export function jourParDefaut(jours) {
  return joursAVenir(jours)[0] || null;
}

export function etiquetteJour(dateIso) {
  const auj = aujourdhuiIso();
  if (dateIso === auj) return "Aujourd'hui";
  if (dateIso === ajouterJours(auj, 1)) return "Demain";
  if (dateIso === ajouterJours(auj, 2)) return "Après-demain";
  return dateCourte(dateIso);
}

export function dateLongue(dateIso) {
  return new Date(dateIso + "T12:00:00").toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long",
  });
}

export function dateCourte(dateIso) {
  return new Date(dateIso + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

// ---------- Heures ----------
export function heureActuelle() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Durée entre deux heures "HH:MM", en gérant le passage de minuit
export function duree(depart, arrivee) {
  const enMinutes = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
  let minutes = enMinutes(arrivee) - enMinutes(depart);
  if (minutes < 0) minutes += 24 * 60;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
}

// ---------- Risque de retard ----------
// risques.json est créé par exporter_risques.py. S'il n'existe pas encore,
// le site fonctionne quand même : les barres affichent « pas assez de données ».
let cacheRisques = undefined;

export function useRisques() {
  const [risques, setRisques] = useState(cacheRisques ?? null);

  useEffect(() => {
    if (cacheRisques !== undefined) return;
    fetch(`${DOSSIER}/risques.json`)
      .then((reponse) => reponse.json())
      .then((donnees) => { cacheRisques = donnees; setRisques(donnees); })
      .catch(() => { cacheRisques = null; });
  }, []);

  return risques;
}

// Choisit la mesure la plus précise disponible pour un train :
// 1. ce train précis   2. sa ligne à cette heure   3. tous les trains à cette heure
export function risqueDuTrain(risques, train) {
  if (!risques) return null;
  const heure = train.heure.slice(0, 2);

  const parTrain = risques.par_train[train.numero];
  if (parTrain) return { ...parTrain, source: "ce train" };

  const parLigne = train.ligne && risques.par_ligne_heure[`${train.ligne}|${heure}`];
  if (parLigne) return { ...parLigne, source: `la ligne ${train.ligne} vers ${Number(heure)} h` };

  const parHeure = risques.par_heure[heure];
  if (parHeure) return { ...parHeure, source: `les trains de ${Number(heure)} h` };

  return null;
}

// Niveau de risque en mots, selon le pourcentage
export function niveauRisque(pourcentage) {
  if (pourcentage >= 30) return { mot: "Élevé", classe: "eleve" };
  if (pourcentage >= 15) return { mot: "Modéré", classe: "modere" };
  return { mot: "Faible", classe: "faible" };
}

// ---------- Météo prévue (meteo.json, écrit par collecter_meteo.py) ----------
let cacheMeteo = undefined;

export function useMeteo() {
  const [meteo, setMeteo] = useState(cacheMeteo ?? null);
  useEffect(() => {
    if (cacheMeteo !== undefined) return;
    fetch(`${DOSSIER}/meteo.json`)
      .then((reponse) => reponse.json())
      .then((donnees) => { cacheMeteo = donnees; setMeteo(donnees); })
      .catch(() => { cacheMeteo = null; });
  }, []);
  return meteo;
}

// La météo au départ d'un train. La pluie de 8 h = pluie tombée entre 7 h et 8 h :
// pour un départ à 7 h 24, on prend donc la ligne de 8 h.
export function meteoDuTrain(meteo, stopId, jour, heure) {
  const point = meteo?.gares[stopId];
  if (!point) return null;
  let h = Number(heure.slice(0, 2)) + (heure.slice(3, 5) !== "00" ? 1 : 0);
  if (h > 23) h = 23;
  const valeurs = meteo.points[point]?.[`${jour}T${String(h).padStart(2, "0")}`];
  if (!valeurs) return null;
  const [pluie, neige, temperature, rafales] = valeurs;
  return { point, pluie, neige, temperature, rafales };
}

// ---------- Temps réel (temps_reel.json, écrit par le collecteur toutes les 5 min) ----------
// actif = true seulement pour aujourd'hui. Le fichier est relu toutes les minutes.
export function useTempsReel(actif) {
  const [tempsReel, setTempsReel] = useState(null);

  useEffect(() => {
    if (!actif) { setTempsReel(null); return; }
    let annule = false;
    function charger() {
      // ?t=... : évite que le navigateur garde une ancienne version en mémoire
      fetch(`${DOSSIER}/temps_reel.json?t=${Date.now()}`)
        .then((reponse) => reponse.json())
        .then((donnees) => { if (!annule) setTempsReel(donnees); })
        .catch(() => {});
    }
    charger();
    const minuteur = setInterval(charger, 60_000);
    // Nettoyage : quand on quitte la page, on arrête le minuteur
    return () => { annule = true; clearInterval(minuteur); };
  }, [actif]);

  return tempsReel;
}

// Le temps réel n'est affiché que s'il a moins de 15 minutes
export function tempsReelFrais(tempsReel) {
  return tempsReel && Date.now() / 1000 - tempsReel.maj < 15 * 60;
}

// L'état en direct d'un train entre sa gare de départ et sa gare d'arrivée
export function infoDirect(tempsReel, trainId, stopDepart, stopArrivee) {
  if (!tempsReelFrais(tempsReel)) return null;
  const train = tempsReel.trajets[trainId];
  if (!train) return null;                       // pas (encore) dans le flux : on ne sait rien
  const dep = train.arrets[stopDepart];
  const arr = train.arrets[stopArrivee];
  const supprime = train.statut === "SUPPRIME" || dep?.[2] === 1 || arr?.[2] === 1;
  return {
    supprime,
    retardDepart: dep ? (dep[1] ?? dep[0] ?? 0) : null,     // en secondes
    retardArrivee: arr ? (arr[0] ?? arr[1] ?? 0) : null,
  };
}

export function ajouterMinutes(heure, minutes) {
  const total = (Number(heure.slice(0, 2)) * 60 + Number(heure.slice(3, 5)) + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// ---------- Fraîcheur des données ----------
// "2026-10-11 04:05" -> objet Date
export function lireDate(texte) {
  return texte ? new Date(texte.replace(" ", "T")) : null;
}

export function formatMaj(date) {
  if (!date) return "inconnue";
  const jour = date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  const heure = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return `${jour} à ${heure}`;
}

export function ilYa(date) {
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  return `il y a ${Math.round(minutes / 60)} h`;
}

// =====================================================================
//  Recherche de trajets : directs et avec UNE correspondance
// =====================================================================
// Un trajet = une liste de « tronçons » (1 pour un direct, 2 avec correspondance).
// Chaque tronçon : un train, sa gare de départ, sa gare d'arrivée, les arrêts entre les deux.

export const CORRESPONDANCE_MIN = 5;    // minutes pour changer de train
export const CORRESPONDANCE_MAX = 90;   // au-delà, l'attente est trop longue

export function enMinutes(heure) {
  return Number(heure.slice(0, 2)) * 60 + Number(heure.slice(3, 5));
}

// Minutes entre deux heures, en gérant le passage de minuit
function ecart(debut, fin) {
  const m = enMinutes(fin) - enMinutes(debut);
  return m < 0 ? m + 24 * 60 : m;
}

// Position de la destination dans la suite d'un train (-1 si le train n'y va pas)
function positionVers(train, cible) {
  return train.suite.findIndex((s) => normaliser(s.gare).includes(cible));
}

function troncon(train, gareDepart, position) {
  const arret = train.suite[position];
  return {
    train,
    depart: { gare: gareDepart, heure: train.heure, stop_id: train.stop_id },
    arrivee: { gare: arret.gare, heure: arret.heure, stop_id: arret.stop_id },
    arrets: train.suite.slice(0, position),           // les gares entre les deux
  };
}

function assembler(troncons) {
  const premier = troncons[0];
  const dernier = troncons[troncons.length - 1];
  return {
    heure: premier.depart.heure,
    arrivee: dernier.arrivee.heure,
    gareDepart: premier.depart.gare,
    gareArrivee: dernier.arrivee.gare,
    dureeMin: ecart(premier.depart.heure, dernier.arrivee.heure),
    troncons,
    correspondance: troncons.length > 1
      ? { gare: premier.arrivee.gare, attente: ecart(premier.arrivee.heure, dernier.depart.heure) }
      : null,
  };
}

// 1. Les trains directs
export function trajetsDirects(departs, gareDepart, cible) {
  return departs.flatMap((train) => {
    const position = positionVers(train, cible);
    return position === -1 ? [] : [assembler([troncon(train, gareDepart, position)])];
  });
}

// 2. Les trajets avec une correspondance.
// fichiers : les départs des gares de correspondance, rangés par nom de gare
export function trajetsAvecCorrespondance(departs, gareDepart, cible, fichiers) {
  const resultats = [];
  for (const train1 of departs) {
    train1.suite.forEach((arret, i) => {
      const fichier = fichiers[arret.gare];                     // une gare de correspondance ?
      if (!fichier || normaliser(arret.gare).includes(cible)) return;
      for (const train2 of fichier.departs) {
        if (train2.trip_id === train1.trip_id) continue;        // pas le même train
        const attente = enMinutes(train2.heure) - enMinutes(arret.heure);
        if (attente < CORRESPONDANCE_MIN || attente > CORRESPONDANCE_MAX) continue;
        const position = positionVers(train2, cible);           // va-t-il à destination ?
        if (position === -1) continue;
        resultats.push(assembler([troncon(train1, gareDepart, i), troncon(train2, arret.gare, position)]));
      }
    });
  }
  return resultats;
}

// 3. Garder les meilleurs trajets
// Un trajet avec correspondance est « dominé » s'il existe un autre trajet qui part
// au même moment ou plus tard ET arrive au même moment ou plus tôt. On le retire.
// Les trains directs sont toujours gardés.
export function garderMeilleurs(directs, avecCorrespondance) {
  // Une seule version par couple (départ, arrivée) : celle qui laisse le plus de marge
  const uniques = new Map();
  for (const t of avecCorrespondance) {
    const cle = `${t.heure}|${t.arrivee}`;
    const deja = uniques.get(cle);
    if (!deja || t.correspondance.attente > deja.correspondance.attente) uniques.set(cle, t);
  }

  const tous = [...directs, ...uniques.values()];
  const bornes = (t) => ({ dep: enMinutes(t.heure), arr: enMinutes(t.heure) + t.dureeMin });

  const gardes = tous.filter((t) => {
    if (!t.correspondance) return true;
    const { dep, arr } = bornes(t);
    return !tous.some((autre) => {
      if (autre === t) return false;
      const b = bornes(autre);
      return b.dep >= dep && b.arr <= arr && (b.dep > dep || b.arr < arr || !autre.correspondance);
    });
  });

  return gardes.sort((x, y) => enMinutes(x.heure) - enMinutes(y.heure) || x.dureeMin - y.dureeMin);
}

// Durée en minutes -> "1 h 05" ou "34 min"
export function formatDuree(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
}
