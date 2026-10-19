// Tests de la recherche des bus, sur un petit réseau inventé (aucun accès à Internet)
import { describe, test, expect, vi } from "vitest";
import {
  distance, arretsProches, busDirects, busDepuisGare, busVersGare, gareCouverte, lienCarte, plusRapideQueAPied,
  nettoyerLieu, categorieDe, garesCorrespondantes, estUnLieuPrecis, dansLaCategorie, libelleGare,
  lieuxPrepares, chercherLieu, etapesSiteOfficiel, SITES_RESEAUX, seRessemblent, pertinent,
  reseauDeGare, reseauDeVille, transportsDuReseau, decrireLigne, nettoyerDirection, joliNom, RESEAUX_BUS, RESEAUX,
  estAdresse, arretsCorrespondants, estCentreVille, adressePertinente, motsAdresse, horairesPerimes, gareLaPlusProche, arretLePlusProche, gareCitee,
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
    // Les noms tout en majuscules du réseau sont rendus lisibles
    expect(premier.direction).toBe("Beau Marais");
    expect(premier.arrivee.nom).toBe("Hotel de Ville");
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
    expect(premier.direction).toBe("Gare");
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

describe("les lieux préparés par charger_bus.py", () => {
  const boulogne = {
    lieux: [
      { nom: "Université du Littoral - Saint-Louis", cat: "universite", lat: 50.7240, lon: 1.6100 },
      { nom: "IUT Boulogne", cat: "universite", lat: 50.7100, lon: 1.6000 },
      { nom: "Nausicaá", cat: "loisirs", lat: 50.7300, lon: 1.5950 },
      { nom: "Basilique Notre-Dame", cat: "musee", lat: 50.7260, lon: 1.6140 },
      { nom: "Université de Lille", cat: "universite", lat: 50.6300, lon: 3.0700 },
    ],
  };
  const gare = { lat: 50.7180, lon: 1.6100 };

  test("« l'université » : seulement les universités, jamais la basilique", () => {
    expect(lieuxPrepares(boulogne, "l'université").map((l) => l.nom)).not.toContain("Basilique Notre-Dame");
  });

  test("un nom propre est trouvé, même sans accent", () => {
    expect(lieuxPrepares(boulogne, "nausicaa").map((l) => l.nom)).toEqual(["Nausicaá"]);
  });

  test("la recherche se fait sans Internet, du plus proche au plus loin, et sans homonyme lointain", async () => {
    const fetchInterdit = vi.fn(() => { throw new Error("aucun appel réseau attendu"); });
    vi.stubGlobal("fetch", fetchInterdit);
    const lieux = await chercherLieu("l'université", gare, "Boulogne-sur-Mer", boulogne);
    expect(fetchInterdit).not.toHaveBeenCalled();
    expect(lieux.map((l) => l.nom)).toEqual(["Université du Littoral - Saint-Louis", "IUT Boulogne"]);
    vi.unstubAllGlobals();
  });
});

test("un parcours peu fréquent passe derrière un parcours habituel, sans disparaître", () => {
  const reseauTest = {
    lignes: { A: { nom: "A", couleur: "#000000", texte: "#FFFFFF" }, B: { nom: "B", couleur: "#000000", texte: "#FFFFFF" } },
    arrets: { G: ["G", 50, 1], X: ["X", 50.01, 1] },
    parcours: [
      { ligne: "A", direction: "X", arrets: ["G", "X"], minutes: [0, 5], voyages: 1 },     // plus rapide, mais rare
      { ligne: "B", direction: "X", arrets: ["G", "X"], minutes: [0, 8], voyages: 40 },    // habituel
    ],
  };
  const [premier, second] = busDirects(reseauTest, [["G", 0]], [["X", 0]]);
  expect(premier.ligne.nom).toBe("B");
  expect(second.ligne.nom).toBe("A");
  expect(second.occasionnel).toBe(true);
  expect(second.minutesTotal).toBe(6);       // la durée affichée ne contient pas la pénalité
});

test("une adresse précise est gardée (test terrain : 293 rue Duguay-Trouin)", () => {
  expect(estUnLieuPrecis({ properties: { osm_key: "place", osm_value: "house", type: "house", housenumber: "293", street: "Rue Duguay-Trouin" } })).toBe(true);
  expect(estUnLieuPrecis({ properties: { osm_key: "place", osm_value: "city", type: "city", name: "Calais" } })).toBe(false);
});

test("les étapes vers le site officiel sont remplies avec le départ et l'arrivée", () => {
  const etapes = etapesSiteOfficiel("calais", "Gare de Calais Ville", "293 rue Duguay-Trouin, Calais");
  expect(etapes).toHaveLength(4);
  expect(etapes[0]).toContain(SITES_RESEAUX.calais.nom);
  expect(etapes[1]).toContain("Gare de Calais Ville");
  expect(etapes[2]).toContain("293 rue Duguay-Trouin");
});

describe("les fautes de frappe (test terrain : « l'ulclo »)", () => {
  test.each([
    ["l'ulclo", "Université"],
    ["l'univercité", "Université"],
    ["l'hopitale", "Hôpital"],
    ["la mairi", "Mairie"],
  ])("« %s » est reconnu comme : %s", (texte, categorie) => {
    expect(categorieDe(texte)?.nom).toBe(categorie);
  });

  test("les mots courts doivent être identiques", () => {
    expect(seRessemblent("bus", "but")).toBe(false);
    expect(seRessemblent("port", "fort")).toBe(true);     // 4 lettres : une faute tolérée
  });

  test("un nom propre mal orthographié est retrouvé", () => {
    const reseau = { lieux: [{ nom: "Nausicaá", cat: "loisirs", lat: 50.73, lon: 1.59 }] };
    expect(lieuxPrepares(reseau, "nausicaa")).toHaveLength(1);
    expect(lieuxPrepares(reseau, "nausica")).toHaveLength(1);     // une lettre oubliée
    expect(lieuxPrepares(reseau, "plage")).toHaveLength(0);       // aucun rapport
  });

  test("un résultat sans aucun mot commun est écarté", () => {
    expect(pertinent({ nom: "Fontaine de Boulogne-sur-Mer" }, "l'ulclo")).toBe(false);
    expect(pertinent({ nom: "293 Rue Duguay-Trouin", detail: "Calais" }, "293 rue Duguay trouin")).toBe(true);
  });
});


// ---------------------------------------------------------------------
//  Les six réseaux (liste unique reseaux.json), et bus, tram ou métro
// ---------------------------------------------------------------------
describe("la liste unique des réseaux", () => {
  test("les six réseaux sont connus, avec leur site officiel", () => {
    expect(RESEAUX_BUS).toEqual(expect.arrayContaining(["lille", "calais", "boulogne", "dunkerque", "amiens", "arras"]));
    expect(SITES_RESEAUX.lille.url).toContain("ilevia");
  });
  test.each([
    ["Lille Flandres", "lille"], ["Roubaix", "lille"], ["Calais-Fréthun", "calais"], ["Boulogne - Tintelleries", "boulogne"],
    ["Longueau", "amiens"], ["Arras", "arras"], ["Paris Gare du Nord", null], ["", null],
  ])("la gare « %s » est desservie par le réseau %s", (gare, code) => {
    expect(reseauDeGare(gare)).toBe(code);
  });
  test.each([["Boulogne-sur-Mer", "boulogne"], ["Tourcoing", "lille"], ["dunkerque", "dunkerque"], ["Valenciennes", null]])(
    "la ville « %s » correspond au réseau %s", (ville, code) => {
      expect(reseauDeVille(ville)).toBe(code);
    });
  test("les mots annoncent le bon transport", () => {
    expect(transportsDuReseau("lille")).toBe("le bus, le tram ou le métro");
    expect(transportsDuReseau("arras")).toBe("le bus");
  });
});

describe("parler du bon mode de transport", () => {
  test("métro : « le métro M1 », « la station », « 9 stations »", () => {
    const d = decrireLigne({ nom: "M1", mode: "metro" });
    expect(d.prendre).toBe("le métro M1");
    expect(d.station).toBe("la station");
    expect(d.arrets(9)).toBe("9 stations");
  });
  test("le tram de Lille s'appelle « TRAM » dans le fichier : on dit « le tram »", () => {
    const d = decrireLigne({ nom: "TRAM", mode: "tram", long: "TRAMWAY" });
    expect(d.nom).toBe("Tram");
    expect(d.prendre).toBe("le tram");
  });
  test("bus : « le bus 3 », « l'arrêt », « 1 arrêt » ; sans mode connu, c'est un bus", () => {
    const d = decrireLigne({ nom: "3" });
    expect(d.prendre).toBe("le bus 3");
    expect(d.station).toBe("l'arrêt");
    expect(d.arrets(1)).toBe("1 arrêt");
  });
  test("une ligne de nuit est reconnue à son nom long", () => {
    expect(decrireLigne({ nom: "N1", long: "LIGNE DE NUIT" }).nuit).toBe(true);
    expect(decrireLigne({ nom: "N1", long: "NEMO 1" }).nuit).toBe(false);
  });
});

describe("des noms lisibles", () => {
  test("le numéro de la ligne n'est pas répété dans la direction (Artis)", () => {
    expect(nettoyerDirection("3 Achicourt College Adam de la Halle", "3")).toBe("Achicourt College Adam de la Halle");
    expect(nettoyerDirection("D2 Beaurains Centre Commercial", "D2")).toBe("Beaurains Centre Commercial");
    expect(nettoyerDirection("30 Rue Royale", "3")).toBe("30 Rue Royale");           // seulement le numéro EXACT
    expect(nettoyerDirection("C6a Teteghem Vandermeersch", "C6")).toBe("Teteghem Vandermeersch");  // variante « a »
  });
  test("les noms tout en majuscules sont rendus lisibles (DK'Bus), les autres ne changent pas", () => {
    expect(joliNom("DUNKERQUE GARE")).toBe("Dunkerque Gare");
    expect(joliNom("PONT DE LA REINE")).toBe("Pont de la Reine");
    expect(joliNom("Gare Lille Flandres")).toBe("Gare Lille Flandres");
    expect(joliNom("12E DIM.")).toBe("12e Dim.");
  });
});

describe("les cas découverts sur les données de Lille", () => {
  const lille = {
    lignes: {
      M2: { nom: "M2", couleur: "#E30613", texte: "#FFFFFF", mode: "metro", long: "METRO LIGNE 2" },
      N1: { nom: "N1", couleur: "#3A2757", texte: "#FFFFFF", mode: "bus", long: "LIGNE DE NUIT" },
      L5: { nom: "L5", couleur: "#307BBF", texte: "#FFFFFF", mode: "bus", long: "LIANE 5" },
    },
    arrets: { G: ["Gare Lille Flandres", 50.6365, 3.0705], E: ["Eurotéléport", 50.6925, 3.1770], X: ["Tourcoing", 50.72, 3.16] },
    parcours: [
      { ligne: "M2", direction: "Roubaix Grand Place", arrets: ["G", "E"], minutes: [0, 19] },
      { ligne: "M2", direction: "Tourcoing C.H. Dron", arrets: ["G", "E", "X"], minutes: [0, 19, 30] },
      { ligne: "N1", direction: "Roubaix", arrets: ["G", "E"], minutes: [0, 20] },
      { ligne: "L5", direction: "Roubaix", arrets: ["G", "E"], minutes: [0, 26] },
    ],
  };
  const propositions = busDirects(lille, [["G", 100]], [["E", 150]]);

  test("le M2 vers Roubaix OU Tourcoing : un seul trajet proposé, avec les deux directions", () => {
    const m2 = propositions.filter((b) => b.ligne.nom === "M2");
    expect(m2).toHaveLength(1);
    expect(m2[0].direction).toBe("Roubaix Grand Place ou Tourcoing C.H. Dron");
  });
  test("au-delà de deux terminus, on cite le principal et le nombre des autres", () => {
    const r = {
      lignes: { C6: { nom: "C6", couleur: "#000000", texte: "#FFFFFF" } },
      arrets: { G: ["Gare", 51.03, 2.37], J: ["Jean Bart", 51.035, 2.38] },
      parcours: ["Teteghem A", "Teteghem B", "Place d'Uxem"].map((d, i) => ({ ligne: "C6", direction: d, arrets: ["G", "J"], minutes: [0, 4 + i] })),
    };
    expect(busDirects(r, [["G", 50]], [["J", 50]])[0].direction).toBe("Teteghem A (ou 2 autres terminus)");
  });

  test("la ligne de nuit est signalée, et passe derrière une ligne de jour plus lente", () => {
    const noms = propositions.map((b) => b.ligne.nom);
    expect(noms.indexOf("L5")).toBeLessThan(noms.indexOf("N1"));
    expect(propositions.find((b) => b.ligne.nom === "N1").nuit).toBe(true);
  });
  test("le mode voyage avec la proposition, pour choisir les mots et le pictogramme", () => {
    expect(propositions[0].ligne.mode).toBe("metro");
  });
});

describe("les grands sites : jusqu'à 800 m à pied", () => {
  // Un arrêt à environ 700 m au sud du point central du campus
  const r = {
    lignes: { B: { nom: "B", couleur: "#000000", texte: "#FFFFFF" } },
    arrets: { GARE: ["Gare", 50.0, 2.0], CAMPUS: ["Campus", 50.0937, 2.0] },
    parcours: [{ ligne: "B", direction: "Campus", arrets: ["GARE", "CAMPUS"], minutes: [0, 12] }],
    gares: { Gare: { lat: 50.0, lon: 2.0, arrets_proches: [["GARE", 0]] } },
  };
  const couverte = { code: "test", reseau: r, nom: "Gare", gare: r.gares.Gare };
  const centre = { lat: 50.1, lon: 2.0 };

  test("une université dont le centre est à 700 m de l'arrêt est desservie", () => {
    expect(busDepuisGare(couverte, { ...centre, cat: "universite" })).toHaveLength(1);
  });
  test("un bureau de poste à 700 m de l'arrêt ne l'est pas (500 m au plus)", () => {
    expect(busDepuisGare(couverte, { ...centre, cat: "poste" })).toEqual([]);
  });
});


// ---------------------------------------------------------------------
//  Retour du test à Boulogne : « 7 place de Lorraine » donnait des plages
// ---------------------------------------------------------------------
describe("une adresse n'est pas une catégorie", () => {
  test.each(["7 place de Lorraine", "Place lorraine", "rue des Écoles", "12 avenue Foch", "quai Gambetta"])(
    "« %s » est une adresse", (texte) => {
      expect(estAdresse(texte)).toBe(true);
      expect(categorieDe(texte)).toBeNull();
    });
  test.each([["la plage", "plage"], ["l'université", "universite"], ["la mairie", "mairie"]])(
    "« %s » reste une catégorie", (texte, code) => {
      expect(categorieDe(texte)?.code).toBe(code);
    });
});

describe("un nom d'arrêt est une destination", () => {
  const boulogne = {
    arrets: {
      L1: ["Place de Lorraine", 50.7262, 1.6151], L2: ["Place de Lorraine", 50.7264, 1.6155],
      G: ["Gare SNCF", 50.7155, 1.6135], P: ["Plage", 50.73, 1.59],
    },
  };
  test("« 7 place de Lorraine » trouve l'arrêt, ses deux quais réunis en un seul lieu", () => {
    const lieux = arretsCorrespondants(boulogne, "7 place de Lorraine");
    expect(lieux).toHaveLength(1);
    expect(lieux[0]).toMatchObject({ nom: "Place de Lorraine", cat: "arret" });
    expect(lieux[0].lat).toBeCloseTo(50.7263, 4);
  });
  test("une faute de frappe est tolérée, un autre nom ne correspond pas", () => {
    expect(arretsCorrespondants(boulogne, "place lorainne")).toHaveLength(1);
    expect(arretsCorrespondants(boulogne, "place Dalton")).toEqual([]);
  });
  test("une catégorie ne cherche pas parmi les arrêts (« plage » ressemble à « place »)", () => {
    expect(arretsCorrespondants(boulogne, "la plage")).toEqual([]);
  });
});


// ---------------------------------------------------------------------
//  Retours de la série 2 de tests (Boulogne, Dunkerque, Arras)
// ---------------------------------------------------------------------
describe("les lieux ambigus", () => {
  const reseau = {
    arrets: { A: ["Boulevard Daunou", 50.72, 1.61] },
    lieux: [
      { nom: "Plage de Malo-les-Bains", cat: "plage", lat: 51.05, lon: 2.40 },
      { nom: "Plage de Zuydcoote", cat: "plage", lat: 51.07, lon: 2.48 },
      { nom: "Stade de la Libération", cat: "stade", lat: 50.72, lon: 1.61 },
    ],
  };
  test("« la plage de Malo » : seulement la plage de Malo", () => {
    expect(lieuxPrepares(reseau, "la plage de Malo").map((l) => l.nom)).toEqual(["Plage de Malo-les-Bains"]);
    expect(lieuxPrepares(reseau, "la plage")).toHaveLength(2);
  });
  test("« boulevard de Lille » : une adresse, ni lieu préparé ni arrêt « boulevard » quelconque", () => {
    expect(motsAdresse("je vais boulevard de Lille")).toEqual(["boulevard", "lille"]);
    expect(lieuxPrepares(reseau, "boulevard de Lille")).toEqual([]);
    expect(arretsCorrespondants(reseau, "boulevard de Lille")).toEqual([]);
    expect(adressePertinente({ nom: "Boulevard de Lille", detail: "Boulogne-sur-Mer" }, "boulevard de Lille")).toBe(true);
    expect(adressePertinente({ nom: "Stade de la Libération", detail: "Boulevard Daunou" }, "boulevard de Lille")).toBe(false);
  });
  test.each(["le centre-ville", "centre ville", "au centre", "le centre de Lille", "hyper centre"])("« %s » est le centre-ville", (t) => {
    expect(estCentreVille(t)).toBe(true);
  });
  test.each(["Centre hospitalier", "centre de secours", "le centre commercial"])("« %s » n'est pas le centre-ville", (t) => {
    expect(estCentreVille(t)).toBe(false);
  });
});


describe("des horaires périmés", () => {
  test("avant la fin de validité : rien à signaler ; après : la date, en français", () => {
    const dunkerque = { valide_jusqu_au: "2026-12-31" };
    expect(horairesPerimes(dunkerque, new Date("2026-12-31T12:00:00Z"))).toBeNull();
    expect(horairesPerimes(dunkerque, new Date("2027-01-02T12:00:00Z"))).toBe("31/12/2026");
    expect(horairesPerimes({}, new Date())).toBeNull();
  });
});


describe("« Ma position » : calculé dans le téléphone", () => {
  const gares = [
    { nom: "Calais Ville", reseau: "calais", lat: 50.9535, lon: 1.8509 },
    { nom: "Lille Flandres", reseau: "lille", lat: 50.6365, lon: 3.0705 },
  ];
  test("la gare couverte la plus proche, et sa distance", () => {
    const g = gareLaPlusProche(gares, 50.958, 1.858);          // près de l'Alhambra, à Calais
    expect(g.nom).toBe("Calais Ville");
    expect(g.metres).toBeGreaterThan(500);
    expect(g.metres).toBeLessThan(1000);
    expect(gareLaPlusProche([], 50, 2)).toBeNull();
  });
  test("l'arrêt le plus proche, au nom lisible", () => {
    const reseau = { arrets: { A: ["ALHAMBRA", 50.9578, 1.8578], B: ["GARE", 50.9535, 1.8509] } };
    expect(arretLePlusProche(reseau, 50.958, 1.858)).toBe("Alhambra");
    expect(arretLePlusProche(reseau, 51.5, 2.5)).toBeNull();
  });
});


describe("une gare nommée dans une phrase", () => {
  const noms = ["Boulogne sur Mer", "Boulogne - Tintelleries", "Lille Flandres", "Lille Europe"];
  test.each([
    ["Non depuis ma position jusqu'à Boulogne ville", "Boulogne sur Mer"],
    ["je vais dans l'autre gare de Boulogne Tintelleries", "Boulogne - Tintelleries"],
    ["vers Lille Europe", "Lille Europe"],
  ])("« %s » -> %s", (phrase, gare) => expect(gareCitee(noms, phrase)).toBe(gare));
  test("aucune gare nommée", () => expect(gareCitee(noms, "jusqu'à l'université")).toBeNull());
});

test("« la gare de Boulogne ville » désigne UNE gare, pas les deux gares de Boulogne", () => {
  expect(gareCitee(["Boulogne sur Mer", "Boulogne - Tintelleries"], "la gare de Boulogne ville")).toBe("Boulogne sur Mer");
  expect(gareCitee(["Boulogne sur Mer", "Boulogne - Tintelleries"], "la gare de Boulogne")).toBeNull();   // vraiment ambiguë
});


describe("une gare nommée, pour toutes les villes", () => {
  const toutes = RESEAUX.flatMap((r) => r.gares);
  test.each([
    ["la gare de Boulogne ville", "Boulogne sur Mer"], ["Tintelleries", "Boulogne - Tintelleries"],
    ["Calais Ville", "Calais Ville"], ["je vais à Fréthun", "Calais - Fréthun"], ["calais frethun", "Calais - Fréthun"],
    ["Lille Europe", "Lille Europe"], ["la gare Flandres", "Lille Flandres"], ["Roubaix", "Roubaix"],
    ["la gare d'Arras", "Arras"], ["Dunkerque", "Dunkerque"], ["Amiens", "Amiens"], ["Longueau", "Longueau"],
  ])("« %s » -> %s", (phrase, gare) => expect(gareCitee(toutes, phrase)).toBe(gare));
  test.each(["la gare de Boulogne", "Lille", "Lille ville", "Calais", "l'université", "boulevard de Lille"])(
    "« %s » : ambigu ou pas une gare, Nora demande", (phrase) => expect(gareCitee(toutes, phrase)).toBeNull());
});
