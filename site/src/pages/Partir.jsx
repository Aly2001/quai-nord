// =====================================================================
//  PARTIR : tout ce qu'il faut savoir au moment de partir pour un train suivi.
//   1. « Et pour aller à la gare ? » : ma position ou une adresse -> le bus (ou la marche) qui arrive à temps ;
//   2. puis : « Partez dans 18 min », l'itinéraire heure par heure, l'état du train en direct.
//  À chaque ouverture, si le départ était « Ma position », on vérifie où l'on est : au-delà de 300 m,
//  l'itinéraire est recalculé depuis là où l'on est. La position reste sur le téléphone.
// =====================================================================
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTitrePage } from "../components/titrePage";
import { useLangue } from "../langue/langue";
import { LienMarche } from "../components/Marche";
import { lienPartir } from "../components/Suivre";
import { useSuivis, prochaineOccasion, allerALaGare, margeEnGare, enMinutesDuJour, BOUGE } from "../data/suivi";
import { chargerReseau, chargerGaresCouvertes, chercherLieu, distance, RESEAUX } from "../data/bus";
import { chargerHoraires, minutesEnHeure } from "../data/trajetBus";
import { etatDuTrain } from "../data/favorisPlus";
import { normaliser, dateLongue, useIndexHoraires, trouverGare, DOSSIER, useTempsReel, useRisques } from "../data/horaires";
import "./Partir.css";

const maintenantEnMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
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
  const calculer = (A) => allerALaGare(contexte.reseau, contexte.horaires, A, contexte.gare, jour, limite);

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
    const aller = calculer(point);
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
  const [maintenant, setMaintenant] = useState(maintenantEnMinutes);
  const [lieu, setLieu] = useState({ etat: suivi.aller.depuis.position ? "verification" : "adresse", aller: suivi.aller });
  useEffect(() => { const m = setInterval(() => setMaintenant(maintenantEnMinutes()), 30_000); return () => clearInterval(m); }, []);
  const aujourdhui = jour === aujourdhuiLocal();

  // Le départ était « Ma position » : est-on toujours au même endroit ?
  useEffect(() => {
    if (!suivi.aller.depuis.position || !aujourdhui) return;
    positionActuelle().then((ici) => {
      const ecart = distance(ici.lat, ici.lon, suivi.aller.depuis.lat, suivi.aller.depuis.lon);
      if (ecart <= BOUGE) setLieu({ etat: "meme", aller: suivi.aller });
      else setLieu({ etat: "bouge", aller: { ...calculer(ici), depuis: { ...suivi.aller.depuis, lat: ici.lat, lon: ici.lon } } });
    }).catch(() => setLieu({ etat: "inconnu", aller: suivi.aller }));
  }, [suivi.heure, aujourdhui]);   // eslint-disable-line react-hooks/exhaustive-deps

  async function recalculerIci() {
    try {
      const ici = await positionActuelle();
      setLieu({ etat: "bouge", aller: { ...calculer(ici), depuis: { nom: t("ville.maposition"), lat: ici.lat, lon: ici.lon, position: true } } });
    } catch { setLieu((l) => ({ ...l, etat: "inconnu" })); }
  }

  const aller = lieu.aller;
  const dans = Math.round(aller.departMaison - maintenant);
  const gare = { lat: contexte.gare.lat, lon: contexte.gare.lon };
  const arret = aller.mode === "bus" ? contexte.reseau?.arrets[aller.arretDepart.id] : null;

  return (
    <section className="partir__itineraire">
      {/* Parti de « Ma position » : on parle de l'arrêt (s'il y a un bus), sinon simplement du même endroit */}
      {lieu.etat === "meme" && (
        <p className="partir__lieu partir__lieu--meme">📍 {aller.mode === "bus" ? t("partir.meme", { lieu: aller.arretDepart.nom }) : t("partir.meme.endroit")}</p>
      )}
      {lieu.etat === "bouge" && <p className="partir__lieu partir__lieu--bouge">📍 {t("partir.bouge")}</p>}
      {(lieu.etat === "adresse" || lieu.etat === "inconnu") && (
        <p className="partir__lieu">📍 {t("partir.depuis", { lieu: aller.depuis.nom })}
          <button type="button" onClick={recalculerIci}>{t("partir.ailleurs")}</button></p>
      )}
      <EtatDuTrain suivi={suivi} jour={jour} />
      <div className="partir__compte">
        {aujourdhui && dans >= 0 ? (<><p>{t("partir.dans")}</p><p className="partir__grand">{minutesEnTexte(dans, t)}</p></>)
          : aujourdhui ? <p className="partir__grand partir__grand--petit">{t("partir.maintenant")}</p> : null}
        <p><strong>{t("suivi.partez", { heure: minutesEnHeure(aller.departMaison) })}</strong></p>
      </div>
      <ol className="partir__etapes">
        {aller.mode === "bus" ? (<>
          <li><span>🚶</span><div><strong>{minutesEnHeure(aller.departMaison)} · {t("partir.marchez", { minutes: aller.marcheAvant })}</strong>
            <small>{t("partir.jusqua", { arret: aller.arretDepart.nom })}</small>
            {arret && <LienMarche vers={{ lat: arret[1], lon: arret[2] }} />}</div></li>
          <li><span>🚌</span><div><strong>{minutesEnHeure(aller.heureBus)} · {t(aller.ligne.mode === "metro" ? "ville.mode.metro" : aller.ligne.mode === "tram" ? "ville.mode.tram" : "ville.mode.bus")} {aller.ligne.nom}</strong>
            <small>{t("ville.direction", { direction: aller.direction })} · {t("ville.arrets", { nombre: aller.arrets })}</small></div></li>
          <li><span>🚉</span><div><strong>{minutesEnHeure(aller.arriveeGare)} · {suivi.de}</strong>
            <small>{t("partir.marge", { minutes: enMinutesDuJour(suivi.heure) - aller.arriveeGare })}</small>
            {aller.marcheApres > 0 && <LienMarche vers={gare} genre="gare" />}</div></li>
        </>) : (
          <li><span>🚶</span><div><strong>{minutesEnHeure(aller.departMaison)} · {t("partir.marchez", { minutes: aller.marche })}</strong>
            <small>{t("partir.jusqua.gare", { gare: suivi.de })}</small><LienMarche vers={gare} genre="gare" /></div></li>
        )}
        <li className="partir__train"><span>🚆</span><div><strong>{suivi.heure} · {suivi.de} → {suivi.a}</strong>
          <small>{t("partir.arrivee", { heure: suivi.arrivee })}{suivi.correspondance ? ` · ${t("partir.correspondance", { gare: suivi.correspondance })}` : ""}</small></div></li>
      </ol>
      <button type="button" className="partir__plustard" onClick={() => navigate(`${lienPartir(suivi)}&preparer=1`)}>
        {t("suivi.changer")}
      </button>
    </section>
  );
}

const minutesEnTexte = (m, t) => t("partir.duree", { minutes: m });

// ---------- L'état du train, en direct (aujourd'hui seulement) ----------
function EtatDuTrain({ suivi, jour }) {
  const { t } = useLangue();
  const { index } = useIndexHoraires();
  const aujourdhui = jour === aujourdhuiLocal();
  const tempsReel = useTempsReel(aujourdhui);
  const risques = useRisques();
  const [departs, setDeparts] = useState(null);
  const gare = useMemo(() => (index ? trouverGare(index.gares, suivi.de) : null), [index, suivi.de]);
  useEffect(() => {
    if (!gare || !jour) return undefined;
    let annule = false;
    fetch(`${DOSSIER}/${gare.slug}/${jour}.json`).then((r) => r.json())
      .then((d) => { if (!annule) setDeparts(d.departs || []); }).catch(() => { if (!annule) setDeparts([]); });
    return () => { annule = true; };
  }, [gare?.slug, jour]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!departs) return null;
  const etat = etatDuTrain(suivi, departs, aujourdhui ? tempsReel : null, risques);
  if (etat.statut === "supprime") {
    return (
      <div className="partir__alerte partir__alerte--supprime">
        <strong>🔴 {t("partir.supprime", { heure: suivi.heure })}</strong>
        <Link to={`/trajet?${new URLSearchParams({ de: suivi.de, a: suivi.a, jour, heure: suivi.heure })}`}>{t("partir.autres")}</Link>
      </div>
    );
  }
  if (etat.statut === "retard") {
    return <p className="partir__alerte partir__alerte--retard">🟠 <span><strong>{t("partir.retard", { heure: suivi.heure, minutes: etat.minutes })}</strong> {t("partir.prudence")}</span></p>;
  }
  if (etat.statut === "heure") return <p className="partir__alerte partir__alerte--heure">🟢 {t("partir.alheure", { heure: suivi.heure })}</p>;
  if (etat.statut === "absent") return <p className="partir__alerte">{t("montrain.absent")}</p>;
  return null;
}
