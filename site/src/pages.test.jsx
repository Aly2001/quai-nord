// Chaque page doit s'afficher sans erreur (une erreur ici = page blanche pour le visiteur)
import { test, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import Trajet from "./pages/Trajet";
import { questionsDuTrain, accueilDuTrain, accueilSupprime } from "./data/questionsTrain";
import Accueil from "./pages/Accueil";
import Nora from "./pages/Nora";
import Plus from "./pages/Plus";
import Sources from "./pages/Sources";
import Footer from "./components/Footer";
import { sansEmojis, QUESTION_DEPART, DEPUIS_MA_POSITION, VERS_UNE_GARE } from "./components/NoraConversation";
const rendre = (Page, url) => renderToString(<MemoryRouter initialEntries={[url]}><Page /></MemoryRouter>);
test.each([
  [Trajet, "/trajet?de=Marquise+-+Rinxent&a=Calais+Ville&jour=2026-10-16&heure=17%3A52"],
  [Trajet, "/trajet?de=Arras&a=Lille+Flandres&jour=2026-10-16&heure=17%3A52"],
  [Accueil, "/"], [Nora, "/nora"], [Nora, "/nora?gare=Lille+Flandres"], [Plus, "/plus"], [Sources, "/sources"],
])("la page s'affiche sans erreur (%#)", (Page, url) => {
  expect(rendre(Page, url).length).toBeGreaterThan(100);
});

test("les six réseaux sont cités dans les sources et le pied de page, avec le nom de l'auteur", () => {
  const sources = rendre(Sources, "/sources");
  const pied = renderToString(<Footer />);
  for (const reseau of ["ilévia", "Imag'in", "Marinéo", "DK'Bus", "Ametis", "Artis"]) {
    expect(sources).toContain(reseau.replace("'", "&#x27;"));
    expect(pied).toContain(reseau.replace("'", "&#x27;"));
  }
  expect(pied).toContain("Aly Keita");
  expect(rendre(Plus, "/plus")).toContain("linkedin.com/in/aly-keita-306703340");
});

test("la page Nora propose des exemples à compléter et cite les six villes", () => {
  const page = rendre(Nora, "/nora");
  expect(page).toContain("touchez pour compléter");
  for (const ville of ["Lille", "Calais", "Boulogne", "Dunkerque", "Amiens", "Arras"]) expect(page).toContain(ville);
});

test("les questions d'un train sont proposées dans Nora, avec l'information d'abord", () => {
  const t = { gareArrivee: "Calais Ville", heure: "07:04" };
  const questions = questionsDuTrain(t, 17, null, "calais").map((q) => q.texte);
  expect(questions).toEqual(["Pourquoi 17 % de risque ?", "S'il est en retard, quel train ensuite ?", "Bus à l'arrivée à Calais Ville ?"]);
  expect(questionsDuTrain({ gareArrivee: "Lille Flandres" }, 5, null, "lille").map((q) => q.texte))
    .toEqual(["Pourquoi 5 % de risque ?", "Bus, tram ou métro à l'arrivée à Lille Flandres ?"]);
  expect(accueilDuTrain("07:04", "17 %")).toBe("Le train de 07:04 a 17 % de risque de retard. Que voulez-vous savoir ?");
});

test("la page Nora a le réglage de la taille du texte, en taille normale par défaut", () => {
  const page = rendre(Nora, "/nora");
  expect(page).toContain("Taille du texte : normale");
  expect(page).toContain("nora-conversation--normale");
});

test("le sitemap et robots.txt listent les pages publiques", async () => {
  const fs = await import("node:fs");
  const sitemap = fs.readFileSync("public/sitemap.xml", "utf-8");
  for (const page of ["/carte", "/analyses", "/faq", "/nora", "/sources"]) expect(sitemap).toContain(`quai-nord.web.app${page}<`);
  expect(sitemap).not.toContain("/trajet");
  expect(fs.readFileSync("public/robots.txt", "utf-8")).toContain("Sitemap: https://quai-nord.web.app/sitemap.xml");
});

test("la lecture à voix haute retire les émojis, pas le texte", () => {
  expect(sansEmojis("Bonjour ! 👋 Je suis Nora.\n🚆 Je trouve votre train. 😊")).toBe("Bonjour ! Je suis Nora.\n Je trouve votre train.");
});

test.each([
  "D'où partez-vous ? Dites-moi le lieu où vous êtes",
  "De quelle gare partez-vous ?",
  "Depuis quelle ville et quelle gare souhaitez-vous prendre le bus pour aller à la gare ?",
  "Où êtes-vous en ce moment ?",
])("« %s » propose « Ma position »", (q) => expect(QUESTION_DEPART.test(q)).toBe(true));
test("une autre question ne propose pas « Ma position »", () => {
  expect(QUESTION_DEPART.test("Où allez-vous depuis Lille Europe ?")).toBe(false);
});

test.each([
  "Je vais à la gare de Boulogne depuis ma position",
  "Non depuis ma position jusqu'à Boulogne ville",
  "Ma position vers Lille Europe",
])("« %s » : calculé par le site, sans Gemini", (q) => {
  expect(DEPUIS_MA_POSITION.test(q) && VERS_UNE_GARE.test(q)).toBe(true);
});
test("« Nora a-t-elle ma position ? » reste une question pour Nora", () => {
  const q = "Nora a-t-elle ma position ?";
  expect(DEPUIS_MA_POSITION.test(q) && VERS_UNE_GARE.test(q)).toBe(false);
});

test("un train supprimé : Nora le dit d'abord, et propose le suivant", () => {
  expect(accueilSupprime("17:10", true, "18:10")).toBe("Le train de 17:10 est supprimé aujourd'hui, d'après la SNCF. 👉 Le prochain : 18:10.");
  expect(accueilSupprime("17:10", false)).toBe("Le train de 17:10 est déjà annoncé supprimé par la SNCF.");
});

import { menuActif, PRINCIPAUX, GROUPES } from "./components/navigation";
test("la navigation : quatre menus principaux, et le bon menu allumé", () => {
  expect(PRINCIPAUX.map((p) => p.label)).toEqual(["Accueil", "En ville", "Nora", "Favoris"]);
  expect(menuActif("/")).toBe("/");
  expect(menuActif("/trajet")).toBe("/");            // les résultats appartiennent à « Trains »
  expect(menuActif("/bus")).toBe("/bus");
  expect(menuActif("/favoris")).toBe("/favoris");
  expect(menuActif("/carte")).toBeNull();            // dans le menu ☰
  const autres = GROUPES.flatMap((g) => g.pages.map((p) => p.lien.split("#")[0]));
  expect(autres).toEqual(expect.arrayContaining(["/carte", "/prediction", "/analyses", "/faq", "/plus"]));
});

import Bus from "./pages/Bus";
test("la page Bus s'affiche, avec les six villes et les deux champs", () => {
  const html = renderToString(<MemoryRouter><Bus /></MemoryRouter>);
  expect(html).toContain("En ville");
  expect(html).toContain("Calais");                    // la ville choisie au départ
  expect(html).toContain("D&#x27;où partez-vous ?");
  expect(html).toContain("Chercher le trajet");
});
