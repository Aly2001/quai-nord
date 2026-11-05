// =====================================================================
//  PARTIR : tout ce qu'il faut savoir au moment de partir pour un train suivi.
//   1. « Et pour aller à la gare ? » : ma position ou une adresse -> le bus (ou la marche) qui arrive à temps ;
//   2. puis : « Partez dans 18 min », l'itinéraire heure par heure, l'état du train en direct.
//  À chaque ouverture, si le départ était « Ma position », on vérifie où l'on est : au-delà de 300 m,
//  l'itinéraire est recalculé depuis là où l'on est. La position reste sur le téléphone.
// =====================================================================
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTitrePage } from "../components/titrePage";
import { useLangue } from "../langue/langue";
import { LienMarche } from "../components/Marche";
import { lienPartir, LigneEtape } from "../components/Suivre";
import { useSuivis, prochaineOccasion, allerALaGare, margeEnGare, enMinutesDuJour, BOUGE, TRES_LOIN, MARCHE_MAX, terminusDe, heureDescenteDe } from "../data/suivi";
import { chargerReseau, chargerGaresCouvertes, chercherLieu, distance, RESEAUX, gareLaPlusProche, lienCarte } from "../data/bus";
import { enDuree } from "../langue/langue";
import { chargerHoraires, minutesEnHeure } from "../data/trajetBus";
import { normaliser, dateLongue, trajetsDirects, ajouterMinutes } from "../data/horaires";
import { useMomentDuSuivi } from "../data/directSuivi";
import "./Partir.css";

const aujourdhuiLocal = () => new Date().toLocaleDateString("sv-SE");
function positionActuelle() {
  return new Promise((ok, refus) => {
    if (!navigator.geolocation) { refus(new Error("indisponible")); return; }
    navigator.geolocation.getCurrentPosition((p) => ok({ lat: p.coords.latitude, lon: p.coords.longitude }), refus,
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 });
  });
}

export default function Partir() {
  const { t } = useLangue();
  const navigate = useNavigate();
  const [parametres] = useSearchParams();
  const { trouver, enregistrerAller, nePlusSuivre } = useSuivis();
  const suivi = trouver(parametres.get("id") || "");
  useTitrePage(t("partir.titre"), t("partir.titre"));
  const preparer = parametres.get("preparer") === "1" || (suivi && !suivi.aller);
  const jour = suivi ? prochaineOccasion(suivi) : null;

  // La gare de départ, son réseau de bus, et les horaires de ce réseau
  const [contexte, setContexte] = useState({ gare: null, reseau: null, horaires: null, pret: false });
  useEffect(() => {
    if (!suivi) return undefined;
    let annule = false;
    chargerGaresCouvertes().then(async (gares) => {
      const gare = gares.find((g) => normaliser(g.nom) === normaliser(suivi.de)) || null;
      const [reseau, horaires] = gare ? await Promise.all([chargerReseau(gare.reseau), chargerHoraires(gare.reseau)]) : [null, null];
      if (!annule) setContexte({ gare, reseau, horaires, pret: true });
    });
    return () => { annule = true; };
  }, [suivi?.de]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!suivi) {
    return (
      <div className="partir">
        <p className="partir__vide">{t("partir.introuvable")}</p>
        <Link to="/favoris" className="partir__lien">{t("partir.mes")}</Link>
      </div>
    );
  }
  const limite = enMinutesDuJour(suivi.heure) - margeEnGare(suivi.de);
  const calculer = async (A) => {
    const aller = allerALaGare(contexte.reseau, contexte.horaires, A, contexte.gare, jour, limite);
    if (aller.mode !== "loin") return aller;
    const proche = gareLaPlusProche(await chargerGaresCouvertes(), A.lat, A.lon);
    return { ...aller, gareProche: proche && proche.metres < TRES_LOIN ? proche.nom : null };
  };

  return (
    <div className="partir">
      <section className="partir__entete">
        <p>{jour === aujourdhuiLocal() ? t("jour.aujourdhui") : dateLongue(jour)}</p>
        <h1>{suivi.heure} · {suivi.de} → {suivi.a}</h1>
      </section>
      {!contexte.pret ? <p className="partir__vide">{t("ville.cherche")}</p>
        : !contexte.gare ? <p className="partir__vide">{t("partir.pasdebus")}</p>
        : preparer ? (
          <PreparerAller suivi={suivi} contexte={contexte} calculer={calculer}
                         onChoisi={(aller) => { enregistrerAller(suivi, aller); navigate(`/partir?${new URLSearchParams({ id: parametres.get("id") })}`, { replace: true }); }} />
        ) : <Itineraire suivi={suivi} jour={jour} contexte={contexte} calculer={calculer} />}
      <div className="partir__pied">
        <Link to={`/trajet?${new URLSearchParams({ de: suivi.a, a: suivi.de, jour: jour || aujourdhuiLocal(), heure: suivi.arrivee })}`}>{t("partir.retour")}</Link>
        <Link to="/favoris">{t("partir.mes")}</Link>
        <button type="button" onClick={() => { nePlusSuivre(suivi); navigate("/favoris"); }}>{t("suivi.arreter")}</button>
      </div>
    </div>
  );
}

// ---------- 1. « Et pour aller à la gare ? » ----------
function PreparerAller({ suivi, contexte, calculer, onChoisi }) {
  const { t } = useLangue();
  const navigate = useNavigate();
  const [adresse, setAdresse] = useState("");
  const [message, setMessage] = useState("");
  const [enCours, setEnCours] = useState(false);
  const ville = RESEAUX.find((r) => r.code === contexte.gare.reseau)?.ville || "";

  async function depuis(point, nom, position) {
    const aller = await calculer(point);
    onChoisi({ ...aller, depuis: { nom, lat: point.lat, lon: point.lon, position } });
  }
  async function avecPosition() {
    setEnCours(true); setMessage("");
    try { await depuis(await positionActuelle(), t("ville.maposition"), true); }
    catch { setMessage(t("partir.position.refus")); }
    setEnCours(false);
  }
  async function avecAdresse(e) {
    e.preventDefault();
    if (!adresse.trim()) return;
    setEnCours(true); setMessage("");
    const [lieu] = await chercherLieu(adresse, contexte.gare, ville, contexte.reseau);
    if (lieu) await depuis(lieu, lieu.nom, false);
    else setMessage(t("ville.introuvable", { texte: adresse, ville }));
    setEnCours(false);
  }
  return (
    <section className="partir__preparer">
      <p className="partir__bulle">{t("partir.question", { heure: suivi.heure, gare: suivi.de })}</p>
      <button type="button" className="partir__bouton partir__bouton--plein" onClick={avecPosition} disabled={enCours}>📍 {t("ville.maposition")}</button>
      <form className="partir__adresse" onSubmit={avecAdresse}>
        <label htmlFor="partir-adresse">{t("partir.adresse")}</label>
        <div><input id="partir-adresse" type="text" value={adresse} onChange={(e) => setAdresse(e.target.value)} placeholder={t("ville.depart.exemple")} />
          <button type="submit" className="partir__bouton" disabled={enCours}>{t("ville.chercher")}</button></div>
      </form>
      {message && <p className="partir__message" role="alert">{message}</p>}
      <p className="partir__note">{t("partir.note")}</p>
      <button type="button" className="partir__plustard" onClick={() => navigate("/")}>{t("partir.plustard")}</button>
    </section>
  );
}

// ---------- 2. L'itinéraire, au moment de partir ----------
function Itineraire({ suivi, jour, contexte, calculer }) {
  const { t } = useLangue();
  const navigate = useNavigate();
  // Un aller enregistré avant cette règle (« marchez 27 h ») est relu avec la règle d'aujourd'hui
  const [lieu, setLieu] = useState({ etat: suivi.aller.depuis.position ? "verification" : "adresse", aller: corrigerAller(suivi.aller) });
  const [absent, setAbsent] = useState(false);        // le train n'est plus dans les horaires de ce jour
  const [quandMeme, setQuandMeme] = useState(false);   // « J'y vais quand même », malgré « trop tard »
  const aujourdhui = jour === aujourdhuiLocal();

  // Le départ était « Ma position » : est-on toujours au même endroit ?
  useEffect(() => {
    if (!suivi.aller.depuis.position || !aujourdhui) return;
    positionActuelle().then((ici) => {
      const ecart = distance(ici.lat, ici.lon, suivi.aller.depuis.lat, suivi.aller.depuis.lon);
      if (ecart <= BOUGE) setLieu({ etat: "meme", aller: suivi.aller });
      else calculer(ici).then((aller) => setLieu({ etat: "bouge", aller: { ...aller, depuis: { ...suivi.aller.depuis, lat: ici.lat, lon: ici.lon } } }));
    }).catch(() => setLieu({ etat: "inconnu", aller: suivi.aller }));
  }, [suivi.heure, aujourdhui]);   // eslint-disable-line react-hooks/exhaustive-deps

  async function recalculerIci() {
    try {
      const ici = await positionActuelle();
      setLieu({ etat: "bouge", aller: { ...(await calculer(ici)), depuis: { nom: t("ville.maposition"), lat: ici.lat, lon: ici.lon, position: true } } });
    } catch { setLieu((l) => ({ ...l, etat: "inconnu" })); }
  }

  const aller = lieu.aller;
  // Tout part de MAINTENANT et des heures ANNONCÉES (moment.js) : la même règle que Mes trains suivis
  const { moment: brut, etat, departs, maintenant } = useMomentDuSuivi(suivi, jour, aller);
  const moment = quandMeme && brut.etape === "troptard" ? { ...brut, etape: "sauve" } : brut;
  const partiMaintenant = ["maintenant", "serre", "sauve", "troptard"].includes(moment.etape);
  const gare = { lat: contexte.gare.lat, lon: contexte.gare.lon };
  const arret = aller.mode === "bus" ? contexte.reseau?.arrets[aller.arretDepart.id] : null;

  return (
    <section className="partir__itineraire">
      {/* Parti de « Ma position » : on parle de l'arrêt (s'il y a un bus), sinon simplement du même endroit */}
      {/* Toujours au même endroit : rien n'a changé, donc rien à dire. Ailleurs : une ligne discrète. */}
      {lieu.etat === "bouge" && <p className="partir__lieu">📍 {t("partir.bouge")}</p>}
      {(lieu.etat === "adresse" || lieu.etat === "inconnu") && (
        <p className="partir__lieu">📍 {t("partir.depuis", { lieu: aller.depuis.nom })}
          <button type="button" onClick={recalculerIci}>{t("partir.ailleurs")}</button></p>
      )}
      <EtatDuTrain suivi={suivi} jour={jour} etat={etat} departs={departs} onAbsent={setAbsent} />
      {aller.mode === "loin" && (
        <div className="partir__alerte partir__alerte--absent">
          <strong>🚆 {t("partir.loin", { gare: suivi.de, km: Math.round(aller.metres / 1000) })}</strong>
          <span>{t("partir.loin.texte")}</span>
          {aller.gareProche && (
            <Link className="partir__bouton partir__bouton--plein" to={`/trajet?${new URLSearchParams({ de: aller.gareProche, a: suivi.de, jour, heure: "00:00" })}`}>
              {t("partir.loin.train", { de: aller.gareProche, a: suivi.de })}</Link>
          )}
        </div>
      )}
      {aller.mode === "aucun" && (
        <div className="partir__alerte partir__alerte--absent">
          <strong>{t("partir.aucun", { gare: suivi.de })}</strong>
          <span>{t("partir.aucun.texte", { duree: enDuree(aller.marche) })}</span>
          <a href={lienCarte(aller.depuis, contexte.gare)} target="_blank" rel="noopener noreferrer">{t("ville.carte")}</a>
        </div>
      )}
      {!absent && ["bus", "pied"].includes(aller.mode) && (<>
      <div className="partir__compte">
        <Compte moment={moment} aller={aller} suivi={suivi} aujourdhui={aujourdhui} maintenant={maintenant}
                departs={departs} onQuandMeme={() => setQuandMeme(true)} onRecalculer={recalculerIci} />
      </div>
      <ol className="partir__etapes">
        {aller.mode === "bus" ? (<>
          <li><span>🚶</span><div><strong>{partiMaintenant ? t("partir.maintenant.court") : minutesEnHeure(aller.departMaison)} · {t("partir.marchez", { minutes: aller.marcheAvant })}</strong>
            <small>{t("partir.jusqua", { arret: aller.arretDepart.nom })}</small>
            {arret && <LienMarche vers={{ lat: arret[1], lon: arret[2] }} />}</div></li>
          <li><span>🚌</span><div><strong>{minutesEnHeure(aller.heureBus)} · {t(aller.ligne.mode === "metro" ? "ville.mode.metro" : aller.ligne.mode === "tram" ? "ville.mode.tram" : "ville.mode.bus")} {aller.ligne.nom}</strong>
            <small>{t("ville.direction", { direction: terminusDe(aller) })} · {t("ville.arrets", { nombre: aller.arrets })}</small></div></li>
          {/* La descente : l'heure du bus à l'arrêt, puis la marche jusqu'à la gare (son bouton est ICI) */}
          <li><span>🚏</span><div><strong>{minutesEnHeure(heureDescenteDe(aller))} · {t("partir.descendez", { arret: aller.arretArrivee.nom })}</strong>
            <small>{aller.marcheApres > 0 ? t("partir.puis", { minutes: aller.marcheApres }) : t("partir.devant")}</small>
            {aller.marcheApres > 0 && <LienMarche vers={gare} genre="gare" />}</div></li>
        </>) : (
          <li><span>🚶</span><div><strong>{partiMaintenant ? t("partir.maintenant.court") : minutesEnHeure(aller.departMaison)} · {t("partir.marchez", { minutes: aller.marche })}</strong>
            <small>{t("partir.jusqua.gare", { gare: suivi.de })}</small><LienMarche vers={gare} genre="gare" /></div></li>
        )}
        {/* Le train : l'heure ANNONCÉE à côté de l'heure prévue, et l'arrivée qui en découle */}
        <li className="partir__train"><span>🚆</span><div><strong>{suivi.heure}{moment.retardDepart >= 1 && <> → <span className="partir__annonce">{t("partir.annonce", { heure: minutesEnHeure(moment.departAnnonce) })}</span></>} · {suivi.de} → {suivi.a}</strong>
          <small>{aller.mode === "bus" ? `${t("partir.marge.court", { minutes: enMinutesDuJour(suivi.heure) - aller.arriveeGare })} · ` : ""}
            {moment.retardArrivee >= 1 ? t("partir.arrivee.vers", { heure: minutesEnHeure(moment.arriveeAnnoncee), prevue: suivi.arrivee }) : t("partir.arrivee", { heure: suivi.arrivee })}{suivi.correspondance ? ` · ${t("partir.correspondance", { gare: suivi.correspondance })}` : ""}</small></div></li>
      </ol>
      </>)}
      <button type="button" className="partir__plustard" onClick={() => navigate(`${lienPartir(suivi)}&preparer=1`)}>
        {t("suivi.changer")}
      </button>
    </section>
  );
}

const minutesEnTexte = (m, t) => (m >= 60 ? enDuree(m) : t("partir.duree", { minutes: m }));

// ---------- Le grand message : quoi faire MAINTENANT (voir moment.js) ----------
function Compte({ moment, aller, suivi, aujourdhui, maintenant, departs, onQuandMeme, onRecalculer }) {
  const { t } = useLangue();
  const navigate = useNavigate();
  const { suivre, nePlusSuivre } = useSuivis();
  if (!aujourdhui) return <p><strong>{t("suivi.partez", { heure: minutesEnHeure(aller.departMaison) })}</strong></p>;
  const h = minutesEnHeure;
  switch (moment.etape) {
    case "avant":
      return (<>
        <p>{t("partir.dans")}</p><p className="partir__grand">{minutesEnTexte(moment.minutes, t)}</p>
        <p><strong>{t("suivi.partez", { heure: h(aller.departMaison) })}</strong></p>
      </>);
    case "maintenant":
      return (<>
        <p>{t("partir.ilest", { heure: h(maintenant) })}</p><p className="partir__grand partir__grand--petit">{t("partir.maintenant")}</p>
        <p><strong>{t("partir.serez", { heure: h(moment.arriveeGare) })}</strong></p>
      </>);
    case "serre": case "sauve":
      return (<>
        <p>{t("partir.ilest", { heure: h(maintenant) })}</p>
        <p className="partir__grand partir__grand--petit partir__grand--presse">⏱️ {t("partir.presse")}</p>
        <p><strong>{t("partir.serez", { heure: h(moment.arriveeGare) })}</strong></p>
        {moment.etape === "sauve" && <p className="partir__nuance">{t("partir.sauve", { heure: h(moment.departAnnonce) })}</p>}
      </>);
    case "troptard": {
      // Le premier train APRÈS celui-ci, vers la même gare : on propose de le suivre à la place
      const suivant = trajetsDirects(departs || [], suivi.de, normaliser(suivi.a)).filter((x) => x.heure > suivi.heure)
        .sort((x, y) => (x.heure < y.heure ? -1 : 1))[0];
      const remplacer = () => {
        const nouveau = { ...suivi, heure: suivant.heure, arrivee: suivant.arrivee, aller: undefined };
        nePlusSuivre(suivi);
        if (suivre(nouveau) !== "plein") navigate(`${lienPartir(nouveau)}&preparer=1`);
      };
      return (
        <div className="partir__troptard" role="alert">
          <p className="partir__troptard-titre">{t("partir.troptard")}</p>
          <p>{t("partir.troptard.texte", { maintenant: h(maintenant), arrivee: h(moment.arriveeGare), heure: h(moment.departAnnonce) })}</p>
          {suivant && <button type="button" className="partir__bouton partir__bouton--plein" onClick={remplacer}>
            {t("partir.remplacer", { heure: suivant.heure, arrivee: suivant.arrivee })}</button>}
          <button type="button" className="partir__quandmeme" onClick={onQuandMeme}>{t("partir.quandmeme")}</button>
        </div>
      );
    }
    case "busrate":
      return (<>
        <p className="partir__grand partir__grand--petit">🚌 {t("partir.busrate", { heure: h(moment.heureBus) })}</p>
        <button type="button" className="partir__bouton partir__bouton--plein" onClick={onRecalculer}>{t("partir.recalculer")}</button>
      </>);
    default:
      return <p className="partir__etape"><LigneEtape suivi={suivi} classe="" moment={moment} /></p>;
  }
}


// ---------- L'état du train, en direct (aujourd'hui seulement) ----------
// Il reçoit l'état calculé UNE fois pour tout l'écran (useMomentDuSuivi), pour que tout dise la même chose
function EtatDuTrain({ suivi, jour, etat, departs, onAbsent }) {
  const { t } = useLangue();
  const navigate = useNavigate();
  const { suivre, nePlusSuivre } = useSuivis();
  const estAbsent = etat?.statut === "absent" && departs.length > 0;
  useEffect(() => { onAbsent?.(estAbsent); }, [estAbsent]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!etat) return null;
  if (etat.statut === "supprime") {
    return (
      <div className="partir__alerte partir__alerte--supprime">
        <strong>🔴 {t("partir.supprime", { heure: suivi.heure })}</strong>
        <Link to={`/trajet?${new URLSearchParams({ de: suivi.de, a: suivi.a, jour, heure: suivi.heure })}`}>{t("partir.autres")}</Link>
      </div>
    );
  }
  if (etat.statut === "retard") {
    const annonce = etat.retardDepart >= 1 ? ` ${t("partir.retard.annonce", { heure: ajouterMinutes(suivi.heure, etat.retardDepart) })}` : "";
    return <p className="partir__alerte partir__alerte--retard">🟠 <span><strong>{t("partir.retard", { heure: suivi.heure, minutes: etat.minutes })}</strong>{annonce} {t("partir.prudence")}</span></p>;
  }
  if (etat.statut === "heure") return <p className="partir__alerte partir__alerte--heure">🟢 {t("partir.alheure", { heure: suivi.heure })}</p>;
  if (etat.statut === "absent") {
    // Le premier train vers la même gare, à partir de l'heure prévue (on ne propose pas un train déjà parti)
    const vers = trajetsDirects(departs, suivi.de, normaliser(suivi.a)).filter((x) => x.heure >= suivi.heure)
      .sort((x, y) => (x.heure < y.heure ? -1 : 1))[0];
    function remplacer() {
      const nouveau = { ...suivi, heure: vers.heure, arrivee: vers.arrivee, aller: undefined };
      nePlusSuivre(suivi);
      suivre(nouveau);
      navigate(`${lienPartir(nouveau)}&preparer=1`);
    }
    return (
      <div className="partir__alerte partir__alerte--absent">
        <strong>⚠️ {t("partir.absent", { heure: suivi.heure })}</strong>
        <span>{t("partir.absent.texte")}</span>
        {vers && <button type="button" onClick={remplacer}>{t("partir.remplacer", { heure: vers.heure, arrivee: vers.arrivee })}</button>}
      </div>
    );
  }
  return null;
}

// Les anciens allers à pied trop longs deviennent « loin » ou « aucun », comme le calcul d'aujourd'hui
function corrigerAller(aller) {
  if (aller.mode !== "pied" || aller.marche <= MARCHE_MAX) return aller;
  return aller.metres > TRES_LOIN ? { ...aller, mode: "loin", gareProche: null } : { ...aller, mode: "aucun" };
}
