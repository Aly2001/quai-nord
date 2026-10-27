// « 🔔 Suivre ce train » (sur chaque carte de train), la feuille de choix, et « Mon prochain train » (accueil).
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLangue } from "../langue/langue";
import { useSuivis, idSuivi, prochainTrainSuivi, trainsSuivisPourLeServeur, prochaineOccasion, etapeDuVoyage } from "../data/suivi";
import { etatNotifications, activerNotifications, desactiverNotifications } from "../data/notifications";
import { minutesEnHeure } from "../data/trajetBus";
import { dateLongue } from "../data/horaires";
import "./Suivre.css";

const CLOCHE = <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"
  strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></svg>;
const estEnSemaine = (iso) => { const j = new Date(`${iso}T12:00:00`).getDay(); return j >= 1 && j <= 5; };
export const lienPartir = (suivi) => `/partir?${new URLSearchParams({ id: idSuivi(suivi) })}`;

export function BoutonSuivre({ trajet, jour }) {
  const { t } = useLangue();
  const navigate = useNavigate();
  const { estSuivi, suivre } = useSuivis();
  const [ouvert, setOuvert] = useState(false);
  const [repetition, setRepetition] = useState("une");
  const dejaSuivi = estSuivi(trajet.gareDepart, trajet.gareArrivee, trajet.heure);

  function activer() {
    const suivi = {
      de: trajet.gareDepart, a: trajet.gareArrivee, heure: trajet.heure, arrivee: trajet.arrivee,
      correspondance: trajet.correspondance ? trajet.correspondance.gare : null,
      repetition, jour: repetition === "semaine" ? null : jour,
    };
    suivre(suivi);
    setOuvert(false);
    // Les notifications : demandées dans le même geste (l'iPhone l'exige), seulement si c'est possible
    if (["a-demander", "autorise"].includes(etatNotifications())) activerNotifications(trainsSuivisPourLeServeur()).catch(() => {});
    navigate(`${lienPartir(suivi)}&preparer=1`);              // tout de suite : « Et pour aller à la gare ? »
  }

  return (
    <>
      <button type="button" className={dejaSuivi ? "suivre suivre--actif" : "suivre"} aria-pressed={dejaSuivi}
              onClick={() => (dejaSuivi ? navigate("/favoris") : setOuvert(true))}>
        {CLOCHE} {dejaSuivi ? t("suivi.actif") : t("suivi.bouton")}
      </button>
      {ouvert && (
        <div className="feuille-suivre" role="dialog" aria-modal="true" aria-label={t("suivi.titre")}>
          <button type="button" className="feuille-suivre__fond" aria-label={t("suivi.fermer")} onClick={() => setOuvert(false)} />
          <div className="feuille-suivre__contenu">
            <span className="feuille-suivre__poignee" aria-hidden="true" />
            <p className="feuille-suivre__titre">🔔 {t("suivi.titre")}</p>
            <p className="feuille-suivre__train">{trajet.heure} · {trajet.gareDepart} → {trajet.gareArrivee}</p>
            <div className="feuille-suivre__choix" role="radiogroup" aria-label={t("suivi.quand")}>
              <button type="button" role="radio" aria-checked={repetition === "une"} onClick={() => setRepetition("une")}
                      className={repetition === "une" ? "feuille-suivre__option feuille-suivre__option--actif" : "feuille-suivre__option"}>
                {t("suivi.une", { jour: dateLongue(jour) })}
              </button>
              <button type="button" role="radio" aria-checked={repetition === "semaine"} onClick={() => setRepetition("semaine")}
                      className={repetition === "semaine" ? "feuille-suivre__option feuille-suivre__option--actif" : "feuille-suivre__option"}>
                {t("suivi.semaine")}
              </button>
            </div>
            {repetition === "semaine" && !estEnSemaine(jour) && <p className="feuille-suivre__note">{t("suivi.semaine.note")}</p>}
            <ul className="feuille-suivre__liste">
              <li><strong>{t("suivi.a1")}</strong><small>{t("suivi.a1.detail")}</small></li>
              {trajet.correspondance && <li><strong>{t("suivi.a2")}</strong><small>{t("suivi.a2.detail", { gare: trajet.correspondance.gare })}</small></li>}
              <li><strong>{t("suivi.a3")}</strong><small>{t("suivi.a3.detail")}</small></li>
            </ul>
            {etatNotifications() === "installer" && <p className="feuille-suivre__note">{t("notif.installer")}</p>}
            <button type="button" className="feuille-suivre__activer" onClick={activer}>{t("suivi.activer")}</button>
            <p className="feuille-suivre__prive">{t("suivi.prive")}</p>
          </div>
        </div>
      )}
    </>
  );
}

// ---------- L'accueil : « Mon prochain train », avec l'heure à laquelle partir ----------
export function MonProchainTrain() {
  const { t } = useLangue();
  const { suivis } = useSuivis();
  const prochain = prochainTrainSuivi(suivis);
  if (!prochain) return null;
  const { suivi, jour } = prochain;
  const aujourdhui = jour === new Date().toLocaleDateString("sv-SE");
  const quand = aujourdhui ? t("jour.aujourdhui") : dateLongue(jour);
  const maintenant = new Date().getHours() * 60 + new Date().getMinutes();
  const aller = suivi.aller && (suivi.aller.mode === "bus" || (suivi.aller.mode === "pied" && suivi.aller.marche <= 45)) ? suivi.aller : null;
  const dans = aller && aujourdhui ? Math.round(aller.departMaison - maintenant) : null;
  return (
    <Link to={lienPartir(suivi)} className="prochain-train">
      <span className="prochain-train__haut">{t("suivi.prochain", { quand })}</span>
      <strong className="prochain-train__trajet">{suivi.heure} · {suivi.de} → {suivi.a}</strong>
      {etapeDuVoyage(suivi, jour).etape !== "avant" && etapeDuVoyage(suivi, jour).etape !== "autrejour" ? (
        <LigneEtape suivi={suivi} jour={jour} classe="prochain-train__etape" />
      ) : aller ? (
        <span className="prochain-train__partir">
          <span aria-hidden="true">🏠</span>
          <span><strong>{t("suivi.partez", { heure: minutesEnHeure(aller.departMaison) })}</strong>
            <small>{aller.mode === "bus" ? t("suivi.bus", { ligne: aller.ligne.nom, heure: minutesEnHeure(aller.heureBus), arret: aller.arretDepart.nom })
              : t("suivi.pied", { minutes: aller.marche })}</small></span>
          {dans !== null && dans >= 0 && <span className="prochain-train__dans">{t("ville.dans", { minutes: dans })} ›</span>}
        </span>
      ) : <span className="prochain-train__preparer">{t("suivi.preparer")} ›</span>}
    </Link>
  );
}

// ---------- Favoris : « Mes trains suivis » ----------
export function ListeSuivis() {
  const { t } = useLangue();
  const { suivis, nePlusSuivre, toutArreter } = useSuivis();
  if (!suivis.length) return <p className="favoris__vide">{t("suivi.vide")}</p>;
  return (
    <>
      <EtatNotifications />
      <ul className="favoris__liste">
        {suivis.map((s) => (
          <li key={idSuivi(s)} className="favori-train">
            <Link className="favori-train__lien" to={lienPartir(s)}>
              <strong>{s.heure} · {s.de} → {s.a}</strong>
              <span className="etat-train etat-train--absent">{s.repetition === "semaine" ? t("suivi.semaine.court") : dateLongue(s.jour)}</span>
            </Link>
            <LigneEtape suivi={s} />
            <div className="favori-train__actions">
              <Link className="favori-train__surveiller" to={`${lienPartir(s)}&preparer=1`}>{s.aller ? t("suivi.changer") : t("suivi.preparer")}</Link>
              <button type="button" className="favoris__retirer" onClick={() => nePlusSuivre(s)}>{t("suivi.arreter")}</button>
            </div>
          </li>
        ))}
      </ul>
      <button type="button" className="suivi__tout-arreter" onClick={() => { toutArreter(); desactiverNotifications(); }}>{t("suivi.tout")}</button>
    </>
  );
}

// ---------- L'état des notifications, dans Mes trains suivis ----------
function EtatNotifications() {
  const { t } = useLangue();
  const [etat, setEtat] = useState(etatNotifications);
  const [erreur, setErreur] = useState(false);
  async function activer() {
    setErreur(false);
    try { await activerNotifications(trainsSuivisPourLeServeur()); } catch { setErreur(true); }
    setEtat(etatNotifications());
  }
  if (etat === "autorise") {
    return (
      <p className="notif notif--oui">🔔 {t("notif.actives")}
        <button type="button" onClick={async () => { await desactiverNotifications(); setEtat("a-demander"); }}>{t("notif.couper")}</button></p>
    );
  }
  if (etat === "installer") return <p className="notif">📲 {t("notif.installer")}</p>;
  if (etat === "refuse") return <p className="notif">🔕 {t("notif.refusees")}</p>;
  if (etat === "impossible") return null;
  return (
    <p className="notif">🔔 {t("notif.proposer")}
      <button type="button" onClick={activer}>{t("notif.activer")}</button>
      {erreur && <small>{t("notif.erreur")}</small>}</p>
  );
}

// ---------- Ce qui compte MAINTENANT pour ce voyage, en une ligne ----------
export function LigneEtape({ suivi, jour = prochaineOccasion(suivi), classe = "suivi__aller" }) {
  const { t } = useLangue();
  const { etape, minutes } = etapeDuVoyage(suivi, jour);
  const aller = suivi.aller && (suivi.aller.mode === "bus" || (suivi.aller.mode === "pied" && suivi.aller.marche <= 45)) ? suivi.aller : null;
  if (etape === "arrive") return <small className={`${classe} etape--fini`}>✅ {t("etape.arrive", { gare: suivi.a, heure: suivi.arrivee })}</small>;
  if (etape === "enroute") return <small className={`${classe} etape--route`}>🚆 {t("etape.enroute", { gare: suivi.a, heure: suivi.arrivee })}</small>;
  if (etape === "presse") return <small className={`${classe} etape--presse`}>⏱️ {t("partir.trainpart", { minutes })}</small>;
  if (aller) return <small className={classe}>🏠 {t("suivi.partez", { heure: minutesEnHeure(aller.departMaison) })}</small>;
  return null;
}
