import { test, expect } from "vitest";
import { TEXTES } from "./traductions";
import { traduire } from "./langue";

test("chaque phrase française a sa version anglaise (et inversement)", () => {
  expect(Object.keys(TEXTES.fr).filter((cle) => !(cle in TEXTES.en))).toEqual([]);
  expect(Object.keys(TEXTES.en).filter((cle) => !(cle in TEXTES.fr))).toEqual([]);
});

test("les mêmes trous dans les deux langues", () => {
  const trous = (p) => [...p.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  const differents = Object.keys(TEXTES.fr).filter((cle) => trous(TEXTES.fr[cle]) !== trous(TEXTES.en[cle]));
  expect(differents).toEqual([]);
});

test("traduire : la langue choisie, les trous remplis, le français en secours", () => {
  expect(traduire("en", "ville.dans", { minutes: 4 })).toBe("in 4 min");
  expect(traduire("fr", "ville.dans", { minutes: 4 })).toBe("dans 4 min");
  expect(traduire("es", "nav.accueil")).toBe("Accueil");          // langue inconnue : le français
  expect(traduire("en", "cle.inconnue")).toBe("cle.inconnue");     // clé inconnue : la clé elle-même, rien ne casse
});

test("le pluriel suit le nombre", () => {
  expect(traduire("fr", "ville.possibilites", { nombre: 1 })).toBe("1 possibilité");
  expect(traduire("en", "ville.possibilites", { nombre: 3 })).toBe("3 options");
});
