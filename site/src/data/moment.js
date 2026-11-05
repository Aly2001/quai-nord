// =====================================================================
//  LE MOMENT DU VOYAGE : ce qu'il faut dire MAINTENANT, recalculé à chaque minute.
//  Une seule règle pour l'écran Partir, « Mes trains suivis » et la carte de l'accueil :
//   - tout part de MAINTENANT (jamais d'étape à une heure déjà passée) ;
//   - « parti » et « arrivé » se calculent avec les heures ANNONCÉES par la SNCF (retard compris),
//     et se disent avec « devrait » : le direct donne les heures, pas la position du train ;
//   - par prudence, l'heure de partir de chez soi reste calculée sur l'heure PRÉVUE du train.
//  Toutes les heures sont en minutes depuis minuit.
// =====================================================================
export const MARGE_SERREE = 2;     // arriver à la gare moins de 2 min avant l'heure prévue : c'est serré

// direct : { retardDepart, retardArrivee (en minutes), supprime } ou null (pas de nouvelles fraîches)
// aller  : l'aller enregistré ({ mode: "pied" | "bus", departMaison, marche, marcheAvant, heureBus, arriveeGare })
export function momentDuVoyage({ maintenant, depart, arrivee, direct = null, aller = null }) {
  if (direct?.supprime) return { etape: "supprime" };
  const retardDepart = Math.max(0, direct?.retardDepart ?? 0);
  const retardArrivee = Math.max(0, direct?.retardArrivee ?? direct?.retardDepart ?? 0);
  const departAnnonce = depart + retardDepart;
  const arriveeAnnoncee = arrivee + retardArrivee;
  const annonce = { departAnnonce, arriveeAnnoncee, retardDepart, retardArrivee, direct: Boolean(direct) };

  if (maintenant >= arriveeAnnoncee) return { etape: "arrive", ...annonce };
  if (maintenant >= departAnnonce) return { etape: "enroute", ...annonce, minutes: arriveeAnnoncee - maintenant };

  const utile = aller && (aller.mode === "pied" || aller.mode === "bus") ? aller : null;
  if (!utile) return { etape: "avant", ...annonce, minutes: departAnnonce - maintenant, sansAller: true };
  if (maintenant < utile.departMaison) return { etape: "avant", ...annonce, minutes: utile.departMaison - maintenant };

  // L'heure de partir de chez soi est atteinte ou passée : où en serait-on en partant MAINTENANT ?
  let arriveeGare;
  if (utile.mode === "pied") arriveeGare = maintenant + utile.marche;
  else if (maintenant + (utile.marcheAvant || 0) <= utile.heureBus) arriveeGare = utile.arriveeGare;
  else return { etape: "busrate", ...annonce, heureBus: utile.heureBus };

  const base = { ...annonce, arriveeGare, minutesTrain: departAnnonce - maintenant };
  if (arriveeGare <= depart - MARGE_SERREE) return { etape: "maintenant", ...base };   // on a le temps : pas d'alarme
  if (arriveeGare <= depart) return { etape: "serre", ...base };                       // juste à l'heure prévue
  if (arriveeGare < departAnnonce) return { etape: "sauve", ...base };                 // possible grâce au retard annoncé
  return { etape: "troptard", ...base };
}

export const enMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export function arriveeDuSuivi(suivi) {
  const a = enMinutes(suivi.arrivee);
  return a < enMinutes(suivi.heure) ? a + 24 * 60 : a;        // arrivée après minuit
}
