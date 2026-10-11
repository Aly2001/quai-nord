// Résultats réels de l'analyse (analyse_02.py), collecte des 8 et 9 octobre 2026.

export const resume = [
  { valeur: "28 857", texte: "passages collectés" },
  { valeur: "18 344", texte: "retards constatés" },
  { valeur: "2 513", texte: "trains suivis" },
  { valeur: "5 min", texte: "seuil de retard" },
];

// Nombre de passages par retard annoncé (soirée du 8 octobre, hors 0 min)
export const paliers = [
  { etiquette: "1 min", taux: 18, couleur: "var(--retard)" },
  { etiquette: "2 min", taux: 7, couleur: "var(--retard)" },
  { etiquette: "5 min", taux: 754 },
  { etiquette: "10 min", taux: 264 },
  { etiquette: "15 min", taux: 135 },
  { etiquette: "20 min", taux: 94 },
  { etiquette: "25 min", taux: 66 },
  { etiquette: "30 min", taux: 82 },
];

// Taux de retard selon la position de la gare dans le trajet
export const parPosition = [
  { tranche: "1re gare", taux: 9.2, passages: 2512 },
  { tranche: "2e à 4e", taux: 15.6, passages: 6388 },
  { tranche: "5e à 8e", taux: 20.2, passages: 5429 },
  { tranche: "9e à 13e", taux: 22.4, passages: 2851 },
  { tranche: "14e et +", taux: 24.0, passages: 1164 },
];

export const parHeure = [
  { etiquette: "5 h", taux: 5.8 },
  { etiquette: "6 h", taux: 12.7 },
  { etiquette: "7 h", taux: 15.4 },
  { etiquette: "8 h", taux: 15.9 },
  { etiquette: "9 h", taux: 11.0 },
];

export const methode = [
  { titre: "Collecte", texte: "Flux temps réel SNCF (GTFS-RT) toutes les 5 minutes, relié aux horaires théoriques (GTFS)." },
  { titre: "Retard", texte: "Heure réelle moins heure prévue. En retard à partir de 5 minutes." },
  { titre: "Fiabilité", texte: "Retards constatés uniquement. Aucun taux affiché sous 30 passages." },
  { titre: "Limites", texte: "Deux jours de données, toute la France. Les causes des retards ne sont pas connues." },
];
