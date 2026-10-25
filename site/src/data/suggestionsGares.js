// =====================================================================
//  Les propositions de gares pendant la saisie (formulaire de recherche)
// =====================================================================
// La même idée partout : sans accents ni tirets, les mots dans n'importe quel ordre,
// et le nom courant compte (« boulogne ville », « paris nord », « frethun »).
import { normaliser } from "./horaires";
import { libelleGare } from "./bus";

const mots = (texte) => normaliser(texte || "").replace(/[^a-z0-9 ]/g, " ").split(" ").filter(Boolean);
const PETITS = new Set(["gare", "de", "du", "d", "la", "le", "l", "sncf"]);

// Le rang d'une gare pour ce qui est tapé (plus petit = mieux), ou null si elle ne correspond pas
function rang(nom, tape) {
  const cherche = mots(tape).filter((m) => !PETITS.has(m));
  if (!cherche.length) return null;
  const formes = [nom, libelleGare(nom)].map((f) => mots(f));
  const nomTexte = formes[0].join(" ");
  if (nomTexte === cherche.join(" ")) return 0;                                  // le nom exact
  if (nomTexte.startsWith(cherche.join(" "))) return 1;                          // le début du nom
  // Chaque mot tapé commence un mot du nom (ou de son nom courant), dans n'importe quel ordre
  if (formes.some((f) => cherche.every((m) => f.some((w) => w.startsWith(m))))) return 2;
  if (formes.some((f) => cherche.every((m) => f.join(" ").includes(m)))) return 3; // au milieu d'un mot
  return null;
}

// Les propositions : les meilleures d'abord, puis par ordre alphabétique. Sans texte : les gares récentes.
export function proposerGares(noms, tape, recents = [], max = 6) {
  if (!normaliser(tape || "").trim()) return recents.filter((r) => noms.includes(r)).slice(0, 3);
  return noms
    .map((nom) => ({ nom, r: rang(nom, tape) }))
    .filter((p) => p.r !== null)
    .sort((x, y) => x.r - y.r || (recents.includes(y.nom) - recents.includes(x.nom)) || x.nom.localeCompare(y.nom, "fr"))
    .slice(0, max)
    .map((p) => p.nom);
}

// Les morceaux à mettre en gras : le début de chaque mot qui correspond à un mot tapé
export function morceauxEnGras(nom, tape) {
  const cherche = mots(tape).filter((m) => !PETITS.has(m));
  const morceaux = [];
  const regex = /[A-Za-zÀ-ÿ0-9]+|[^A-Za-zÀ-ÿ0-9]+/g;
  for (const [bout] of nom.matchAll(regex)) {
    const n = normaliser(bout);
    const m = cherche.filter((c) => n.startsWith(c)).sort((x, y) => y.length - x.length)[0];
    if (m) morceaux.push({ texte: bout.slice(0, m.length), gras: true }, { texte: bout.slice(m.length), gras: false });
    else morceaux.push({ texte: bout, gras: false });
  }
  return morceaux.filter((p) => p.texte);
}

// ---------- Les gares récentes, gardées sur le téléphone (aucun compte, rien n'est envoyé) ----------
const CLE = "quainord:gares-recentes";
export function lireRecents() {
  try { return JSON.parse(localStorage.getItem(CLE)) || []; } catch { return []; }
}
export function retenirGares(...noms) {
  try {
    const liste = [...noms.filter(Boolean), ...lireRecents().filter((n) => !noms.includes(n))].slice(0, 8);
    localStorage.setItem(CLE, JSON.stringify(liste));
  } catch { /* stockage indisponible : tant pis */ }
}
