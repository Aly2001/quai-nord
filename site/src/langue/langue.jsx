// =====================================================================
//  La LANGUE du site : la choisir, la retenir, et traduire avec t("clé").
// =====================================================================
import { createContext, useContext, useEffect, useState } from "react";
import { TEXTES } from "./traductions";

const CLE = "quai-nord:langue";

// 1. La langue de départ : celle choisie la dernière fois, sinon celle du téléphone
export function langueDeDepart() {
  try {
    const choisie = localStorage.getItem(CLE);
    if (choisie && TEXTES[choisie]) return choisie;
  } catch { /* stockage indisponible */ }
  const telephone = typeof navigator !== "undefined" ? navigator.language || "fr" : "fr";
  return telephone.toLowerCase().startsWith("en") ? "en" : "fr";
}

// 2. Traduire : la phrase dans la langue choisie, le français en secours, puis les trous remplis
export function traduire(langue, cle, valeurs = {}) {
  const phrase = TEXTES[langue]?.[cle] ?? TEXTES.fr[cle] ?? cle;
  // « (s) » : le pluriel, selon le nombre (1 possibilité, 3 possibilités)
  const accordee = valeurs.nombre === undefined ? phrase : phrase.replace(/\(s\)/g, valeurs.nombre > 1 ? "s" : "");
  return accordee.replace(/\{(\w+)\}/g, (_, nom) => (valeurs[nom] ?? `{${nom}}`));
}

// 3. Partager la langue dans tout le site (un « contexte » React : toutes les pages lisent la même)
const LangueContexte = createContext({ langue: "fr", setLangue: () => {}, t: (cle, v) => traduire("fr", cle, v) });

export function LangueProvider({ children }) {
  const [langue, setLangueEtat] = useState(langueDeDepart);
  useEffect(() => { document.documentElement.lang = langue; }, [langue]);   // pour les lecteurs d'écran et Google
  const setLangue = (code) => {
    setLangueEtat(code);
    try { localStorage.setItem(CLE, code); } catch { /* tant pis */ }
  };
  const t = (cle, valeurs) => traduire(langue, cle, valeurs);
  return <LangueContexte.Provider value={{ langue, setLangue, t }}>{children}</LangueContexte.Provider>;
}

export const useLangue = () => useContext(LangueContexte);
