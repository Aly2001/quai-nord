// Sur les VRAIES données de Calais : chaque bus du panneau garde SA course (et donc ses arrêts)
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { coursesALArret, passagesALArret, journeeALArret, arretsDeLaCourse, terminusDeLaCourse } from "./trajetBus";
import { joliNom } from "./bus";

const lire = (f) => JSON.parse(readFileSync(new URL(`../../public/bus/${f}`, import.meta.url)));
const reseau = lire("calais.json");
const horaires = lire("calais_horaires.json");
const gare = Object.entries(reseau.arrets).filter(([, a]) => a[0] === "GARE").map(([id]) => id);
const JEUDI = "2026-11-05";
const ligne4 = Object.entries(reseau.lignes).find(([, l]) => l.nom === "4")[0];

describe("chaque bus se touche : ses arrêts, ceux de SA course", () => {
  test("le panneau de la Gare garde, pour chaque heure, la course qui passe", () => {
    const passages = passagesALArret(reseau, horaires, gare, JEUDI, 17 * 60, 3);
    const g = passages.find((x) => x.ligneId === ligne4);
    expect(g.courses.length).toBe(g.heures.length);
    expect(g.courses.map((c) => c.depart)).toEqual(g.heures);
  });

  test("même direction, autre trajet : la variante par la digue a ses propres arrêts", () => {
    const groupes = coursesALArret(reseau, horaires, gare, JEUDI, 0, 1440).filter((g) => g.ligneId === ligne4);
    const nombres = new Set();
    for (const g of groupes) for (const c of g.courses) {
      const apres = arretsDeLaCourse(reseau, c, joliNom).filter((a) => a.role !== "avant");
      nombres.add(apres.length);
      expect(apres[0].minute).toBe(c.depart);                       // la course commence bien à la Gare, à son heure
    }
    expect(nombres.size).toBeGreaterThan(1);                         // des courses de longueurs différentes
  });

  test("la journée d'un bus favori : une ligne, une direction, un arrêt, dans l'ordre", () => {
    const groupe = coursesALArret(reseau, horaires, gare, JEUDI, 0, 1440).find((g) => g.ligneId === ligne4);
    const jour = journeeALArret(reseau, horaires, gare, JEUDI, ligne4, groupe.direction);
    expect(jour.length).toBeGreaterThan(10);
    expect(jour.every((c, i) => i === 0 || c.depart > jour[i - 1].depart)).toBe(true);
    expect(terminusDeLaCourse(reseau, jour[0].parcours, "4")).toBeTruthy();
  });
});
