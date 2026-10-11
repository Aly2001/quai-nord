// Résultats D'EXEMPLE : le vrai modèle sera entraîné sur plusieurs semaines de collecte.

export const trajet = {
  depart: "Boulogne-Tintelleries",
  arrivee: "Lille Flandres",
  jour: "Lundi 12 octobre 2026",
};

// Les trains possibles pour ce trajet, avec le risque prédit (en %)
export const trains = [
  {
    numero: "847101", depart: "06:52", arrivee: "08:12", info: "1 correspondance", risque: 18,
    facteurs: [
      { nom: "Heure de pointe du matin", effet: "augmente", force: 35, detail: "Départ avant le pic de 7 h - 9 h." },
      { nom: "Correspondance à Calais", effet: "augmente", force: 30, detail: "Un retard du premier train peut faire manquer le second." },
      { nom: "Ponctualité habituelle", effet: "réduit", force: 50, detail: "Ces trains sont d'ordinaire ponctuels." },
    ],
  },
  {
    numero: "847103", depart: "07:24", arrivee: "08:41", info: "direct", risque: 41,
    facteurs: [
      { nom: "Heure de pointe du matin", effet: "augmente", force: 80, detail: "Entre 7 h et 9 h, les retards sont les plus fréquents." },
      { nom: "Position dans le trajet", effet: "augmente", force: 65, detail: "Lille Flandres est la 9e gare du trajet : le retard s'accumule." },
      { nom: "Météo prévue", effet: "augmente", force: 30, detail: "Vent fort annoncé sur la côte." },
      { nom: "Ponctualité habituelle", effet: "réduit", force: 40, detail: "Ce train est d'ordinaire plus ponctuel que la moyenne." },
    ],
  },
  {
    numero: "847107", depart: "08:52", arrivee: "10:09", info: "direct", risque: 22,
    facteurs: [
      { nom: "Fin de l'heure de pointe", effet: "augmente", force: 35, detail: "Le trafic commence à se libérer après 9 h." },
      { nom: "Position dans le trajet", effet: "augmente", force: 60, detail: "Lille Flandres est la 9e gare du trajet." },
    ],
  },
  {
    numero: "847109", depart: "10:12", arrivee: "11:30", info: "direct", risque: 15,
    facteurs: [
      { nom: "Heure creuse", effet: "réduit", force: 55, detail: "Moins de trains et de voyageurs en milieu de matinée." },
      { nom: "Position dans le trajet", effet: "augmente", force: 60, detail: "Lille Flandres est la 9e gare du trajet." },
    ],
  },
];
