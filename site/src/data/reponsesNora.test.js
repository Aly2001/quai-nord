import { describe, expect, test } from "vitest";
import { reponseLocale, PRESENTATION, demandeAPied, reponseAPied, demandeAutreSens } from "./reponsesNora";

describe("les réponses données par le site, sans Gemini", () => {
  test.each(["Bonjour Nora, à quoi tu sers ?", "A quoi sers-tu", "Qui es-tu ?", "tu fais quoi", "Présente-toi",
             "qu'est-ce que tu sais faire ?", "Tu sers à quoi Nora ?"])("« %s » : la présentation", (q) => {
    expect(reponseLocale(q)).toBe(PRESENTATION);
  });
  test.each(["Bonjour", "salut Nora", "Bonsoir !"])("« %s » : un bonjour court", (q) => {
    expect(reponseLocale(q)).toMatch(/^Bonjour ! 👋 Je suis Nora\./);
  });
  test.each(["Merci", "merci beaucoup !", "Au revoir Nora"])("« %s » : bon voyage", (q) => {
    expect(reponseLocale(q)).toMatch(/bon voyage/);
  });
  test.each(["Bonjour, je vais à Arras depuis Amiens demain", "Merci, et pour revenir ?", "Je suis à Lille Flandres"])(
    "« %s » : une vraie question, envoyée à Nora", (q) => {
      expect(reponseLocale(q)).toBeNull();
    });
});


describe("après un trajet, aller à pied (sans Gemini)", () => {
  test.each(["Je vais à pied", "Adresse pour y aller", "comment y aller à pied ?", "le chemin ?", "je préfère marcher"])(
    "« %s » : une demande à pied", (q) => expect(demandeAPied(q)).toBe(true));
  test.each(["Merci", "Et pour revenir ?", "Je vais à l'hôpital", "Comment aller à Lille ?"])("« %s » : autre chose", (q) => expect(demandeAPied(q)).toBe(false));
  test("la distance réelle et le temps de marche", () => {
    const texte = reponseAPied({ lieu: "Université", gare: "Calais Ville", metres: 1400, depuis: true });
    expect(texte).toBe("Pour rejoindre Université depuis la gare de Calais Ville à pied, comptez environ 22 min (1,8 km). "
      + "Le bouton ci-dessous ouvre l'itinéraire à pied sur la carte.");
  });
});


test.each(["Non pour aller à la gare", "dans l'autre sens", "et pour revenir ?"])("« %s » : l'autre sens, après une réponse à pied", (q) => {
  expect(demandeAutreSens(q)).toBe(true);
});
test("le chemin inverse : du lieu vers la gare", () => {
  expect(reponseAPied({ lieu: "Université", gare: "Calais Ville", metres: 1400, depuis: false }))
    .toMatch(/^Pour rejoindre la gare de Calais Ville depuis Université à pied/);
});
