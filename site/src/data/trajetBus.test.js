import { describe, test, expect } from "vitest";
import { calendriersDuJour, prochainsPassages, trajetEntrePoints, minutesEnHeure, arretsDeLaCourse } from "./trajetBus";

// Un petit réseau : la ligne 5 va de A1 (près de A) à B1 (près de B) en 10 min, 3 arrêts.
const reseau = {
  lignes: { L5: { nom: "5", couleur: "#8B3A1E", texte: "#FFFFFF", mode: "bus", long: "Ligne 5" } },
  arrets: { A1: ["Place de Lorraine", 50.7200, 1.6000], M1: ["Milieu", 50.7250, 1.6050], B1: ["Gare", 50.7400, 1.6200] },
  parcours: [{ ligne: "L5", direction: "Gare", arrets: ["A1", "M1", "B1"], voyages: 40, minutes: [0, 4, 10] }],
};
// Calendrier 0 : tous les jours de semaine du 19 au 25 octobre (le 24 est un samedi, le 25 un dimanche)
// Calendrier 1 : le samedi 24 seulement, avec un bus de nuit à 25:10 (1:10 le dimanche)
const horaires = { debut: "2026-10-19", jours: ["1111100", "0000010"], departs: [{ 0: [380, 400, 870, 885], 1: [1510] }] };
const A = { lat: 50.7201, lon: 1.6001 };
const B = { lat: 50.7401, lon: 1.6201 };

describe("les calendriers", () => {
  test("un jour de semaine, un samedi, un jour hors du fichier", () => {
    expect([...calendriersDuJour(horaires, "2026-10-21")]).toEqual(["0"]);
    expect([...calendriersDuJour(horaires, "2026-10-24")]).toEqual(["1"]);
    expect([...calendriersDuJour(horaires, "2026-10-18")]).toEqual([]);
  });
});

describe("les prochains passages", () => {
  test("à partir de 14:20, les bus de 14:30 et 14:45", () => {
    const p = prochainsPassages(reseau, horaires, "L5", "A1", "B1", "2026-10-21", 860);
    expect(p.map((x) => minutesEnHeure(x.depart))).toEqual(["14:30", "14:45"]);
    expect(minutesEnHeure(p[0].arrivee)).toBe("14:40");                 // 10 minutes de trajet
  });
  test("à un arrêt du milieu : le départ du voyage + la durée jusqu'à l'arrêt", () => {
    const p = prochainsPassages(reseau, horaires, "L5", "M1", "B1", "2026-10-21", 0);
    expect(minutesEnHeure(p[0].depart)).toBe("06:24");                  // 6:20 + 4 min
  });
  test("le bus de nuit de samedi (25:10) passe le dimanche à 01:10", () => {
    const p = prochainsPassages(reseau, horaires, "L5", "A1", "B1", "2026-10-25", 0);
    expect(p.map((x) => minutesEnHeure(x.depart))).toEqual(["01:10"]);
  });
  test("dans le mauvais sens : aucun bus", () => {
    expect(prochainsPassages(reseau, horaires, "L5", "B1", "A1", "2026-10-21", 0)).toEqual([]);
  });
});

describe("le trajet de A à B", () => {
  test("en semaine : le bus, avec ses prochains départs", () => {
    const t = trajetEntrePoints(reseau, horaires, A, B, "2026-10-21", 860);
    expect(t.conseil).toBe("bus");
    expect(t.bus[0].ligne.nom).toBe("5");
    expect(t.bus[0].passages.length).toBe(2);
    expect(t.minutesAPied).toBeGreaterThan(20);
  });
  test("le soir, plus de bus aujourd'hui : le premier de demain", () => {
    const t = trajetEntrePoints(reseau, horaires, A, B, "2026-10-21", 1200);
    expect(t.bus).toEqual([]);
    expect(t.conseil).toBe("demain");
    expect(minutesEnHeure(t.lendemain.passages[0].depart)).toBe("06:20");
  });
  test("un bus existe, mais l'attente le rend plus lent que la marche : on conseille la marche, et on montre le bus", () => {
    // B à environ 10 min à pied ; le prochain bus part dans 1 h
    const presDeB = { lat: 50.7262, lon: 1.6062 };
    const reseauCourt = { ...reseau, arrets: { ...reseau.arrets, B1: ["Gare", 50.7262, 1.6062] } };
    const t = trajetEntrePoints(reseauCourt, horaires, A, presDeB, "2026-10-21", 810);
    expect(t.conseil).toBe("pied");
    expect(t.bus.length).toBe(1);
  });
  test("aucune ligne directe, et loin : aucun", () => {
    const loin = { lat: 50.80, lon: 1.70 };
    expect(trajetEntrePoints(reseau, horaires, A, loin, "2026-10-21", 860).conseil).toBe("aucun");
  });
  test("deux points tout proches : à pied", () => {
    const t = trajetEntrePoints(reseau, horaires, A, { lat: 50.7215, lon: 1.6010 }, "2026-10-21", 860);
    expect(t.conseil).toBe("pied");
  });
});


test("le détail de la course : chaque arrêt, son heure, et son rôle", () => {
  const [p] = prochainsPassages(reseau, horaires, "L5", "M1", "B1", "2026-10-21", 860);
  const arrets = arretsDeLaCourse(reseau, p);
  expect(arrets.map((a) => [a.nom, minutesEnHeure(a.minute), a.role])).toEqual([
    ["Place de Lorraine", "14:30", "avant"], ["Milieu", "14:34", "montee"], ["Gare", "14:40", "descente"],
  ]);
});
