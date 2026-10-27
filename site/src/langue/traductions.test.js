import { test, expect } from "vitest";
import { TEXTES } from "./traductions";
import { traduire, enDuree } from "./langue";

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

import faqFr from "../data/faq.json";
import faqEn from "../data/faq.en.json";
test("la FAQ anglaise a les mêmes thèmes, le même nombre de questions et de paragraphes", () => {
  const forme = (d) => d.faq.map((g) => [g.id, g.questions.map((q) => [q.reponse.length, Boolean(q.lien)])]);
  expect(forme(faqEn)).toEqual(forme(faqFr));
});

test("les durées passent en heures au-delà de 59 minutes, partout", () => {
  expect([enDuree(4), enDuree(59), enDuree(60), enDuree(64), enDuree(76), enDuree(125)]).toEqual(["4 min", "59 min", "1 h", "1 h 04", "1 h 16", "2 h 05"]);
  expect(traduire("fr", "ville.dans", { minutes: 64 })).toBe("dans 1 h 04");
  expect(traduire("en", "ville.dans", { minutes: 76 })).toBe("in 1 h 16");
  expect(traduire("fr", "ville.pied.arrivee", { heure: "19:20", minutes: 12 })).toBe("Arrivée à 19:20 · 12 min");
  expect(traduire("fr", "nora.r.aucunbus", { gare: "Arras", lieu: "X", km: "5,1", minutes: 70 })).toContain("environ 1 h 10 à pied");
});
