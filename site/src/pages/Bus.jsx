import { useEffect, useId, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { EtoileVille } from "../components/Favoris";
import { useLangue } from "../langue/langue";
import { useTitrePage } from "../components/titrePage";
import {
  RESEAUX, chargerReseau, chargerGaresCouvertes, gareLaPlusProche, arretLePlusProche, DISTANCE_MAX_GARE,
  lieuxPrepares, arretsCorrespondants, chercherLieu, distance, libelleGare, reseauDeVille, lienCarte, lienAPied, nettoyerLieu,
} from "../data/bus";
import { aujourdhuiIso, heureActuelle, enMinutes } from "../data/horaires";
import { chargerHoraires, trajetEntrePoints, minutesEnHeure, arretsDeLaCourse, passagesALArret, arretsAutour,
  chargerDirectBus, busAvecDirect, relierAuDirect, autresDescentes } from "../data/trajetBus";
import { normaliser } from "../data/horaires";
import { joliNom } from "../data/bus";
import "../components/RechercheTrajet.css";
import "./Bus.css";

const RACCOURCIS = [
  { emoji: "🚉", texte: "La gare", cle: "ville.gare", gare: true },
  { emoji: "🏥", texte: "L'hôpital", cle: "ville.hopital" },
  { emoji: "🎓", texte: "L'université", cle: "ville.universite" },
  { emoji: "🏛️", texte: "Le centre-ville", cle: "ville.centre" },
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
  const { t } = useLangue();
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
              <span><strong>{t("ville.maposition")}</strong><small>{t("ville.maposition.detail")}</small></span>
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
  const { t } = useLangue();
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
    if (a.erreur === "vide" || b.erreur === "vide") { setEtat({ type: "formulaire", message: t("ville.vide") }); return; }
    for (const r of [a, b]) {
      if (r.erreur === "introuvable") { setEtat({ type: "formulaire", message: t("ville.introuvable", { texte: r.texte, ville: ville.ville }) }); return; }
    }
    if (b.autreVille || a.autreVille) {
      const autre = RESEAUX.find((r) => r.code === (b.autreVille || a.autreVille));
      const de = b.autreVille ? ville : autre;
      const vers = b.autreVille ? autre : ville;
      setEtat({ type: "autreVille", de, vers });
      return;
    }
    const [horaires, direct] = await Promise.all([chargerHoraires(code), chargerDirectBus(code)]);
    const maintenant = enMinutes(heureActuelle());
    const brut = trajetEntrePoints(reseau, horaires, a.lieu, b.lieu, aujourdhuiIso(), maintenant);
    // Le direct (Lille) : les heures attendues remplacent les heures prévues, quand on sait les relier
    const trajet = direct ? { ...brut, bus: brut.bus.map((x) => busAvecDirect(x, direct, aujourdhuiIso())) } : brut;
    setEtat({ type: "resultat", A: a.lieu, B: b.lieu, trajet, maintenant, horaires: Boolean(horaires), direct: Boolean(direct) });
  }

  function raccourci(r) {
    if (r.gare && repere) setArrivee({ texte: repere.nom, lieu: repere });
    else setArrivee({ texte: r.texte, lieu: null });
  }

  return (
    <div className="bus">
      <h1 className="bus__titre">{t("ville.titre")}</h1>
      <p className="bus__sous-titre">{t("ville.sous")}</p>

      <div className="bus__modes" role="tablist" aria-label="Que voulez-vous faire ?">
        <button type="button" role="tab" aria-selected={mode === "trajet"} className={mode === "trajet" ? "bus__mode bus__mode--actif" : "bus__mode"}
                onClick={() => setMode("trajet")}>{t("ville.trajet")}</button>
        <button type="button" role="tab" aria-selected={mode === "passages"} className={mode === "passages" ? "bus__mode bus__mode--actif" : "bus__mode"}
                onClick={() => setMode("passages")}>{t("ville.passages")}</button>
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
          <ChampLieu label={t("ville.depart")} champ={depart} onChange={setDepart} reseau={reseau} repere={repere}
                     position onPosition={maPosition} placeholder={t("ville.depart.exemple")} />
          <ChampLieu label={t("ville.arrivee")} champ={arrivee} onChange={setArrivee} reseau={reseau} repere={repere}
                     placeholder={t("ville.arrivee.exemple")} />
          <button type="button" className="recherche__inverser" onClick={inverser} aria-label={t("recherche.inverser")}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"
                 strokeLinecap="round" strokeLinejoin="round"><path d="M7 4v16M3 8l4-4 4 4M17 20V4M21 16l-4 4-4-4" /></svg>
          </button>
        </div>

        <div className="bus__raccourcis">
          {RACCOURCIS.map((r) => (
            <button key={r.texte} type="button" className="bus__raccourci" onClick={() => raccourci(r)}>
              <span aria-hidden="true">{r.emoji}</span> {t(r.cle)}
            </button>
          ))}
        </div>

        {etat.message && <p className="bus__message" role="alert">{etat.message}</p>}
        <button type="submit" className="recherche__bouton" disabled={!reseau || etat.type === "calcul"}>
          {etat.type === "calcul" ? t("ville.cherche") : t("ville.chercher")}
        </button>
        <p className="bus__note">{t("ville.note")}</p>
      </form>
      </>)}

      {mode === "trajet" && course && <DetailCourse course={course} reseau={reseau} ville={ville} onFermer={() => setCourse(null)} onChoix={setCourse} />}
      {mode === "trajet" && !course && etat.type === "resultat" && <Resultat key={`${etat.A.nom}|${etat.B.nom}|${etat.maintenant}`} etat={etat} reseau={reseau} ville={ville} code={code} onDetail={setCourse} />}
      {mode === "trajet" && etat.type === "autreVille" && (
        <section className="bus__carte">
          <p className="bus__carte-titre">{t("ville.autre.ville", { ville: etat.vers.ville })}</p>
          <Link className="bus__bouton bus__bouton--jaune"
                to={`/trajet?${new URLSearchParams({ de: etat.de.gares[0], a: etat.vers.gares[0], jour: aujourdhuiIso(), heure: heureActuelle() })}`}>
            {t("ville.voir.trains", { de: etat.de.ville.replace(/-sur-Mer$/, ""), a: etat.vers.ville.replace(/-sur-Mer$/, "") })}
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

function nomTransport(ligne, t) {
  return t(ligne.mode === "metro" ? "ville.mode.metro" : ligne.mode === "tram" ? "ville.mode.tram" : "ville.mode.bus");
}

// Une possibilité en bus, tram ou métro : chaque minute dit OÙ et QUAND
function CarteLigne({ b, maintenant, rapide, onDetail, reseau, descentes }) {
  const { t } = useLangue();
  const p = b.passages[0];
  const attente = p ? Math.round(p.depart - maintenant) : null;
  const dans = attente === null ? null : attente <= 0 ? t("ville.maintenant") : t("ville.dans", { minutes: attente });
  return (
    <section className={rapide ? "bus__carte bus__carte--meilleur" : "bus__carte bus__carte--option"}>
      {rapide && <span className="bus__badge">{t("ville.rapide")}</span>}
      <div className="bus__ligne"><PuceLigne ligne={b.ligne} />
        <strong>{nomTransport(b.ligne, t)} {b.ligne.nom} · {t("ville.direction", { direction: b.direction })}</strong>
        {dans && <span className={p?.direct ? "bus__dans bus__dans--direct" : "bus__dans"}>{p?.direct && <SignalDirect />}{dans}</span>}</div>
      {b.marcheAvant > 0 && <p className="bus__detail">{t("ville.marche", { minutes: b.marcheAvant, arret: b.depart.nom })}</p>}
      {p ? (
        <>
          <p><strong>{t("ville.passe", { arret: b.depart.nom, dans, heure: minutesEnHeure(p.depart) })}</strong>
            {p.direct && p.prevue !== p.depart && <span className="bus__prevu"> {t("ville.prevu", { heure: minutesEnHeure(p.prevue) })}</span>}</p>
          <p><strong>{t("ville.arrive", { arret: b.arrivee.nom, heure: minutesEnHeure(p.arrivee) })}</strong>
            {b.marcheApres ? t("ville.puis.pied", { minutes: b.marcheApres }) : ""} · {t("ville.arrets", { nombre: b.arrets })}</p>
          {autresDescentes(reseau, b, descentes).map((o) => (
            <p key={o.id} className="bus__detail">{t("ville.ou.descendre", { arret: o.nom, heure: minutesEnHeure(o.minute) })}
              {o.marche ? t("ville.puis.pied", { minutes: o.marche }) : ""}</p>
          ))}
          {b.passages.length > 1 && (
            <p className="bus__detail">{t("ville.suivants", { arret: b.depart.nom, heures: b.passages.slice(1).map((x) => minutesEnHeure(x.depart)).join(" · ") })}</p>
          )}
          <button type="button" className="bus__voir-arrets" onClick={() => onDetail({ bus: b, passage: p })}>
            {t("ville.voir.arrets")} <span aria-hidden="true">›</span>
          </button>
        </>
      ) : (
        <p>De l'arrêt {b.depart.nom} à l'arrêt {b.arrivee.nom} · {b.arrets} arrêt{b.arrets > 1 ? "s" : ""}</p>
      )}
    </section>
  );
}

function CartePied({ A, B, minutes, arrivee, rapide }) {
  const { t } = useLangue();
  return (
    <section className={rapide ? "bus__carte bus__carte--meilleur" : "bus__carte bus__carte--option"}>
      {rapide && <span className="bus__badge">{t("ville.rapide")}</span>}
      <div className="bus__ligne"><span className="bus__pied" aria-hidden="true">🚶</span><strong>{t("ville.pied")}</strong></div>
      <p>{t("ville.pied.arrivee", { heure: minutesEnHeure(arrivee), minutes })}</p>
      <a className="bus__voir-arrets" href={lienAPied(A, B)} target="_blank" rel="noopener noreferrer">
        {t("ville.pied.itineraire")} <span aria-hidden="true">↗</span>
      </a>
    </section>
  );
}

function Resultat({ etat, reseau, ville, code, onDetail }) {
  const { t } = useLangue();
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
          <p className="bus__entete-grand">{t("ville.possibilites", { nombre: possibilites.length })}</p>
        )}
      </section>

      {visibles.map((o, i) => (o.type === "pied"
        ? <CartePied key="pied" A={A} B={B} minutes={trajet.minutesAPied} arrivee={o.arrivee} rapide={i === 0} />
        : <CarteLigne key={`${o.b.ligne.nom}-${o.b.depart.id}-${o.b.direction}`} b={o.b} maintenant={maintenant} rapide={i === 0}
                      onDetail={onDetail} reseau={reseau} descentes={trajet.descentes} />))}
      {!tout && possibilites.length > VISIBLES && (
        <button type="button" className="bus__plus" onClick={() => setTout(true)}>
          {t("ville.autres", { nombre: possibilites.length - VISIBLES })}
        </button>
      )}

      {trajet.conseil === "pied" && !trajet.bus.length && (
        <CartePied A={A} B={B} minutes={trajet.minutesAPied} arrivee={arriveePied} rapide />
      )}
      {trajet.conseil === "demain" && (
        <section className="bus__carte">
          <p className="bus__carte-titre">{t("ville.demain.titre")}</p>
          <p>Le premier demain : le <strong>{trajet.lendemain.ligne.nom}</strong> à {minutesEnHeure(trajet.lendemain.passages[0].depart)},
            de l'arrêt {trajet.lendemain.depart.nom}. À pied : {trajet.minutesAPied} min.</p>
          <a className="bus__bouton" href={lienCarte(A, B)} target="_blank" rel="noopener noreferrer">{t("ville.carte")}</a>
        </section>
      )}
      {trajet.conseil === "aucun" && (
        <section className="bus__carte">
          <p className="bus__carte-titre">{t("ville.aucun.titre")}</p>
          <p>À pied : {trajet.minutesAPied} min. Un trajet avec un changement est peut-être possible :</p>
          <a className="bus__bouton" href={lienCarte(A, B)} target="_blank" rel="noopener noreferrer">{t("ville.carte")}</a>
        </section>
      )}

      <p className="bus__source">
        {etat.direct ? <><SignalDirect /> {t("ville.source.direct", { reseau: reseau?.reseau || ville.nom })}</>
          : t("ville.source.prevu", { reseau: reseau?.reseau || ville.nom })}
      </p>
    </div>
  );
}

// ---------- Le champ Ville : une liste, avec « Me localiser » tout en haut ----------
function ChampVille({ code, onChoix, onLocaliser, parPosition }) {
  const { t } = useLangue();
  const [ouvert, setOuvert] = useState(false);
  const actuelle = RESEAUX.find((r) => r.code === code);
  return (
    <div className="bus__ville-champ">
      <button type="button" className="boite bus__ville-bouton" aria-haspopup="listbox" aria-expanded={ouvert}
              onClick={() => setOuvert((o) => !o)} onBlur={() => setTimeout(() => setOuvert(false), 150)}>
        <span className="boite__contenu"><span className="bus__ville-etiquette">{t("ville.ville")}</span><strong>{actuelle.ville}</strong></span>
        <span aria-hidden="true">{ouvert ? "▴" : "▾"}</span>
      </button>
      {parPosition && <p className="bus__ville-note">{t("ville.position.choisie")}</p>}
      {ouvert && (
        <ul className="champ-gare__liste" role="listbox" aria-label={t("ville.ville")}>
          <li role="option" aria-selected={false} className="champ-gare__option" onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setOuvert(false); onLocaliser(); }}>
            <span className="champ-gare__pictogramme" aria-hidden="true">📍</span>
            <span><strong>{t("ville.localiser")}</strong><small>{t("ville.localiser.detail")}</small></span>
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
  const { t } = useLangue();
  const { bus, passage } = course;
  const [toutVoir, setToutVoir] = useState(false);
  const tous = arretsDeLaCourse(reseau, passage, joliNom);
  // Les arrêts AVANT la montée ne servent pas au voyageur : repliés, pour que son trajet soit tout de suite visible
  const avant = tous.filter((a) => a.role === "avant").length;
  const arrets = toutVoir ? tous : tous.filter((a) => a.role !== "avant");
  return (
    <section className="course" aria-label="Détail de la course">
      <button type="button" className="course__retour" onClick={onFermer}>{t("ville.retour")}</button>
      <div className="course__entete">
        <PuceLigne ligne={bus.ligne} />
        <div><strong>{t("ville.direction", { direction: bus.direction })}</strong>
          <small>{t("ville.depart.de", { arret: bus.depart.nom, heure: minutesEnHeure(passage.depart) })} · {reseau?.reseau || ville.nom}</small></div>
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
              {t("ville.avant", { nombre: avant, arret: tous[0].nom })}
            </button>
          </li>
        )}
        {arrets.map((a) => (
          <li key={a.id + a.minute} className={`course__arret course__arret--${a.role}`}>
            <span className="course__heure">{minutesEnHeure(a.minute)}</span>
            <span className="course__rond" aria-hidden="true" />
            <span className="course__nom">{a.nom}
              {a.role === "montee" && <span className="course__etiquette course__etiquette--montee">{t("ville.montee")}</span>}
              {a.role === "descente" && <span className="course__etiquette course__etiquette--descente">{t("ville.descente")}</span>}
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
  const [direct, setDirect] = useState(null);
  const [maintenant, setMaintenant] = useState(() => enMinutes(heureActuelle()));
  useEffect(() => { let annule = false; chargerHoraires(code).then((h) => { if (!annule) setHoraires(h); }); return () => { annule = true; }; }, [code]);
  useEffect(() => {                                       // le panneau se met à jour toutes les 30 secondes
    const relire = () => chargerDirectBus(code).then(setDirect);
    relire();
    const minuterie = setInterval(() => { setMaintenant(enMinutes(heureActuelle())); relire(); }, 30_000);
    return () => clearInterval(minuterie);
  }, [code]);

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
  const prevus = reseau && horaires && arret ? passagesALArret(reseau, horaires, arret.ids, aujourdhuiIso(), maintenant - 3, 3) : [];
  // Avec le direct : chaque heure prévue prend son heure attendue, quand on sait la relier
  const passages = prevus.map((g) => {
    if (!direct) return { ...g, enDirect: false, heures: g.heures.filter((h) => h >= maintenant).slice(0, 2) };
    const attendues = arret.ids.flatMap((id) => direct.passages[`${g.ligneId}|${id}`] || []).sort((x, y) => x - y);
    const liens = relierAuDirect(g.heures, attendues, aujourdhuiIso());
    const heures = liens.map((l) => l.attendue ?? l.prevue).filter((h) => h >= maintenant).sort((x, y) => x - y).slice(0, 2);
    return { ...g, enDirect: liens.some((l) => l.attendue !== null), heures };
  }).filter((g) => g.heures.length).sort((x, y) => x.heures[0] - y.heures[0]);
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
            <div className="panneau-arret__entete"><span>LIGNE · DIRECTION</span><span>{direct ? <><SignalDirect /> EN DIRECT</> : "PRÉVU"}</span></div>
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
          <p className="bus__source">{direct ? "En direct quand le réseau le publie, sinon les horaires prévus." : "Horaires prévus."} Mis à jour toutes les 30 secondes.</p>
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

function SignalDirect() {
  return (
    <svg className="signal-direct" viewBox="0 0 24 24" width="14" height="14" aria-label="en direct" role="img" fill="none"
         stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M5 12a7 7 0 0 1 14 0M8.5 12a3.5 3.5 0 0 1 7 0" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" /></svg>
  );
}
