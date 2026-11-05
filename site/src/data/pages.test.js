import { test, expect } from "vitest";
import { etatDuModele, pourcent, dateCourte } from "./pages";

test("les deux conditions, sur la dernière nuit (vos vrais chiffres du 4 novembre)", () => {
  const modele = { conditions: { gain_min: 3, ecart_max: 2, jours: 14 },
    historique: [{ date: "2026-11-04", gain: 1.65, annonce: 23.2, reel: 19.4 }] };
  expect(etatDuModele(modele)).toMatchObject({ gain: 1.65, ecart: 3.8, gainOk: false, ecartOk: false });
  expect(etatDuModele({ ...modele, historique: [] })).toBeNull();
});

test("les nombres à la française", () => {
  expect(pourcent(19.4)).toBe("19,4 %");
  expect(dateCourte("2026-11-04")).toBe("04/11");
});
