import { useEffect, useState } from "react";

// La taille du texte de Nora : normale (18 px), grande (20 px) ou très grande (22 px).
// Gardée sur l'appareil (comme les favoris) ; l'en-tête et la conversation restent synchronisés.
const TAILLES = ["normale", "grande", "tres-grande"];
const NOMS = { normale: "normale", grande: "grande", "tres-grande": "très grande" };
const CLE = "nora-taille";
const EVENEMENT = "nora-taille";

function lire() {
  try {
    const valeur = window.localStorage.getItem(CLE);
    return TAILLES.includes(valeur) ? valeur : "normale";
  } catch {
    return "normale";
  }
}

export function useTailleNora() {
  const [taille, setTaille] = useState(() => (typeof window === "undefined" ? "normale" : lire()));
  useEffect(() => {
    const suivre = () => setTaille(lire());
    window.addEventListener(EVENEMENT, suivre);
    return () => window.removeEventListener(EVENEMENT, suivre);
  }, []);
  return taille;
}

export function BoutonTaille() {
  const taille = useTailleNora();
  const suivante = TAILLES[(TAILLES.indexOf(taille) + 1) % TAILLES.length];
  const changer = () => {
    try { window.localStorage.setItem(CLE, suivante); } catch { /* navigation privée : tant pis */ }
    window.dispatchEvent(new Event(EVENEMENT));
  };
  return (
    <button type="button" className={`bouton-taille${taille !== "normale" ? " bouton-taille--actif" : ""}`} onClick={changer}
            aria-label={`Taille du texte : ${NOMS[taille]}. Passer à ${NOMS[suivante]}`}>
      <span aria-hidden="true" className="bouton-taille__petit">A</span>
      <span aria-hidden="true" className="bouton-taille__grand">A</span>
    </button>
  );
}
