import { useLangue } from "../langue/langue";
import { ListeFavoris, ListeTrainsFavoris, ListeVilleFavoris } from "../components/Favoris";
import { ListeSuivis } from "../components/Suivre";
import { useTitrePage } from "../components/titrePage";
import "./Plus.css";

export default function Favoris() {
  const { t } = useLangue();
  useTitrePage("Mes favoris", "Vos trains, vos trajets et vos déplacements en ville, gardés sur cet appareil, sans compte.");
  return (
    <div className="plus">
      <h1 className="plus__titre">{t("fav.page.titre")}</h1>
      <p className="plus__aide">{t("fav.page.aide")}</p>

      <section className="plus__bloc">
        <h2 className="plus__rubrique">{t("suivi.titre.liste")}</h2>
        <p className="plus__aide">{t("suivi.aide")}</p>
        <ListeSuivis />
      </section>

      <section className="plus__bloc">
        <h2 className="plus__rubrique">{t("fav.trains")}</h2>
        <p className="plus__aide">{t("fav.trains.aide")}</p>
        <ListeTrainsFavoris />
      </section>

      <section className="plus__bloc">
        <h2 className="plus__rubrique">{t("fav.trajets")}</h2>
        <ListeFavoris gestion />
      </section>

      <section className="plus__bloc">
        <h2 className="plus__rubrique">{t("fav.ville")}</h2>
        <ListeVilleFavoris />
      </section>
    </div>
  );
}
