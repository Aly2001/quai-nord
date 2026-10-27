import { describe, test, expect } from "vitest";
import { ajouterSansPerdre, placeRestante, MAXIMUM_LISTE } from "./listeLimitee";
import { nettoyer } from "./suivi";

const id = (x) => x.heure;
const trains = (...heures) => heures.map((heure) => ({ heure }));

describe("une liste limitée ne perd jamais rien sans le choix du voyageur", () => {
  test("la limite est de 5", () => expect(MAXIMUM_LISTE).toBe(5));
  test("tant qu'il reste de la place : ajouté en tête", () => {
    const r = ajouterSansPerdre(trains("07:13", "12:04"), { heure: "08:12" }, id);
    expect([r.plein, r.liste.map(id)]).toEqual([false, ["08:12", "07:13", "12:04"]]);
  });
  test("pleine : l'ajout est refusé, et la liste reste INTACTE (plus de suppression silencieuse)", () => {
    const cinq = trains("07:13", "12:04", "17:12", "14:37", "09:20");
    const r = ajouterSansPerdre(cinq, { heure: "08:12" }, id);
    expect(r.plein).toBe(true);
    expect(r.liste).toBe(cinq);
  });
  test("pleine, mais l'élément y est déjà : il remonte en tête, rien n'est perdu", () => {
    const r = ajouterSansPerdre(trains("07:13", "12:04", "17:12", "14:37", "09:20"), { heure: "17:12" }, id);
    expect([r.plein, r.liste.map(id)]).toEqual([false, ["17:12", "07:13", "12:04", "14:37", "09:20"]]);
  });
  test("après en avoir retiré un, le nouveau passe", () => {
    const quatre = trains("07:13", "12:04", "17:12", "09:20");
    expect(ajouterSansPerdre(quatre, { heure: "08:12" }, id).plein).toBe(false);
    expect([placeRestante(quatre), placeRestante(trains("a", "b", "c", "d", "e"))]).toEqual([1, 0]);
  });
  test("un voyage déjà terminé ne prend pas de place : le ménage passe avant le compte", () => {
    const fini = { de: "Boulogne sur Mer", a: "Paris Nord", heure: "12:04", arrivee: "14:46", repetition: "une", jour: "2026-10-20" };
    const semaine = (heure) => ({ de: "Calais Ville", a: "Boulogne sur Mer", heure, arrivee: "23:00", repetition: "semaine" });
    const liste = [fini, semaine("07:13"), semaine("08:13"), semaine("17:12"), semaine("18:12")];
    const { gardes } = nettoyer(liste, new Date("2026-10-27T10:00:00"));
    expect(ajouterSansPerdre(gardes, semaine("19:12"), (s) => s.heure).plein).toBe(false);
  });
});
