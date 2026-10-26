// =====================================================================
//  La navigation, en UN seul endroit (la barre du bas, l'en-tête et le menu ☰ s'en servent)
// =====================================================================
// Les menus PRINCIPAUX : ce qu'on fait tous les jours (la barre du bas sur téléphone, l'en-tête sur ordinateur)
export const PRINCIPAUX = [
  { label: "Accueil", cle: "nav.accueil", lien: "/", aussi: ["/trajet"] },
  { label: "En ville", cle: "nav.enville", lien: "/bus" },
  { label: "Nora", cle: "nav.nora", lien: "/nora" },
  { label: "Favoris", cle: "nav.favoris", lien: "/favoris" },
];

// Tout le reste, rangé en groupes (le menu ☰ sur téléphone, « Plus » sur ordinateur)
export const GROUPES = [
  { titre: "Voyager", cle: "menu.voyager", pages: [
    { emoji: "🗺️", label: "Carte des gares", cle: "menu.carte", detail: "Le risque de retard de chaque gare", lien: "/carte" },
  ] },
  { titre: "Comprendre", cle: "menu.comprendre", pages: [
    { emoji: "📈", label: "Comment on prédit", cle: "menu.prediction", detail: "Le calcul du risque, en toute transparence", lien: "/prediction" },
    { emoji: "📊", label: "Analyses", cle: "menu.analyses", detail: "Ce qui fait varier les retards", lien: "/analyses" },
  ] },
  { titre: "Aide", cle: "menu.aide", pages: [
    { emoji: "❓", label: "Questions fréquentes", cle: "menu.faq", detail: "Nora, la position, les données", lien: "/faq" },
    { emoji: "📲", label: "Installer l'application", cle: "menu.installer", detail: "Sur l'écran d'accueil de votre téléphone", lien: "/plus#installer" },
    { emoji: "📚", label: "Sources et à propos", cle: "menu.sources", detail: "SNCF, réseaux de bus, météo, Gemini", lien: "/plus" },
  ] },
];

// Le menu principal à allumer pour une adresse (les résultats /trajet appartiennent à « Trains »)
export function menuActif(pathname) {
  const trouve = PRINCIPAUX.find((m) => (m.lien === "/" ? pathname === "/" : pathname.startsWith(m.lien))
    || (m.aussi || []).some((a) => pathname.startsWith(a)));
  return trouve?.lien || null;
}
