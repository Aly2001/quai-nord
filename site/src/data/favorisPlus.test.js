import { test, expect } from "vitest";
import { etatDuTrain, idTrain } from "./favorisPlus";

// Le train de 17:12, de Boulogne sur Mer à Calais Ville
const train = { heure: "17:12", trip_id: "T1712", stop_id: "BV", numero: "848710", ligne: "K21",
  suite: [{ gare: "Calais Ville", heure: "17:44", stop_id: "CV" }] };
const favori = { de: "Boulogne sur Mer", a: "Calais Ville", heure: "17:12" };
const frais = (trajets) => ({ maj: Date.now() / 1000, trajets });
const risques = { par_train: { 848710: { taux: 0.22, n: 40 } }, par_ligne_heure: {}, par_heure: {} };

test("le même train se reconnaît d'un jour à l'autre", () => {
  expect(idTrain(favori)).toBe("Boulogne sur Mer|Calais Ville|17:12");
});
test("il ne circule pas ce jour-là", () => {
  expect(etatDuTrain(favori, [], null, risques).statut).toBe("absent");
});
test("supprimé, en retard, à l'heure : ce que dit le direct", () => {
  expect(etatDuTrain(favori, [train], frais({ T1712: { statut: "SUPPRIME", arrets: {} } }), risques).statut).toBe("supprime");
  const retard = etatDuTrain(favori, [train], frais({ T1712: { statut: "PREVU", arrets: { BV: [null, 360, 0], CV: [360, null, 0] } } }), risques);
  expect([retard.statut, retard.minutes]).toEqual(["retard", 6]);
  expect(etatDuTrain(favori, [train], frais({ T1712: { statut: "PREVU", arrets: { BV: [null, 0, 0] } } }), risques).statut).toBe("heure");
});
test("sans direct : son risque habituel", () => {
  const e = etatDuTrain(favori, [train], null, risques);
  expect([e.statut, e.risque, e.niveau.mot]).toEqual(["prevu", 22, "Modéré"]);
});
