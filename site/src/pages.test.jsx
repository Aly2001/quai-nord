// Chaque page doit s'afficher sans erreur (une erreur ici = page blanche pour le visiteur)
import { test, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import Trajet from "./pages/Trajet";
import Accueil from "./pages/Accueil";
import Nora from "./pages/Nora";
const rendre = (Page, url) => renderToString(<MemoryRouter initialEntries={[url]}><Page /></MemoryRouter>);
test.each([
  [Trajet, "/trajet?de=Marquise+-+Rinxent&a=Calais+Ville&jour=2026-10-16&heure=17%3A52"],
  [Trajet, "/trajet?de=Arras&a=Lille+Flandres&jour=2026-10-16&heure=17%3A52"],
  [Accueil, "/"], [Nora, "/nora"], [Nora, "/nora?gare=Lille+Flandres"],
])("la page s'affiche sans erreur (%#)", (Page, url) => {
  expect(rendre(Page, url).length).toBeGreaterThan(100);
});
