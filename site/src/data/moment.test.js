import { describe, test, expect } from "vitest";
import { momentDuVoyage, MARGE_SERREE } from "./moment";

const h = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
const pied = (departMaison, marche) => ({ mode: "pied", departMaison: h(departMaison), marche, arriveeGare: h(departMaison) + marche });
const train = (depart, arrivee) => ({ depart: h(depart), arrivee: h(arrivee) });

describe("le moment du voyage, recalculé depuis maintenant", () => {
  test("avant l'heure : on compte jusqu'à l'heure de partir, jamais « 0 min »", () => {
    const m = momentDuVoyage({ maintenant: h("17:40"), ...train("18:05", "18:37"), aller: pied("17:41", 14) });
    expect([m.etape, m.minutes]).toEqual(["avant", 1]);
    const pile = momentDuVoyage({ maintenant: h("17:41"), ...train("18:05", "18:37"), aller: pied("17:41", 14) });
    expect(pile.etape).toBe("maintenant");                                 // et non « Partez dans 0 min »
  });

  test("capture de 18:00 : en retard sur l'heure de partir, mais 1 min à pied : on a le temps, pas d'alarme", () => {
    const m = momentDuVoyage({ maintenant: h("18:00"), ...train("18:05", "18:37"), aller: pied("17:54", 1),
      direct: { retardDepart: 5, retardArrivee: 5 } });
    expect(m.etape).toBe("maintenant");
    expect([m.arriveeGare, m.departAnnonce, m.arriveeAnnoncee]).toEqual([h("18:01"), h("18:10"), h("18:42")]);
  });

  test("capture de 16:08 : on arrive 1 min après l'heure prévue, sauvé par le retard annoncé", () => {
    const m = momentDuVoyage({ maintenant: h("16:08"), ...train("16:19", "16:55"), aller: pied("16:02", 12),
      direct: { retardDepart: 10, retardArrivee: 10 } });
    expect([m.etape, m.arriveeGare]).toEqual(["sauve", h("16:20")]);
  });

  test("juste à l'heure prévue : « serré »", () => {
    const m = momentDuVoyage({ maintenant: h("16:06"), ...train("16:19", "16:55"), aller: pied("16:02", 12) });
    expect([m.etape, m.arriveeGare]).toEqual(["serre", h("16:18")]);
    expect(h("16:19") - m.arriveeGare).toBeLessThan(MARGE_SERREE);
  });

  test("capture de 07:11 : 6 min à pied pour un train dans 2 min, à l'heure : trop tard, on le dit", () => {
    const m = momentDuVoyage({ maintenant: h("07:11"), ...train("07:13", "07:39"), aller: pied("07:02", 6),
      direct: { retardDepart: 0, retardArrivee: 0 } });
    expect(m.etape).toBe("troptard");
  });

  test("le bus est passé : on ne fait pas comme s'il allait encore passer", () => {
    const bus = { mode: "bus", departMaison: h("14:11"), marcheAvant: 4, heureBus: h("14:17"), arriveeGare: h("14:27") };
    expect(momentDuVoyage({ maintenant: h("14:15"), ...train("14:37", "15:01"), aller: bus }).etape).toBe("busrate");
    expect(momentDuVoyage({ maintenant: h("14:12"), ...train("14:37", "15:01"), aller: bus }).etape).toBe("maintenant");
  });

  test("« parti » et « arrivé » avec les heures ANNONCÉES : pas « arrivé » tant que le train roule", () => {
    const direct = { retardDepart: 7, retardArrivee: 8 };
    const t = train("07:13", "07:39");
    expect(momentDuVoyage({ maintenant: h("07:15"), ...t, direct }).etape).toBe("avant");      // il part à 07:20
    expect(momentDuVoyage({ maintenant: h("07:42"), ...t, direct }).etape).toBe("enroute");    // et non « arrivé »
    const fin = momentDuVoyage({ maintenant: h("07:48"), ...t, direct });
    expect([fin.etape, fin.arriveeAnnoncee]).toEqual(["arrive", h("07:47")]);
  });

  test("un train supprimé n'est jamais « parti » ni « arrivé »", () => {
    expect(momentDuVoyage({ maintenant: h("08:00"), ...train("07:13", "07:39"), direct: { supprime: true } }).etape).toBe("supprime");
  });

  test("sans nouvelles du direct : les heures prévues, sans rien inventer", () => {
    const m = momentDuVoyage({ maintenant: h("07:20"), ...train("07:13", "07:39") });
    expect([m.etape, m.direct, m.arriveeAnnoncee]).toEqual(["enroute", false, h("07:39")]);
  });
});
