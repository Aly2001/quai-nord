// =====================================================================
//  Tests automatiques des fonctions de horaires.js
//  Lancement (dans le dossier site) :  npm test
//
//  Chaque test suit la même idée : « si je donne ÇA, je dois obtenir ÇA ».
//  - describe(...) : regroupe des tests sur un même sujet
//  - test(...)     : un test, avec une phrase qui dit ce qu'il vérifie
//  - expect(résultat).toBe(attendu) : la vérification elle-même
// =====================================================================
import { describe, test, expect } from "vitest";
import {
  duree, formatDuree, enMinutes, normaliser, trouverGare, niveauRisque, garderMeilleurs,
} from "./horaires";

// ---------- 1. Les durées ----------
describe("duree", () => {
  test("un trajet de 15:47 à 18:31 dure 2 h 44", () => {
    expect(duree("15:47", "18:31")).toBe("2 h 44");
  });

  test("un trajet de moins d'une heure s'affiche en minutes", () => {
    expect(duree("07:11", "07:45")).toBe("34 min");
  });

  test("un trajet qui passe minuit (23:50 → 00:20) dure 30 min, pas -23 h 30", () => {
    expect(duree("23:50", "00:20")).toBe("30 min");
  });
});

describe("formatDuree et enMinutes", () => {
  test("164 minutes s'écrivent 2 h 44", () => {
    expect(formatDuree(164)).toBe("2 h 44");
  });

  test("les minutes gardent toujours deux chiffres (1 h 05, pas 1 h 5)", () => {
    expect(formatDuree(65)).toBe("1 h 05");
  });

  test("07:30 correspond à 450 minutes après minuit", () => {
    expect(enMinutes("07:30")).toBe(450);
  });
});

// ---------- 2. La recherche des gares ----------
describe("normaliser et trouverGare", () => {
  const gares = [
    { slug: "lille-flandres", nom: "Lille Flandres" },
    { slug: "lille-europe", nom: "Lille Europe" },
    { slug: "calais-ville", nom: "Calais Ville" },
  ];

  test("les accents, tirets et majuscules sont ignorés", () => {
    expect(normaliser("Lille-Flandrès")).toBe("lille flandres");
  });

  test("le nom exact est trouvé en priorité", () => {
    expect(trouverGare(gares, "lille europe").slug).toBe("lille-europe");
  });

  test("un début de nom suffit", () => {
    expect(trouverGare(gares, "cal").slug).toBe("calais-ville");
  });

  test("une gare inconnue renvoie null", () => {
    expect(trouverGare(gares, "Paris")).toBeNull();
  });
});

// ---------- 3. Les niveaux de risque ----------
describe("niveauRisque", () => {
  test("moins de 15 % : faible", () => expect(niveauRisque(6).mot).toBe("Faible"));
  test("de 15 à 30 % : modéré", () => expect(niveauRisque(22).mot).toBe("Modéré"));
  test("30 % et plus : élevé", () => expect(niveauRisque(41).mot).toBe("Élevé"));
});

// ---------- 4. Le tri des trajets ----------
describe("garderMeilleurs", () => {
  // Petite fonction pour fabriquer un trajet de test
  const trajet = (heure, dureeMin, avecCorrespondance) => ({
    heure,
    dureeMin,
    arrivee: "",
    correspondance: avecCorrespondance ? { gare: "Amiens", attente: 10 } : null,
  });

  test("un trajet avec correspondance « dominé » est retiré", () => {
    const direct = trajet("08:00", 80, false);             // 08:00 → 09:20
    const moinsBon = trajet("07:11", 133, true);            // 07:11 → 09:24 : part avant, arrive après
    expect(garderMeilleurs([direct], [moinsBon])).toEqual([direct]);
  });

  test("un trajet avec correspondance qui part plus tard est gardé", () => {
    const direct = trajet("08:00", 80, false);
    const plusTard = trajet("08:11", 133, true);           // part après le direct
    expect(garderMeilleurs([direct], [plusTard])).toHaveLength(2);
  });

  test("les trains directs sont toujours gardés", () => {
    const lent = trajet("08:00", 120, false);
    const rapide = trajet("08:05", 60, false);
    expect(garderMeilleurs([lent, rapide], [])).toHaveLength(2);
  });
});
