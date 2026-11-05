// Les chiffres des pages Analyses et Prédiction : calculés chaque nuit sur la VM (exporter_pages.py)
import { useEffect, useState } from "react";

let enCours = null;
export function usePages() {
  const [donnees, setDonnees] = useState({ etat: "chargement" });
  useEffect(() => {
    let annule = false;
    enCours = enCours || fetch("/donnees/pages.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    enCours.then((d) => { if (!annule) setDonnees(d ? { etat: "pret", ...d } : { etat: "absent" }); if (!d) enCours = null; });
    return () => { annule = true; };
  }, []);
  return donnees;
}

export const nombre = (n) => (n === null || n === undefined ? "–" : n.toLocaleString("fr-FR"));
export const pourcent = (n, chiffres = 1) => (n === null || n === undefined ? "–"
  : `${n.toLocaleString("fr-FR", { minimumFractionDigits: chiffres, maximumFractionDigits: chiffres })} %`);
export const dateCourte = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

// Les deux conditions pour brancher le modèle, sur la dernière nuit
export function etatDuModele(modele) {
  const derniere = modele?.historique?.at(-1);
  if (!derniere) return null;
  const ecart = Math.round((derniere.annonce - derniere.reel) * 10) / 10;
  return { ...derniere, ecart, gainOk: derniere.gain >= modele.conditions.gain_min, ecartOk: Math.abs(ecart) < modele.conditions.ecart_max };
}
