import { useEffect, useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTitrePage } from "../components/titrePage";
import {
  RESEAUX, chargerReseau, chargerGaresCouvertes, gareLaPlusProche, arretLePlusProche, DISTANCE_MAX_GARE,
  lieuxPrepares, arretsCorrespondants, chercherLieu, distance, libelleGare, reseauDeVille, lienCarte, lienAPied, nettoyerLieu,
} from "../data/bus";
import { aujourdhuiIso, heureActuelle, enMinutes } from "../data/horaires";
import { chargerHoraires, trajetEntrePoints, minutesEnHeure } from "../data/trajetBus";
import "../components/RechercheTrajet.css";
import "./Bus.css";

const RACCOURCIS = [
  { emoji: "🚉", texte: "La gare", gare: true },
  { emoji: "🏥", texte: "L'hôpital" },
  { emoji: "🎓", texte: "L'université" },
  { emoji: "🏛️", texte: "Le centre-ville" },
];

// La gare principale d'un réseau (la première de reseaux.json), qui sert aussi de point de repère
function gareDuReseau(code, reseau) {
  const nom = RESEAUX.find((r) => r.code === code)?.gares[0];
  const g = reseau?.gares?.[nom];
  return g ? { nom: `Gare de ${libelleGare(nom)}`, lat: g.lat, lon: g.lon, cat: "gare", gareSncf: nom } : null;
}

// Les propositions pendant la frappe : les lieux préparés et les arrêts du réseau, du plus proche au plus loin
function propositions(reseau, repere, texte) {
  if (!reseau || nettoyerLieu(texte).length < 2) return [];
  const vus = new Set();
  return [...lieuxPrepares(reseau, texte), ...arretsCorrespondants(reseau, texte)]
    .filter((l) => (vus.has(l.nom) ? false : vus.add(l.nom)))
    .map((l) => ({ ...l, distance: repere ? distance(repere.lat, repere.lon, l.lat, l.lon) : 0 }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 6);
}

const EMOJI = { hopital: "🏥", universite: "🎓", mairie: "🏛️", arret: "🚏", lycee: "🏫", college: "🏫", gare: "🚉", position: "📍" };

function ChampLieu({ label, champ, onChange, reseau, repere, position = false, onPosition, placeholder }) {
  const id = useId();
  const [ouvert, setOuvert] = useState(false);
  const liste = useMemo(() => (champ.lieu ? [] : propositions(reseau, repere, champ.texte)), [reseau, repere, champ]);
  const avecPosition = position && !champ.texte.trim();
  const visible = ouvert && (liste.length > 0 || avecPosition);
  return (
    <div className="boite champ-gare">
      <div className="boite__contenu">
        <label htmlFor={id}>{label}</label>
        <input id={id} type="text" autoComplete="off" spellCheck={false} placeholder={placeholder} value={champ.texte}
               role="combobox" aria-expanded={visible} aria-autocomplete="list"
               onChange={(e) => onChange({ texte: e.target.value, lieu: null })}
               onFocus={() => setOuvert(true)} onBlur={() => setTimeout(() => setOuvert(false), 150)} />
        {champ.detail && <p className="champ-gare__message">{champ.detail}</p>}
      </div>
      {champ.texte && (
        <button type="button" className="champ-gare__effacer" aria-label={`Effacer ${label}`}
                onMouseDown={(e) => e.preventDefault()} onClick={() => onChange({ texte: "", lieu: null })}>✕</button>
      )}
      {visible && (
        <ul className="champ-gare__liste" role="listbox">
          {avecPosition && (
            <li role="option" aria-selected={false} className="champ-gare__option" onMouseDown={(e) => e.preventDefault()}
                onClick={() => { setOuvert(false); onPosition(); }}>
              <span className="champ-gare__pictogramme" aria-hidden="true">📍</span>
              <span><strong>Ma position</strong><small>Calculée sur votre téléphone</small></span>
            </li>
          )}
          {liste.map((l) => (
            <li key={l.nom} role="option" aria-selected={false} className="champ-gare__option" onMouseDown={(e) => e.preventDefault()}
                onClick={() => { setOuvert(false); onChange({ texte: l.nom, lieu: l }); }}>
              <span className="champ-gare__pictogramme" aria-hidden="true">{EMOJI[l.cat] || "📌"}</span>
              <span><strong>{l.nom}</strong>{l.detail && <small>{l.detail}</small>}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Bus() {
  useTitrePage("Bus, tram et métro", "Le bus, le tram ou le métro, d'un endroit à un autre, dans six villes des Hauts-de-France.");
  const [code, setCode] = useState(RESEAUX[0].code);
  const [parPosition, setParPosition] = useState(false);
  const [charge, setCharge] = useState({ code: null, reseau: null });   // le réseau téléchargé, et pour quelle ville
  const [depart, setDepart] = useState({ texte: "", lieu: null });
  const [arrivee, setArrivee] = useState({ texte: "", lieu: null });
  const [etat, setEtat] = useState({ type: "formulaire" });
  const ville = RESEAUX.find((r) => r.code === code);

  useEffect(() => {
    let annule = false;
    chargerReseau(code).then((r) => { if (!annule) setCharge({ code, reseau: r }); });
    return () => { annule = true; };
  }, [code]);
  const reseau = charge.code === code ? charge.reseau : null;
  const repere = useMemo(() => gareDuReseau(code, reseau), [code, reseau]);

  function choisirVille(nouveau) {
    if (nouveau === code) return;
    setCode(nouveau);
    setParPosition(false);
    setDepart({ texte: "", lieu: null });
    setArrivee({ texte: "", lieu: null });
    setEtat({ type: "formulaire" });
  }

  // « Ma position » : la ville se choisit toute seule (la gare couverte la plus proche). Rien n'est envoyé.
  function maPosition() {
    if (!navigator.geolocation) { setDepart({ texte: "", lieu: null, detail: "Votre appareil ne donne pas sa position." }); return; }
    setDepart({ texte: "Ma position", lieu: null, detail: "Je cherche où vous êtes…" });
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      const gare = gareLaPlusProche(await chargerGaresCouvertes(), coords.latitude, coords.longitude);
      if (!gare || gare.metres > DISTANCE_MAX_GARE) {
        setDepart({ texte: "", lieu: null, detail: "Vous êtes loin des six villes couvertes : tapez votre point de départ." });
        return;
      }
      setCode(gare.reseau);
      setParPosition(true);
      const r = await chargerReseau(gare.reseau);
      const arret = r ? arretLePlusProche(r, coords.latitude, coords.longitude) : null;
      setDepart({ texte: "Ma position", lieu: { nom: "votre position", lat: coords.latitude, lon: coords.longitude, cat: "position" },
                  detail: arret ? `Près de l'arrêt ${arret}` : "" });
    }, () => setDepart({ texte: "", lieu: null, detail: "Position refusée : tapez votre point de départ." }),
    { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 });
  }

  function inverser() {
    setDepart(arrivee);
    setArrivee({ ...depart, detail: "" });
  }

  async function retrouver(champ) {
    if (champ.lieu) return { lieu: champ.lieu };
    const texte = champ.texte.trim();
    if (!texte) return { erreur: "vide" };
    // Une autre ville couverte : c'est un train, pas un bus
    const autre = reseauDeVille(nettoyerLieu(texte) || texte);
    if (autre && autre !== code) return { autreVille: autre, texte };
    if (/^(la )?gare( sncf)?$/i.test(texte) && repere) return { lieu: repere };
    const lieux = await chercherLieu(texte, repere, ville.ville, reseau);
    return lieux[0] ? { lieu: lieux[0] } : { erreur: "introuvable", texte };
  }

  async function chercher(e) {
    e?.preventDefault();
    if (!reseau) return;
    setEtat({ type: "calcul" });
    const [a, b] = await Promise.all([retrouver(depart), retrouver(arrivee)]);
    if (a.erreur === "vide" || b.erreur === "vide") { setEtat({ type: "formulaire", message: "Indiquez d'où vous partez et où vous allez." }); return; }
    for (const r of [a, b]) {
      if (r.erreur === "introuvable") { setEtat({ type: "formulaire", message: `Je ne trouve pas « ${r.texte} » à ${ville.ville}. Essayez une adresse, un arrêt ou un lieu.` }); return; }
    }
    if (b.autreVille || a.autreVille) {
      const autre = RESEAUX.find((r) => r.code === (b.autreVille || a.autreVille));
      const de = b.autreVille ? ville : autre;
      const vers = b.autreVille ? autre : ville;
      setEtat({ type: "autreVille", de, vers });
      return;
    }
    const horaires = await chargerHoraires(code);
    const maintenant = enMinutes(heureActuelle());
    const trajet = trajetEntrePoints(reseau, horaires, a.lieu, b.lieu, aujourdhuiIso(), maintenant);
    setEtat({ type: "resultat", A: a.lieu, B: b.lieu, trajet, maintenant, horaires: Boolean(horaires) });
  }

  function raccourci(r) {
    if (r.gare && repere) setArrivee({ texte: repere.nom, lieu: repere });
    else setArrivee({ texte: r.texte, lieu: null });
  }

  return (
    <div className="bus">
      <h1 className="bus__titre">Bus, tram et métro</h1>

      <form className="bus__formulaire" onSubmit={chercher}>
        <fieldset className="bus__villes">
          <legend>Ville</legend>
          <div className="bus__villes-liste">
            {RESEAUX.map((r) => (
              <button key={r.code} type="button" aria-pressed={r.code === code}
                      className={r.code === code ? "bus__ville bus__ville--active" : "bus__ville"} onClick={() => choisirVille(r.code)}>
                {r.ville.replace(/-sur-Mer$/, "")}
              </button>
            ))}
          </div>
          {parPosition && <p className="bus__ville-note">📍 Choisie avec votre position</p>}
        </fieldset>

        <div className="bus__champs">
          <ChampLieu label="D'où partez-vous ?" champ={depart} onChange={setDepart} reseau={reseau} repere={repere}
                     position onPosition={maPosition} placeholder="Ma position, un lieu, une adresse…" />
          <ChampLieu label="Où allez-vous ?" champ={arrivee} onChange={setArrivee} reseau={reseau} repere={repere}
                     placeholder="Un lieu, une adresse, un arrêt…" />
          <button type="button" className="recherche__inverser" onClick={inverser} aria-label="Inverser le départ et l'arrivée">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"
                 strokeLinecap="round" strokeLinejoin="round"><path d="M7 4v16M3 8l4-4 4 4M17 20V4M21 16l-4 4-4-4" /></svg>
          </button>
        </div>

        <div className="bus__raccourcis">
          {RACCOURCIS.map((r) => (
            <button key={r.texte} type="button" className="bus__raccourci" onClick={() => raccourci(r)}>
              <span aria-hidden="true">{r.emoji}</span> {r.texte}
            </button>
          ))}
        </div>

        {etat.message && <p className="bus__message" role="alert">{etat.message}</p>}
        <button type="submit" className="recherche__bouton" disabled={!reseau || etat.type === "calcul"}>
          {etat.type === "calcul" ? "Je cherche…" : "Chercher le trajet"}
        </button>
        <p className="bus__note">Votre position reste sur votre téléphone.</p>
      </form>

      {etat.type === "resultat" && <Resultat etat={etat} reseau={reseau} ville={ville} />}
      {etat.type === "autreVille" && (
        <section className="bus__carte">
          <p className="bus__carte-titre">{etat.vers.ville} est dans une autre ville : prenez le train</p>
          <Link className="bus__bouton bus__bouton--jaune"
                to={`/trajet?${new URLSearchParams({ de: etat.de.gares[0], a: etat.vers.gares[0], jour: aujourdhuiIso(), heure: heureActuelle() })}`}>
            Voir les trains {etat.de.ville.replace(/-sur-Mer$/, "")} → {etat.vers.ville.replace(/-sur-Mer$/, "")}
          </Link>
        </section>
      )}
    </div>
  );
}

function PuceLigne({ ligne }) {
  return <span className="bus__puce" style={{ background: ligne.couleur, color: ligne.texte }}>{ligne.nom}</span>;
}

function Resultat({ etat, reseau, ville }) {
  const { A, B, trajet, maintenant } = etat;
  const nomA = A.cat === "position" ? "Ma position" : A.nom;
  // Le bus en vedette seulement s'il fait gagner du temps ; sinon la marche passe devant
  const [meilleur, ...autres] = trajet.conseil === "bus" ? trajet.bus : [];
  const dans = (m) => { const d = Math.round(m - maintenant); return d <= 0 ? "maintenant" : `dans ${d} min`; };
  return (
    <div className="bus__resultat">
      <section className="bus__entete">
        <p>{nomA} → {B.nom}</p>
        {meilleur?.arriveeFinale && (
          <p className="bus__entete-grand">Arrivée vers {minutesEnHeure(meilleur.arriveeFinale)} · {Math.round(meilleur.arriveeFinale - maintenant)} min</p>
        )}
      </section>

      {meilleur && (
        <section className="bus__carte bus__carte--meilleur">
          <div className="bus__ligne"><PuceLigne ligne={meilleur.ligne} /><strong>Direction {meilleur.direction}</strong>
            {meilleur.passages[0] && <span className="bus__dans">{dans(meilleur.passages[0].depart)}</span>}</div>
          <ol className="bus__etapes">
            <li>🚶 <span><strong>Marchez {meilleur.marcheAvant} min</strong> jusqu'à l'arrêt {meilleur.depart.nom}</span></li>
            <li>🚌 <span><strong>{meilleur.ligne.mode === "metro" ? "Métro" : meilleur.ligne.mode === "tram" ? "Tram" : "Bus"} {meilleur.ligne.nom}
              {meilleur.passages[0] ? ` à ${minutesEnHeure(meilleur.passages[0].depart)}` : ""}</strong> · {meilleur.arrets} arrêt{meilleur.arrets > 1 ? "s" : ""}</span></li>
            <li>📍 <span><strong>Descendez à {meilleur.arrivee.nom}{meilleur.passages[0] ? ` à ${minutesEnHeure(meilleur.passages[0].arrivee)}` : ""}</strong>
              {meilleur.marcheApres ? `, puis ${meilleur.marcheApres} min à pied` : ""}</span></li>
          </ol>
          {meilleur.passages.length > 1 && (
            <p className="bus__suivants"><strong>Les suivants :</strong> {meilleur.passages.slice(1).map((p) => minutesEnHeure(p.depart)).join(" · ")}</p>
          )}
          <div className="bus__boutons">
            <a className="bus__bouton" href={lienCarte(A, B)} target="_blank" rel="noopener noreferrer">Voir sur la carte ↗</a>
            <a className="bus__bouton" href={lienAPied(A, B)} target="_blank" rel="noopener noreferrer">À pied : {trajet.minutesAPied} min</a>
          </div>
        </section>
      )}

      {autres.map((b) => (
        <section key={`${b.ligne.nom}-${b.depart.id}`} className="bus__carte bus__carte--autre">
          <PuceLigne ligne={b.ligne} /><span>Direction {b.direction}{b.arriveeFinale ? ` · arrivée ${minutesEnHeure(b.arriveeFinale)}` : ""}</span>
          {b.passages[0] && <span className="bus__heure">{minutesEnHeure(b.passages[0].depart)}</span>}
        </section>
      ))}

      {trajet.conseil === "pied" && (
        <section className="bus__carte">
          <p className="bus__carte-titre">🚶 Le plus rapide : à pied, {trajet.minutesAPied} min</p>
          {trajet.bus[0]?.passages[0] ? (
            <p>Le prochain bus direct, le <strong>{trajet.bus[0].ligne.nom}</strong>, part à {minutesEnHeure(trajet.bus[0].passages[0].depart)} de
              l'arrêt {trajet.bus[0].depart.nom} : vous arriveriez vers {minutesEnHeure(trajet.bus[0].arriveeFinale)}.</p>
          ) : <p>Aucun bus n'est plus rapide pour ce trajet.</p>}
          <a className="bus__bouton bus__bouton--plein" href={lienAPied(A, B)} target="_blank" rel="noopener noreferrer">Itinéraire à pied ↗</a>
        </section>
      )}
      {trajet.conseil === "demain" && (
        <section className="bus__carte">
          <p className="bus__carte-titre">Plus de bus direct aujourd'hui</p>
          <p>Le premier demain : le <strong>{trajet.lendemain.ligne.nom}</strong> à {minutesEnHeure(trajet.lendemain.passages[0].depart)},
            de l'arrêt {trajet.lendemain.depart.nom}. À pied : {trajet.minutesAPied} min.</p>
          <a className="bus__bouton" href={lienCarte(A, B)} target="_blank" rel="noopener noreferrer">Voir les transports sur la carte ↗</a>
        </section>
      )}
      {trajet.conseil === "aucun" && (
        <section className="bus__carte">
          <p className="bus__carte-titre">Pas de bus direct entre ces deux endroits</p>
          <p>À pied : {trajet.minutesAPied} min. Un trajet avec un changement est peut-être possible :</p>
          <a className="bus__bouton" href={lienCarte(A, B)} target="_blank" rel="noopener noreferrer">Voir les transports sur la carte ↗</a>
        </section>
      )}

      <p className="bus__source">Horaires prévus par {reseau?.reseau || ville.nom}{etat.horaires ? "" : " (indisponibles pour l'instant)"}. Le direct arrivera bientôt.</p>
    </div>
  );
}
