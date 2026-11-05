import { useEffect, useId, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { EtoileVille, lienVille } from "../components/Favoris";
import { BoutonPartager } from "../components/Bandeaux";
import { LienMarche, lienMarche } from "../components/Marche";
import { useLangue, enDuree } from "../langue/langue";
import { useTitrePage } from "../components/titrePage";
import {
  RESEAUX, chargerReseau, chargerGaresCouvertes, gareLaPlusProche, arretLePlusProche, DISTANCE_MAX_GARE,
  lieuxPrepares, arretsCorrespondants, chercherLieu, distance, libelleGare, reseauDeVille, lienCarte, nettoyerLieu,
} from "../data/bus";
import { aujourdhuiIso, heureActuelle, enMinutes, dateLongue } from "../data/horaires";
import { chargerHoraires, trajetEntrePoints, minutesEnHeure, arretsDeLaCourse, terminusDeLaCourse, arretsDuPassage, passagesALArret, arretsAutour, journeeALArret,
  chargerDirectBus, busAvecDirect, relierAuDirect, autresDescentes } from "../data/trajetBus";
import { normaliser } from "../data/horaires";
import { joliNom } from "../data/bus";
import { useBusFavoris, idBus, rappelsValides, rappelDuBus, MAX_RAPPELS } from "../data/busFavoris";
import { etatNotifications, activerNotifications } from "../data/notifications";
import { trainsSuivisPourLeServeur } from "../data/suivi";
import { FeuillePleine } from "../components/FeuillePleine";
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
  const [aOuvrir, setAOuvrir] = useState(null);          // un bus favori touché dans « Un trajet » : ouvert dans « Prochains passages »
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
          <PassagesArret key={aOuvrir?.n || "passages"} aOuvrir={aOuvrir?.favori} reseau={reseau} code={code}
                         position={depart.lieu?.cat === "position" ? depart.lieu : null} onLocaliser={maPosition} onVille={choisirVille} />
        </>
      )}

      {mode === "trajet" && (<>
      <form className="bus__formulaire" onSubmit={chercher}>
        <ChampVille code={code} onChoix={choisirVille} onLocaliser={maPosition} parPosition={parPosition} />
        {/* Les bus favoris de la ville, tout de suite visibles : un toucher ouvre leurs horaires */}
        <MesBus reseau={reseau} code={code} onVille={choisirVille}
                onOuvrir={(favori) => { setAOuvrir({ favori, n: Date.now() }); setMode("passages"); }} />

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
function CarteLigne({ b, maintenant, rapide, onDetail, reseau, descentes, B }) {
  const { t } = useLangue();
  const p = b.passages[0];
  const attente = p ? Math.round(p.depart - maintenant) : null;
  const dans = attente === null ? null : attente <= 0 ? t("ville.maintenant") : t("ville.dans", { minutes: attente });
  return (
    <section className={rapide ? "bus__carte bus__carte--meilleur" : "bus__carte bus__carte--option"}>
      {rapide && <span className="bus__badge">{t("ville.rapide")}</span>}
      <div className="bus__ligne"><PuceLigne ligne={b.ligne} />
        {/* Le terminus du PROCHAIN bus, pas la liste de tous ceux de la ligne */}
        <strong>{nomTransport(b.ligne, t)} {b.ligne.nom} · {t("ville.direction", { direction: (p && terminusDeLaCourse(reseau, p.parcours, b.ligne.nom)) || b.direction })}</strong>
        {dans && <span className={p?.direct ? "bus__dans bus__dans--direct" : "bus__dans"}>{p?.direct && <SignalDirect />}{dans}</span>}</div>
      {b.marcheAvant > 0 && (
        <div className="bus__detail">{t("ville.marche", { minutes: b.marcheAvant, arret: b.depart.nom })}
          {reseau?.arrets[b.depart.id] && <div><LienMarche vers={{ lat: reseau.arrets[b.depart.id][1], lon: reseau.arrets[b.depart.id][2] }} /></div>}
        </div>
      )}
      {p ? (
        <>
          <p><strong>{t("ville.passe", { arret: b.depart.nom, dans, heure: minutesEnHeure(p.depart) })}</strong>
            {p.direct && p.prevue !== p.depart && <span className="bus__prevu"> {t("ville.prevu", { heure: minutesEnHeure(p.prevue) })}</span>}</p>
          <p><strong>{t("ville.arrive", { arret: b.arrivee.nom, heure: minutesEnHeure(p.arrivee) })}</strong>
            {b.marcheApres ? t("ville.puis.pied", { minutes: b.marcheApres }) : ""} · {t("ville.arrets", { nombre: arretsDuPassage(p, b.arrets) })}</p>
          {b.marcheApres > 0 && B && <LienMarche vers={B} genre="lieu" nom={B.nom} />}
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

function CartePied({ B, minutes, arrivee, rapide }) {
  const { t } = useLangue();
  return (
    <section className={rapide ? "bus__carte bus__carte--meilleur" : "bus__carte bus__carte--option"}>
      {rapide && <span className="bus__badge">{t("ville.rapide")}</span>}
      <div className="bus__ligne"><span className="bus__pied" aria-hidden="true">🚶</span><strong>{t("ville.pied")}</strong></div>
      <p>{t("ville.pied.arrivee", { heure: minutesEnHeure(arrivee), minutes })}</p>
      {/* La destination seulement : Plans ou Google Maps partent de la position, sans qu'on l'écrive dans le lien */}
      <a className="bus__voir-arrets" href={lienMarche(B)} target="_blank" rel="noopener noreferrer">
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
        {(() => {
          const favori = { code, ville: ville.ville, B: { nom: B.nom, lat: B.lat, lon: B.lon, cat: B.cat || null },
            A: A.cat === "position" ? { nom: "Ma position", cat: "position" } : { nom: A.nom, lat: A.lat, lon: A.lon, cat: A.cat || null } };
          return (
            <div className="bus__entete-actions">
              <EtoileVille trajet={favori} />
              {/* Partager : jamais « Ma position » avec ses coordonnées (le lien relocalise celui qui l'ouvre) */}
              <BoutonPartager classe="bouton-favori" titre={`${nomA} → ${B.nom}`} chemin={lienVille(favori)} />
            </div>
          );
        })()}
        {possibilites.length > 0 && (
          <p className="bus__entete-grand">{t("ville.possibilites", { nombre: possibilites.length })}</p>
        )}
      </section>

      {visibles.map((o, i) => (o.type === "pied"
        ? <CartePied key="pied" A={A} B={B} minutes={trajet.minutesAPied} arrivee={o.arrivee} rapide={i === 0} />
        : <CarteLigne key={`${o.b.ligne.nom}-${o.b.depart.id}-${o.b.direction}`} b={o.b} maintenant={maintenant} rapide={i === 0}
                      onDetail={onDetail} reseau={reseau} descentes={trajet.descentes} B={B} />))}
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
            de l'arrêt {trajet.lendemain.depart.nom}. À pied : {enDuree(trajet.minutesAPied)}.</p>
          <a className="bus__bouton" href={lienCarte(A, B)} target="_blank" rel="noopener noreferrer">{t("ville.carte")}</a>
        </section>
      )}
      {trajet.conseil === "aucun" && (
        <section className="bus__carte">
          <p className="bus__carte-titre">{t("ville.aucun.titre")}</p>
          <p>À pied : {enDuree(trajet.minutesAPied)}. Un trajet avec un changement est peut-être possible :</p>
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
        <div><strong>{t("ville.direction", { direction: terminusDeLaCourse(reseau, passage.parcours, bus.ligne.nom) || bus.direction })}</strong>
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
function PassagesArret({ reseau, code, position, onLocaliser, onVille, aOuvrir }) {
  const { t } = useLangue();
  // La vue ouverte (« course » ou « horaires ») appartient à une ville : changer de ville la referme
  const [vueBrute, setVueBrute] = useState(() => (aOuvrir ? { type: "horaires", favori: aOuvrir, code } : null));
  const vue = vueBrute?.code === code ? vueBrute : null;
  const setVue = (v) => setVueBrute(v && { ...v, code });
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
  // Les passages gardent leurs courses (toutes celles des 3 heures) : un bus touché ouvre SES arrêts
  const prevus = reseau && horaires && arret ? passagesALArret(reseau, horaires, arret.ids, aujourdhuiIso(), maintenant - 3, 12)
    .map((g) => ({ ...g, heures: g.heures.slice(0, 3) })) : [];
  // Avec le direct : chaque heure prévue prend son heure attendue, quand on sait la relier
  const passages = prevus.map((g) => {
    if (!direct) return { ...g, enDirect: false, heures: g.heures.filter((h) => h >= maintenant).slice(0, 2) };
    const attendues = arret.ids.flatMap((id) => direct.passages[`${g.ligneId}|${id}`] || []).sort((x, y) => x - y);
    const liens = relierAuDirect(g.heures, attendues, aujourdhuiIso());
    const heures = liens.map((l) => l.attendue ?? l.prevue).filter((h) => h >= maintenant).sort((x, y) => x - y).slice(0, 2);
    return { ...g, enDirect: liens.some((l) => l.attendue !== null), heures };
  }).filter((g) => g.heures.length).sort((x, y) => x.heures[0] - y.heures[0]);
  const metres = arret && autour.find((a) => a.nom === arret.nom)?.metres;

  if (vue?.type === "course" && reseau) {
    return <ArretsDuBus reseau={reseau} code={code} arret={vue.arret} groupe={vue.groupe} course={vue.course} retour={vue.retour} jour={vue.jour}
                        onFermer={() => setVue(vue.depuis || null)} onChoix={(c) => setVue({ ...vue, course: c })} />;
  }
  if (vue?.type === "horaires" && reseau && horaires) {
    const f = vue.favori;
    return <HorairesFavori reseau={reseau} horaires={horaires} favori={f} maintenant={maintenant} onFermer={() => setVue(null)}
                           onChoix={(c, jour) => {
                             const groupe = { ligneId: f.ligneId, ligne: f.ligne, direction: f.direction,
                               courses: journeeALArret(reseau, horaires, f.arret.ids, jour, f.ligneId, f.direction).filter((x) => x.depart >= c.depart) };
                             setVue({ type: "course", arret: f.arret, groupe, course: c, jour, retour: t("bus.retour.horaires"), depuis: vue });
                           }} />;
  }
  return (
    <div className="passages">
      <MesBus reseau={reseau} horaires={horaires} code={code} maintenant={maintenant}
              onOuvrir={(favori) => setVue({ type: "horaires", favori })} onVille={onVille} />
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
              const attente = (m) => { const d = Math.round(m - maintenant); return d <= 0 ? "à l'arrêt" : enDuree(d); };
              return (
                <button key={`${g.ligneId}|${g.direction}`} type="button" className="panneau-arret__rang panneau-arret__rang--bouton"
                        onClick={() => setVue({ type: "course", arret, groupe: g, course: g.courses[0], retour: t("bus.retour.passages") })}
                        aria-label={t("bus.voir", { ligne: g.ligne.nom, direction: g.direction })}>
                  <PuceLigne ligne={g.ligne} />
                  <span className="panneau-arret__direction">{g.direction}</span>
                  <span className="panneau-arret__temps"><strong>{attente(g.heures[0])}</strong>
                    {g.heures[1] !== undefined && <small>puis {attente(g.heures[1])}</small>}</span>
                  <span className="panneau-arret__fleche" aria-hidden="true">›</span>
                </button>
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

// =====================================================================
//  Les bus d'un arrêt : chaque bus se touche, et les bus favoris (ligne + arrêt + direction)
// =====================================================================
const ajouterJours = (iso, n) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n)).toISOString().slice(0, 10);

// ---------- Les arrêts du bus touché, depuis l'arrêt où l'on est jusqu'au terminus ----------
function ArretsDuBus({ reseau, code, arret, groupe, course, onFermer, onChoix, retour, jour = aujourdhuiIso() }) {
  const { t } = useLangue();
  const { estFavori, basculer, retirer, bus: favoris, maximum } = useBusFavoris();
  const [plein, setPlein] = useState(false);
  const [prevenir, setPrevenir] = useState(false);
  const tous = arretsDeLaCourse(reseau, course, joliNom).filter((a) => a.role !== "avant");
  const terminus = terminusDeLaCourse(reseau, course.parcours, groupe.ligne.nom) || groupe.direction;
  const favori = { code, ligneId: groupe.ligneId, ligne: groupe.ligne, direction: groupe.direction, arret: { nom: arret.nom, ids: arret.ids } };
  const actif = estFavori(favori);
  const departs = groupe.courses.slice(0, 4);
  return (
    <section className="course" aria-label={t("bus.arrets.titre")}>
      <button type="button" className="course__retour" onClick={onFermer}>‹ {retour}</button>
      <div className="course__entete">
        <PuceLigne ligne={groupe.ligne} />
        <div><strong>{t("ville.direction", { direction: terminus })}</strong>
          <small>{t("bus.depuis", { arret: arret.nom, nombre: tous.length - 1, heure: minutesEnHeure(tous[tous.length - 1].minute) })}</small></div>
      </div>
      <button type="button" className={actif ? "bus__favori bus__favori--actif" : "bus__favori"} aria-pressed={actif}
              onClick={() => { if (basculer(favori) === "plein") setPlein(true); }}>
        {actif ? `★ ${t("bus.favori.dans")}` : `☆ ${t("bus.favori.ajouter", { ligne: groupe.ligne.nom, arret: arret.nom })}`}
      </button>
      {(() => {
        const actuel = favoris.find((b) => idBus(b) === idBus(favori));
        const r = actuel && rappelDuBus(actuel, course.depart, jour);
        return (
          <button type="button" className={r ? "bus__favori bus__favori--actif" : "bus__favori bus__favori--prevenir"} onClick={() => setPrevenir(true)}>
            🔔 {r ? t("rappel.deja", { heure: minutesEnHeure(course.depart), minutes: r.avance }) : t("rappel.pour", { heure: minutesEnHeure(course.depart) })}
          </button>
        );
      })()}
      {prevenir && <FeuilleRappel favori={favori} course={course} jour={jour} onFermer={() => setPrevenir(false)} />}
      {departs.length > 1 && (
        <div className="course__departs" role="group" aria-label={t("bus.choisir")}>
          {departs.map((c) => (
            <button key={c.depart} type="button" aria-pressed={c.depart === course.depart}
                    className={c.depart === course.depart ? "course__depart course__depart--actif" : "course__depart"}
                    onClick={() => onChoix(c)}>{minutesEnHeure(c.depart)}</button>
          ))}
        </div>
      )}
      <ol className="course__arrets" style={{ "--couleur-ligne": groupe.ligne.couleur }}>
        {tous.map((a, i) => {
          const role = i === 0 ? "montee" : i === tous.length - 1 ? "descente" : "trajet";
          return (
            <li key={a.id + a.minute} className={`course__arret course__arret--${role}`}>
              <span className="course__heure">{minutesEnHeure(a.minute)}</span>
              <span className="course__rond" aria-hidden="true" />
              <span className="course__nom">{a.nom}
                {role === "montee" && <span className="course__etiquette course__etiquette--descente">{t("bus.ici")}</span>}
                {role === "descente" && <span className="course__etiquette course__etiquette--montee">{t("bus.terminus")}</span>}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="bus__source">{t("bus.exact")}</p>
      {plein && (
        <FeuillePleine titre={`⭐ ${t("bus.plein.titre", { max: maximum })}`} question={t("bus.plein.question", { ligne: groupe.ligne.nom, arret: arret.nom })}
                       elements={favoris.map((b) => ({ cle: idBus(b), texte: `${b.ligne.nom} · ${b.arret.nom}`, detail: t("bus.vers", { direction: b.direction }) }))}
                       action={t("plein.retirer")} onFermer={() => setPlein(false)}
                       onRetirer={(cle) => { retirer(cle); basculer(favori); setPlein(false); }} />
      )}
    </section>
  );
}

// ---------- « ⭐ Mes bus à Calais » : les bus favoris de la ville choisie, avec leur prochain passage ----------
function MesBus({ reseau, horaires: donnes, code, maintenant: donne, onOuvrir, onVille }) {
  const { t } = useLangue();
  const { bus } = useBusFavoris();
  // Dans l'onglet « Un trajet », les horaires et l'heure ne sont pas encore là : on les prend ici
  const [charges, setCharges] = useState({ code: null, horaires: null });
  const [ici_, setIci] = useState(() => enMinutes(heureActuelle()));
  useEffect(() => {
    if (donnes) return undefined;
    let annule = false;
    chargerHoraires(code).then((h) => { if (!annule) setCharges({ code, horaires: h }); });
    const m = setInterval(() => setIci(enMinutes(heureActuelle())), 30_000);
    return () => { annule = true; clearInterval(m); };
  }, [code, donnes]);
  const horaires = donnes || (charges.code === code ? charges.horaires : null);
  const maintenant = donne ?? ici_;
  const ici = bus.filter((b) => b.code === code);
  const ailleurs = bus.filter((b) => b.code !== code);
  if (!bus.length) return null;
  const ville = (c) => RESEAUX.find((r) => r.code === c)?.ville || c;
  const autreVille = ailleurs[0]?.code;
  return (
    <section className="mes-bus">
      {ici.length > 0 && <h2 className="mes-bus__titre">⭐ {t("bus.mes", { ville: ville(code) })} <small>{t("bus.compte", { nombre: bus.length, max: 5 })}</small></h2>}
      {reseau && horaires && ici.map((b) => {
        const suivants = journeeALArret(reseau, horaires, b.arret.ids, aujourdhuiIso(), b.ligneId, b.direction).filter((c) => c.depart >= maintenant);
        const [premier, ...apres] = suivants;
        return (
          <button key={idBus(b)} type="button" className="mes-bus__carte" onClick={() => onOuvrir(b)}>
            <PuceLigne ligne={b.ligne} />
            <span className="mes-bus__texte"><strong>{b.arret.nom}</strong><small>{t("bus.vers", { direction: b.direction })}</small>
              <small>{premier ? <><b>{t("bus.dans", { minutes: Math.max(0, premier.depart - maintenant), heure: minutesEnHeure(premier.depart) })}</b>
                {apres.length > 0 && ` · ${t("bus.puis", { heures: apres.slice(0, 2).map((c) => minutesEnHeure(c.depart)).join(", ") })}`}</>
                : t("bus.plusaujourdhui")}</small></span>
            <span aria-hidden="true">›</span>
          </button>
        );
      })}
      {autreVille && (
        <button type="button" className="mes-bus__ailleurs" onClick={() => onVille?.(autreVille)}>
          {t(ailleurs.length > 1 ? "bus.ailleurs.plusieurs" : "bus.ailleurs", { nombre: ailleurs.length, ville: ville(autreVille) })}
        </button>
      )}
    </section>
  );
}

// ---------- Les horaires de la journée d'un bus favori, heure par heure ----------
function HorairesFavori({ reseau, horaires, favori: ancien, maintenant, onFermer, onChoix }) {
  const { t } = useLangue();
  const { bus, arreterRappel } = useBusFavoris();
  const favori = bus.find((b) => idBus(b) === idBus(ancien)) || ancien;      // relu : les rappels ont pu changer
  const rappels = rappelsValides(favori.rappels).sort((a, b) => a.heure - b.heure);
  const [decalage, setDecalage] = useState(0);              // 0 : aujourd'hui, 1 : demain
  const jour = ajouterJours(aujourdhuiIso(), decalage);
  const courses = journeeALArret(reseau, horaires, favori.arret.ids, jour, favori.ligneId, favori.direction);
  const prochain = decalage === 0 ? courses.find((c) => c.depart >= maintenant) : null;
  const parHeure = new Map();
  courses.forEach((c) => { const h = Math.floor(c.depart / 60); parHeure.set(h, [...(parHeure.get(h) || []), c]); });
  return (
    <section className="horaires-bus" aria-label={t("bus.horaires")}>
      <button type="button" className="course__retour" onClick={onFermer}>‹ {t("bus.retour.ville")}</button>
      <div className="course__entete"><PuceLigne ligne={favori.ligne} />
        <div><strong>{favori.arret.nom}</strong><small>{t("bus.vers", { direction: favori.direction })}</small></div></div>
      {prochain && <p className="horaires-bus__prochain"><small>{t("bus.prochain")}</small>
        <strong>{t("bus.dans", { minutes: Math.max(0, prochain.depart - maintenant), heure: minutesEnHeure(prochain.depart) })}</strong></p>}
      {rappels.map((r) => (
        <div key={r.heure + (r.jour || "")} className="rappel-bus__actif"><span aria-hidden="true">🔔</span>
          <span><strong>{t("rappel.lebus", { heure: minutesEnHeure(r.heure) })}</strong>
            <small>{r.repetition === "une" ? dateLongue(r.jour) : t(TEXTE_REPETITION[r.repetition])} · {t("rappel.avant", { minutes: r.avance })}</small></span>
          <button type="button" onClick={() => arreterRappel(favori, r.heure)}>{t("plein.arreter")}</button></div>
      ))}
      <div className="horaires-bus__jour">
        <strong>{decalage === 0 ? t("jour.aujourdhui") : t("jour.demain")}</strong>
        <button type="button" onClick={() => setDecalage(decalage === 0 ? 1 : 0)}>{decalage === 0 ? `${t("jour.demain")} →` : `← ${t("jour.aujourdhui")}`}</button>
      </div>
      {courses.length === 0 ? <p className="panneau-arret__vide">{t("bus.aucun")}</p> : (
        <div className="horaires-bus__grille">
          {[...parHeure.entries()].map(([h, cs]) => (
            <div key={h} className="horaires-bus__heure"><strong>{h % 24} h</strong>
              <span>{cs.map((c) => {
                const passe = decalage === 0 && c.depart < maintenant;
                const classe = passe ? "horaires-bus__minute horaires-bus__minute--passe" : c === prochain ? "horaires-bus__minute horaires-bus__minute--prochain" : "horaires-bus__minute";
                const cloche = rappelDuBus(favori, c.depart, jour);
                return <button key={c.depart} type="button" className={classe} onClick={() => onChoix(c, jour)}
                               aria-label={`${minutesEnHeure(c.depart)}${cloche ? ` · ${t("rappel.titre")}` : ""}`}>
                  {String(c.depart % 60).padStart(2, "0")}{cloche && <span aria-hidden="true"> 🔔</span>}</button>;
              })}</span></div>
          ))}
        </div>
      )}
      <p className="bus__source">{t("bus.horaires.note2")}</p>
    </section>
  );
}

// ---------- 🔔 « Me prévenir pour le bus de 19:27 » : la feuille, comme « Suivre ce train » ----------
function FeuilleRappel({ favori, course, jour, onFermer }) {
  const { t } = useLangue();
  const { bus, poserRappel, nombreRappels } = useBusFavoris();
  const actuel = bus.find((b) => idBus(b) === idBus(favori));
  const existant = rappelsValides(actuel?.rappels).find((r) => r.heure === course.depart);
  const [repetition, setRepetition] = useState(existant?.repetition || "une");
  const [avance, setAvance] = useState(existant?.avance || 5);
  const [message, setMessage] = useState("");
  const h = minutesEnHeure;
  const choix = [["une", t("rappel.une"), jour === aujourdhuiIso() ? t("rappel.une.texte") : t("rappel.une.jour", { jour: dateLongue(jour) })],
    ["semaine", t("rappel.semaine"), t("rappel.semaine.texte", { heure: h(course.depart) })], ["tous", t("rappel.tous"), t("rappel.tous.texte")]];
  async function prevenir() {
    setMessage("");
    if (!existant && nombreRappels >= MAX_RAPPELS) { setMessage(t("rappel.plein", { max: MAX_RAPPELS })); return; }
    if (poserRappel(favori, { heure: course.depart, repetition, avance, ...(repetition === "une" ? { jour } : {}) }) === "plein") {
      setMessage(t("bus.plein.titre", { max: 5 })); return;
    }
    const etat = etatNotifications();
    if (etat === "installer") { setMessage(t("rappel.installer")); return; }
    if (etat === "refuse") { setMessage(t("rappel.refuse")); return; }
    if (etat === "impossible") { setMessage(t("rappel.impossible")); return; }
    // Dans le geste du voyageur (l'iPhone l'exige) : l'autorisation, puis l'envoi au serveur
    try { await activerNotifications(trainsSuivisPourLeServeur()); onFermer(); } catch { setMessage(t("notif.erreur")); }
  }
  return (
    <div className="feuille-suivre" role="dialog" aria-modal="true" aria-label={t("rappel.titre")}>
      <button type="button" className="feuille-suivre__fond" aria-label={t("plein.annuler")} onClick={onFermer} />
      <div className="feuille-suivre__contenu">
        <span className="feuille-suivre__poignee" aria-hidden="true" />
        <p className="feuille-suivre__titre">🔔 {t("rappel.bus", { ligne: favori.ligne.nom, heure: h(course.depart) })}</p>
        <p className="feuille-suivre__train">{favori.arret.nom} → {favori.direction}</p>
        <div className="rappel-bus__choix" role="radiogroup">
          {choix.map(([v, titre, texte]) => (
            <button key={v} type="button" role="radio" aria-checked={repetition === v} onClick={() => setRepetition(v)}
                    className={repetition === v ? "rappel-bus__option rappel-bus__option--actif" : "rappel-bus__option"}>
              <span className="rappel-bus__rond" aria-hidden="true" /><span><strong>{titre}</strong><small>{texte}</small></span>
            </button>
          ))}
        </div>
        <fieldset className="rappel-bus__groupe"><legend>{t("rappel.avance")}</legend>
          {[3, 5, 10, 15].map((n) => (
            <button key={n} type="button" aria-pressed={avance === n} onClick={() => setAvance(n)}
                    className={avance === n ? "rappel-bus__puce rappel-bus__puce--actif" : "rappel-bus__puce"}>{n} min</button>
          ))}
        </fieldset>
        <p className="rappel-bus__apercu">{t("rappel.apercu.court", { heure: h(course.depart - avance) })} 🚌 {t("rappel.message",
          { ligne: favori.ligne.nom, arret: favori.arret.nom, minutes: avance, heure: h(course.depart), direction: favori.direction })}</p>
        {message && <p className="partir__message" role="alert">{message}</p>}
        <button type="button" className="partir__bouton partir__bouton--plein" onClick={prevenir}>{t("rappel.prevenir")}</button>
        <p className="bus__source">{t("rappel.prevus")}</p>
      </div>
    </div>
  );
}

const TEXTE_REPETITION = { une: "rappel.une", semaine: "rappel.semaine", tous: "rappel.tous" };

function SignalDirect() {
  return (
    <svg className="signal-direct" viewBox="0 0 24 24" width="14" height="14" aria-label="en direct" role="img" fill="none"
         stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M5 12a7 7 0 0 1 14 0M8.5 12a3.5 3.5 0 0 1 7 0" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" /></svg>
  );
}
