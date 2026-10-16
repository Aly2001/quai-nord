// Chaque page doit s'afficher sans erreur (une erreur ici = page blanche pour le visiteur)
import { test, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import Trajet from "./pages/Trajet";
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
