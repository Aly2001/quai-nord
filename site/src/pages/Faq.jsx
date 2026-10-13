import { Link } from "react-router-dom";
import DecorVoies from "../components/DecorVoies";
import { faq, SNCF_CONNECT } from "../data/faq";
import "./Faq.css";

export default function Faq() {
  return (
    <>
      {/* ---------- Bandeau, dans le style des autres pages ---------- */}
      <section className="bandeau-resultats">
        <DecorVoies cadrage="xMidYMid slice" discret />
        <div className="conteneur bandeau-resultats__contenu">
          <p className="bandeau-resultats__surtitre">Aide</p>
          <h1 className="bandeau-resultats__titre">Questions fréquentes</h1>
          <p className="bandeau-resultats__date">Ce que fait Quai Nord, et ce qu'il ne fait pas.</p>
        </div>
      </section>

      {/* ---------- Sommaire : un lien par thème ---------- */}
      <nav aria-label="Thèmes" className="faq__sommaire">
        {faq.map((groupe) => (
          <a key={groupe.id} href={`#${groupe.id}`} className="faq__theme-lien">{groupe.theme}</a>
        ))}
      </nav>

      {/* ---------- Les questions, en accordéon ---------- */}
      {faq.map((groupe) => (
        <section key={groupe.id} id={groupe.id} className="faq__groupe" aria-labelledby={`titre-${groupe.id}`}>
          <h2 id={`titre-${groupe.id}`} className="titre-section">{groupe.theme}</h2>
          <div className="faq__liste">
            {groupe.questions.map((q) => (
              // <details> : un accordéon natif du navigateur, accessible au clavier
              <details key={q.question} className="faq__question">
                <summary>{q.question}</summary>
                <div className="faq__reponse">
                  {q.reponse.map((paragraphe) => <p key={paragraphe}>{paragraphe}</p>)}
                  {q.lien && (
                    <a href={q.lien.url} target="_blank" rel="noopener noreferrer" className="faq__lien">
                      {q.lien.texte} ↗
                    </a>
                  )}
                </div>
              </details>
            ))}
          </div>
        </section>
      ))}

      <section className="faq__fin">
        <h2 className="titre-section">Vous n'avez pas trouvé votre réponse ?</h2>
        <p className="texte-doux">
          Pour les billets, les horaires officiels et les perturbations, le site de référence reste SNCF Connect.
        </p>
        <div className="faq__actions">
          <Link to="/" className="faq__bouton">Rechercher un trajet</Link>
          <a href={SNCF_CONNECT} target="_blank" rel="noopener noreferrer" className="faq__bouton faq__bouton--secondaire">
            Aller sur SNCF Connect ↗
          </a>
        </div>
      </section>
    </>
  );
}
