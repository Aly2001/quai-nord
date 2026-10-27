import { Link, useNavigate } from "react-router-dom";
import RechercheTrajet from "../components/RechercheTrajet";
import { useLangue } from "../langue/langue";
import Fraicheur from "../components/Fraicheur";
import DecorVoies from "../components/DecorVoies";
import { ListeFavoris, MonTrainDuJour } from "../components/Favoris";
import { MonProchainTrain } from "../components/Suivre";
import { useSuivis, prochainTrainSuivi } from "../data/suivi";
import BusDepuisGare from "../components/BusDepuisGare";
import CarteChiffre from "../components/CarteChiffre";
import GraphiqueBarres from "../components/GraphiqueBarres";
import { chiffreVedette, chiffresCles, retardParHeure, decouvertes } from "../data/chiffres";
import { gares } from "../data/gares";
import "./Accueil.css";
import { useTitrePage } from "../components/titrePage";

export default function Accueil() {
  const { t } = useLangue();
  const prochain = prochainTrainSuivi(useSuivis().suivis);
  useTitrePage(null, "Votre TER des Hauts-de-France sera-t-il à l'heure ? Voyez le risque de retard de votre train, puis le bus, le tram ou le métro à prendre depuis la gare, à Lille, Calais, Boulogne, Dunkerque, Amiens et Arras.");
  const navigate = useNavigate();

  // Quand on valide le formulaire : on va sur la page des résultats,
  // avec la recherche dans l'adresse (/trajet?de=...&a=...&jour=...&heure=...)
  function rechercher(valeurs) {
    navigate(`/trajet?${new URLSearchParams(valeurs)}`);
  }

  // Les 3 gares les plus touchées, calculées à partir des données de la carte
  const podium = gares
    .filter((g) => g.taux !== null)
    .sort((a, b) => b.taux - a.taux)
    .slice(0, 3);

  return (
    <>
      {/* ---------- 1. Le bandeau, sur toute la largeur ---------- */}
      <section className="bandeau">
        <DecorVoies />
        <div className="conteneur bandeau__contenu">
          <div className="bandeau__recherche">
            <h1 className="bandeau__titre">{t("accueil.titre")}</h1>
            {/* Le train surveillé, avec son état en direct : ce qu'on veut savoir en ouvrant l'application */}
            {/* Un train suivi passe en premier ; sinon, le train surveillé des favoris */}
            {prochain ? <MonProchainTrain /> : <MonTrainDuJour />}
            <RechercheTrajet onRechercher={rechercher} />
            {/* Si les données sont anciennes, l'alerte reste juste sous le formulaire */}
            <Fraicheur sombre partie="alerte" />
            {/* Les favoris d'abord : c'est l'action du quotidien */}
            <ListeFavoris sombre />
            <BusDepuisGare />
            <Fraicheur sombre partie="infos" />
          </div>

          <aside className="info-ponctualite seulement-ordinateur" aria-labelledby="titre-ponctualite">
            <h2 id="titre-ponctualite" className="info-ponctualite__titre">{t("accueil.ponctualite")}</h2>
            <div className="info-ponctualite__corps">
              <p className="info-ponctualite__valeur">{chiffreVedette.valeur}</p>
              <p>{chiffreVedette.texte}</p>
              <p className="info-ponctualite__source">{chiffreVedette.source}</p>
            </div>
            <div className="info-ponctualite__podium">
              <h3>{t("accueil.touchees")}</h3>
              <ol>
                {podium.map((g) => (
                  <li key={g.nom}>
                    <span>{g.nom}</span>
                    <strong>{g.taux.toFixed(1).replace(".", ",")}&nbsp;%</strong>
                  </li>
                ))}
              </ol>
              <Link to="/carte" className="info-ponctualite__lien">{t("accueil.carte")}</Link>
            </div>
          </aside>
        </div>
      </section>

      {/* ---------- 2. Chiffres clés ---------- */}
      <section aria-label="Chiffres clés" className="accueil__chiffres seulement-ordinateur">
        {chiffresCles.map((c) => (
          <CarteChiffre key={c.texte} valeur={c.valeur} texte={c.texte} />
        ))}
      </section>

      {/* ---------- 3. Graphique heure par heure ---------- */}
      <section className="bloc seulement-ordinateur">
        <div className="bloc__entete">
          <h2 className="titre-section">Ce matin, heure par heure</h2>
          <p className="texte-doux">Part des passages avec 5 min de retard ou plus, 9 octobre 2026</p>
        </div>
        <GraphiqueBarres donnees={retardParHeure} />
        <p className="texte-doux bloc__note">
          Le retard monte avec l'heure de pointe, puis redescend. Une seule matinée de données :
          cette tendance doit encore être confirmée sur plusieurs jours.
        </p>
      </section>

      {/* ---------- 4. Découvertes ---------- */}
      <section className="accueil__decouvertes seulement-ordinateur">
        <h2 className="titre-section">Ce que les données révèlent</h2>
        <div className="grille-decouvertes">
          {decouvertes.map((d) => (
            <article key={d.titre} className="decouverte">
              <span className="decouverte__chiffre" style={{ color: d.couleur }}>{d.chiffre}</span>
              <h3>{d.titre}</h3>
              <p className="texte-doux">{d.texte}</p>
              <Link to={d.lien} className="decouverte__lien">{d.lienTexte}</Link>
            </article>
          ))}
        </div>
      </section>

      {/* Sur téléphone, le grand pied de page est remplacé par cette ligne discrète (voir Footer.css) */}
      <p className="accueil__signature">
        {t("accueil.signature")} · <Link to="/sources">{t("accueil.sources")}</Link>
      </p>
    </>
  );
}
