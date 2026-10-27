import { useLangue } from "../langue/langue";
import { useSearchParams } from "react-router-dom";
import NoraConversation, { AvatarNora } from "../components/NoraConversation";
import { BoutonTaille } from "../components/TailleNora";
import { libelleGare } from "../data/bus";
import "./NoraPage.css";
import { useTitrePage } from "../components/titrePage";

// La page de Nora : présentation à gauche, conversation à droite (ordinateur) ;
// sur téléphone, un bandeau compact puis la conversation en plein écran.
const DESTINATIONS = [["au centre-ville", "norap.dest1"], ["à l'université", "norap.dest2"], ["à l'hôpital", "norap.dest3"], ["à la mairie", "norap.dest4"]];

export default function Nora() {
  const { t, langue } = useLangue();
  useTitrePage("Nora, l'assistante", "Nora, l'assistante IA de Quai Nord : le bus, le tram ou le métro depuis la gare, et les risques de retard expliqués, dans six villes des Hauts-de-France.");
  // Ouverte depuis la carte « Votre bus depuis la gare » de l'accueil : la gare est déjà connue
  const [parametres] = useSearchParams();
  const gare = parametres.get("gare");
  const depuisGare = gare ? {
    contexte: `Le voyageur est à la gare de ${gare} et cherche un bus, un tram ou un métro pour continuer.`,
    accueil: t("norap.depuis", { gare: libelleGare(gare) }),
    suggestions: DESTINATIONS.map(([lieu, cle]) => ({
      texte: t(cle),
      question: langue === "en" ? `I'm at ${gare} station, I'm going ${t(cle).toLowerCase()}.` : `Je suis à la gare de ${gare}, je vais ${lieu}.`,
    })),
  } : {};

  return (
    <div className="nora-page">
      {/* ---------- Téléphone : bandeau compact ---------- */}
      <header className="nora-page__bandeau">
        <AvatarNora taille={40} />
        <div>
          <h1 className="nora-page__nom">Nora</h1>
          <p className="nora-page__signature">{t("norap.signature")}</p>
        </div>
        <BoutonTaille />
      </header>

      {/* ---------- Ordinateur : présentation ---------- */}
      <aside className="nora-page__presentation">
        <section className="nora-carte-nuit">
          <AvatarNora taille={64} />
          <div>
            <h1 className="nora-carte-nuit__nom">Nora</h1>
            <p className="nora-carte-nuit__signature">{t("norap.signature")}</p>
          </div>
          <BoutonTaille />
          <p>{t("norap.intro")}</p>
        </section>

        <section className="nora-carte-blanche">
          <h2>{t("norap.peut")}</h2>
          <p className="nora-oui">{t("norap.peut1")}</p>
          <p className="nora-oui">{t("norap.peut2")}</p>
          <p className="nora-oui">{t("norap.peut3")}</p>
          <h2>{t("norap.nepeut")}</h2>
          <p className="nora-non">{t("norap.nepeut1")}</p>
          <p className="nora-non">{t("norap.nepeut2")}</p>
        </section>

        <p className="nora-page__note">
          {t("norap.note")}
        </p>
      </aside>

      <section className="nora-page__conversation" aria-label={t("norap.aria")}>
        <NoraConversation key={gare || "general"} {...depuisGare} />
      </section>
    </div>
  );
}
