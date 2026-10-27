import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import DecorVoies from "../components/DecorVoies";
import { faqDe, SNCF_CONNECT } from "../data/faq";
import { useLangue } from "../langue/langue";
import "./Faq.css";
import { useTitrePage } from "../components/titrePage";

export default function Faq() {
  useTitrePage("Questions fréquentes", "Les réponses aux questions sur Quai Nord : le calcul du risque de retard, les données utilisées, Nora et les bus depuis les gares.");
  // Arrivée sur /faq#risque : on fait défiler jusqu'au bon thème
  const { t, langue } = useLangue();
  const faq = faqDe(langue);
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);

  return (
    <>
      {/* ---------- Bandeau, dans le style des autres pages ---------- */}
      <section className="bandeau-resultats">
        <DecorVoies cadrage="xMidYMid slice" discret />
        <div className="conteneur bandeau-resultats__contenu">
          <p className="bandeau-resultats__surtitre">{t("faq.surtitre")}</p>
          <h1 className="bandeau-resultats__titre">{t("faq.titre")}</h1>
          <p className="bandeau-resultats__date">{t("faq.sous")}</p>
        </div>
      </section>

      {/* ---------- Sommaire : un lien par thème ---------- */}
      <nav aria-label={t("faq.themes")} className="faq__sommaire">
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
        <h2 className="titre-section">{t("faq.fin")}</h2>
        <p className="texte-doux">{t("faq.fin.texte")}</p>
        <div className="faq__actions">
          <Link to="/" className="faq__bouton">{t("nora.rechercher")}</Link>
          <a href={SNCF_CONNECT} target="_blank" rel="noopener noreferrer" className="faq__bouton faq__bouton--secondaire">
            {t("nora.sncf")}
          </a>
        </div>
      </section>
    </>
  );
}
