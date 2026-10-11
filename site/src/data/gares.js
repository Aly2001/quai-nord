// Les gares affichées sur la carte.
// x, y : position sur la carte, en % de sa largeur et de sa hauteur
//        (calculée à partir de la longitude et de la latitude).
// taux : % de passages avec 5 min de retard ou plus (null = moins de 30 passages)
// passages : nombre de passages observés
// Mesures du 9 octobre 2026.

export const gares = [
  { nom: "Boulogne-sur-Mer", x: 10.4, y: 18.4, taux: null, passages: null },
  { nom: "Calais", x: 18.4, y: 8.4, taux: null, passages: null },
  { nom: "Dunkerque", x: 35.6, y: 5.1, taux: null, passages: null },
  { nom: "Lille Flandres", x: 59.0, y: 21.8, taux: 14.6, passages: 96 },
  { nom: "Arras", x: 49.4, y: 36.7, taux: 16.7, passages: 36 },
  { nom: "Douai", x: 59.7, y: 33.2, taux: 18.9, passages: 37 },
  { nom: "Hazebrouck", x: 41.2, y: 18.2, taux: 18.2, passages: 33 },
  { nom: "Amiens", x: 33.6, y: 53.6, taux: 12.5, passages: 48 },
  { nom: "Creil", x: 39.0, y: 80.3, taux: 27.8, passages: 36 },
  { nom: "Saint-Quentin", x: 66.2, y: 55.7, taux: null, passages: null },
  { nom: "Beauvais", x: 26.1, y: 73.2, taux: null, passages: null },
  { nom: "Compiègne", x: 50.9, y: 73.5, taux: null, passages: null },
  { nom: "Laon", x: 77.2, y: 67.2, taux: null, passages: null },
  { nom: "Abbeville", x: 17.5, y: 44.6, taux: null, passages: null },
  { nom: "Étaples", x: 11.3, y: 27.1, taux: null, passages: null },
  { nom: "Valenciennes", x: 73.9, y: 33.5, taux: null, passages: null },
  { nom: "Lens", x: 51.1, y: 30.7, taux: null, passages: null },
];

// Contour simplifié des Hauts-de-France (le même que dans charger_gtfs.py),
// converti en coordonnées de dessin pour une carte de 520 × 634.
export const contourRegion =
  "M13.9,291.4 L34.7,202.3 L38.1,54.0 L121.3,27.0 L216.7,16.2 L230.5,89.0 " +
  "L286.0,121.4 L320.7,97.1 L346.7,167.3 L407.3,188.9 L424.7,215.8 L476.7,215.8 " +
  "L502.7,237.4 L494.0,283.3 L511.3,323.7 L476.7,391.2 L476.7,472.1 L409.1,539.6 " +
  "L377.9,623.2 L312.0,566.6 L225.3,553.1 L156.0,534.2 L86.7,526.1 L69.3,499.1 " +
  "L78.0,391.2 Z";
