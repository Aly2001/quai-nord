import { describe, test, expect } from "vitest";
import { proposerGares, morceauxEnGras } from "./suggestionsGares";

const noms = ["Lille Flandres", "Lille Europe", "Lillers", "Paris Gare du Nord", "Boulogne sur Mer", "Boulogne - Tintelleries",
  "Calais Ville", "Calais - Fréthun", "Saint-Omer", "Béthune", "Villeneuve-d'Ascq"];

describe("les propositions de gares pendant la saisie", () => {
  test("« lil » : les gares qui commencent par Lil, dans l'ordre", () => {
    expect(proposerGares(noms, "lil")).toEqual(["Lille Europe", "Lille Flandres", "Lillers"]);
  });
  test("les mots dans le désordre, sans accents : « paris nor », « gare du nord », « frethun », « bethune »", () => {
    expect(proposerGares(noms, "paris nor")).toEqual(["Paris Gare du Nord"]);
    expect(proposerGares(noms, "gare du nord")).toEqual(["Paris Gare du Nord"]);
    expect(proposerGares(noms, "frethun")).toEqual(["Calais - Fréthun"]);
    expect(proposerGares(noms, "bethune")).toEqual(["Béthune"]);
  });
  test("le nom courant : « boulogne ville » propose Boulogne sur Mer en premier", () => {
    expect(proposerGares(noms, "boulogne ville")[0]).toBe("Boulogne sur Mer");
  });
  test("le nom exact passe devant", () => {
    expect(proposerGares(noms, "lille flandres")[0]).toBe("Lille Flandres");
  });
  test("sans texte : les gares récentes (3 au plus)", () => {
    expect(proposerGares(noms, "", ["Calais Ville", "Inconnue", "Béthune"])).toEqual(["Calais Ville", "Béthune"]);
    expect(proposerGares(noms, "")).toEqual([]);
  });
  test("une gare récente passe devant à rang égal", () => {
    expect(proposerGares(noms, "lil", ["Lillers"])[0]).toBe("Lillers");
  });
  test("rien qui corresponde : aucune proposition", () => {
    expect(proposerGares(noms, "marseille")).toEqual([]);
  });
});

test("le gras : le début des mots tapés", () => {
  expect(morceauxEnGras("Paris Gare du Nord", "paris nor").filter((m) => m.gras).map((m) => m.texte)).toEqual(["Paris", "Nor"]);
  expect(morceauxEnGras("Calais - Fréthun", "frethun").filter((m) => m.gras).map((m) => m.texte)).toEqual(["Fréthun"]);
});
