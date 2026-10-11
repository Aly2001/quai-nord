// Les chiffres du site, séparés de l'affichage.
// Aujourd'hui ils sont écrits à la main (mesures du 9 octobre 2026).
// Plus tard, ils viendront de l'API FastAPI : seul ce fichier changera.

export const chiffreVedette = {
  valeur: "22,3 %",
  texte: "des trains suivis arrivaient avec 5 minutes de retard ou plus à leur dernière gare observée.",
  source: "2 513 trains, France entière, le 9 octobre 2026 entre 5 h et 9 h. Une seule matinée : tendance à confirmer.",
};

export const chiffresCles = [
  { valeur: "17,6 %", texte: "des passages en gare avec 5 min de retard ou plus" },
  { valeur: "18 344", texte: "passages en gare constatés" },
  { valeur: "334", texte: "gares suivies dans les Hauts-de-France" },
  { valeur: "5 min", texte: "entre deux collectes du flux temps réel" },
];

export const retardParHeure = [
  { etiquette: "5 h", taux: 5.8 },
  { etiquette: "6 h", taux: 12.7 },
  { etiquette: "7 h", taux: 15.4 },
  { etiquette: "8 h", taux: 15.9 },
  { etiquette: "9 h", taux: 11.0 },
];

export const decouvertes = [
  {
    chiffre: "0, 5, 10, 15",
    couleur: "var(--mer)",
    titre: "Les retards vont par paliers de 5 minutes",
    texte: "Presque aucun retard de 1 à 4 minutes : la SNCF arrondit ses annonces. Quai Nord prédit donc un seuil (5 min ou plus) plutôt qu'un nombre exact de minutes.",
    lien: "/analyses",
    lienTexte: "Lire l'analyse",
  },
  {
    chiffre: "9 % → 24 %",
    couleur: "var(--retard)",
    titre: "Le retard s'accumule au fil du trajet",
    texte: "De la première gare à la quatorzième et au-delà, la part de passages en retard est multipliée par plus de deux.",
    lien: "/analyses",
    lienTexte: "Lire l'analyse",
  },
  {
    chiffre: "27,8 %",
    couleur: "var(--nuit)",
    titre: "Creil, gare la plus touchée de la région",
    texte: "Sur l'axe très chargé vers Paris, devant Douai (18,9 %) et Hazebrouck (18,2 %). Calculé sur 36 passages seulement.",
    lien: "/carte",
    lienTexte: "Voir la carte",
  },
];
