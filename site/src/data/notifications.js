// =====================================================================
//  Les NOTIFICATIONS des trains suivis (notifications web : sans compte, ni numéro, ni e-mail)
//   1. le téléphone demande l'autorisation ;
//   2. le navigateur crée une « adresse d'envoi » anonyme, propre à ce téléphone et à Quai Nord ;
//   3. on l'envoie au serveur avec les trains suivis (et, pour le rappel, l'heure de départ de chez soi
//      et le nom de l'arrêt : jamais la position).
//  Sur iPhone, il faut que Quai Nord soit INSTALLÉ sur l'écran d'accueil (iOS 16.4 ou plus récent).
// =====================================================================
import { minutesEnHeure } from "./trajetBus";

const CLE_LANGUE = "quai-nord:langue";

export function etatNotifications() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    const iphone = typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent || "");
    const installee = typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone);
    return iphone && !installee ? "installer" : "impossible";
  }
  if (Notification.permission === "denied") return "refuse";
  return Notification.permission === "granted" ? "autorise" : "a-demander";
}

// La clé publique du serveur, au format attendu par le navigateur (base64url -> octets)
function versOctets(base64url) {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

// Ce que le serveur reçoit pour chaque train : le strict nécessaire
export function trainsPourLeServeur(suivis, idSuivi) {
  return suivis.map((s) => ({
    de: s.de, a: s.a, heure: s.heure, arrivee: s.arrivee, repetition: s.repetition, jour: s.jour || null,
    // Le rappel seulement pour un vrai itinéraire (un bus, ou moins de 45 min à pied : jamais « marchez 27 h »)
    rappel: s.aller && (s.aller.mode === "bus" || (s.aller.mode === "pied" && s.aller.marche <= 45)) ? {
      minute: Math.round(s.aller.departMaison),
      texte: s.aller.mode === "bus" ? `${s.aller.ligne.nom} · ${minutesEnHeure(s.aller.heureBus)} · ${s.aller.arretDepart.nom}` : `🚶 ${s.aller.marche} min`,
    } : null,
    url: `/partir?${new URLSearchParams({ id: idSuivi(s) })}`,
  }));
}

async function envoyer(abonnement, trains) {
  let langue = "fr";
  try { langue = localStorage.getItem(CLE_LANGUE) === "en" ? "en" : "fr"; } catch { /* rien */ }
  const reponse = await fetch("/api/alertes/abonnement", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ abonnement: abonnement.toJSON(), langue, trains }),
  });
  if (!reponse.ok) throw new Error(`serveur ${reponse.status}`);
}

// Activer : à appeler DIRECTEMENT dans le geste du voyageur (le toucher d'un bouton), sinon l'iPhone refuse
export async function activerNotifications(trains) {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;
  const inscription = await navigator.serviceWorker.ready;
  let abonnement = await inscription.pushManager.getSubscription();
  if (!abonnement) {
    const { cle } = await (await fetch("/api/alertes/cle")).json();
    abonnement = await inscription.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: versOctets(cle) });
  }
  await envoyer(abonnement, trains);
  return true;
}

// Après chaque changement des trains suivis : le serveur est tenu à jour (si les notifications sont actives)
export async function synchroniserNotifications(trains) {
  if (etatNotifications() !== "autorise") return;
  try {
    const abonnement = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    if (abonnement) await envoyer(abonnement, trains);
  } catch { /* hors connexion : ce sera fait la prochaine fois */ }
}

export async function desactiverNotifications() {
  try {
    const abonnement = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    if (!abonnement) return;
    await fetch("/api/alertes/desabonnement", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: abonnement.endpoint }) });
    await abonnement.unsubscribe();
  } catch { /* rien */ }
}
