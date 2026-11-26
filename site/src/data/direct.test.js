import { describe, expect, it } from "vitest";
import { comparerHabitude, directFrais, risqueDirect } from "./direct";

const MAINTENANT = 1_800_000_000;
const direct = {
  genere_le: "2026-11-26T16:45", maj: MAINTENANT - 120, afficher: true,
  trains: {
    "847016": { jour: "2026-11-26", ligne: "K12", arrets: [
      { gare: "Calais-Ville", stop_id: "StopArea:CAL", heure: "17:39", risque: 0.42 },
      { gare: "Boulogne-Ville", stop_id: "StopArea:BOU", heure: "17:13", risque: 0.31 },
    ] },
  },
};
const train = { numero: "847016" };

describe("le risque en direct", () => {
  it("donne le risque du train à SA gare d'arrivée", () => {
    expect(risqueDirect(direct, train, "StopArea:CAL", "2026-11-26", MAINTENANT))
      .toEqual({ taux: 0.42, maj: "16:45", ligne: "K12" });
  });

  it("rien si l'interrupteur est éteint, sauf en aperçu (?apercu=direct)", () => {
    const eteint = { ...direct, afficher: false };
    expect(risqueDirect(eteint, train, "StopArea:CAL", "2026-11-26", MAINTENANT)).toBeNull();
    expect(risqueDirect(eteint, train, "StopArea:CAL", "2026-11-26", MAINTENANT, true)?.taux).toBe(0.42);
  });

  it("rien si le fichier a plus de 20 minutes (VM en panne) : on revient au risque de la nuit", () => {
    expect(directFrais(direct, MAINTENANT)).toBe(true);
    expect(directFrais(direct, MAINTENANT + 25 * 60)).toBe(false);
  });

  it("rien pour un autre jour, un autre train ou une gare absente", () => {
    expect(risqueDirect(direct, train, "StopArea:CAL", "2026-11-27", MAINTENANT)).toBeNull();
    expect(risqueDirect(direct, { numero: "999" }, "StopArea:CAL", "2026-11-26", MAINTENANT)).toBeNull();
    expect(risqueDirect(direct, train, "StopArea:LIL", "2026-11-26", MAINTENANT)).toBeNull();
    expect(risqueDirect(null, train, "StopArea:CAL", "2026-11-26", MAINTENANT)).toBeNull();
  });
});

describe("aujourd'hui par rapport à d'habitude", () => {
  it("dit si la journée est meilleure, pire ou pareille (écart de 5 points)", () => {
    expect(comparerHabitude(42, 18)).toBe("pire");
    expect(comparerHabitude(10, 18)).toBe("mieux");
    expect(comparerHabitude(20, 18)).toBe("pareil");
    expect(comparerHabitude(20, null)).toBeNull();
  });
});
