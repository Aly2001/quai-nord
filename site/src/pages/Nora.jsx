import { useSearchParams } from "react-router-dom";
import NoraConversation, { AvatarNora } from "../components/NoraConversation";
import { BoutonTaille } from "../components/TailleNora";
import { libelleGare } from "../data/bus";
import "./NoraPage.css";
import { useTitrePage } from "../components/titrePage";

// La page de Nora : présentation à gauche, conversation à droite (ordinateur) ;
// sur téléphone, un bandeau compact puis la conversation en plein écran.
const DESTINATIONS = ["au centre-ville", "à l'université", "à l'hôpital", "à la mairie"];

export default function Nora() {
  useTitrePage("Nora, l'assistante", "Nora, l'assistante IA de Quai Nord : le bus, le tram ou le métro depuis la gare, et les risques de retard expliqués, dans six villes des Hauts-de-France.");
  // Ouverte depuis la carte « Votre bus depuis la gare » de l'accueil : la gare est déjà connue
  const [parametres] = useSearchParams();
  const gare = parametres.get("gare");
  const depuisGare = gare ? {
    contexte: `Le voyageur est à la gare de ${gare} et cherche un bus, un tram ou un métro pour continuer.`,
    accueil: `Depuis la gare de ${libelleGare(gare)}, où allez-vous ?`,
    suggestions: DESTINATIONS.map((lieu) => ({
      texte: lieu.charAt(0).toUpperCase() + lieu.slice(1),
      question: `Je suis à la gare de ${gare}, je vais ${lieu}.`,
    })),
  } : {};

  return (
    <div className="nora-page">
      {/* ---------- Téléphone : bandeau compact ---------- */}
      <header className="nora-page__bandeau">
        <AvatarNora taille={40} />
        <div>
          <h1 className="nora-page__nom">Nora</h1>
          <p className="nora-page__signature">Votre assistante mobilité</p>
        </div>
        <BoutonTaille />
      </header>

      {/* ---------- Ordinateur : présentation ---------- */}
      <aside className="nora-page__presentation">
        <section className="nora-carte-nuit">
          <AvatarNora taille={64} />
          <div>
            <h1 className="nora-carte-nuit__nom">Nora</h1>
            <p className="nora-carte-nuit__signature">Votre assistante mobilité</p>
          </div>
          <BoutonTaille />
          <p>L'assistante IA de Quai Nord répond à vos questions sur l'application, vos trajets et le risque de retard.</p>
        </section>

        <section className="nora-carte-blanche">
          <h2>Nora peut</h2>
          <p className="nora-oui">expliquer un risque de retard</p>
          <p className="nora-oui">chercher vos prochains trains</p>
          <p className="nora-oui">vous aider à utiliser Quai Nord</p>
          <h2>Nora ne peut pas</h2>
          <p className="nora-non">vendre ou réserver un billet</p>
          <p className="nora-non">donner une information officielle SNCF</p>
        </section>

        <p className="nora-page__note">
          Nora est une IA : elle peut se tromper. Vos questions sont transmises au service Gemini de Google
          pour générer les réponses, et ne sont pas conservées par Quai Nord. 10 questions par jour.
        </p>
      </aside>

      <section className="nora-page__conversation" aria-label="Conversation avec Nora">
        <NoraConversation key={gare || "general"} {...depuisGare} />
      </section>
    </div>
  );
}
