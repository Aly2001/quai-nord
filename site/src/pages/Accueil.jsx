import { Link, useNavigate } from "react-router-dom";
import RechercheTrajet from "../components/RechercheTrajet";
import Fraicheur from "../components/Fraicheur";
import DecorVoies from "../components/DecorVoies";
import { ListeFavoris } from "../components/Favoris";
import BusDepuisGare from "../components/BusDepuisGare";
import CarteChiffre from "../components/CarteChiffre";
import GraphiqueBarres from "../components/GraphiqueBarres";
import { chiffreVedette, chiffresCles, retardParHeure, decouvertes } from "../data/chiffres";
import { gares } from "../data/gares";
import "./Accueil.css";
import { useTitrePage } from "../components/titrePage";

export default function Accueil() {
  useTitrePage(null, "Votre TER des Hauts-de-France sera-t-il à l'heure ? Recherchez un trajet et voyez son risque de retard, calculé à partir des données ouvertes de la SNCF.");
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
            <h1 className="bandeau__titre">Votre TER sera-t-il à l'heure&nbsp;?</h1>
            <RechercheTrajet onRechercher={rechercher} />
            {/* Si les données sont anciennes, l'alerte reste juste sous le formulaire */}
            <Fraicheur sombre partie="alerte" />
            {/* Les favoris d'abord : c'est l'action du quotidien */}
            <ListeFavoris sombre />
            <BusDepuisGare />
            <Fraicheur sombre partie="infos" />
          </div>

          <aside className="info-ponctualite seulement-ordinateur" aria-labelledby="titre-ponctualite">
            <h2 id="titre-ponctualite" className="info-ponctualite__titre">Ponctualité mesurée</h2>
            <div className="info-ponctualite__corps">
              <p className="info-ponctualite__valeur">{chiffreVedette.valeur}</p>
              <p>{chiffreVedette.texte}</p>
              <p className="info-ponctualite__source">{chiffreVedette.source}</p>
            </div>
            <div className="info-ponctualite__podium">
              <h3>Gares les plus touchées</h3>
              <ol>
                {podium.map((g) => (
                  <li key={g.nom}>
                    <span>{g.nom}</span>
                    <strong>{g.taux.toFixed(1).replace(".", ",")}&nbsp;%</strong>
                  </li>
                ))}
              </ol>
              <Link to="/carte" className="info-ponctualite__lien">Voir la carte des gares</Link>
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
        Projet d'Aly Keita, sans lien avec la SNCF · <Link to="/sources">Sources des données</Link>
      </p>
    </>
  );
}
