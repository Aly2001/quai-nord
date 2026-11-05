// L'état en direct d'un train SUIVI : horaires du jour de sa gare + direct de la SNCF + risques.
// Utilisé par l'écran Partir, « Mes trains suivis » et la carte de l'accueil, pour qu'ils disent la même chose.
import { useEffect, useMemo, useState } from "react";
import { useIndexHoraires, trouverGare, DOSSIER, useTempsReel, useRisques } from "./horaires";
import { etatDuTrain } from "./favorisPlus";
import { momentDuVoyage, enMinutes, arriveeDuSuivi } from "./moment";

const enCache = new Map();        // les horaires d'une gare pour un jour : chargés une seule fois
function chargerDeparts(slug, jour) {
  const cle = `${slug}/${jour}`;
  if (!enCache.has(cle)) {
    enCache.set(cle, fetch(`${DOSSIER}/${cle}.json`).then((r) => r.json()).then((d) => d.departs || [])
      .catch(() => { enCache.delete(cle); return []; }));
  }
  return enCache.get(cle);
}

export const aujourdhuiLocal = () => new Date().toLocaleDateString("sv-SE");

// Renvoie { etat, departs, direct } ; direct : { retardDepart, retardArrivee, supprime } ou null (pas de nouvelles)
export function useDirectSuivi(suivi, jour) {
  const { index } = useIndexHoraires();
  const aujourdhui = Boolean(suivi) && jour === aujourdhuiLocal();
  const tempsReel = useTempsReel(aujourdhui);
  const risques = useRisques();
  const [departs, setDeparts] = useState(null);
  const gare = useMemo(() => (index && suivi ? trouverGare(index.gares, suivi.de) : null), [index, suivi?.de]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!gare || !jour) return undefined;
    let annule = false;
    chargerDeparts(gare.slug, jour).then((d) => { if (!annule) setDeparts(d); });
    return () => { annule = true; };
  }, [gare?.slug, jour]);   // eslint-disable-line react-hooks/exhaustive-deps
  const etat = departs && suivi ? etatDuTrain(suivi, departs, aujourdhui ? tempsReel : null, risques) : null;
  const direct = etat?.statut === "supprime" ? { supprime: true }
    : etat && (etat.statut === "retard" || etat.statut === "heure")
      ? { retardDepart: etat.retardDepart ?? 0, retardArrivee: etat.retardArrivee ?? 0, supprime: false } : null;
  return { etat, departs, direct };
}

// Le moment du voyage d'un train suivi, recalculé toutes les 30 s avec le direct (voir moment.js).
// aller : celui à utiliser (l'écran Partir passe l'aller recalculé depuis là où l'on est).
const maintenantEnMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
export function useMomentDuSuivi(suivi, jour, aller = suivi?.aller) {
  const direct = useDirectSuivi(suivi, jour);
  const [maintenant, setMaintenant] = useState(maintenantEnMinutes);
  useEffect(() => { const m = setInterval(() => setMaintenant(maintenantEnMinutes()), 30_000); return () => clearInterval(m); }, []);
  if (!suivi || jour !== aujourdhuiLocal()) return { ...direct, moment: { etape: "autrejour" }, maintenant };
  const moment = momentDuVoyage({ maintenant, depart: enMinutes(suivi.heure), arrivee: arriveeDuSuivi(suivi), direct: direct.direct, aller });
  return { ...direct, moment, maintenant };
}
