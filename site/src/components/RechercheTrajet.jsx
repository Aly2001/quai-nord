import { useEffect, useMemo, useState } from "react";
import ChampGare from "./ChampGare";
import { lireRecents, retenirGares } from "../data/suggestionsGares";
import { useIndexHoraires, joursAVenir, etiquetteJour, dateCourte, heureActuelle } from "../data/horaires";
import { useLangue } from "../langue/langue";
import "./RechercheTrajet.css";

// « Aujourd'hui », « Demain », « Après-demain » dans la langue choisie (sinon la date)
function nomDuJour(dateIso, t, court = false) {
  const nom = etiquetteJour(dateIso);
  const cles = { "Aujourd'hui": "jour.aujourdhui", Demain: "jour.demain", "Après-demain": court ? "jour.apresdemain.court" : "jour.apresdemain" };
  return cles[nom] ? t(cles[nom]) : nom;
}

// Petites icônes dessinées en SVG (aucune image externe)
function IconeGare() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="currentColor">
      <path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" />
    </svg>
  );
}

function IconeHorloge() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </svg>
  );
}

// Le formulaire « De ... à ... », utilisé sur l'accueil ET sur la page des résultats.
export default function RechercheTrajet({ initial = {}, onRechercher, texteBouton }) {
  const { t } = useLangue();
  const { index } = useIndexHoraires();
  const [de, setDe] = useState(initial.de || "");
  const [a, setA] = useState(initial.a || "");
  const [jour, setJour] = useState(initial.jour || "");
  // Par défaut : l'heure actuelle (on ne cherche pas un train déjà parti)
  const [heure, setHeure] = useState(initial.heure || heureActuelle());
  const recents = useMemo(() => lireRecents(), []);
  const nomsDepart = useMemo(() => index?.gares.map((g) => g.nom) || [], [index]);
  const nomsArrivee = useMemo(() => index?.destinations || [], [index]);

  // Seulement aujourd'hui, demain et après-demain
  const jours = index ? joursAVenir(index.jours) : [];

  // Si aucun jour n'est choisi, ou si le jour choisi est passé : on prend le premier disponible
  useEffect(() => {
    if (jours.length > 0 && !jours.includes(jour)) setJour(jours[0]);
  }, [jours, jour]);

  function inverser() {
    setDe(a);
    setA(de);
  }

  function envoyer(evenement) {
    evenement.preventDefault();          // empêche le navigateur de recharger la page
    retenirGares(de, a);                 // les gares récentes, gardées sur ce téléphone
    onRechercher({ de, a, jour, heure });
  }

  return (
    <form className="recherche" onSubmit={envoyer}>
      {/* ---------- Départ et arrivée ---------- */}
      <div className="recherche__gares">
        <ChampGare id="rt-de" label={t("recherche.depart")} valeur={de} onChange={setDe} noms={nomsDepart} recents={recents}
                   placeholder={t("recherche.exemple")} position icone={<IconeGare />} />
        <ChampGare id="rt-a" label={t("recherche.arrivee")} valeur={a} onChange={setA} noms={nomsArrivee} recents={recents}
                   placeholder={t("recherche.exemple")} icone={<IconeGare />} />

        <button type="button" className="recherche__inverser" onClick={inverser}
                aria-label={t("recherche.inverser")}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none"
               stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 4v16M3 8l4-4 4 4M17 20V4M21 16l-4 4-4-4" />
          </svg>
        </button>
      </div>

      {/* ---------- Le jour : trois boutons ---------- */}
      <fieldset className="recherche__jours">
        <legend>{t("recherche.aller")}</legend>
        <div className="recherche__choix-jours">
          {jours.map((j) => (
            <button key={j} type="button"
                    className={j === jour ? "choix-jour choix-jour--actif" : "choix-jour"}
                    aria-pressed={j === jour}
                    onClick={() => setJour(j)}>
              <span className="choix-jour__nom">
                {/* Version courte sur les petits écrans : « Après-dem. » */}
                <span className="choix-jour__long">{nomDuJour(j, t)}</span>
                <span className="choix-jour__court" aria-hidden="true">{nomDuJour(j, t, true)}</span>
              </span>
              <span className="choix-jour__date">{dateCourte(j)}</span>
            </button>
          ))}
        </div>
        {index && jours.length === 0 && (
          <p className="recherche__alerte">Horaires à mettre à jour : relance python exporter_horaires.py.</p>
        )}
      </fieldset>

      {/* ---------- L'heure ---------- */}
      <div className="boite">
        <IconeHorloge />
        <div className="boite__contenu">
          <label htmlFor="rt-heure">{t("recherche.heure")}</label>
          <input id="rt-heure" type="time" required value={heure}
                 onChange={(e) => setHeure(e.target.value)} />
        </div>
      </div>

      <div className="recherche__actions">
        <button type="submit" className="recherche__bouton" disabled={!jour}>{texteBouton || t("recherche.rechercher")}</button>
      </div>

    </form>
  );
}
