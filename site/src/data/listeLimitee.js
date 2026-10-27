// =====================================================================
//  Les listes limitées (trains suivis, trains favoris, trajets favoris) : 5 éléments au plus.
//  Règle : on ne retire JAMAIS un élément sans le choix du voyageur. Quand la liste est pleine,
//  l'ajout est refusé (« plein ») et l'écran demande lequel retirer.
// =====================================================================
export const MAXIMUM_LISTE = 5;

// Ajouter en tête, sans doublon : { liste, plein }. Un élément déjà présent remonte simplement en tête.
export function ajouterSansPerdre(liste, element, id, maximum = MAXIMUM_LISTE) {
  const autres = liste.filter((x) => id(x) !== id(element));
  if (autres.length >= maximum) return { liste, plein: true };
  return { liste: [element, ...autres], plein: false };
}

export const placeRestante = (liste, maximum = MAXIMUM_LISTE) => Math.max(0, maximum - liste.length);
