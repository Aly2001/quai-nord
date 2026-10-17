// Chaque page doit s'afficher sans erreur (une erreur ici = page blanche pour le visiteur)
import { test, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import Trajet from "./pages/Trajet";
import { questionsDuTrain, accueilDuTrain } from "./data/questionsTrain";
import Accueil from "./pages/Accueil";
import Nora from "./pages/Nora";
import Plus from "./pages/Plus";
import Sources from "./pages/Sources";
import Footer from "./components/Footer";
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
