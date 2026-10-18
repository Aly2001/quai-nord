import CarteChiffre from "../components/CarteChiffre";
import GraphiqueBarres, { formaterTaux } from "../components/GraphiqueBarres";
import { resume, paliers, parPosition, parHeure, methode } from "../data/analyses";
import "./Analyses.css";
import { useTitrePage } from "../components/titrePage";

export default function Analyses() {
  useTitrePage("Analyses des retards", "Ce que les données révèlent sur les retards des TER des Hauts-de-France : paliers de 5 minutes, accumulation au fil du trajet, heures de pointe.");
  const maxPosition = Math.max(...parPosition.map((p) => p.taux));

  return (
    <>
      <div className="analyses__entete">
        <div className="analyses__intro">
          <p className="surtitre">Analyses</p>
          <h1 className="analyses__titre">Ce que les premières données révèlent</h1>
          <p className="texte-doux analyses__chapo">
            Cinq constats tirés de la collecte des 8 et 9 octobre 2026, avec leurs limites.
            Chaque chiffre repose sur des retards réellement constatés, jamais sur des prévisions.
          </p>
        </div>
        <div className="analyses__resume">
          {resume.map((r) => (
            <CarteChiffre key={r.texte} valeur={r.valeur} texte={r.texte} />
          ))}
        </div>
      </div>

      {/* ---------- Constat 1 : on réutilise GraphiqueBarres, avec des nombres ---------- */}
      <Constat
        numero="Constat 1"
        titre="Les retards vont par paliers de 5 minutes"
        texte="Les retards annoncés tombent presque tous sur 5, 10, 15 ou 20 minutes, et très rarement entre les deux : la SNCF arrondit ses annonces."
        consequence="Prédire un nombre exact de minutes n'a pas de sens. Le modèle prédit si le retard atteint 5 minutes, le seuil de ponctualité des TER."
      >
        <GraphiqueBarres donnees={paliers} seuil={Infinity} formater={(n) => String(n)} />
        <p className="legende-graphique">
          Passages par retard annoncé, soirée du 8 octobre. Les 5 118 passages à 0 min sont hors graphique.
        </p>
      </Constat>

      {/* ---------- Constat 2 : barres horizontales ---------- */}
      <Constat
        sombre
        numero="Constat 2, le plus solide"
        titre="Le retard s'accumule au fil du trajet"
        texte="À la première gare, 9,2 % des passages sont en retard. Après la quatorzième, 24,0 %. Le taux augmente à chaque étape, sur des milliers de passages."
        consequence="La position dans le trajet et le retard à la gare précédente seront deux variables clés du modèle."
      >
        <div className="barres-h">
          {parPosition.map((p) => (
            <div key={p.tranche} className="barres-h__ligne">
              <span className="barres-h__nom">{p.tranche}</span>
              <span className="barres-h__piste">
                <span className="barres-h__barre" style={{ width: `${(p.taux / maxPosition) * 100}%` }} />
              </span>
              <span className="barres-h__valeur">{formaterTaux(p.taux)}</span>
            </div>
          ))}
        </div>
        <p className="legende-graphique">
          Part des passages avec 5 min de retard ou plus selon la position de la gare dans le trajet
          (de 1 164 à 6 388 passages par tranche).
        </p>
      </Constat>

      <div className="analyses__duo">
        {/* ---------- Constat 3 : encore GraphiqueBarres ---------- */}
        <Constat
          compact
          numero="Constat 3"
          titre="L'heure de pointe pèse"
          texte="Le taux triple entre 5 h et 8 h. Une seule matinée observée : piste à confirmer sur plusieurs semaines."
        >
          <GraphiqueBarres donnees={parHeure} hauteurMax={140} />
        </Constat>

        {/* ---------- Constat 4 ---------- */}
        <Constat
          compact
          numero="Constat 4"
          titre="Compter les trains ou les passages ?"
          texte="Mesuré à la fin du trajet, chaque train porte tout son retard accumulé. Un même jeu de données donne deux taux différents : il faut toujours dire ce que l'on compte avant de comparer."
        >
          <div className="comparaison">
            <div className="comparaison__case comparaison__case--passage">
              <p className="comparaison__valeur">17,6 %</p>
              <p className="texte-doux">par passage en gare</p>
            </div>
            <div className="comparaison__case comparaison__case--train">
              <p className="comparaison__valeur">22,3 %</p>
              <p className="texte-doux">par train, à sa dernière gare</p>
            </div>
          </div>
        </Constat>
      </div>

      {/* ---------- Constat 5 ---------- */}
      <Constat
        pointille
        numero="Constat 5 : un piège évité"
        titre="Le biais des trains « survivants »"
        texte="Lancée à 21 h le 8 octobre, la collecte affichait 45 % de retard pour les trains prévus à 14 h. En réalité, seuls les trains encore en circulation à 21 h étaient visibles : les longs trajets et ceux très en retard. Les trains de 14 h arrivés à l'heure avaient déjà quitté le flux."
        consequence="Une heure n'est analysée que si la collecte tournait en continu pendant cette période."
      />

      <section className="methode">
        <h2 className="titre-section">Méthode</h2>
        <div className="methode__grille">
          {methode.map((m) => (
            <div key={m.titre} className="methode__case">
              <strong>{m.titre}</strong>
              {m.texte}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

// Un bloc « constat », réutilisé 5 fois.
// children = ce qu'on met ENTRE <Constat> et </Constat> (un graphique, par exemple)
function Constat({ numero, titre, texte, consequence, children, sombre, compact, pointille }) {
  const classes = ["constat"];
  if (sombre) classes.push("constat--sombre");
  if (compact) classes.push("constat--compact");
  if (pointille) classes.push("constat--pointille");

  return (
    <article className={classes.join(" ")}>
      <div className="constat__texte">
        <span className="constat__numero">{numero}</span>
        <h2 className="constat__titre">{titre}</h2>
        <p>{texte}</p>
        {consequence && (
          <p><strong>Conséquence :</strong> {consequence}</p>
        )}
      </div>
      {children && <div className="constat__visuel">{children}</div>}
    </article>
  );
}
