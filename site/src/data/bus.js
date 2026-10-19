// =====================================================================
//  Les bus, trams et métros entre une gare et une destination
//
//  Les réseaux couverts sont décrits dans UNE seule liste, reseaux.json (lue aussi par
//  charger_bus.py et par le serveur de Nora). Les données de chaque réseau viennent de
//  charger_bus.py (site/public/bus/<reseau>.json), chargées SEULEMENT quand on en a besoin :
//   - lignes   : nom, couleur officielle et type (bus, tram ou métro)
//   - arrets   : nom et position GPS
//   - parcours : pour chaque ligne et direction, la liste ORDONNÉE de ses arrêts,
//                et les minutes depuis le premier arrêt
//   - gares    : les gares SNCF couvertes, et leurs arrêts à moins de 400 m
//
//  Le principe de la recherche, comme pour les trains directs :
//  un parcours convient s'il passe par un arrêt de DÉPART, PUIS par un arrêt d'ARRIVÉE.
// =====================================================================
import { normaliser } from "./horaires";
import LISTE_RESEAUX from "./reseaux.json";

// ---------- La liste unique des réseaux ----------
export const RESEAUX = LISTE_RESEAUX.reseaux;
export const RESEAUX_BUS = RESEAUX.map((r) => r.code);

// Les sites officiels des réseaux, pour guider le voyageur quand Nora ne trouve pas elle-même
export const SITES_RESEAUX = Object.fromEntries(RESEAUX.map((r) => [r.code, { nom: r.nom, url: r.site }]));

export const infosReseau = (code) => RESEAUX.find((r) => r.code === code) || null;

// Le réseau qui dessert une gare SNCF (« Lille Flandres » -> lille), SANS rien télécharger
export function reseauDeGare(nomGare) {
  const cherche = normaliser(nomGare || "");
  if (!cherche) return null;
  return RESEAUX.find((r) => r.gares.some((g) => normaliser(g) === cherche))?.code || null;
}

// Le réseau d'une ville citée par Nora (« Boulogne-sur-Mer », « Roubaix » -> boulogne, lille)
export function reseauDeVille(ville) {
  const cherche = normaliser(ville || "");
  if (!cherche) return null;
  return RESEAUX.find((r) => r.villes.includes(cherche) || normaliser(r.ville) === cherche)?.code || null;
}

// « le bus » ou « le bus, le tram ou le métro » : les mots qui annoncent les transports d'un réseau
export function transportsDuReseau(code) {
  const modes = infosReseau(code)?.modes || ["bus"];
  const mots = { bus: "le bus", tram: "le tram", metro: "le métro" };
  const liste = ["bus", "tram", "metro"].filter((m) => modes.includes(m)).map((m) => mots[m]);
  return liste.length > 1 ? `${liste.slice(0, -1).join(", ")} ou ${liste[liste.length - 1]}` : liste[0];
}

// Les étapes pour chercher soi-même sur le site officiel, déjà remplies avec le départ et l'arrivée
export function etapesSiteOfficiel(code, depart, arrivee) {
  return [
    `Ouvrez le site officiel du réseau ${SITES_RESEAUX[code].nom}, rubrique itinéraire.`,
    `Indiquez « ${depart} » comme départ.`,
    `Indiquez « ${arrivee} » comme destination.`,
    "Choisissez votre heure de départ pour voir les trajets, avec les changements si besoin.",
  ];
}
const DOSSIER_BUS = `${import.meta.env.BASE_URL}bus`;
const RAYON_DESTINATION = 500;   // mètres à pied, au maximum, entre l'arrêt et la destination
// Un GRAND site (campus, hôpital) est décrit par son point central, souvent loin de l'entrée :
// on accepte une marche un peu plus longue jusqu'à ce point (même règle que charger_bus.py)
const RAYON_GRANDS_SITES = 800;
const CATEGORIES_GRANDS_SITES = new Set(["universite", "hopital", "stade", "commerce", "loisirs", "plage"]);
export const rayonMarche = (categorie) => (CATEGORIES_GRANDS_SITES.has(categorie) ? RAYON_GRANDS_SITES : RAYON_DESTINATION);
const VITESSE_MARCHE = 80;       // mètres par minute (environ 5 km/h)

// ---------- « Ma position » : tout se calcule dans le téléphone ----------
// La position du voyageur n'est JAMAIS envoyée : ni au serveur de Nora, ni à Gemini.
// La liste des gares couvertes (un petit fichier, préparé par charger_bus.py) suffit à trouver la plus proche.
let garesCouvertes = null;
export async function chargerGaresCouvertes() {
  if (!garesCouvertes) {
    garesCouvertes = fetch(`${DOSSIER_BUS}/gares.json`).then((r) => (r.ok ? r.json() : { gares: [] }))
      .then((d) => d.gares || []).catch(() => { garesCouvertes = null; return []; });
  }
  return garesCouvertes;
}

export const DISTANCE_MAX_GARE = 15_000;      // au-delà, la position n'est près d'aucune ville couverte

// La gare couverte la plus proche d'un point : { nom, reseau, lat, lon, metres }, ou null
export function gareLaPlusProche(gares, lat, lon) {
  let meilleure = null;
  for (const g of gares) {
    const metres = distance(lat, lon, g.lat, g.lon);
    if (!meilleure || metres < meilleure.metres) meilleure = { ...g, metres };
  }
  return meilleure;
}

// Le nom de l'arrêt le plus proche d'un point (pour dire « vous êtes près de… »), ou null
export function arretLePlusProche(reseau, lat, lon) {
  const [premier] = arretsProches(reseau, lat, lon, 800);
  return premier ? joliNom(reseau.arrets[premier[0]][0]) : null;
}

// La date de fin de validité du fichier d'un réseau, si elle est DÉPASSÉE (« 31/12/2026 »), sinon null.
// charger_bus.py refuse un fichier expiré, mais un fichier valide le jour où il est préparé expire ensuite.
export function horairesPerimes(reseau, aujourdhui = new Date()) {
  const fin = reseau?.valide_jusqu_au;
  if (!fin) return null;
  const jour = aujourdhui.toISOString().slice(0, 10);
  if (fin >= jour) return null;
  const [a, m, j] = fin.split("-");
  return `${j}/${m}/${a}`;
}

// ---------- Les données : un seul réseau à la fois ----------
// Lille pèse 350 Ko : on ne télécharge un réseau que lorsqu'on cherche un trajet dans sa ville.
// Le résultat est gardé en mémoire : la deuxième question est instantanée.
const enCours = new Map();

export function chargerReseau(code) {
  if (!RESEAUX_BUS.includes(code)) return Promise.resolve(null);
  if (!enCours.has(code)) {
    enCours.set(code, fetch(`${DOSSIER_BUS}/${code}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((donnees) => {
        if (!donnees) enCours.delete(code);          // en cas d'échec, on pourra réessayer
        return donnees;
      }));
  }
  return enCours.get(code);
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

// ---------- Les mots justes : bus, tram ou métro ----------
// « DUNKERQUE GARE » -> « Dunkerque Gare » : certains réseaux écrivent tout en majuscules
const PETITS_MOTS = new Set(["de", "du", "des", "la", "le", "les", "et", "à", "au", "aux", "sur", "en"]);
export function joliNom(texte) {
  if (!texte || texte !== texte.toUpperCase() || !/[A-ZÀ-Ý]/.test(texte)) return texte;
  return texte.toLowerCase()
    .replace(/(^|[\s\-'’(])([a-zà-ÿ])/g, (tout, avant, lettre) => avant + lettre.toUpperCase())
    .split(" ")
    .map((mot, i) => (i > 0 && PETITS_MOTS.has(mot.toLowerCase()) ? mot.toLowerCase() : mot))
    .join(" ");
}

// « 3 Achicourt Collège » sur la ligne 3 -> « Achicourt Collège » : le numéro n'est pas une direction
export function nettoyerDirection(direction, nomLigne) {
  let texte = (direction || "").trim();
  // Le nom de la ligne, éventuellement suivi d'une lettre de variante (« C6a ») : jamais « 30 » pour la ligne 3
  const echappe = String(nomLigne || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (nomLigne) texte = texte.replace(new RegExp(`^${echappe}[a-z]?\\s+`, "i"), "").trim();
  return joliNom(texte);
}

// Comment parler d'une ligne : « le métro M1 », « la station », « 9 stations »
export function decrireLigne(ligne) {
  const mode = ligne.mode || "bus";
  const nom = mode === "tram" && /^tram/i.test(ligne.nom) ? "Tram" : ligne.nom;
  const prendre = mode === "metro" ? `le métro ${nom}` : mode === "tram" ? (nom === "Tram" ? "le tram" : `le tram ${nom}`) : `le bus ${nom}`;
  const station = mode === "bus" ? "l'arrêt" : "la station";
  const arrets = (n) => `${n} ${mode === "bus" ? "arrêt" : "station"}${n > 1 ? "s" : ""}`;
  return { mode, nom, prendre, station, arrets, nuit: /\bnuit\b/i.test(ligne.long || "") };
}

// ---------- Le cœur : les bus directs entre deux groupes d'arrêts ----------
const PENALITE_NUIT = 30;         // minutes : une ligne de nuit passe derrière les lignes de jour

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
        // Le temps total estimé ; un parcours peu fréquent (moins de 3 voyages) est pénalisé,
        // pour qu'un trajet habituel passe toujours devant un trajet occasionnel
        const ligne = reseau.lignes[p.ligne];
        const description = decrireLigne(ligne);
        const penalite = ((p.voyages ?? 3) < 3 ? 20 : 0) + (description.nuit ? PENALITE_NUIT : 0);
        const cout = minutesAPied(marche) + enBus + penalite;
        const cle = `${p.ligne}|${p.direction}`;
        if (!meilleurs.has(cle) || cout < meilleurs.get(cle).cout) {
          meilleurs.set(cle, {
            ligne: { nom: ligne.nom, couleur: ligne.couleur, texte: ligne.texte, mode: description.mode, long: ligne.long || "" },
            direction: nettoyerDirection(p.direction, ligne.nom),
            nuit: description.nuit,
            depart: { id: idDepart, nom: joliNom(reseau.arrets[idDepart][0]), marche: distanceDepart.get(idDepart) },
            arrivee: { id: idArrivee, nom: joliNom(reseau.arrets[idArrivee][0]), marche: distanceArrivee.get(idArrivee) },
            arrets: j - i,
            minutesBus: p.minutes ? enBus : null,
            minutesTotal: minutesAPied(marche) + enBus,     // ce qu'on affiche (sans la pénalité)
            occasionnel: (p.voyages ?? 3) < 3,
            cout,
          });
        }
      }
    });
  }
  // Une même ligne entre les MÊMES arrêts, vers deux terminus (métro M2 vers Roubaix OU Tourcoing) :
  // c'est le même trajet pour le voyageur, proposé une seule fois
  const regroupes = new Map();
  for (const b of [...meilleurs.values()].sort((x, y) => x.cout - y.cout)) {
    const cle = `${b.ligne.nom}|${b.depart.id}|${b.arrivee.id}`;
    const deja = regroupes.get(cle);
    if (!deja) regroupes.set(cle, { ...b, directions: [b.direction] });
    else if (!deja.directions.includes(b.direction)) deja.directions.push(b.direction);
  }
  return [...regroupes.values()]
    // Deux terminus : on cite les deux ; davantage (DK'Bus C6 en a six) : le principal, et le nombre des autres
    .map((b) => ({
      ...b,
      direction: b.directions.length <= 2
        ? b.directions.join(" ou ")
        : `${b.directions[0]} (ou ${b.directions.length - 1} autres terminus)`,
    }))
    .slice(0, nombre);
}

// Le bus ne vaut la peine que s'il est plus rapide que d'y aller directement à pied
export function plusRapideQueAPied(propositions, metresAPied) {
  return propositions.filter((b) => b.minutesTotal < minutesAPied(metresAPied));
}

// De la gare vers un lieu, et d'un lieu vers la gare
// Les arrêts du côté du LIEU, sans ceux qui sont déjà proches de la gare : sinon, quand le lieu
// est près de la gare, on proposerait de monter près de la gare... pour redescendre près de la gare.
function arretsDuLieu(couverte, lieu) {
  const prochesGare = new Set(couverte.gare.arrets_proches.map(([id]) => id));
  return arretsProches(couverte.reseau, lieu.lat, lieu.lon, rayonMarche(lieu.cat))
    .filter(([id]) => !prochesGare.has(id));
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
  "en", "vers", "pour", "jusqu", "sur", "mer", ...RESEAUX.flatMap((r) => r.villes.flatMap((v) => v.split(" ")))]);

// Les catégories reconnues, et leur traduction en filtre OpenStreetMap
export const CATEGORIES = [
  // filtres : les descriptions OpenStreetMap possibles ; valeurs : les types acceptés en secours (Photon)
  { mots: ["universite", "fac", "faculte", "campus", "ulco", "iut"], code: "universite", nom: "Université",
    filtres: ['["amenity"~"^(university|college)$"]', '["building"~"^(university|college)$"]'], valeurs: ["university", "college"] },
  { mots: ["hopital", "clinique", "urgences", "centre hospitalier"], code: "hopital", nom: "Hôpital",
    filtres: ['["amenity"~"^(hospital|clinic)$"]'], valeurs: ["hospital", "clinic"] },
  { mots: ["mairie", "hotel ville"], code: "mairie", nom: "Mairie", filtres: ['["amenity"="townhall"]'], valeurs: ["townhall"] },
  { mots: ["plage"], code: "plage", nom: "Plage", filtres: ['["natural"="beach"]'], valeurs: ["beach"] },
  { mots: ["piscine"], code: "piscine", nom: "Piscine", filtres: ['["leisure"="sports_centre"]["sport"="swimming"]', '["leisure"="swimming_pool"]["access"!="private"]["name"]'], valeurs: ["swimming_pool", "sports_centre"] },
  { mots: ["stade"], code: "stade", nom: "Stade", filtres: ['["leisure"="stadium"]'], valeurs: ["stadium"] },
  { mots: ["lycee"], code: "lycee", nom: "Lycée", filtres: ['["amenity"="school"]["name"~"[Ll]yc"]'], valeurs: ["school"] },
  { mots: ["college"], code: "college", nom: "Collège", filtres: ['["amenity"="school"]["name"~"[Cc]oll"]'], valeurs: ["school"] },
  { mots: ["poste"], code: "poste", nom: "Bureau de poste", filtres: ['["amenity"="post_office"]'], valeurs: ["post_office"] },
  { mots: ["commissariat", "police"], code: "police", nom: "Police", filtres: ['["amenity"="police"]'], valeurs: ["police"] },
  { mots: ["bibliotheque", "mediatheque"], code: "mediatheque", nom: "Médiathèque", filtres: ['["amenity"="library"]'], valeurs: ["library"] },
  { mots: ["musee"], code: "musee", nom: "Musée", filtres: ['["tourism"="museum"]'], valeurs: ["museum"] },
  { mots: ["theatre"], code: "theatre", nom: "Théâtre", filtres: ['["amenity"="theatre"]'], valeurs: ["theatre"] },
  { mots: ["cinema"], code: "cinema", nom: "Cinéma", filtres: ['["amenity"="cinema"]'], valeurs: ["cinema"] },
  { mots: ["port", "ferry"], code: "ferry", nom: "Terminal ferry", filtres: ['["amenity"="ferry_terminal"]'], valeurs: ["ferry_terminal"] },
  { mots: ["centre commercial", "galerie marchande"], code: "commerce", nom: "Centre commercial", filtres: ['["shop"="mall"]'], valeurs: ["mall"] },
  { mots: ["aquarium", "zoo"], code: "loisirs", nom: "Loisirs", filtres: ['["tourism"~"^(aquarium|zoo)$"]'], valeurs: ["aquarium", "zoo"] },
];

// ---------- Tolérer les fautes de frappe ----------
// Nombre minimum de modifications (lettre ajoutée, retirée ou changée) pour passer d'un mot à l'autre
export function ecart(a, b) {
  const ligne = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let precedent = ligne[0];
    ligne[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temporaire = ligne[j];
      ligne[j] = Math.min(ligne[j] + 1, ligne[j - 1] + 1, precedent + (a[i - 1] === b[j - 1] ? 0 : 1));
      precedent = temporaire;
    }
  }
  return ligne[b.length];
}

// Deux mots « se ressemblent » : identiques, ou à une faute près (deux pour les mots longs).
// Les mots très courts doivent être identiques (« bus » et « but » sont différents).
export function seRessemblent(a, b) {
  if (a === b) return true;
  const longueur = Math.min(a.length, b.length);
  if (longueur < 4) return false;
  return ecart(a, b) <= (longueur >= 8 ? 2 : 1);
}

// Tous les mots demandés se retrouvent (à une faute près) dans le texte
function contientLesMots(mots, texte) {
  const motsTexte = normaliser(texte).split(" ");
  return mots.every((mot) => motsTexte.some((m) => seRessemblent(mot, m) || (mot.length >= 4 && m.startsWith(mot))));
}

// « l'université de Calais » -> « universite »
export function nettoyerLieu(texte) {
  return normaliser(texte).split(" ").filter((mot) => mot && !MOTS_VIDES.has(mot)).join(" ");
}

// Les mots d'une ADRESSE : « 7 place de Lorraine » n'est pas « la plage » (place et plage ne diffèrent que
// d'une lettre), ni « rue des Écoles » une demande d'école. Une adresse n'est jamais une catégorie.
const MOTS_ADRESSE = new Set(["rue", "place", "pl", "avenue", "av", "boulevard", "bd", "chemin", "allee", "quai", "impasse",
  "route", "rte", "square", "cours", "parvis", "esplanade", "passage", "sentier", "rond", "faubourg"]);
export function estAdresse(texte) {
  const mots = normaliser(texte).split(" ");
  return mots.some((m) => /^\d+[a-z]?$/.test(m)) || mots.some((m) => MOTS_ADRESSE.has(m));
}

export function categorieDe(texte) {
  if (estAdresse(texte)) return null;
  const propre = nettoyerLieu(texte);
  if (!propre) return null;
  // Chaque mot-clé (parfois en plusieurs mots : « hotel ville ») doit se retrouver, à une faute près
  return CATEGORIES.find((c) => c.mots.some((cle) => contientLesMots(cle.split(" "), propre))) || null;
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
    lieux.push({ nom, cat: categorie.code, detail: [e.tags?.["addr:street"], e.tags?.["addr:city"]].filter(Boolean).join(", "), lat, lon });
  }
  return lieux;
}

// Une ville, un quartier ou une région n'est pas une destination précise : on l'écarte
const ZONES = new Set(["city", "town", "village", "hamlet", "suburb", "quarter", "neighbourhood", "district",
  "county", "state", "region", "country", "municipality", "locality"]);

export function estUnLieuPrecis(resultat) {
  const p = resultat.properties || {};
  // Attention : une ADRESSE (« 293 rue Duguay-Trouin ») est aussi rangée dans la famille « place »
  // (type « house ») : on n'écarte que les villes, quartiers et régions, pas toute la famille.
  return !(p.osm_key === "boundary" || ZONES.has(p.type) || ZONES.has(p.osm_value));
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

// La recherche dans les LIEUX PRÉPARÉS par charger_bus.py (sans Internet) :
// par catégorie (« l'université »), sinon par nom (« Cité Europe », « Nausicaá »).
export function lieuxPrepares(reseau, texte) {
  const lieux = reseau?.lieux || [];
  if (estAdresse(texte)) return [];               // une adresse se cherche comme une adresse (voir chercherLieu)
  const categorie = categorieDe(texte);
  if (categorie) {
    const duType = lieux.filter((l) => l.cat === categorie.code);
    // Les mots en plus de la catégorie : « malo » dans « la plage de Malo »
    const motsCategorie = new Set(categorie.mots.flatMap((m) => m.split(" ")));
    const precis = nettoyerLieu(texte).split(" ").filter((m) => m.length > 2 && ![...motsCategorie].some((c) => seRessemblent(m, c)));
    if (precis.length > 0) {
      const nommes = duType.filter((l) => contientLesMots(precis, l.nom));
      if (nommes.length > 0) return nommes;
    }
    return duType;
  }
  const mots = nettoyerLieu(texte).split(" ").filter((mot) => mot.length > 1);
  if (mots.length === 0) return [];
  return lieux.filter((l) => contientLesMots(mots, l.nom));
}

// Un résultat de recherche en direct n'est gardé que s'il partage au moins un mot avec la demande
// (sinon : « l'ulclo » donnait « Fontaine de Boulogne-sur-Mer »). Les numéros (« 293 ») ne comptent pas.
export function pertinent(lieu, texte) {
  const mots = nettoyerLieu(texte).split(" ").filter((mot) => mot.length >= 3 && !/^\d+$/.test(mot));
  if (mots.length === 0) return true;
  const motsLieu = normaliser(`${lieu.nom} ${lieu.detail || ""}`).split(" ");
  return mots.some((mot) => motsLieu.some((m) => seRessemblent(mot, m)));
}

// Une adresse trouvée doit contenir TOUS les mots du nom de la voie (« boulevard » ET « lille »)
export function adressePertinente(lieu, texte) {
  const mots = motsAdresse(texte);
  if (mots.length === 0) return true;
  const motsLieu = normaliser(`${lieu.nom} ${lieu.detail || ""}`).split(" ");
  return mots.every((mot) => motsLieu.some((m) => seRessemblent(mot, m)));
}

const PRES_DE_LA_GARE = 15_000;   // mètres : au-delà, c'est sans doute un homonyme dans une autre ville

function classer(lieux, gare) {
  return lieux
    .map((l) => ({ ...l, distance: Math.round(distance(gare.lat, gare.lon, l.lat, l.lon)) }))
    .filter((l) => l.distance <= PRES_DE_LA_GARE)
    .sort((a, b) => a.distance - b.distance);
}

// Les ARRÊTS du réseau dont le nom correspond (« place de Lorraine » est aussi un arrêt à Boulogne) :
// un nom d'arrêt est une destination parfaite, et il est déjà dans les données, sans rien chercher en ligne.
// Plusieurs quais d'un même arrêt (même nom) n'en font qu'un.
const PETITS_MOTS_ADRESSE = new Set(["de", "du", "des", "la", "le", "les", "l", "d", "a", "au", "aux", "je", "vais", "suis"]);
export function motsAdresse(texte) {
  return normaliser(texte).split(" ").filter((mot) => mot.length > 1 && !PETITS_MOTS_ADRESSE.has(mot) && !/^\d+[a-z]?$/.test(mot));
}

export function arretsCorrespondants(reseau, texte) {
  // Pour une adresse, on garde aussi les noms de villes (« boulevard de Lille » à Boulogne)
  const mots = estAdresse(texte) ? motsAdresse(texte)
    : nettoyerLieu(texte).split(" ").filter((mot) => mot.length > 1 && !/^\d+[a-z]?$/.test(mot));
  // Une catégorie (« la plage ») n'est pas un nom d'arrêt : sinon « plage » ressemblerait à « Place Dalton »
  if (!reseau?.arrets || mots.length === 0 || categorieDe(texte)) return [];
  const parNom = new Map();
  for (const [nom, lat, lon] of Object.values(reseau.arrets)) {
    if (!contientLesMots(mots, nom)) continue;
    const cle = normaliser(nom);
    const deja = parNom.get(cle) || { nom: joliNom(nom), cat: "arret", detail: "Arrêt de bus", lat: 0, lon: 0, n: 0 };
    deja.lat += lat; deja.lon += lon; deja.n += 1;
    parNom.set(cle, deja);
  }
  return [...parNom.values()].map(({ n, ...l }) => ({ ...l, lat: l.lat / n, lon: l.lon / n }));
}

// « le centre-ville », « le centre », « centre de Lille » : le cœur de la ville, repéré par sa mairie
// (« centre de secours » ou « centre hospitalier » ne sont pas le centre-ville : seul « centre de <ville> » l'est)
const CENTRE_VILLE = /^(le |au |en )?(hyper )?centre( ville)?( de (.+))?$/;
export function estCentreVille(texte) {
  const propre = normaliser(texte).replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  const trouve = propre.match(CENTRE_VILLE);
  if (!trouve) return false;
  if (!trouve[5]) return true;
  const villes = new Set(RESEAUX.flatMap((r) => [...r.villes, normaliser(r.ville).replace(/-/g, " ")]));
  return villes.has(trouve[5].trim());
}

// Parmi les lieux d'une catégorie, ceux dont le NOM contient le mot de la catégorie passent devant
// (« Université d'Artois » avant « Association pour la formation… », à distance égale ou presque)
function vraisDabord(lieux, categorie) {
  if (!categorie) return lieux;
  const racines = categorie.mots.map((m) => m.split(" ")[0].slice(0, 6));
  const vrai = (l) => normaliser(l.nom).split(" ").some((mot) => racines.some((r) => mot.startsWith(r)));
  return [...lieux.filter(vrai), ...lieux.filter((l) => !vrai(l))];
}

export async function chercherLieu(texte, gare, ville, reseau = null) {
  // 0. Le centre-ville : la mairie la plus proche de la gare
  if (estCentreVille(texte)) {
    const mairie = classer((reseau?.lieux || []).filter((l) => l.cat === "mairie"), gare)[0];
    if (mairie) return [{ ...mairie, nom: `Centre-ville (${mairie.nom})` }];
  }
  // 1. Les lieux préparés : fiables et instantanés
  const prepares = vraisDabord(classer(lieuxPrepares(reseau, texte), gare), categorieDe(texte));
  if (prepares.length > 0) return prepares;

  // 2. Un arrêt du réseau qui porte ce nom
  const arrets = classer(arretsCorrespondants(reseau, texte), gare);
  if (arrets.length > 0) return arrets;

  // 3. En secours, la recherche en direct sur Internet
  const categorie = categorieDe(texte);
  const essais = categorie
    ? [() => parCategorie(categorie, gare), () => parPhoton(`${categorie.nom} ${ville}`, gare, categorie)]
    : estAdresse(texte)
      ? [() => parBaseAdresse(`${texte} ${ville}`, gare), () => parPhoton(`${texte} ${ville}`, gare)]
      : [() => parPhoton(`${texte} ${ville}`, gare), () => parBaseAdresse(`${texte} ${ville}`, gare)];
  let lieux = [];
  for (const essai of essais) {
    try {
      lieux = await essai();
    } catch {
      lieux = [];                                          // service indisponible : on essaie le suivant
    }
    lieux = classer(lieux, gare);
    if (!categorie) lieux = lieux.filter((l) => (estAdresse(texte) ? adressePertinente(l, texte) : pertinent(l, texte)));
    if (lieux.length > 0) break;
  }
  return lieux;
}

// ---------- Le lien vers une application de cartes (itinéraire en transports) ----------
// Le même lien, mais l'itinéraire À PIED (quand le voyageur préfère marcher)
export function lienAPied(depart, arrivee) {
  return lienCarte(depart, arrivee).replace("travelmode=transit", "travelmode=walking");
}

export function lienCarte(depart, arrivee) {
  const parametres = new URLSearchParams({
    api: "1", origin: `${depart.lat},${depart.lon}`, destination: `${arrivee.lat},${arrivee.lon}`, travelmode: "transit",
  });
  return `https://www.google.com/maps/dir/?${parametres}`;
}
