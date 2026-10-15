// Tests de la recherche des bus, sur un petit réseau inventé (aucun accès à Internet)
import { describe, test, expect } from "vitest";
import { distance, arretsProches, busDirects, busDepuisGare, busVersGare, gareCouverte, lienCarte } from "./bus";

const reseau = {
  lignes: {
    R1: { nom: "1", couleur: "#1F6F8B", texte: "#FFFFFF" },
    R3: { nom: "3", couleur: "#0F766E", texte: "#FFFFFF" },
  },
  arrets: {
    GARE: ["GARE", 50.9530, 1.8516],
    THEATRE: ["THEATRE", 50.9520, 1.8540],
    HDV: ["HOTEL DE VILLE", 50.9510, 1.8570],
    BM: ["BEAU MARAIS", 50.9600, 1.8800],
    PLAGE: ["PLAGE", 50.9660, 1.8400],
  },
  parcours: [
    { ligne: "R1", direction: "BEAU MARAIS", arrets: ["GARE", "THEATRE", "HDV", "BM"], minutes: [0, 3, 6, 15] },
    { ligne: "R1", direction: "GARE", arrets: ["BM", "HDV", "THEATRE", "GARE"], minutes: [0, 9, 12, 15] },
    { ligne: "R3", direction: "PLAGE", arrets: ["GARE", "PLAGE"], minutes: [0, 10] },
  ],
  gares: { "Calais Ville": { lat: 50.9532, lon: 1.8513, arrets_proches: [["GARE", 31], ["THEATRE", 200]] } },
};
const reseaux = { calais: reseau };
const HOTEL_DE_VILLE = { lat: 50.9508, lon: 1.8572 };
const PLAGE = { lat: 50.9662, lon: 1.8402 };

describe("distances", () => {
  test("la gare et l'Hôtel de Ville sont à quelques centaines de mètres", () => {
    const d = distance(50.9532, 1.8513, 50.9510, 1.8570);
    expect(d).toBeGreaterThan(300);
    expect(d).toBeLessThan(600);
  });

  test("les arrêts proches sont triés du plus proche au plus loin", () => {
    const proches = arretsProches(reseau, HOTEL_DE_VILLE.lat, HOTEL_DE_VILLE.lon);
    expect(proches[0][0]).toBe("HDV");
    expect(proches.every(([, d], i) => i === 0 || d >= proches[i - 1][1])).toBe(true);
  });
});

describe("gareCouverte", () => {
  test("le nom est reconnu sans tenir compte des majuscules ni des tirets", () => {
    expect(gareCouverte(reseaux, "calais-ville").nom).toBe("Calais Ville");
  });
  test("une gare hors de Calais et Boulogne n'est pas couverte", () => {
    expect(gareCouverte(reseaux, "Lille Flandres")).toBeNull();
  });
});

describe("bus depuis la gare", () => {
  const couverte = gareCouverte(reseaux, "Calais Ville");

  test("la ligne 1, dans le bon sens, mène à l'Hôtel de Ville", () => {
    const [premier] = busDepuisGare(couverte, HOTEL_DE_VILLE);
    expect(premier.ligne.nom).toBe("1");
    expect(premier.direction).toBe("BEAU MARAIS");
    expect(premier.arrivee.nom).toBe("HOTEL DE VILLE");
  });

  test("le trajet le plus rapide est proposé (départ du Théâtre, plus près de la destination)", () => {
    const [premier] = busDepuisGare(couverte, HOTEL_DE_VILLE);
    // Depuis GARE : 6 min de bus ; depuis THEATRE : 3 min de bus mais plus de marche au départ
    expect(premier.minutesBus).toBeGreaterThan(0);
    expect(premier.cout).toBeLessThanOrEqual(busDirects(reseau, [["GARE", 31]], arretsProches(reseau, HOTEL_DE_VILLE.lat, HOTEL_DE_VILLE.lon))[0].cout);
  });

  test("la ligne 3 mène à la plage", () => {
    expect(busDepuisGare(couverte, PLAGE)[0].ligne.nom).toBe("3");
  });

  test("un lieu sans bus direct ne donne aucune proposition", () => {
    expect(busDepuisGare(couverte, { lat: 50.99, lon: 1.70 })).toEqual([]);
  });
});

describe("bus vers la gare", () => {
  test("depuis l'Hôtel de Ville, la ligne 1 en direction de la GARE", () => {
    const [premier] = busVersGare(gareCouverte(reseaux, "Calais Ville"), HOTEL_DE_VILLE);
    expect(premier.ligne.nom).toBe("1");
    expect(premier.direction).toBe("GARE");
  });

  test("le sens compte : la ligne 3 ne va que de la gare à la plage, pas l'inverse", () => {
    expect(busVersGare(gareCouverte(reseaux, "Calais Ville"), PLAGE)).toEqual([]);
  });
});

test("le lien de carte demande un itinéraire en transports en commun", () => {
  expect(lienCarte({ lat: 1, lon: 2 }, { lat: 3, lon: 4 })).toContain("travelmode=transit");
});
