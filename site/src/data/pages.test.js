import { test, expect } from "vitest";
import { etatDuModele, pourcent, dateCourte, candidats, progressionReseau, courbesReseau, resumeEssaiReseau } from "./pages";

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

const conditions = { gain_min: 3, ecart_max: 2, jours: 14 };
const essai = { poids: 6182, nuits: [
  { date: "2026-11-24", gain_logistique: 2.85, gain_etat: 7.21, gain_reseau: 12.63, ecart_graines: 0.19 },
  { date: "2026-11-25", gain_logistique: 1.83, gain_etat: 5.46, gain_reseau: 12.45, ecart_graines: null },
] };

test("les trois candidats : la dernière vraie journée, sinon la dernière nuit rejouée", () => {
  const rejoue = candidats({ conditions, reseau: { journees: [], essai } });
  expect(rejoue.quand).toBe("nuit rejouée du 25/11");
  expect(rejoue.liste.find((c) => c.enTete).cle).toBe("reseau");
  const journees = [{ journee: "2026-11-26", gain_reseau: 4, gain_etat: 6, gain_logistique: 2, annonce_reseau: 20, reel: 21 }];
  const reel = candidats({ conditions, reseau: { journees, essai } });
  expect(reel.quand).toBe("journée du 26/11");
  expect(reel.liste.find((c) => c.enTete).cle).toBe("etat");          // jamais de favori : le meilleur du jour
  expect(candidats({ conditions })).toBeNull();
});

test("la progression du réseau : les journées tenues d'affilée", () => {
  const j = (journee, gain, annonce, reel) => ({ journee, gain_reseau: gain, annonce_reseau: annonce, reel });
  const p = progressionReseau({ conditions, reseau: { journees: [
    j("2026-11-24", 12, 20, 21), j("2026-11-25", 12, 19, 21.5), j("2026-11-26", 11, 20, 21), j("2026-11-27", 12, 22, 21)] } });
  expect(p.cases.map((c) => c.ok)).toEqual([true, false, true, true]);   // le 25 : 2,5 points d'écart
  expect(p.suite).toBe(2);
  expect(p.cases[1]).toMatchObject({ gainOk: true, ecartOk: false, ecart: -2.5 });
});

test("les courbes du réseau : rejouées à leur nuit, vraies journées la nuit suivante", () => {
  const modele = { reseau: { essai, journees: [{ journee: "2026-11-26", gain_reseau: 11 }] } };
  expect(courbesReseau(modele, ["2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27"]))
    .toEqual({ rejoue: [12.63, 12.45, null, null], reel: [null, null, null, 11] });
});

test("le résumé des nuits rejouées", () => {
  expect(resumeEssaiReseau({ reseau: { essai } })).toEqual({ nuits: 2, gain: 12.5, stabilite: 0.2, poids: 6182 });
});
