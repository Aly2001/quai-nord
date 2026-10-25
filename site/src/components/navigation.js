// =====================================================================
//  La navigation, en UN seul endroit (la barre du bas, l'en-tête et le menu ☰ s'en servent)
// =====================================================================
// Les menus PRINCIPAUX : ce qu'on fait tous les jours (la barre du bas sur téléphone, l'en-tête sur ordinateur)
export const PRINCIPAUX = [
  { label: "Accueil", lien: "/", aussi: ["/trajet"] },
  { label: "En ville", lien: "/bus" },
  { label: "Nora", lien: "/nora" },
  { label: "Favoris", lien: "/favoris" },
];

// Tout le reste, rangé en groupes (le menu ☰ sur téléphone, « Plus » sur ordinateur)
export const GROUPES = [
  { titre: "Voyager", pages: [
    { emoji: "🗺️", label: "Carte des gares", detail: "Le risque de retard de chaque gare", lien: "/carte" },
  ] },
  { titre: "Comprendre", pages: [
    { emoji: "📈", label: "Comment on prédit", detail: "Le calcul du risque, en toute transparence", lien: "/prediction" },
    { emoji: "📊", label: "Analyses", detail: "Ce qui fait varier les retards", lien: "/analyses" },
  ] },
  { titre: "Aide", pages: [
    { emoji: "❓", label: "Questions fréquentes", detail: "Nora, la position, les données", lien: "/faq" },
    { emoji: "📲", label: "Installer l'application", detail: "Sur l'écran d'accueil de votre téléphone", lien: "/plus#installer" },
    { emoji: "📚", label: "Sources et à propos", detail: "SNCF, réseaux de bus, météo, Gemini", lien: "/plus" },
  ] },
];

// Le menu principal à allumer pour une adresse (les résultats /trajet appartiennent à « Trains »)
export function menuActif(pathname) {
  const trouve = PRINCIPAUX.find((m) => (m.lien === "/" ? pathname === "/" : pathname.startsWith(m.lien))
    || (m.aussi || []).some((a) => pathname.startsWith(a)));
  return trouve?.lien || null;
}
