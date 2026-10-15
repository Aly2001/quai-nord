// =====================================================================
//  Les bus entre une gare et une destination (Calais et Boulogne)
//
//  Les données viennent de charger_bus.py (site/public/bus/<reseau>.json) :
//   - lignes   : nom et couleur officielle
//   - arrets   : nom et position GPS
//   - parcours : pour chaque ligne et direction, la liste ORDONNÉE de ses arrêts,
//                et les minutes depuis le premier arrêt
//   - gares    : les gares SNCF couvertes, et leurs arrêts à moins de 400 m
//
//  Le principe de la recherche, comme pour les trains directs :
//  un parcours convient s'il passe par un arrêt de DÉPART, PUIS par un arrêt d'ARRIVÉE.
// =====================================================================
import { useEffect, useState } from "react";
import { normaliser } from "./horaires";

export const RESEAUX_BUS = ["calais", "boulogne"];
const DOSSIER_BUS = `${import.meta.env.BASE_URL}bus`;
const RAYON_DESTINATION = 500;   // mètres à pied, au maximum, entre l'arrêt et la destination
const VITESSE_MARCHE = 80;       // mètres par minute (environ 5 km/h)

// ---------- Les données ----------
let cache = null;

export function useBus() {
  const [reseaux, setReseaux] = useState(cache);
  useEffect(() => {
    if (cache) return;
    Promise.all(RESEAUX_BUS.map((code) =>
      fetch(`${DOSSIER_BUS}/${code}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null)))
      .then((liste) => {
        cache = Object.fromEntries(RESEAUX_BUS.map((code, i) => [code, liste[i]]).filter(([, d]) => d));
        setReseaux(cache);
      });
  }, []);
  return reseaux;
}

// Le réseau et la gare qui correspondent à un nom de gare SNCF (ou null si non couverte)
export function gareCouverte(reseaux, nomGare) {
  const cherche = normaliser(nomGare || "");
  for (const [code, reseau] of Object.entries(reseaux || {})) {
    for (const [nom, gare] of Object.entries(reseau.gares)) {
      if (normaliser(nom) === cherche) return { code, reseau, nom, gare };
    }
  }
  return null;
}

// Les gares d'un réseau qui correspondent à un nom approximatif (« Boulogne » -> Boulogne-sur-Mer
// ET Boulogne - Tintelleries) : s'il y en a plusieurs, il faut demander laquelle.
// On compare les MOTS UTILES : « la gare de Boulogne Ville » -> « boulogne » (« ville » ne distingue rien,
// et la SNCF appelle « Boulogne sur Mer » la gare que tout le monde appelle « Boulogne Ville »).
const MOTS_GARE_INUTILES = new Set(["la", "gare", "sncf", "de", "du", "d", "l", "ville", "centre"]);

export function garesCorrespondantes(reseau, texte) {
  const noms = Object.keys(reseau.gares);
  const exacte = noms.find((nom) => normaliser(nom) === normaliser(texte || ""));
  if (exacte) return [exacte];
  const mots = normaliser(texte || "").split(" ").filter((mot) => mot && !MOTS_GARE_INUTILES.has(mot));
  if (mots.length === 0) return noms;
  return noms.filter((nom) => {
    const motsNom = normaliser(nom).split(" ");
    return mots.every((mot) => motsNom.includes(mot));
  });
}

// Le nom affiché : le nom courant d'abord, quand la SNCF utilise un autre nom officiel
const NOMS_COURANTS = { "boulogne sur mer": "Boulogne Ville (Boulogne-sur-Mer)" };
export const libelleGare = (nom) => NOMS_COURANTS[normaliser(nom)] || nom;

// ---------- Les distances ----------
// Distance à vol d'oiseau en mètres (formule de haversine)
export function distance(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}

export const minutesAPied = (metres) => Math.max(1, Math.round(metres / VITESSE_MARCHE));

// Les arrêts à moins de `rayon` mètres d'un point : [[identifiant, distance], ...]
export function arretsProches(reseau, lat, lon, rayon = RAYON_DESTINATION) {
  return Object.entries(reseau.arrets)
    .map(([id, [, aLat, aLon]]) => [id, Math.round(distance(lat, lon, aLat, aLon))])
    .filter(([, d]) => d <= rayon)
    .sort((a, b) => a[1] - b[1]);
}

// ---------- Le cœur : les bus directs entre deux groupes d'arrêts ----------
export function busDirects(reseau, departs, arrivees, nombre = 3) {
  const distanceDepart = new Map(departs);
  const distanceArrivee = new Map(arrivees);
  const meilleurs = new Map();          // une seule proposition par ligne et direction

  for (const p of reseau.parcours) {
    p.arrets.forEach((idDepart, i) => {
      if (!distanceDepart.has(idDepart)) return;
      for (let j = i + 1; j < p.arrets.length; j++) {
        const idArrivee = p.arrets[j];
        if (!distanceArrivee.has(idArrivee)) continue;
        const marche = distanceDepart.get(idDepart) + distanceArrivee.get(idArrivee);
        const enBus = p.minutes ? p.minutes[j] - p.minutes[i] : (j - i) * 2;   // 2 min par arrêt si inconnu
        const cout = minutesAPied(marche) + enBus;                            // le temps total estimé
        const cle = `${p.ligne}|${p.direction}`;
        if (!meilleurs.has(cle) || cout < meilleurs.get(cle).cout) {
          const ligne = reseau.lignes[p.ligne];
          meilleurs.set(cle, {
            ligne: { nom: ligne.nom, couleur: ligne.couleur, texte: ligne.texte },
            direction: p.direction,
            depart: { id: idDepart, nom: reseau.arrets[idDepart][0], marche: distanceDepart.get(idDepart) },
            arrivee: { id: idArrivee, nom: reseau.arrets[idArrivee][0], marche: distanceArrivee.get(idArrivee) },
            arrets: j - i,
            minutesBus: p.minutes ? enBus : null,
            cout,
          });
        }
      }
    });
  }
  return [...meilleurs.values()].sort((a, b) => a.cout - b.cout).slice(0, nombre);
}

// Le bus ne vaut la peine que s'il est plus rapide que d'y aller directement à pied
export function plusRapideQueAPied(propositions, metresAPied) {
  return propositions.filter((b) => b.cout < minutesAPied(metresAPied));
}

// De la gare vers un lieu, et d'un lieu vers la gare
// Les arrêts du côté du LIEU, sans ceux qui sont déjà proches de la gare : sinon, quand le lieu
// est près de la gare, on proposerait de monter près de la gare... pour redescendre près de la gare.
function arretsDuLieu(couverte, lieu) {
  const prochesGare = new Set(couverte.gare.arrets_proches.map(([id]) => id));
  return arretsProches(couverte.reseau, lieu.lat, lieu.lon).filter(([id]) => !prochesGare.has(id));
}

export function busDepuisGare(couverte, lieu) {
  return busDirects(couverte.reseau, couverte.gare.arrets_proches, arretsDuLieu(couverte, lieu));
}

export function busVersGare(couverte, lieu) {
  return busDirects(couverte.reseau, arretsDuLieu(couverte, lieu), couverte.gare.arrets_proches);
}

// ---------- Retrouver un lieu (« l'université », « la mairie », « 12 rue Royale ») ----------
// 1. On nettoie la phrase : « l'université de Calais » -> « universite ».
// 2. Une CATÉGORIE connue (université, hôpital...) : on demande à OpenStreetMap tous les lieux
//    de ce type autour de la gare, avec leur vrai nom (service Overpass).
// 3. Sinon (un nom précis, une adresse) : le moteur Photon (OpenStreetMap), puis la Base Adresse Nationale.
// Renvoie une liste de lieux possibles : [{ nom, detail, lat, lon, distance }], du plus proche au plus loin.

const MOTS_VIDES = new Set(["le", "la", "les", "l", "un", "une", "des", "du", "de", "d", "au", "aux", "a",
  "en", "vers", "pour", "jusqu", "calais", "boulogne", "sur", "mer"]);

// Les catégories reconnues, et leur traduction en filtre OpenStreetMap
export const CATEGORIES = [
  // filtres : les descriptions OpenStreetMap possibles ; valeurs : les types acceptés en secours (Photon)
  { mots: ["universite", "fac", "faculte", "campus", "ulco", "iut"], nom: "Université",
    filtres: ['["amenity"~"^(university|college)$"]', '["building"~"^(university|college)$"]'], valeurs: ["university", "college"] },
  { mots: ["hopital", "clinique", "urgences", "centre hospitalier"], nom: "Hôpital",
    filtres: ['["amenity"~"^(hospital|clinic)$"]'], valeurs: ["hospital", "clinic"] },
  { mots: ["mairie", "hotel ville"], nom: "Mairie", filtres: ['["amenity"="townhall"]'], valeurs: ["townhall"] },
  { mots: ["plage"], nom: "Plage", filtres: ['["natural"="beach"]'], valeurs: ["beach"] },
  { mots: ["piscine"], nom: "Piscine", filtres: ['["leisure"="sports_centre"]["sport"="swimming"]', '["leisure"="swimming_pool"]["access"!="private"]["name"]'], valeurs: ["swimming_pool", "sports_centre"] },
  { mots: ["stade"], nom: "Stade", filtres: ['["leisure"="stadium"]'], valeurs: ["stadium"] },
  { mots: ["lycee"], nom: "Lycée", filtres: ['["amenity"="school"]["name"~"[Ll]yc"]'], valeurs: ["school"] },
  { mots: ["college"], nom: "Collège", filtres: ['["amenity"="school"]["name"~"[Cc]oll"]'], valeurs: ["school"] },
  { mots: ["poste"], nom: "Bureau de poste", filtres: ['["amenity"="post_office"]'], valeurs: ["post_office"] },
  { mots: ["commissariat", "police"], nom: "Police", filtres: ['["amenity"="police"]'], valeurs: ["police"] },
  { mots: ["bibliotheque", "mediatheque"], nom: "Médiathèque", filtres: ['["amenity"="library"]'], valeurs: ["library"] },
  { mots: ["musee"], nom: "Musée", filtres: ['["tourism"="museum"]'], valeurs: ["museum"] },
  { mots: ["theatre"], nom: "Théâtre", filtres: ['["amenity"="theatre"]'], valeurs: ["theatre"] },
  { mots: ["cinema"], nom: "Cinéma", filtres: ['["amenity"="cinema"]'], valeurs: ["cinema"] },
  { mots: ["port", "ferry"], nom: "Terminal ferry", filtres: ['["amenity"="ferry_terminal"]'], valeurs: ["ferry_terminal"] },
];

// « l'université de Calais » -> « universite »
export function nettoyerLieu(texte) {
  return normaliser(texte).split(" ").filter((mot) => mot && !MOTS_VIDES.has(mot)).join(" ");
}

export function categorieDe(texte) {
  const propre = ` ${nettoyerLieu(texte)} `;
  return CATEGORIES.find((c) => c.mots.some((mot) => propre.includes(` ${mot} `))) || null;
}

// Deux serveurs Overpass avec les mêmes données OpenStreetMap : si le premier est surchargé, le second
const SERVEURS_OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"];

async function parCategorie(categorie, gare) {
  // Toutes les descriptions possibles de la catégorie, autour de la gare (« ( ... ; ... ; ) » = l'une OU l'autre)
  const autour = `(around:8000,${gare.lat},${gare.lon})`;
  const requete = `[out:json][timeout:15];(${categorie.filtres.map((f) => `nwr${f}${autour};`).join("")});out center 20;`;
  let donnees = null;
  for (const serveur of SERVEURS_OVERPASS) {
    try {
      const reponse = await fetch(`${serveur}?data=${encodeURIComponent(requete)}`);
      if (reponse.ok) { donnees = await reponse.json(); break; }
    } catch { /* serveur indisponible : on essaie le suivant */ }
  }
  if (!donnees) throw new Error("OpenStreetMap indisponible");
  const vus = new Set();
  const lieux = [];
  for (const e of donnees.elements) {
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    const nom = e.tags?.name || categorie.nom;
    if (lat == null || vus.has(nom)) continue;            // un même lieu peut être décrit plusieurs fois
    vus.add(nom);
    lieux.push({ nom, detail: [e.tags?.["addr:street"], e.tags?.["addr:city"]].filter(Boolean).join(", "), lat, lon });
  }
  return lieux;
}

// Une ville, un quartier ou une région n'est pas une destination précise : on l'écarte
const ZONES = new Set(["city", "town", "village", "hamlet", "suburb", "quarter", "neighbourhood", "district",
  "county", "state", "region", "country", "municipality", "locality"]);

export function estUnLieuPrecis(resultat) {
  const p = resultat.properties || {};
  return !(p.osm_key === "place" || p.osm_key === "boundary" || ZONES.has(p.type) || ZONES.has(p.osm_value));
}

// Pour une catégorie, la recherche de secours ne garde que les lieux du BON type :
// si on cherche une université, une basilique au nom ressemblant est écartée.
export function dansLaCategorie(resultat, categorie) {
  return !categorie || categorie.valeurs.includes((resultat.properties || {}).osm_value);
}

async function parPhoton(texte, gare, categorie = null) {
  const parametres = new URLSearchParams({ q: texte, lat: gare.lat, lon: gare.lon, limit: "10", lang: "fr" });
  const reponse = await fetch(`https://photon.komoot.io/api/?${parametres}`);
  return (await reponse.json()).features
    .filter((f) => estUnLieuPrecis(f) && dansLaCategorie(f, categorie)).slice(0, 5).map((f) => ({
    nom: f.properties.name || [f.properties.housenumber, f.properties.street].filter(Boolean).join(" ") || texte,
    detail: [f.properties.street, f.properties.city].filter(Boolean).join(", "),
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
  }));
}

async function parBaseAdresse(texte, gare) {
  const parametres = new URLSearchParams({ q: texte, lat: gare.lat, lon: gare.lon, limit: "5" });
  const reponse = await fetch(`https://api-adresse.data.gouv.fr/search/?${parametres}`);
  return (await reponse.json()).features.map((f) => ({
    nom: f.properties.label, detail: f.properties.context,
    lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0],
  }));
}

export async function chercherLieu(texte, gare, ville) {
  const categorie = categorieDe(texte);
  const essais = categorie
    ? [() => parCategorie(categorie, gare), () => parPhoton(`${categorie.nom} ${ville}`, gare, categorie)]
    : [() => parPhoton(`${texte} ${ville}`, gare), () => parBaseAdresse(`${texte} ${ville}`, gare)];
  let lieux = [];
  for (const essai of essais) {
    try {
      lieux = await essai();
    } catch {
      lieux = [];                                          // service indisponible : on essaie le suivant
    }
    lieux = lieux
      .map((l) => ({ ...l, distance: Math.round(distance(gare.lat, gare.lon, l.lat, l.lon)) }))
      .filter((l) => l.distance <= 15_000)                 // pas un homonyme dans une autre région
      .sort((a, b) => a.distance - b.distance);
    if (lieux.length > 0) break;
  }
  return lieux;
}

// ---------- Le lien vers une application de cartes (itinéraire en transports) ----------
export function lienCarte(depart, arrivee) {
  const parametres = new URLSearchParams({
    api: "1", origin: `${depart.lat},${depart.lon}`, destination: `${arrivee.lat},${arrivee.lon}`, travelmode: "transit",
  });
  return `https://www.google.com/maps/dir/?${parametres}`;
}
