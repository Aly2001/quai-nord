// ---------- Le risque EN DIRECT, calculé par le réseau de neurones ----------
// predire_direct.py (sur la VM) calcule toutes les 5 minutes le risque de chaque arrêt des TER
// des 3 prochaines heures, à partir de ce qui s'est passé sur la ligne depuis le matin, et le dépose
// dans un fichier public. Le site l'affiche SEULEMENT si :
//   - l'interrupteur est allumé sur la VM (afficher: true), ou l'adresse contient ?apercu=direct
//     (pour regarder le rendu sur son téléphone avant de l'allumer pour tout le monde) ;
//   - le fichier a moins de 20 minutes (sinon la VM est en panne : on revient au risque de la nuit) ;
//   - le train et sa gare d'arrivée y figurent, pour le bon jour.
// Sinon, rien ne change : la carte affiche le risque de la nuit, comme avant.
import { useEffect, useState } from "react";

export const ADRESSE_DIRECT = "https://storage.googleapis.com/quai-nord-direct/risques_direct.json";
const FRAICHEUR_MAX = 20 * 60;          // en secondes
const ECART_NOTABLE = 5;                // en points : en dessous, c'est « comme d'habitude »

export function directFrais(direct, maintenant = Date.now() / 1000, apercu = false) {
  return Boolean(direct && (direct.afficher === true || apercu) && maintenant - direct.maj < FRAICHEUR_MAX);
}

// Le risque en direct d'un train à SA gare d'arrivée, ou null
export function risqueDirect(direct, train, stopArrivee, jour, maintenant = Date.now() / 1000, apercu = false) {
  if (!directFrais(direct, maintenant, apercu) || !train) return null;
  const leTrain = direct.trains?.[train.numero];
  if (!leTrain || leTrain.jour !== jour) return null;
  const arret = leTrain.arrets.find((a) => a.stop_id === stopArrivee);
  if (!arret) return null;
  return { taux: arret.risque, maj: direct.genere_le.slice(11, 16), ligne: leTrain.ligne };
}

// Aujourd'hui par rapport à d'habitude (en pourcentages) : "pire", "mieux" ou "pareil"
export function comparerHabitude(aujourdhui, habituel) {
  if (habituel === null || habituel === undefined) return null;
  if (aujourdhui >= habituel + ECART_NOTABLE) return "pire";
  if (aujourdhui <= habituel - ECART_NOTABLE) return "mieux";
  return "pareil";
}

export async function chargerDirect(lire = fetch) {
  const reponse = await lire(`${ADRESSE_DIRECT}?t=${Date.now()}`);     // jamais une vieille copie
  return reponse.ok ? reponse.json() : null;
}

// Relu toutes les 5 minutes, seulement pour aujourd'hui
export function useRisquesDirect(actif) {
  const [direct, setDirect] = useState(null);
  useEffect(() => {
    if (!actif) return;
    let annule = false;
    function charger() {
      chargerDirect().then((d) => { if (!annule) setDirect(d); }).catch(() => {});
    }
    charger();
    const minuteur = setInterval(charger, 5 * 60_000);
    return () => { annule = true; clearInterval(minuteur); };
  }, [actif]);
  return actif ? direct : null;
}
