import { test, expect } from "vitest";
import { rappelsBusPourLeServeur, idBus } from "./busFavoris";

const favori = (rappel) => ({ code: "calais", ligneId: "7", ligne: { nom: "4", couleur: "#FF9900" }, direction: "C.cial la Francaise",
  arret: { nom: "UFR", ids: ["A", "B"] }, ...(rappel ? { rappel } : {}) });

test("le serveur ne reçoit que les bus avec un rappel, et le strict nécessaire (jamais la position)", () => {
  const envoi = rappelsBusPourLeServeur([favori(), favori({ heure: 615, jours: [0, 1, 2, 3, 4], avance: 5 })]);
  expect(envoi).toEqual([{ code: "calais", ligneId: "7", ligne: "4", direction: "C.cial la Francaise", arret: "UFR",
    ids: ["A", "B"], heure: 615, jours: [0, 1, 2, 3, 4], avance: 5 }]);
});

test("un bus favori se reconnaît par sa ville, sa ligne, sa direction et son arrêt", () => {
  expect(idBus(favori())).toBe("calais|7|C.cial la Francaise|UFR");
});
