import { useEffect, useRef } from "react";
import NoraConversation, { AvatarNora } from "./NoraConversation";
import "./NoraPanneau.css";

// Le panneau latéral de Nora, ouvert depuis un train (« Pourquoi ? Demander à Nora »).
// Sur téléphone, il occupe tout l'écran.
// titre : le train concerné (affiché dans le bandeau jaune) ; contexte : le texte envoyé à Nora
export default function NoraPanneau({ titre, contexte, accueil = null, suggestions = null, questionInitiale = null, onFermer }) {
  const fermer = useRef(null);
  const boite = useRef(null);

  // Le clavier du téléphone : quand il s'ouvre, la hauteur VISIBLE de l'écran diminue,
  // mais la page ne le sait pas toute seule. On écoute cette hauteur (visualViewport)
  // et on y ajuste le panneau, pour que la saisie reste juste au-dessus du clavier.
  useEffect(() => {
    const vue = window.visualViewport;
    if (!vue) return undefined;
    const ajuster = () => {
      if (!boite.current) return;
      boite.current.style.height = `${vue.height}px`;
      boite.current.style.top = `${vue.offsetTop}px`;
    };
    ajuster();
    vue.addEventListener("resize", ajuster);
    vue.addEventListener("scroll", ajuster);
    return () => {
      vue.removeEventListener("resize", ajuster);
      vue.removeEventListener("scroll", ajuster);
    };
  }, []);

  useEffect(() => {
    fermer.current?.focus();                                    // le clavier arrive dans le panneau
    const echap = (e) => { if (e.key === "Escape") onFermer(); };
    document.addEventListener("keydown", echap);
    document.body.style.overflow = "hidden";                   // la page derrière ne défile plus
    return () => {
      document.removeEventListener("keydown", echap);
      document.body.style.overflow = "";
    };
  }, [onFermer]);

  return (
    <div className="nora-panneau">
      <div className="nora-panneau__fond" onClick={onFermer} aria-hidden="true" />
      <aside ref={boite} className="nora-panneau__boite" role="dialog" aria-modal="true" aria-label="Nora, l'assistante">
        <header className="nora-panneau__entete">
          <AvatarNora taille={44} />
          <div className="nora-panneau__titre">
            <h2>Nora</h2>
            <p>Je suis là pour votre trajet</p>
          </div>
          <button ref={fermer} type="button" className="nora-panneau__fermer" aria-label="Fermer" onClick={onFermer}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor"
                 strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>
        <p className="nora-panneau__contexte">À propos de : <strong>{titre}</strong></p>
        <div className="nora-panneau__conversation">
          <NoraConversation contexte={contexte} accueil={accueil} suggestions={suggestions} questionInitiale={questionInitiale} />
        </div>
      </aside>
    </div>
  );
}
