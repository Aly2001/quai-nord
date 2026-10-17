import { useEffect, useRef } from "react";
import NoraConversation, { AvatarNora } from "./NoraConversation";
import { BoutonTaille } from "./TailleNora";
import "./NoraPanneau.css";

// Le panneau latéral de Nora, ouvert depuis un train (« Pourquoi ? Demander à Nora »).
// Sur téléphone, il occupe tout l'écran.
// titre : le train concerné (affiché dans le bandeau jaune) ; contexte : le texte envoyé à Nora
export default function NoraPanneau({ titre, contexte, accueil = null, suggestions = null, questionInitiale = null, onFermer }) {
  const fermer = useRef(null);
  const boite = useRef(null);

  // Le clavier du téléphone : quand il s'ouvre, la hauteur VISIBLE de l'écran diminue,
  // mais la page ne le sait pas toute seule. On écoute cette hauteur (visualViewport).
  // Le panneau garde toute la hauteur de l'écran (son fond blanc passe SOUS le clavier, qui est
  // transparent sur les iPhone récents), et une marge en bas égale au clavier garde la saisie au-dessus.
  useEffect(() => {
    const vue = window.visualViewport;
    if (!vue) return undefined;
    const ajuster = () => {
      if (!boite.current) return;
      const hauteurEcran = window.innerHeight;
      const clavier = Math.max(0, Math.round(hauteurEcran - vue.height - vue.offsetTop));
      boite.current.style.top = `${vue.offsetTop}px`;
      boite.current.style.height = `${hauteurEcran}px`;
      boite.current.style.paddingBottom = `${clavier}px`;
      // Clavier ouvert : la barre du bas de l'iPhone est cachée, inutile de lui laisser de la place
      boite.current.classList.toggle("nora-panneau__boite--clavier", clavier > 80);
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
            <p>Votre assistante mobilité</p>
          </div>
          <BoutonTaille />
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
