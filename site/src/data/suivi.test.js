import { describe, test, expect } from "vitest";
import { prochaineOccasion, nettoyer, prochainTrainSuivi, margeEnGare, allerALaGare, etapeDuVoyage } from "./suivi";

const une = { de: "Boulogne sur Mer", a: "Paris Nord", heure: "12:04", arrivee: "14:46", repetition: "une", jour: "2026-10-28" };
const semaine = { de: "Calais Ville", a: "Boulogne sur Mer", heure: "17:12", arrivee: "17:44", repetition: "semaine" };
const le = (iso, hhmm) => new Date(`${iso}T${hhmm}:00`);

describe("le suivi qui se nettoie tout seul", () => {
  test("un voyage ponctuel : gardé jusqu'à 30 min après l'arrivée, puis oublié", () => {
    expect(prochaineOccasion(une, le("2026-10-27", "20:00"))).toBe("2026-10-28");      // la veille
    expect(prochaineOccasion(une, le("2026-10-28", "15:10"))).toBe("2026-10-28");      // 24 min après l'arrivée
    expect(prochaineOccasion(une, le("2026-10-28", "15:20"))).toBeNull();              // 34 min après : oublié
    const { gardes, retires } = nettoyer([une, semaine], le("2026-10-29", "08:00"));
    expect([gardes.length, retires.length]).toEqual([1, 1]);
  });
  test("un train de semaine : aujourd'hui s'il n'est pas passé, sinon le prochain jour de semaine", () => {
    expect(prochaineOccasion(semaine, le("2026-10-28", "09:00"))).toBe("2026-10-28");   // mercredi matin
    expect(prochaineOccasion(semaine, le("2026-10-30", "19:00"))).toBe("2026-11-02");   // vendredi soir -> lundi
    expect(prochaineOccasion(semaine, le("2026-10-31", "10:00"))).toBe("2026-11-02");   // samedi -> lundi
  });
  test("le prochain train suivi, tous trains confondus", () => {
    const p = prochainTrainSuivi([semaine, une], le("2026-10-27", "20:00"));
    expect([p.suivi.heure, p.jour]).toEqual(["12:04", "2026-10-28"]);
  });
});

describe("l'aller à la gare", () => {
  test("plus de marge dans une grande gare", () => {
    expect([margeEnGare("Lille Flandres"), margeEnGare("Boulogne - Tintelleries")]).toEqual([10, 5]);
  });
  // Un petit réseau : la ligne 5 va de A1 (près de la maison) à G1 (la gare) en 12 min
  const reseau = {
    lignes: { L5: { nom: "5", couleur: "#8B3A1E", texte: "#FFFFFF", mode: "bus" } },
    arrets: { A1: ["Place de Lorraine", 50.7200, 1.6000], G1: ["Gare SNCF", 50.7400, 1.6200] },
    parcours: [{ ligne: "L5", direction: "Gare", arrets: ["A1", "G1"], voyages: 40, minutes: [0, 12] }],
  };
  const horaires = { debut: "2026-10-26", jours: ["1111100"], departs: [{ 0: [660, 680, 700, 720] }] };   // 11:00, 11:20, 11:40, 12:00
  const maison = { lat: 50.7201, lon: 1.6001 };
  const gare = { lat: 50.7401, lon: 1.6201 };
  test("le DERNIER bus qui arrive à temps, et l'heure de départ de la maison (marche + 2 min de marge)", () => {
    const aller = allerALaGare(reseau, horaires, maison, gare, "2026-10-28", 12 * 60 + 4 - 5);   // train 12:04, 5 min de marge
    expect(aller.mode).toBe("bus");
    expect(aller.heureBus).toBe(700);                       // 11:40 -> gare à 11:52 (le bus de 12:00 arriverait trop tard)
    expect(aller.departMaison).toBe(700 - aller.marcheAvant - 2);
  });
  test("tout près de la gare : à pied", () => {
    const aller = allerALaGare(reseau, horaires, { lat: 50.7395, lon: 1.6195 }, gare, "2026-10-28", 719);
    expect(aller.mode).toBe("pied");
    expect(aller.departMaison).toBe(719 - aller.marche);
  });
});


describe("quand l'aller à la gare n'a pas de sens", () => {
  const gare = { lat: 50.6364, lon: 3.0710 };                    // Lille Flandres
  test("dans une autre ville (Boulogne -> Lille Flandres) : « loin », jamais 27 h de marche", () => {
    const aller = allerALaGare(null, null, { lat: 50.7264, lon: 1.6147 }, gare, "2026-10-27", 400);
    expect(aller.mode).toBe("loin");
  });
  test("à 6 km, sans bus : « aucun », pas 1 h 30 de marche", () => {
    const aller = allerALaGare(null, null, { lat: 50.6900, lon: 3.0710 }, gare, "2026-10-27", 400);
    expect(aller.mode).toBe("aucun");
  });
});


describe("où en est le voyage, maintenant", () => {
  const train = { de: "Boulogne - Tintelleries", a: "Calais Ville", heure: "07:13", arrivee: "07:39", repetition: "une",
    jour: "2026-10-27", aller: { mode: "pied", departMaison: 422 } };        // partir de chez soi à 07:02
  const a = (hhmm) => new Date(`2026-10-27T${hhmm}:00`);
  test("les cinq étapes", () => {
    expect(etapeDuVoyage(train, "2026-10-27", a("06:50")).etape).toBe("avant");
    expect(etapeDuVoyage(train, "2026-10-27", a("07:05"))).toEqual({ etape: "presse", minutes: 8 });
    expect(etapeDuVoyage(train, "2026-10-27", a("07:37"))).toEqual({ etape: "enroute", minutes: 2 });  // ta capture : 07:37
    expect(etapeDuVoyage(train, "2026-10-27", a("07:45")).etape).toBe("arrive");
    expect(etapeDuVoyage(train, "2026-10-28", a("07:45")).etape).toBe("autrejour");
  });
});
