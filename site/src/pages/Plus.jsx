import { useLangue } from "../langue/langue";
import { Link } from "react-router-dom";
import "./Plus.css";
import { useTitrePage } from "../components/titrePage";

export default function Plus() {
  const { t } = useLangue();
  useTitrePage("À propos", "L'installation de l'application et les informations sur Quai Nord.");
  return (
    <div className="plus">
      <h1 className="plus__titre">{t("plus.titre")}</h1>

      <section className="plus__bloc" id="installer">
        <h2 className="plus__rubrique">{t("plus.installer")}</h2>
        <details className="plus__details">
          <summary>{t("plus.iphone")}</summary>
          <p>{t("plus.iphone.texte")}</p>
        </details>
        <details className="plus__details">
          <summary>{t("plus.android")}</summary>
          <p>{t("plus.android.texte")}</p>
        </details>
      </section>

      <section className="plus__bloc">
        <h2 className="plus__rubrique">{t("plus.titre")}</h2>
        <div className="plus__apropos">
          <p>{t("plus.apropos.texte")}</p>
          <div className="plus__boutons">
            <a href="https://www.linkedin.com/in/aly-keita-306703340/" target="_blank" rel="noopener noreferrer"
               className="plus__bouton plus__bouton--plein">LinkedIn ↗</a>
            <a href="https://github.com/Aly2001/quai-nord" target="_blank" rel="noopener noreferrer"
               className="plus__bouton">{t("plus.github")}</a>
          </div>
        </div>
      </section>

      <section className="plus__bloc">
        <h2 className="plus__rubrique">{t("plus.aide")}</h2>
        <nav aria-label={t("plus.aide")} className="plus__liens">
          <Link to="/faq">{t("plus.faq")}</Link>
          <Link to="/faq#risque">{t("plus.risque")}</Link>
          <Link to="/sources">{t("plus.sources")}</Link>
        </nav>
      </section>
    </div>
  );
}
