import { describe, expect, test } from "vitest";
import { reponseLocale, PRESENTATION } from "./reponsesNora";

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
