import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useFavoris } from "../data/favoris";
import { useFavorisPlus, etatDuTrain, idTrain, idVille } from "../data/favorisPlus";
import { useLangue } from "../langue/langue";
import { aujourdhuiIso, heureActuelle, useIndexHoraires, trouverGare, DOSSIER, useTempsReel, useRisques, ajouterMinutes } from "../data/horaires";
import "./Favoris.css";

// L'adresse de recherche d'un favori : aujourd'hui, à partir de maintenant
export function lienFavori({ de, a }) {
  return `/trajet?${new URLSearchParams({ de, a, jour: aujourdhuiIso(), heure: heureActuelle() })}`;
}

// ---------- Le bouton étoile, sur la page des résultats ----------
export function BoutonFavori({ de, a }) {
  const { t } = useLangue();
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
      {actif ? t("fav.dans") : t("fav.ajouter")}
    </button>
  );
}

// ---------- La liste des favoris (accueil, page Plus) ----------
// sombre : sur le bandeau bleu nuit de l'accueil ; gestion : avec un bouton « Retirer »
export function ListeFavoris({ sombre = false, gestion = false }) {
  const { t } = useLangue();
  const { favoris, retirer } = useFavoris();

  if (favoris.length === 0) {
    return gestion ? (
      <p className="favoris__vide">
        {t("fav.vide")}
      </p>
    ) : null;
  }

  return (
    <section className={sombre ? "favoris favoris--sombre" : "favoris"} aria-labelledby="titre-favoris">
      {/* Sur la page Plus, la rubrique a déjà son titre */}
      <h2 id="titre-favoris" className={gestion ? "visuellement-cache" : "favoris__titre"}>{t("fav.titre")}</h2>
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
                      aria-label={t("fav.retirer.aria", { trajet: `${f.de} → ${f.a}` })}>
                {t("fav.retirer")}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}


// ---------- Un train précis : l'étoile sur sa carte, dans les résultats ----------
export function EtoileTrain({ trajet }) {
  const { t } = useLangue();
  const { estTrainFavori, basculerTrain } = useFavorisPlus();
  const train = { de: trajet.gareDepart, a: trajet.gareArrivee, heure: trajet.heure };
  const actif = estTrainFavori(train);
  return (
    <button type="button" className={actif ? "etoile-train etoile-train--actif" : "etoile-train"} aria-pressed={actif}
            onClick={() => basculerTrain(train)}
            aria-label={t(actif ? "fav.etoile.retirer" : "fav.etoile.ajouter", { heure: trajet.heure })}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill={actif ? "currentColor" : "none"}
           stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9z" /></svg>
    </button>
  );
}

// Les départs du jour d'une gare (le même fichier que la page des résultats)
function useDepartsDuJour(nomGare) {
  const { index } = useIndexHoraires();
  const [departs, setDeparts] = useState({ gare: null, liste: null });
  const gare = index && nomGare ? trouverGare(index.gares, nomGare) : null;
  useEffect(() => {
    if (!gare) return undefined;
    let annule = false;
    fetch(`${DOSSIER}/${gare.slug}/${aujourdhuiIso()}.json`)
      .then((r) => r.json()).then((d) => { if (!annule) setDeparts({ gare: gare.slug, liste: d.departs || [] }); })
      .catch(() => { if (!annule) setDeparts({ gare: gare.slug, liste: [] }); });
    return () => { annule = true; };
  }, [gare?.slug]);
  return departs.gare === gare?.slug ? departs.liste : null;
}

const MOTS_ETAT = {
  absent: { cle: "montrain.absent", classe: "absent" },
  supprime: { cle: "montrain.supprime", classe: "supprime" },
  heure: { cle: "montrain.heure", classe: "heure" },
};

// L'état du jour d'un train favori, en pastille
export function EtatTrain({ favori, tempsReel, risques }) {
  const { t } = useLangue();
  const departs = useDepartsDuJour(favori.de);
  if (!departs) return <span className="etat-train etat-train--attente">…</span>;
  const etat = etatDuTrain(favori, departs, tempsReel, risques);
  if (etat.statut === "retard") return <span className="etat-train etat-train--retard">{t("montrain.retard", { minutes: etat.minutes })}</span>;
  if (etat.statut === "prevu") {
    return etat.risque === null ? <span className="etat-train etat-train--absent">{t("montrain.prevu")}</span>
      : <span className={`etat-train etat-train--${etat.niveau.classe}`}>{t("montrain.risque", { pourcentage: etat.risque })}</span>;
  }
  const m = MOTS_ETAT[etat.statut];
  return <span className={`etat-train etat-train--${m.classe}`}>{t(m.cle)}</span>;
}

// ---------- « Mon train du jour » : le train surveillé, en tête de l'accueil ----------
export function MonTrainDuJour() {
  const { t } = useLangue();
  const { trainSurveille } = useFavorisPlus();
  const tempsReel = useTempsReel(Boolean(trainSurveille));
  const risques = useRisques();
  const departs = useDepartsDuJour(trainSurveille?.de);
  if (!trainSurveille) return null;
  const etat = departs ? etatDuTrain(trainSurveille, departs, tempsReel, risques) : null;
  const lien = `/trajet?${new URLSearchParams({ de: trainSurveille.de, a: trainSurveille.a, jour: aujourdhuiIso(), heure: trainSurveille.heure })}`;
  return (
    <Link to={lien} className={`mon-train mon-train--${etat?.statut || "attente"}`}>
      <span className="mon-train__haut">
        <span className="mon-train__titre">{t("montrain.titre")}</span>
        {etat && <EtatTrain favori={trainSurveille} tempsReel={tempsReel} risques={risques} />}
      </span>
      <strong className="mon-train__trajet">{trainSurveille.heure} · {trainSurveille.de} → {trainSurveille.a}</strong>
      {etat?.statut === "retard" && <span className="mon-train__detail">{t("montrain.nouvelle", { heure: ajouterMinutes(trainSurveille.heure, etat.minutes) })}</span>}
      {etat?.statut === "supprime" && <span className="mon-train__detail">{t("montrain.autres")}</span>}
    </Link>
  );
}

// ---------- La page Favoris : les trains précis (avec « Surveiller »), puis les trajets En ville ----------
export function ListeTrainsFavoris() {
  const { t: tr } = useLangue();
  const t = tr;                                  // hors des listes ; dans les .map, « t » est un trajet
  const { trains, surveille, basculerTrain, surveiller } = useFavorisPlus();
  const tempsReel = useTempsReel(trains.length > 0);
  const risques = useRisques();
  if (!trains.length) {
    return <p className="favoris__vide">{t("fav.trains.vide")}</p>;
  }
  return (
    <ul className="favoris__liste">
      {trains.map((t) => {
        const surveilleCeTrain = surveille === idTrain(t);
        return (
          <li key={idTrain(t)} className="favori-train">
            <Link className="favori-train__lien" to={`/trajet?${new URLSearchParams({ de: t.de, a: t.a, jour: aujourdhuiIso(), heure: t.heure })}`}>
              <strong>{t.heure} · {t.de} → {t.a}</strong>
              <EtatTrain favori={t} tempsReel={tempsReel} risques={risques} />
            </Link>
            <div className="favori-train__actions">
              <button type="button" aria-pressed={surveilleCeTrain} onClick={() => surveiller(t)}
                      className={surveilleCeTrain ? "favori-train__surveiller favori-train__surveiller--actif" : "favori-train__surveiller"}>
                {surveilleCeTrain ? t("fav.surveille") : t("fav.surveiller")}
              </button>
              <button type="button" className="favoris__retirer" onClick={() => basculerTrain(t)}
                      aria-label={tr("fav.etoile.retirer", { heure: t.heure })}>{tr("fav.retirer")}</button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export const lienVille = (trajet) => `/bus?${new URLSearchParams({ t: JSON.stringify(trajet) })}`;

export function ListeVilleFavoris() {
  const { t: tr } = useLangue();
  const t = tr;                                  // hors des listes ; dans les .map, « t » est un trajet
  const { ville, basculerVille } = useFavorisPlus();
  if (!ville.length) {
    return <p className="favoris__vide">{t("fav.ville.vide")}</p>;
  }
  return (
    <ul className="favoris__liste">
      {ville.map((t) => (
        <li key={idVille(t)} className="favoris__element">
          <Link to={lienVille(t)} className="favoris__lien"><span>{t.A.nom} → {t.B.nom}</span><small>{t.ville}</small></Link>
          <button type="button" className="favoris__retirer" onClick={() => basculerVille(t)}
                  aria-label={tr("fav.retirer.aria", { trajet: `${t.A.nom} → ${t.B.nom}` })}>{tr("fav.retirer")}</button>
        </li>
      ))}
    </ul>
  );
}

export function EtoileVille({ trajet }) {
  const { t } = useLangue();
  const { estVilleFavori, basculerVille } = useFavorisPlus();
  const actif = estVilleFavori(trajet);
  return (
    <button type="button" className={actif ? "bouton-favori bouton-favori--actif" : "bouton-favori"} aria-pressed={actif}
            onClick={() => basculerVille(trajet)}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill={actif ? "currentColor" : "none"}
           stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9z" /></svg>
      {actif ? t("fav.dans") : t("fav.ajouter")}
    </button>
  );
}
