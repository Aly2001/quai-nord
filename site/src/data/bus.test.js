// Tests de la recherche des bus, sur un petit réseau inventé (aucun accès à Internet)
import { describe, test, expect } from "vitest";
import {
  distance, arretsProches, busDirects, busDepuisGare, busVersGare, gareCouverte, lienCarte, plusRapideQueAPied,
  nettoyerLieu, categorieDe, garesCorrespondantes, estUnLieuPrecis, dansLaCategorie, libelleGare,
} from "./bus";

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

describe("bon sens", () => {
  const couverte = gareCouverte(reseaux, "Calais Ville");

  test("on ne propose jamais de redescendre à un arrêt proche de la gare", () => {
    const propositions = busDepuisGare(couverte, HOTEL_DE_VILLE);
    expect(propositions.every((b) => !["GARE", "THEATRE"].includes(b.arrivee.id))).toBe(true);
  });

  test("un bus plus lent que la marche n'est pas proposé", () => {
    const propositions = busDepuisGare(couverte, HOTEL_DE_VILLE);
    expect(plusRapideQueAPied(propositions, 200)).toEqual([]);              // 200 m à pied : 3 min
    expect(plusRapideQueAPied(propositions, 3000).length).toBeGreaterThan(0); // 3 km à pied : 38 min
  });
});

describe("comprendre le lieu demandé", () => {
  test("les articles et le nom de la ville sont retirés", () => {
    expect(nettoyerLieu("l'université de Calais")).toBe("universite");
    expect(nettoyerLieu("la plage")).toBe("plage");
  });

  test.each([
    ["l'université de calais", "Université"],
    ["la fac", "Université"],
    ["l'hôpital", "Hôpital"],
    ["l'hôtel de ville", "Mairie"],
    ["la mairie de Boulogne", "Mairie"],
    ["la plage", "Plage"],
    ["la piscine", "Piscine"],
  ])("« %s » est reconnu comme : %s", (texte, categorie) => {
    expect(categorieDe(texte).nom).toBe(categorie);
  });

  test("un nom précis ou une adresse n'est pas une catégorie", () => {
    expect(categorieDe("12 rue Royale")).toBeNull();
    expect(categorieDe("Nausicaá")).toBeNull();
  });
});

describe("retours du test terrain", () => {
  const boulogne = { gares: { "Boulogne Ville": {}, "Boulogne - Tintelleries": {} } };

  test("« Boulogne » correspond aux deux gares : il faudra demander laquelle", () => {
    expect(garesCorrespondantes(boulogne, "Boulogne")).toHaveLength(2);
    expect(garesCorrespondantes(boulogne, "la gare de Boulogne")).toHaveLength(2);
  });

  test("le nom exact ne laisse aucun doute", () => {
    expect(garesCorrespondantes(boulogne, "boulogne-tintelleries")).toEqual(["Boulogne - Tintelleries"]);
  });

  test("une ville n'est jamais proposée comme destination", () => {
    expect(estUnLieuPrecis({ properties: { osm_key: "place", osm_value: "city", name: "Boulogne-sur-Mer" } })).toBe(false);
    expect(estUnLieuPrecis({ properties: { type: "district", name: "Saint-Pierre" } })).toBe(false);
  });

  test("un vrai lieu est gardé", () => {
    expect(estUnLieuPrecis({ properties: { osm_key: "amenity", osm_value: "university", name: "Université" } })).toBe(true);
    expect(estUnLieuPrecis({ properties: { osm_key: "shop", osm_value: "mall", name: "Cité Europe" } })).toBe(true);
  });
});

test("en cherchant une université, une basilique au nom ressemblant est écartée", () => {
  const universite = categorieDe("l'université");
  expect(dansLaCategorie({ properties: { osm_key: "amenity", osm_value: "place_of_worship" } }, universite)).toBe(false);
  expect(dansLaCategorie({ properties: { osm_key: "amenity", osm_value: "university" } }, universite)).toBe(true);
  expect(dansLaCategorie({ properties: { osm_key: "building", osm_value: "university" } }, universite)).toBe(true);
});

describe("les vrais noms de gares (test terrain du 15 octobre)", () => {
  const boulogne = { gares: { "Boulogne sur Mer": {}, "Boulogne - Tintelleries": {} } };
  const calais = { gares: { "Calais Ville": {}, "Calais - Fréthun": {} } };

  test("« la gare de Boulogne ville » : les deux gares sont proposées, rien n'est refusé", () => {
    expect(garesCorrespondantes(boulogne, "la gare de Boulogne ville")).toHaveLength(2);
  });

  test("« Tintelleries » désigne une seule gare", () => {
    expect(garesCorrespondantes(boulogne, "gare de Boulogne Tintelleries")).toEqual(["Boulogne - Tintelleries"]);
  });

  test("« Calais Ville » est reconnu exactement, sans demander", () => {
    expect(garesCorrespondantes(calais, "Calais Ville")).toEqual(["Calais Ville"]);
  });

  test("le nom courant est affiché pour Boulogne-sur-Mer", () => {
    expect(libelleGare("Boulogne sur Mer")).toBe("Boulogne Ville (Boulogne-sur-Mer)");
    expect(libelleGare("Calais Ville")).toBe("Calais Ville");
  });
});
