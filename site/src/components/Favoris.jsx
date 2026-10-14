import { Link } from "react-router-dom";
import { useFavoris } from "../data/favoris";
import { aujourdhuiIso, heureActuelle } from "../data/horaires";
import "./Favoris.css";

// L'adresse de recherche d'un favori : aujourd'hui, à partir de maintenant
export function lienFavori({ de, a }) {
  return `/trajet?${new URLSearchParams({ de, a, jour: aujourdhuiIso(), heure: heureActuelle() })}`;
}

// ---------- Le bouton étoile, sur la page des résultats ----------
export function BoutonFavori({ de, a }) {
  const { estFavori, basculer } = useFavoris();
  if (!de || !a) return null;
  const actif = estFavori(de, a);
  return (
    <button type="button" className={actif ? "bouton-favori bouton-favori--actif" : "bouton-favori"}
            aria-pressed={actif} onClick={() => basculer(de, a)}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"
           fill={actif ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9z" />
      </svg>
      {actif ? "Dans vos favoris" : "Ajouter aux favoris"}
    </button>
  );
}

// ---------- La liste des favoris (accueil, page Plus) ----------
// sombre : sur le bandeau bleu nuit de l'accueil ; gestion : avec un bouton « Retirer »
export function ListeFavoris({ sombre = false, gestion = false }) {
  const { favoris, retirer } = useFavoris();

  if (favoris.length === 0) {
    return gestion ? (
      <p className="favoris__vide">
        Aucun favori pour l'instant. Après une recherche, appuyez sur « Ajouter aux favoris » pour la retrouver ici.
      </p>
    ) : null;
  }

  return (
    <section className={sombre ? "favoris favoris--sombre" : "favoris"} aria-labelledby="titre-favoris">
      {/* Sur la page Plus, la rubrique a déjà son titre */}
      <h2 id="titre-favoris" className={gestion ? "visuellement-cache" : "favoris__titre"}>Vos trajets favoris</h2>
      <ul className="favoris__liste">
        {favoris.map((f) => (
          <li key={f.de + f.a} className="favoris__element">
            <Link to={lienFavori(f)} className="favoris__lien">
              <span>{f.de} → {f.a}</span>
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none"
                   stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 6l6 6-6 6" /></svg>
            </Link>
            {gestion && (
              <button type="button" className="favoris__retirer" onClick={() => retirer(f.de, f.a)}
                      aria-label={`Retirer ${f.de} → ${f.a} des favoris`}>
                Retirer
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
