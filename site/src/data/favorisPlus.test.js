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

// Le 12:48 de Boulogne - Tintelleries : un 1er train jusqu'à Boulogne sur Mer, puis le K16 jusqu'à Calais Ville
const k21 = { heure: "12:48", trip_id: "T848810", stop_id: "BT", numero: "848810", ligne: "K21",
  suite: [{ gare: "Boulogne sur Mer", heure: "12:50", stop_id: "BV" }] };
const k16 = { heure: "12:58", trip_id: "T16366", stop_id: "BV", numero: "16366", ligne: "K16",
  suite: [{ gare: "Calais Ville", heure: "13:22", stop_id: "CV" }] };
const avecCorresp = { de: "Boulogne - Tintelleries", a: "Calais Ville", heure: "12:48", arrivee: "13:22" };
const fichiers = { "Boulogne sur Mer": { departs: [k16] } };
const risquesK16 = { par_train: { 16366: { taux: 0.46, n: 30 } }, par_ligne_heure: {}, par_heure: {} };

test("un trajet avec correspondance n'est PAS « absent » (le 12:48 via Boulogne sur Mer)", () => {
  expect(etatDuTrain(avecCorresp, [k21], null, risquesK16).statut).toBe("attente");          // horaires pas encore chargés
  const e = etatDuTrain(avecCorresp, [k21], null, risquesK16, fichiers);
  expect([e.statut, e.risque, e.trajet.correspondance.gare]).toEqual(["prevu", 46, "Boulogne sur Mer"]);
});

test("un trajet avec correspondance : départ du 1er train, arrivée du 2e", () => {
  const direct = frais({ T848810: { statut: "PREVU", arrets: { BT: [null, 120, 0] } },
                         T16366: { statut: "PREVU", arrets: { BV: [null, 0, 0], CV: [480, null, 0] } } });
  const e = etatDuTrain(avecCorresp, [k21], direct, risquesK16, fichiers);
  expect([e.statut, e.minutes, e.retardDepart, e.retardArrivee]).toEqual(["retard", 8, 2, 8]);
  const supprime = frais({ T16366: { statut: "SUPPRIME", arrets: {} } });
  expect(etatDuTrain(avecCorresp, [k21], supprime, risquesK16, fichiers).statut).toBe("supprime");
});

test("aucun train à cette heure : vraiment absent, sans attendre", () => {
  expect(etatDuTrain({ ...avecCorresp, heure: "12:49" }, [k21], null, risquesK16).statut).toBe("absent");
});
