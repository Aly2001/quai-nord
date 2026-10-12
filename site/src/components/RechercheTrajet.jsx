import { useEffect, useState } from "react";
import { useIndexHoraires, joursAVenir, etiquetteJour, dateCourte, heureActuelle } from "../data/horaires";
import "./RechercheTrajet.css";

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
export default function RechercheTrajet({ initial = {}, onRechercher, texteBouton = "Rechercher" }) {
  const { index } = useIndexHoraires();
  const [de, setDe] = useState(initial.de || "");
  const [a, setA] = useState(initial.a || "");
  const [jour, setJour] = useState(initial.jour || "");
  // Par défaut : l'heure actuelle (on ne cherche pas un train déjà parti)
  const [heure, setHeure] = useState(initial.heure || heureActuelle());

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
    onRechercher({ de, a, jour, heure });
  }

  return (
    <form className="recherche" onSubmit={envoyer}>
      {/* ---------- Départ et arrivée ---------- */}
      <div className="recherche__gares">
        <div className="boite">
          <IconeGare />
          <div className="boite__contenu">
            <label htmlFor="rt-de">Gare de départ</label>
            <input id="rt-de" type="text" list="rt-liste-depart" required autoComplete="off"
                   placeholder="Ex. : Calais Ville" value={de}
                   onChange={(e) => setDe(e.target.value)} />
          </div>
        </div>

        <div className="boite">
          <IconeGare />
          <div className="boite__contenu">
            <label htmlFor="rt-a">Gare d'arrivée</label>
            <input id="rt-a" type="text" list="rt-liste-arrivee" required autoComplete="off"
                   placeholder="Ex. : Dunkerque" value={a}
                   onChange={(e) => setA(e.target.value)} />
          </div>
        </div>

        <button type="button" className="recherche__inverser" onClick={inverser}
                aria-label="Inverser le départ et l'arrivée">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none"
               stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 4v16M3 8l4-4 4 4M17 20V4M21 16l-4 4-4-4" />
          </svg>
        </button>
      </div>

      {/* ---------- Le jour : trois boutons ---------- */}
      <fieldset className="recherche__jours">
        <legend>Aller</legend>
        <div className="recherche__choix-jours">
          {jours.map((j) => (
            <button key={j} type="button"
                    className={j === jour ? "choix-jour choix-jour--actif" : "choix-jour"}
                    aria-pressed={j === jour}
                    onClick={() => setJour(j)}>
              <span className="choix-jour__nom">{etiquetteJour(j)}</span>
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
          <label htmlFor="rt-heure">Départ à partir de</label>
          <input id="rt-heure" type="time" required value={heure}
                 onChange={(e) => setHeure(e.target.value)} />
        </div>
      </div>

      <div className="recherche__actions">
        <button type="submit" className="recherche__bouton" disabled={!jour}>{texteBouton}</button>
      </div>

      {/* Les suggestions qui s'affichent pendant la saisie */}
      <datalist id="rt-liste-depart">
        {index?.gares.map((g) => <option key={g.slug} value={g.nom} />)}
      </datalist>
      <datalist id="rt-liste-arrivee">
        {index?.destinations.map((nom) => <option key={nom} value={nom} />)}
      </datalist>
    </form>
  );
}
