// =====================================================================
//  Trajets favoris, enregistrés UNIQUEMENT sur l'appareil du voyageur
//  (stockage local du navigateur) : pas de compte, rien n'est envoyé.
//  Un favori = deux gares. On le recherche toujours « à partir de maintenant ».
// =====================================================================
import { useEffect, useState } from "react";
import { ajouterSansPerdre, MAXIMUM_LISTE } from "./listeLimitee";

const CLE = "quai-nord:favoris";
const MAXIMUM = MAXIMUM_LISTE;
const EVENEMENT = "quai-nord:favoris-modifies";   // prévient les autres composants

function lire() {
  try {
    const liste = JSON.parse(localStorage.getItem(CLE) || "[]");
    return Array.isArray(liste) ? liste : [];
  } catch {
    return [];                                    // stockage indisponible ou abîmé
  }
}

function ecrire(liste) {
  try {
    localStorage.setItem(CLE, JSON.stringify(liste));
  } catch {
    // Navigation privée stricte : on continue sans enregistrer
  }
  window.dispatchEvent(new Event(EVENEMENT));
}

const meme = (f, de, a) => f.de === de && f.a === a;

export function useFavoris() {
  const [favoris, setFavoris] = useState(lire);

  useEffect(() => {
    const relire = () => setFavoris(lire());
    window.addEventListener(EVENEMENT, relire);   // modifié dans un autre composant
    window.addEventListener("storage", relire);   // modifié dans un autre onglet
    return () => {
      window.removeEventListener(EVENEMENT, relire);
      window.removeEventListener("storage", relire);
    };
  }, []);

  function estFavori(de, a) {
    return favoris.some((f) => meme(f, de, a));
  }

  // Renvoie « plein » quand la liste est pleine : rien n'est retiré, l'écran demande lequel retirer
  function basculer(de, a) {
    const liste = lire();
    if (liste.some((f) => meme(f, de, a))) {
      ecrire(liste.filter((f) => !meme(f, de, a)));
      return "retire";
    }
    const r = ajouterSansPerdre(liste, { de, a }, (f) => `${f.de}|${f.a}`, MAXIMUM);
    if (r.plein) return "plein";
    ecrire(r.liste);
    return "ajoute";
  }

  function retirer(de, a) {
    ecrire(lire().filter((f) => !meme(f, de, a)));
  }

  return { favoris, estFavori, basculer, retirer, maximum: MAXIMUM };
}
