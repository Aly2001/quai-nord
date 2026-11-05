import { test, expect } from "vitest";
import { rappelsBusPourLeServeur, rappelsValides, rappelDuBus, idBus } from "./busFavoris";

const favori = (rappel) => ({ code: "calais", ligneId: "7", ligne: { nom: "4", couleur: "#FF9900" }, direction: "C.cial la Francaise",
  arret: { nom: "UFR", ids: ["A", "B"] }, ...(rappel ? { rappel } : {}) });

test("le serveur reçoit les rappels posés sur un bus précis, et le strict nécessaire (jamais la position)", () => {
  const envoi = rappelsBusPourLeServeur([favori(), { ...favori(), rappels: [
    { heure: 1167, repetition: "semaine", avance: 5 },
    { heure: 1167, repetition: "une", jour: "2099-01-02", avance: 3 },          // un vendredi
  ] }]);
  expect(envoi).toEqual([
    { code: "calais", ligneId: "7", ligne: "4", direction: "C.cial la Francaise", arret: "UFR", ids: ["A", "B"], heure: 1167, avance: 5, jours: [0, 1, 2, 3, 4], jour: null },
    { code: "calais", ligneId: "7", ligne: "4", direction: "C.cial la Francaise", arret: "UFR", ids: ["A", "B"], heure: 1167, avance: 3, jours: [4], jour: "2099-01-02" },
  ]);
});

test("un rappel « une fois » passé, ou un ancien rappel « vers 08:00 » tapé à la main, ne compte plus", () => {
  const rappels = [{ heure: 480, jours: [0], avance: 5 }, { heure: 600, repetition: "une", jour: "2026-11-05", avance: 5 },
    { heure: 1200, repetition: "une", jour: "2026-11-05", avance: 5 }, { heure: 450, repetition: "tous", avance: 5 }];
  expect(rappelsValides(rappels, "2026-11-05", 19 * 60).map((r) => r.heure)).toEqual([1200, 450]);
});

test("la petite cloche : le bon bus, le bon jour", () => {
  const f = { ...favori(), rappels: [{ heure: 1167, repetition: "semaine", avance: 5 }] };
  expect(rappelDuBus(f, 1167, "2099-01-02")).toBeTruthy();                       // vendredi
  expect(rappelDuBus(f, 1167, "2099-01-03")).toBeFalsy();                        // samedi
  expect(rappelDuBus(f, 1180, "2099-01-02")).toBeFalsy();                        // un autre bus
});

test("un bus favori se reconnaît par sa ville, sa ligne, sa direction et son arrêt", () => {
  expect(idBus(favori())).toBe("calais|7|C.cial la Francaise|UFR");
});
