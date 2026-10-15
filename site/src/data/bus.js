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

// ---------- Retrouver un lieu (« mairie », « 12 rue Royale ») ----------
// 1. OpenStreetMap (Nominatim) pour les lieux connus, autour de la gare ;
// 2. la Base Adresse Nationale pour les adresses, en secours.
// Renvoie une liste de lieux possibles : [{ nom, detail, lat, lon, distance }]
export async function chercherLieu(texte, gare, ville) {
  const autour = 0.12;   // environ 10 km autour de la gare
  const zone = [gare.lon - autour, gare.lat + autour, gare.lon + autour, gare.lat - autour].join(",");
  const lieux = [];
  try {
    const parametres = new URLSearchParams({
      q: `${texte}, ${ville}`, format: "jsonv2", limit: "5", countrycodes: "fr",
      viewbox: zone, bounded: "1", "accept-language": "fr",
    });
    const reponse = await fetch(`https://nominatim.openstreetmap.org/search?${parametres}`);
    for (const r of await reponse.json()) {
      lieux.push({ nom: r.name || r.display_name.split(",")[0], detail: r.display_name, lat: +r.lat, lon: +r.lon });
    }
  } catch { /* service indisponible : on essaie le suivant */ }

  if (lieux.length === 0) {
    try {
      const parametres = new URLSearchParams({ q: texte, lat: gare.lat, lon: gare.lon, limit: "5" });
      const reponse = await fetch(`https://api-adresse.data.gouv.fr/search/?${parametres}`);
      for (const f of (await reponse.json()).features) {
        lieux.push({ nom: f.properties.label, detail: f.properties.context, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] });
      }
    } catch { /* aucun service disponible */ }
  }

  // On ne garde que les lieux raisonnablement proches de la gare, du plus proche au plus loin
  return lieux
    .map((l) => ({ ...l, distance: Math.round(distance(gare.lat, gare.lon, l.lat, l.lon)) }))
    .filter((l) => l.distance <= 15_000)
    .sort((a, b) => a.distance - b.distance);
}

// ---------- Le lien vers une application de cartes (itinéraire en transports) ----------
export function lienCarte(depart, arrivee) {
  const parametres = new URLSearchParams({
    api: "1", origin: `${depart.lat},${depart.lon}`, destination: `${arrivee.lat},${arrivee.lon}`, travelmode: "transit",
  });
  return `https://www.google.com/maps/dir/?${parametres}`;
}
