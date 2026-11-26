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

// ---------- Le réseau de neurones ----------
const arrondi = (v) => Math.round(v * 10) / 10;
const lendemain = (iso) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

// Les trois candidats, notés sur la MÊME journée : la dernière vraie journée, sinon la dernière nuit rejouée
export function candidats(modele) {
  const reseau = modele?.reseau;
  const reelle = reseau?.journees?.at(-1);
  const rejouee = reseau?.essai?.nuits?.at(-1);
  const source = reelle || rejouee;
  if (!source) return null;
  const liste = [
    { cle: "logistique", nom: "Logistique", detail: "heure, ligne, jour, position, météo", gain: source.gain_logistique },
    { cle: "etat", nom: "+ état de la ligne", detail: "+ la part de trains perturbés depuis le matin", gain: source.gain_etat },
    { cle: "reseau", nom: "Réseau de neurones", detail: "lit toute la journée de la ligne, train par train", gain: source.gain_reseau },
  ];
  const meilleur = Math.max(...liste.map((c) => c.gain));
  return {
    liste: liste.map((c) => ({ ...c, enTete: c.gain === meilleur })),
    quand: reelle ? `journée du ${dateCourte(reelle.journee)}` : `nuit rejouée du ${dateCourte(rejouee.date)}`,
  };
}

// Le réseau vers le branchement : les dernières vraies journées, chacune tenue (les deux conditions) ou non
export function progressionReseau(modele) {
  const journees = modele?.reseau?.journees || [];
  const c = modele?.conditions;
  if (!c) return null;
  const cases = journees.slice(-c.jours).map((j) => {
    const ecart = arrondi(j.annonce_reseau - j.reel);
    const gainOk = j.gain_reseau >= c.gain_min;
    const ecartOk = Math.abs(ecart) < c.ecart_max;
    return { journee: j.journee, gain: j.gain_reseau, ecart, gainOk, ecartOk, ok: gainOk && ecartOk };
  });
  let suite = 0;
  for (const x of [...cases].reverse()) { if (!x.ok) break; suite += 1; }
  return { cases, suite, objectif: c.jours, derniere: cases.at(-1) || null };
}

// Les courbes du réseau, alignées sur les dates de l'historique (une date = une nuit) :
// les nuits rejouées dans Colab, et les vraies journées (notées la nuit suivante)
export function courbesReseau(modele, dates) {
  const rejoue = Object.fromEntries((modele?.reseau?.essai?.nuits || []).map((n) => [n.date, n.gain_reseau]));
  const reel = Object.fromEntries((modele?.reseau?.journees || []).map((j) => [lendemain(j.journee), j.gain_reseau]));
  return { rejoue: dates.map((d) => rejoue[d] ?? null), reel: dates.map((d) => reel[d] ?? null) };
}

// Le résumé des nuits rejouées : gain moyen et stabilité (écart moyen entre les 3 entraînements)
export function resumeEssaiReseau(modele) {
  const nuits = modele?.reseau?.essai?.nuits || [];
  if (!nuits.length) return null;
  const moyenne = (v) => v.reduce((a, b) => a + b, 0) / v.length;
  const ecarts = nuits.map((n) => n.ecart_graines).filter((v) => v !== null && v !== undefined);
  return { nuits: nuits.length, gain: arrondi(moyenne(nuits.map((n) => n.gain_reseau))),
           stabilite: ecarts.length ? arrondi(moyenne(ecarts)) : null, poids: modele.reseau.essai.poids };
}
