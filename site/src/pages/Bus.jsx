import { useEffect, useId, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { EtoileVille } from "../components/Favoris";
import { useTitrePage } from "../components/titrePage";
import {
  RESEAUX, chargerReseau, chargerGaresCouvertes, gareLaPlusProche, arretLePlusProche, DISTANCE_MAX_GARE,
  lieuxPrepares, arretsCorrespondants, chercherLieu, distance, libelleGare, reseauDeVille, lienCarte, lienAPied, nettoyerLieu,
} from "../data/bus";
import { aujourdhuiIso, heureActuelle, enMinutes } from "../data/horaires";
import { chargerHoraires, trajetEntrePoints, minutesEnHeure, arretsDeLaCourse, passagesALArret, arretsAutour } from "../data/trajetBus";
import { normaliser } from "../data/horaires";
import { joliNom } from "../data/bus";
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
  useTitrePage("En ville", "Bus, tram, métro ou à pied, d'un endroit à un autre, dans six villes des Hauts-de-France.");
  const [code, setCode] = useState(RESEAUX[0].code);
  const [parPosition, setParPosition] = useState(false);
  const [charge, setCharge] = useState({ code: null, reseau: null });   // le réseau téléchargé, et pour quelle ville
  const [depart, setDepart] = useState({ texte: "", lieu: null });
  const [arrivee, setArrivee] = useState({ texte: "", lieu: null });
  const [etat, setEtat] = useState({ type: "formulaire" });
  const [course, setCourse] = useState(null);          // le détail d'une course ouvert, ou null
  const [mode, setMode] = useState("trajet");          // « trajet » (de A à B) ou « passages » (le panneau d'un arrêt)
  // Un favori « En ville » rouvert : ?t={code, A, B} -> les champs remplis, puis la recherche relancée
  const [parametres] = useSearchParams();
  const [aRelancer, setARelancer] = useState(false);
  useEffect(() => {
    let favori = null;
    try { favori = JSON.parse(parametres.get("t") || "null"); } catch { favori = null; }
    if (!favori?.code || !favori.B || !RESEAUX.some((r) => r.code === favori.code)) return;
    setCode(favori.code);
    setArrivee({ texte: favori.B.nom, lieu: favori.B });
    if (favori.A?.cat === "position") maPosition();                    // « Ma position » : là où l'on est maintenant
    else setDepart({ texte: favori.A.nom, lieu: favori.A });
    setARelancer(true);
  }, [parametres]);   // eslint-disable-line react-hooks/exhaustive-deps
  const ville = RESEAUX.find((r) => r.code === code);

  useEffect(() => {
    let annule = false;
    chargerReseau(code).then((r) => { if (!annule) setCharge({ code, reseau: r }); });
    return () => { annule = true; };
  }, [code]);
  const reseau = charge.code === code ? charge.reseau : null;
  useEffect(() => {
    if (aRelancer && reseau && depart.lieu && arrivee.lieu) { setARelancer(false); chercher(); }
  }, [aRelancer, reseau, depart.lieu, arrivee.lieu]);   // eslint-disable-line react-hooks/exhaustive-deps
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
    setCourse(null);
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
      <h1 className="bus__titre">En ville</h1>
      <p className="bus__sous-titre">Bus, tram, métro ou à pied, d'un endroit à un autre.</p>

      <div className="bus__modes" role="tablist" aria-label="Que voulez-vous faire ?">
        <button type="button" role="tab" aria-selected={mode === "trajet"} className={mode === "trajet" ? "bus__mode bus__mode--actif" : "bus__mode"}
                onClick={() => setMode("trajet")}>Un trajet</button>
        <button type="button" role="tab" aria-selected={mode === "passages"} className={mode === "passages" ? "bus__mode bus__mode--actif" : "bus__mode"}
                onClick={() => setMode("passages")}>Prochains passages</button>
      </div>

      {mode === "passages" && (
        <>
          <ChampVille code={code} onChoix={choisirVille} onLocaliser={maPosition} parPosition={parPosition} />
          <PassagesArret reseau={reseau} code={code} position={depart.lieu?.cat === "position" ? depart.lieu : null} onLocaliser={maPosition} />
        </>
      )}

      {mode === "trajet" && (<>
      <form className="bus__formulaire" onSubmit={chercher}>
        <ChampVille code={code} onChoix={choisirVille} onLocaliser={maPosition} parPosition={parPosition} />

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
      </>)}

      {mode === "trajet" && course && <DetailCourse course={course} reseau={reseau} ville={ville} onFermer={() => setCourse(null)} onChoix={setCourse} />}
      {mode === "trajet" && !course && etat.type === "resultat" && <Resultat key={`${etat.A.nom}|${etat.B.nom}|${etat.maintenant}`} etat={etat} reseau={reseau} ville={ville} code={code} onDetail={setCourse} />}
      {mode === "trajet" && etat.type === "autreVille" && (
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

const VISIBLES = 4;          // au-delà, « Voir les autres possibilités »

function nomTransport(ligne) {
  return ligne.mode === "metro" ? "Métro" : ligne.mode === "tram" ? "Tram" : "Bus";
}

// Une possibilité en bus, tram ou métro : chaque minute dit OÙ et QUAND
function CarteLigne({ b, maintenant, rapide, onDetail }) {
  const p = b.passages[0];
  const attente = p ? Math.round(p.depart - maintenant) : null;
  const dans = attente === null ? null : attente <= 0 ? "maintenant" : `dans ${attente} min`;
  return (
    <section className={rapide ? "bus__carte bus__carte--meilleur" : "bus__carte bus__carte--option"}>
      {rapide && <span className="bus__badge">Le plus rapide</span>}
      <div className="bus__ligne"><PuceLigne ligne={b.ligne} />
        <strong>{nomTransport(b.ligne)} {b.ligne.nom} · direction {b.direction}</strong>
        {dans && <span className="bus__dans">{dans}</span>}</div>
      {b.marcheAvant > 0 && <p className="bus__detail">🚶 {b.marcheAvant} min à pied jusqu'à l'arrêt {b.depart.nom}</p>}
      {p ? (
        <>
          <p>Passe à <strong>{b.depart.nom} {dans}, à {minutesEnHeure(p.depart)}</strong></p>
          <p>Arrivée à <strong>{b.arrivee.nom} à {minutesEnHeure(p.arrivee)}</strong>
            {b.marcheApres ? `, puis ${b.marcheApres} min à pied` : ""} · {b.arrets} arrêt{b.arrets > 1 ? "s" : ""}</p>
          {b.passages.length > 1 && (
            <p className="bus__detail">Puis à {b.depart.nom} : {b.passages.slice(1).map((x) => minutesEnHeure(x.depart)).join(" · ")}</p>
          )}
          <button type="button" className="bus__voir-arrets" onClick={() => onDetail({ bus: b, passage: p })}>
            Voir les arrêts <span aria-hidden="true">›</span>
          </button>
        </>
      ) : (
        <p>De l'arrêt {b.depart.nom} à l'arrêt {b.arrivee.nom} · {b.arrets} arrêt{b.arrets > 1 ? "s" : ""}</p>
      )}
    </section>
  );
}

function CartePied({ A, B, minutes, arrivee, rapide }) {
  return (
    <section className={rapide ? "bus__carte bus__carte--meilleur" : "bus__carte bus__carte--option"}>
      {rapide && <span className="bus__badge">Le plus rapide</span>}
      <div className="bus__ligne"><span className="bus__pied" aria-hidden="true">🚶</span><strong>À pied</strong></div>
      <p>Arrivée à <strong>{minutesEnHeure(arrivee)}</strong> · {minutes} min</p>
      <a className="bus__voir-arrets" href={lienAPied(A, B)} target="_blank" rel="noopener noreferrer">
        Itinéraire à pied <span aria-hidden="true">↗</span>
      </a>
    </section>
  );
}

function Resultat({ etat, reseau, ville, code, onDetail }) {
  const { A, B, trajet, maintenant } = etat;
  const [tout, setTout] = useState(false);
  const nomA = A.cat === "position" ? "Ma position" : A.nom;
  // Toutes les possibilités, la marche comprise, de la plus rapide à la plus lente
  const arriveePied = maintenant + trajet.minutesAPied;
  const possibilites = trajet.bus.length ? [
    ...trajet.bus.map((b) => ({ type: "ligne", b, arrivee: b.arriveeFinale ?? maintenant + b.minutesTotal })),
    { type: "pied", arrivee: arriveePied },
  ].sort((x, y) => x.arrivee - y.arrivee) : [];
  const visibles = tout ? possibilites : possibilites.slice(0, VISIBLES);

  return (
    <div className="bus__resultat">
      <section className="bus__entete">
        <p>{nomA} → {B.nom}</p>
        {/* Le favori garde les deux lieux ; « Ma position » reste « là où l'on sera », sans coordonnées */}
        <EtoileVille trajet={{ code, ville: ville.ville, B: { nom: B.nom, lat: B.lat, lon: B.lon, cat: B.cat || null },
          A: A.cat === "position" ? { nom: "Ma position", cat: "position" } : { nom: A.nom, lat: A.lat, lon: A.lon, cat: A.cat || null } }} />
        {possibilites.length > 0 && (
          <p className="bus__entete-grand">{possibilites.length} possibilité{possibilites.length > 1 ? "s" : ""}</p>
        )}
      </section>

      {visibles.map((o, i) => (o.type === "pied"
        ? <CartePied key="pied" A={A} B={B} minutes={trajet.minutesAPied} arrivee={o.arrivee} rapide={i === 0} />
        : <CarteLigne key={`${o.b.ligne.nom}-${o.b.depart.id}-${o.b.direction}`} b={o.b} maintenant={maintenant} rapide={i === 0} onDetail={onDetail} />))}
      {!tout && possibilites.length > VISIBLES && (
        <button type="button" className="bus__plus" onClick={() => setTout(true)}>
          Voir {possibilites.length - VISIBLES} autre{possibilites.length - VISIBLES > 1 ? "s" : ""} possibilité{possibilites.length - VISIBLES > 1 ? "s" : ""} ▾
        </button>
      )}

      {trajet.conseil === "pied" && !trajet.bus.length && (
        <CartePied A={A} B={B} minutes={trajet.minutesAPied} arrivee={arriveePied} rapide />
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

// ---------- Le champ Ville : une liste, avec « Me localiser » tout en haut ----------
function ChampVille({ code, onChoix, onLocaliser, parPosition }) {
  const [ouvert, setOuvert] = useState(false);
  const actuelle = RESEAUX.find((r) => r.code === code);
  return (
    <div className="bus__ville-champ">
      <button type="button" className="boite bus__ville-bouton" aria-haspopup="listbox" aria-expanded={ouvert}
              onClick={() => setOuvert((o) => !o)} onBlur={() => setTimeout(() => setOuvert(false), 150)}>
        <span className="boite__contenu"><span className="bus__ville-etiquette">Ville</span><strong>{actuelle.ville}</strong></span>
        <span aria-hidden="true">{ouvert ? "▴" : "▾"}</span>
      </button>
      {parPosition && <p className="bus__ville-note">📍 Choisie avec votre position</p>}
      {ouvert && (
        <ul className="champ-gare__liste" role="listbox" aria-label="Ville">
          <li role="option" aria-selected={false} className="champ-gare__option" onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setOuvert(false); onLocaliser(); }}>
            <span className="champ-gare__pictogramme" aria-hidden="true">📍</span>
            <span><strong>Me localiser</strong><small>La ville se choisit seule</small></span>
          </li>
          {RESEAUX.map((r) => (
            <li key={r.code} role="option" aria-selected={r.code === code}
                className={r.code === code ? "champ-gare__option champ-gare__option--actif" : "champ-gare__option"}
                onMouseDown={(e) => e.preventDefault()} onClick={() => { setOuvert(false); onChoix(r.code); }}>
              <span className="champ-gare__pictogramme" aria-hidden="true">{r.code === "lille" ? "🚇" : "🚌"}</span>
              <span><strong>{r.ville}</strong><small>{r.nom.replace(/\s*\(.*\)$/, "")}</small></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- Le détail de la course : le plan de la ligne, avec l'heure à chaque arrêt ----------
function DetailCourse({ course, reseau, ville, onFermer, onChoix }) {
  const { bus, passage } = course;
  const [toutVoir, setToutVoir] = useState(false);
  const tous = arretsDeLaCourse(reseau, passage, joliNom);
  // Les arrêts AVANT la montée ne servent pas au voyageur : repliés, pour que son trajet soit tout de suite visible
  const avant = tous.filter((a) => a.role === "avant").length;
  const arrets = toutVoir ? tous : tous.filter((a) => a.role !== "avant");
  return (
    <section className="course" aria-label="Détail de la course">
      <button type="button" className="course__retour" onClick={onFermer}>‹ Retour au trajet</button>
      <div className="course__entete">
        <PuceLigne ligne={bus.ligne} />
        <div><strong>Direction {bus.direction}</strong>
          <small>Départ de {bus.depart.nom} à {minutesEnHeure(passage.depart)} · {reseau?.reseau || ville.nom}</small></div>
      </div>
      {bus.passages.length > 1 && (
        <div className="course__departs" role="group" aria-label="Choisir un départ">
          {bus.passages.map((p) => (
            <button key={p.depart} type="button" aria-pressed={p.depart === passage.depart}
                    className={p.depart === passage.depart ? "course__depart course__depart--actif" : "course__depart"}
                    onClick={() => onChoix({ bus, passage: p })}>{minutesEnHeure(p.depart)}</button>
          ))}
        </div>
      )}
      <ol className="course__arrets" style={{ "--couleur-ligne": bus.ligne.couleur }}>
        {avant > 0 && !toutVoir && (
          <li className="course__replie">
            <button type="button" onClick={() => setToutVoir(true)}>
              ▴ Voir les {avant} arrêt{avant > 1 ? "s" : ""} d'avant (depuis {tous[0].nom})
            </button>
          </li>
        )}
        {arrets.map((a) => (
          <li key={a.id + a.minute} className={`course__arret course__arret--${a.role}`}>
            <span className="course__heure">{minutesEnHeure(a.minute)}</span>
            <span className="course__rond" aria-hidden="true" />
            <span className="course__nom">{a.nom}
              {a.role === "montee" && <span className="course__etiquette course__etiquette--montee">Montée</span>}
              {a.role === "descente" && <span className="course__etiquette course__etiquette--descente">Descente</span>}
            </span>
          </li>
        ))}
      </ol>
      <p className="bus__source">Horaires prévus. En gras : votre trajet.</p>
    </section>
  );
}

// ---------- Les prochains passages à un arrêt : comme le panneau de l'arrêt ----------
function PassagesArret({ reseau, code, position, onLocaliser }) {
  const [texte, setTexte] = useState("");
  const [choisi, setChoisi] = useState(null);           // { nom, ids }
  const [horaires, setHoraires] = useState(null);
  const [maintenant, setMaintenant] = useState(() => enMinutes(heureActuelle()));
  useEffect(() => { let annule = false; chargerHoraires(code).then((h) => { if (!annule) setHoraires(h); }); return () => { annule = true; }; }, [code]);
  useEffect(() => {                                       // le panneau se met à jour toutes les 30 secondes
    const minuterie = setInterval(() => setMaintenant(enMinutes(heureActuelle())), 30_000);
    return () => clearInterval(minuterie);
  }, []);

  // Avec la position : les arrêts autour, et le plus proche choisi d'office
  const autour = useMemo(() => (reseau && position ? arretsAutour(reseau, position.lat, position.lon) : []), [reseau, position]);
  const arret = choisi || autour[0] || null;
  // En tapant : les arrêts du réseau dont le nom contient les mots tapés
  const trouves = useMemo(() => {
    const mots = normaliser(texte).split(" ").filter((m) => m.length > 1);
    if (!reseau || !mots.length) return [];
    const groupes = new Map();
    for (const [id, [nom]] of Object.entries(reseau.arrets)) {
      if (!mots.every((m) => normaliser(nom).includes(m))) continue;
      const joli = joliNom(nom);
      groupes.set(joli, [...(groupes.get(joli) || []), id]);
    }
    return [...groupes.entries()].slice(0, 6).map(([nom, ids]) => ({ nom, ids }));
  }, [reseau, texte]);
  const passages = reseau && horaires && arret ? passagesALArret(reseau, horaires, arret.ids, aujourdhuiIso(), maintenant) : [];
  const metres = arret && autour.find((a) => a.nom === arret.nom)?.metres;

  return (
    <div className="passages">
      <div className="boite champ-gare">
        <div className="boite__contenu">
          <label htmlFor="passages-arret">Un arrêt</label>
          <input id="passages-arret" type="text" autoComplete="off" placeholder="Le nom de l'arrêt…" value={texte}
                 onChange={(e) => { setTexte(e.target.value); setChoisi(null); }} />
        </div>
        {trouves.length > 0 && !choisi && (
          <ul className="champ-gare__liste" role="listbox">
            {trouves.map((a) => (
              <li key={a.nom} role="option" aria-selected={false} className="champ-gare__option" onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { setChoisi(a); setTexte(a.nom); }}>
                <span className="champ-gare__pictogramme" aria-hidden="true">🚏</span><span><strong>{a.nom}</strong></span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {!position && !arret && (
        <button type="button" className="bus__raccourci" onClick={onLocaliser}>📍 Les arrêts près de moi</button>
      )}

      {arret && (
        <section className="panneau-arret" aria-live="polite">
          <p className="panneau-arret__lieu">{metres !== undefined ? `Près de vous · à ${metres} m` : "Arrêt choisi"}</p>
          <h2 className="panneau-arret__nom">{arret.nom}</h2>
          <div className="panneau-arret__tableau">
            <div className="panneau-arret__entete"><span>LIGNE · DIRECTION</span><span>PRÉVU</span></div>
            {passages.length === 0 && <p className="panneau-arret__vide">Aucun passage dans les 3 prochaines heures.</p>}
            {passages.map((g) => {
              const attente = (m) => { const d = Math.round(m - maintenant); return d <= 0 ? "à l'arrêt" : `${d} min`; };
              return (
                <div key={`${g.ligneId}|${g.direction}`} className="panneau-arret__rang">
                  <PuceLigne ligne={g.ligne} />
                  <span className="panneau-arret__direction">{g.direction}</span>
                  <span className="panneau-arret__temps"><strong>{attente(g.heures[0])}</strong>
                    {g.heures[1] !== undefined && <small>puis {attente(g.heures[1])}</small>}</span>
                </div>
              );
            })}
          </div>
          <p className="bus__source">Horaires prévus, mis à jour toutes les 30 secondes. Le direct arrivera bientôt.</p>
        </section>
      )}

      {autour.length > 1 && (
        <section className="passages__autour">
          <p className="bus__ou">Autres arrêts près de vous</p>
          {autour.filter((a) => a.nom !== arret?.nom).slice(0, 4).map((a) => (
            <button key={a.nom} type="button" className="passages__arret" onClick={() => { setChoisi(a); setTexte(""); }}>
              <span><strong>{a.nom}</strong><small>à {a.metres} m</small></span><span aria-hidden="true">›</span>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}
