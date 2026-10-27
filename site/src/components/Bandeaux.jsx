// Les deux bandeaux d'une « vraie application » :
//  - « Nouvelle version disponible · Mettre à jour » (quand le service worker en a une en attente) ;
//  - « Hors connexion » (quand le téléphone n'a plus de réseau : horaires enregistrés, pas de direct ni de Nora).
import { useEffect, useState } from "react";
import { useLangue } from "../langue/langue";
import "./Bandeaux.css";

export function BandeauMiseAJour() {
  const { t } = useLangue();
  const [attente, setAttente] = useState(null);             // le service worker de la nouvelle version
  useEffect(() => {
    const surNouvelle = (e) => setAttente(e.detail);
    window.addEventListener("quai-nord:nouvelle-version", surNouvelle);
    return () => window.removeEventListener("quai-nord:nouvelle-version", surNouvelle);
  }, []);
  if (!attente) return null;
  return (
    <div className="bandeau-maj" role="status">
      <span aria-hidden="true">✨</span>
      <span className="bandeau-maj__texte"><strong>{t("pwa.maj.titre")}</strong><small>{t("pwa.maj.texte")}</small></span>
      {/* Le service worker se met à jour, puis la page se recharge (voir main.jsx) */}
      <button type="button" onClick={() => attente.postMessage({ type: "METTRE_A_JOUR" })}>{t("pwa.maj.bouton")}</button>
    </div>
  );
}

export function BandeauHorsConnexion() {
  const { t } = useLangue();
  const [enLigne, setEnLigne] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const oui = () => setEnLigne(true);
    const non = () => setEnLigne(false);
    window.addEventListener("online", oui);
    window.addEventListener("offline", non);
    return () => { window.removeEventListener("online", oui); window.removeEventListener("offline", non); };
  }, []);
  if (enLigne) return null;
  return (
    <div className="bandeau-hors-ligne" role="status">
      <span aria-hidden="true">📴</span>
      <span><strong>{t("pwa.horsligne")}</strong> · {t("pwa.horsligne.texte")}</span>
    </div>
  );
}

// ---------- Partager : la feuille de partage du téléphone, sinon le lien copié ----------
export function BoutonPartager({ titre, chemin, classe = "etoile-train" }) {
  const { t } = useLangue();
  const [copie, setCopie] = useState(false);
  async function partager() {
    const url = new URL(chemin, window.location.origin).toString();
    if (navigator.share) {
      try { await navigator.share({ title: titre, text: titre, url }); } catch { /* le voyageur a fermé la feuille */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopie(true);
      setTimeout(() => setCopie(false), 2000);
    } catch { /* presse-papiers indisponible */ }
  }
  return (
    <button type="button" className={classe} onClick={partager} aria-label={copie ? t("pwa.copie") : t("pwa.partager")}
            title={copie ? t("pwa.copie") : t("pwa.partager")}>
      {copie ? <span aria-hidden="true">✓</span> : (
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"
             strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v13M7 8l5-5 5 5" /><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /></svg>
      )}
    </button>
  );
}
