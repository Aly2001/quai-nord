// =====================================================================
//  Les favoris en plus des trajets : un TRAIN précis (« le 17:12 ») et un trajet EN VILLE.
//  Et le train SURVEILLÉ, affiché en premier sur l'accueil avec son état en direct.
//  Tout reste sur l'appareil (stockage local) : pas de compte, rien n'est envoyé.
// =====================================================================
import { useEffect, useState } from "react";
import { normaliser, trajetsDirects, infoDirect, risqueDuTrain, niveauRisque } from "./horaires";

const CLES = { trains: "quai-nord:trains-favoris", ville: "quai-nord:ville-favoris", surveille: "quai-nord:train-surveille" };
const MAXIMUM = 5;
const EVENEMENT = "quai-nord:favoris-modifies";

function lire(cle, defaut) {
  try {
    const v = JSON.parse(localStorage.getItem(cle));
    return v ?? defaut;
  } catch {
    return defaut;
  }
}
function ecrire(cle, valeur) {
  try { localStorage.setItem(cle, JSON.stringify(valeur)); } catch { /* navigation privée : tant pis */ }
  window.dispatchEvent(new Event(EVENEMENT));
}

// Un train précis se reconnaît d'un jour à l'autre par sa gare de départ, sa destination et son heure
export const idTrain = ({ de, a, heure }) => `${de}|${a}|${heure}`;
export const idVille = ({ code, A, B }) => `${code}|${A.nom}|${B.nom}`;

export function useFavorisPlus() {
  const [etat, setEtat] = useState(() => ({ trains: lire(CLES.trains, []), ville: lire(CLES.ville, []), surveille: lire(CLES.surveille, null) }));
  useEffect(() => {
    const relire = () => setEtat({ trains: lire(CLES.trains, []), ville: lire(CLES.ville, []), surveille: lire(CLES.surveille, null) });
    window.addEventListener(EVENEMENT, relire);
    window.addEventListener("storage", relire);
    return () => { window.removeEventListener(EVENEMENT, relire); window.removeEventListener("storage", relire); };
  }, []);

  const basculerTrain = (train) => {
    const liste = lire(CLES.trains, []);
    const id = idTrain(train);
    if (liste.some((t) => idTrain(t) === id)) {
      ecrire(CLES.trains, liste.filter((t) => idTrain(t) !== id));
      if (lire(CLES.surveille, null) === id) ecrire(CLES.surveille, null);
    } else {
      ecrire(CLES.trains, [{ de: train.de, a: train.a, heure: train.heure }, ...liste].slice(0, MAXIMUM));
    }
  };
  const basculerVille = (trajet) => {
    const liste = lire(CLES.ville, []);
    const id = idVille(trajet);
    ecrire(CLES.ville, liste.some((t) => idVille(t) === id) ? liste.filter((t) => idVille(t) !== id)
      : [trajet, ...liste].slice(0, MAXIMUM));
  };
  const surveiller = (train) => {
    const id = train ? idTrain(train) : null;
    ecrire(CLES.surveille, lire(CLES.surveille, null) === id ? null : id);
  };

  return {
    ...etat,
    estTrainFavori: (train) => etat.trains.some((t) => idTrain(t) === idTrain(train)),
    estVilleFavori: (trajet) => etat.ville.some((t) => idVille(t) === idVille(trajet)),
    trainSurveille: etat.trains.find((t) => idTrain(t) === etat.surveille) || null,
    basculerTrain, basculerVille, surveiller,
  };
}

// L'état du jour d'un train favori, à partir des départs de sa gare, du direct et des risques :
//   { statut: "absent" }                             : il ne circule pas ce jour-là ;
//   { statut: "supprime" | "retard" | "heure", trajet, minutes } : ce que dit le direct ;
//   { statut: "prevu", trajet, risque, niveau }       : pas encore de direct, son risque habituel.
export function etatDuTrain(favori, departs, tempsReel, risques) {
  const trajet = trajetsDirects(departs || [], favori.de, normaliser(favori.a)).find((t) => t.heure === favori.heure);
  if (!trajet) return { statut: "absent" };
  const tr = trajet.troncons[0];
  const direct = infoDirect(tempsReel, tr.train.trip_id, tr.depart.stop_id, tr.arrivee.stop_id);
  if (direct?.supprime) return { statut: "supprime", trajet };
  const retard = Math.round(Math.max(direct?.retardDepart ?? 0, direct?.retardArrivee ?? 0) / 60);
  if (direct && retard >= 1) return { statut: "retard", trajet, minutes: retard };
  if (direct) return { statut: "heure", trajet };
  const risque = risqueDuTrain(risques, tr.train);
  const pourcentage = risque ? Math.round(risque.taux * 100) : null;      // taux : entre 0 et 1
  return { statut: "prevu", trajet, risque: pourcentage, niveau: pourcentage === null ? null : niveauRisque(pourcentage) };
}
