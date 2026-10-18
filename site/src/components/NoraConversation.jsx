import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  DOSSIER, useIndexHoraires, useRisques, normaliser, joursAVenir, aujourdhuiIso, heureActuelle,
  trajetsDirects, formatDuree, risqueDuTrain, niveauRisque,
} from "../data/horaires";
import { SNCF_CONNECT } from "../data/faq";
import {
  chargerReseau, reseauDeVille, infosReseau, chercherLieu, busDepuisGare, busVersGare, lienCarte, minutesAPied,
  distance, plusRapideQueAPied, garesCorrespondantes, libelleGare, SITES_RESEAUX, etapesSiteOfficiel, decrireLigne,
  RESEAUX,
} from "../data/bus";
import { useTailleNora } from "./TailleNora";
import { reponseLocale } from "../data/reponsesNora";
import "./Nora.css";

// Pour la lecture à voix haute : sans émojis (certains téléphones lisent « visage souriant », « train »…)
export function sansEmojis(texte) {
  return String(texte || "").replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "").replace(/[ \t]{2,}/g, " ").trim();
}

// Le pictogramme du type de transport, dans la pastille de la ligne (affiché sur téléphone, voir Nora.css)
const DESSINS_MODES = {
  metro: <><rect x="5" y="3" width="14" height="15" rx="4" /><path d="M5 11h14M9 21l-2-3M15 21l2-3" /><circle cx="9" cy="14.5" r="0.8" /><circle cx="15" cy="14.5" r="0.8" /></>,
  tram: <><path d="M9 2h6M12 2v4" /><rect x="5" y="6" width="14" height="12" rx="3" /><path d="M5 12h14M8 21l1.5-3M16 21l-1.5-3" /></>,
  bus: <><rect x="4" y="3" width="16" height="15" rx="3" /><path d="M4 11h16M7 21v-3M17 21v-3" /><circle cx="8" cy="14.5" r="0.8" /><circle cx="16" cy="14.5" r="0.8" /></>,
};

function PastilleLigne({ ligne }) {
  const { mode, nom } = decrireLigne(ligne);
  return (
    <span className="ligne-bus" style={{ background: ligne.couleur, color: ligne.texte }}>
      <svg className="ligne-bus__icone" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none"
           stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{DESSINS_MODES[mode]}</svg>
      {nom}
    </span>
  );
}

// L'avatar de Nora : une bulle de discussion (volontairement pas un visage humain)
// L'avatar de Nora : la mascotte, sur téléphone et sur ordinateur (la bulle dessinée reste en secours
// si l'image manque, voir Nora.css). Aux petites tailles, l'icône ronde ; en grand, l'expression qui convient :
// souriant (par défaut), reflechit (réponse en cours), recherche (trajet), ecoute (dictée, pause).
const MASCOTTES = new Set(["ronde", "souriant", "reflechit", "recherche", "ecoute", "principal"]);

export function AvatarNora({ taille = 40, expression = null }) {
  const image = MASCOTTES.has(expression) ? expression : taille <= 48 ? "ronde" : "souriant";
  return (
    <span className="nora-avatar-bloc" style={{ width: taille, height: taille }}>
      <svg viewBox="0 0 40 40" width={taille} height={taille} aria-hidden="true" className="nora-avatar">
        <circle cx="20" cy="20" r="20" fill="#F2C230" />
        <path d="M11 14h18a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-9l-6 5v-5h-3a3 3 0 0 1-3-3v-8a3 3 0 0 1 3-3z" fill="#14213D" />
        <circle cx="15" cy="21" r="1.8" fill="#F2C230" /><circle cx="20" cy="21" r="1.8" fill="#F2C230" />
        <circle cx="25" cy="21" r="1.8" fill="#F2C230" />
      </svg>
      <img src={`/nora/nora-${image}.webp`} alt="" width={taille} height={taille} decoding="async"
           className="nora-mascotte"
           // Si l'image manque, on garde simplement la bulle dessinée
           onError={(e) => { e.currentTarget.closest(".nora-avatar-bloc")?.classList.add("nora-avatar-bloc--sans-image"); }} />
    </span>
  );
}

const SUGGESTIONS = [
  "Comment est calculé le risque ?",
  "Pourquoi je ne vois pas mon train ?",
  "Comment réserver un billet ?",
];
// Sur téléphone, l'accueil propose des EXEMPLES : les toucher remplit la saisie sans rien envoyer,
// le voyageur adapte la gare ou la destination, puis envoie une seule question complète (quota Gemini)
const EXEMPLES = [
  { texte: "Je suis à la gare de Lille Flandres, je vais à l'université", parties: ["Lille Flandres", "l'université"] },
  { texte: "Je suis au centre-ville d'Arras, comment rejoindre la gare ?", parties: ["centre-ville d'Arras"] },
  { texte: "Pourquoi mon train de 9 h 10 a-t-il un risque élevé ?", parties: ["9 h 10"] },
];
// Les villes couvertes, celles qui ont aussi métro et tram en premier (Lille)
const VILLES_BUS = [...RESEAUX].sort((a, b) => b.modes.length - a.modes.length)
  .map((r) => ({ ville: r.ville.replace(/-sur-Mer$/, ""), metro: r.modes.length > 1 }));
const SUGGESTIONS_TRAIN = ["Pourquoi ce risque ?", "Ce train sera-t-il à l'heure ?", "Comment réserver un billet ?"];
const NUMERO_JOUR = { "aujourd'hui": 0, demain: 1, "après-demain": 2 };

// La reconnaissance vocale du navigateur, si elle existe (sinon : pas de bouton micro)
const Reconnaissance = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
const peutLire = typeof window !== "undefined" && "speechSynthesis" in window;

let compteur = 0;
const nouvelId = () => ++compteur;

// =====================================================================
//  contexte : le train que la personne regarde (texte envoyé à Nora), ou null
// =====================================================================
// accueil : la phrase de Nora à l'ouverture (sinon, la présentation habituelle)
// suggestions : [{ texte, question }] propres au contexte (un train, une gare)
// questionInitiale : une question envoyée tout de suite (un appui sur « Pourquoi 7 % ? »)
export default function NoraConversation({ contexte = null, accueil = null, suggestions: proposees = null, questionInitiale = null }) {
  const { index } = useIndexHoraires();
  const risques = useRisques();
  const [messages, setMessages] = useState([]);
  const [saisie, setSaisie] = useState("");
  const taille = useTailleNora();                              // normale, grande ou très grande
  const [enAttente, setEnAttente] = useState(false);
  const [phase, setPhase] = useState("reflechit");            // ce que fait Nora pendant l'attente
  const [limiteAtteinte, setLimiteAtteinte] = useState(null);   // null, ou { code, message, reprise, limite }
  const [exemple, setExemple] = useState(null);                 // l'exemple touché, tant qu'on le modifie
  const champ = useRef(null);
  const [restantes, setRestantes] = useState(null);
  const [dictee, setDictee] = useState(null);          // null, ou { texte } pendant l'écoute
  const reconnaissance = useRef(null);
  const fin = useRef(null);

  // La zone de saisie grandit avec le texte (4 lignes au plus), comme dans une messagerie
  useEffect(() => {
    const zone = champ.current;
    if (!zone) return;
    zone.style.height = "auto";
    zone.style.height = `${Math.min(zone.scrollHeight, 120)}px`;
  }, [saisie]);

  // À chaque nouveau message, on fait défiler jusqu'en bas
  useEffect(() => { fin.current?.scrollIntoView({ block: "end" }); }, [messages, enAttente]);

  // Une question choisie avant l'ouverture (sous un train) : on l'envoie tout de suite, une seule fois
  const dejaEnvoyee = useRef(false);
  useEffect(() => {
    if (questionInitiale && !dejaEnvoyee.current) {
      dejaEnvoyee.current = true;
      envoyer(questionInitiale);
    }
  }, [questionInitiale]);   // eslint-disable-line react-hooks/exhaustive-deps

  const ajouter = (message) => setMessages((liste) => [...liste, { id: nouvelId(), ...message }]);

  // ---------- Parler à Nora (serveur /api/nora) ----------
  async function envoyer(texte) {
    const question = texte.trim();
    if (!question || enAttente || limiteAtteinte) return;
    setSaisie("");
    setExemple(null);
    setPhase("reflechit");
    const historique = [...messages, { auteur: "vous", texte: question }]
      .filter((m) => m.texte)
      .slice(-8)
      .map((m) => ({ role: m.auteur === "vous" ? "user" : "assistant", content: m.texte.slice(0, 600) }));
    ajouter({ auteur: "vous", texte: question });
    // La présentation, le bonjour, le merci : le site répond lui-même, sans Gemini (aucune question comptée)
    const locale = reponseLocale(question);
    if (locale) {
      ajouter({ auteur: "nora", texte: locale });
      return;
    }
    setEnAttente(true);
    try {
      const reponse = await fetch("/api/nora", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: historique, contexte }),
      });
      if (reponse.status === 429) {
        // « limite_visiteur » ou « plafond_site » : le serveur dit lequel, et quand les questions reviennent
        const detail = (await reponse.json().catch(() => null))?.detail;
        setLimiteAtteinte(typeof detail === "object" && detail ? detail : { code: "limite_visiteur" });
        return;
      }
      if (!reponse.ok) throw new Error(String(reponse.status));
      const donnees = await reponse.json();
      setRestantes(donnees.questions_restantes);
      if (donnees.action) setPhase("recherche");             // Nora cherche maintenant un trajet ou un bus
      if (donnees.action?.type === "rechercher_trajet") {
        await rechercher(donnees.action);
      } else if (donnees.action?.type === "itineraire_bus") {
        await itineraireBus(donnees.action);
      } else {
        ajouter({ auteur: "nora", texte: donnees.reponse, sources: donnees.sources, lienSncf: donnees.lien_sncf });
      }
    } catch {
      ajouter({ auteur: "nora", erreur: question });
    } finally {
      setEnAttente(false);
    }
  }

  // ---------- La recherche de trajet : Nora a compris, l'APPLICATION cherche ----------
  async function rechercher(action, gareChoisie = null) {
    if (!index) {
      ajouter({ auteur: "nora", texte: "Les horaires ne sont pas encore chargés. Réessayez dans un instant." });
      return;
    }
    const jour = joursAVenir(index.jours)[NUMERO_JOUR[action.jour] ?? 0];
    if (!jour) {
      ajouter({ auteur: "nora", texte: "Je ne peux chercher que pour aujourd'hui, demain ou après-demain." });
      return;
    }

    // Retrouver la vraie gare de départ, et demander de choisir s'il y en a plusieurs
    let gare = gareChoisie;
    if (!gare) {
      const cherche = normaliser(action.de);
      const candidates = index.gares.filter((g) => normaliser(g.nom).includes(cherche));
      const exacte = candidates.find((g) => normaliser(g.nom) === cherche);
      if (exacte || candidates.length === 1) {
        gare = exacte || candidates[0];
      } else if (candidates.length === 0) {
        ajouter({ auteur: "nora", texte: `Je ne trouve pas de gare de départ « ${action.de} ». Quai Nord couvre les gares des Hauts-de-France et Paris Gare du Nord.` });
        return;
      } else {
        ajouter({
          auteur: "nora",
          texte: `Il y a plusieurs gares pour « ${action.de} ». De laquelle partez-vous ?`,
          choix: { gares: candidates.slice(0, 5), action },
        });
        return;
      }
    }

    // Chercher les vrais trains dans les horaires
    const debut = jour === aujourdhuiIso() && heureActuelle() > action.heure ? heureActuelle() : action.heure;
    let departs = [];
    try {
      const reponse = await fetch(`${DOSSIER}/${gare.slug}/${jour}.json`);
      departs = (await reponse.json()).departs.filter((t) => t.heure >= debut);
    } catch {
      ajouter({ auteur: "nora", erreur: null, texte: "Je n'arrive pas à lire les horaires pour le moment." });
      return;
    }
    const trains = trajetsDirects(departs, gare.nom, normaliser(action.a)).slice(0, 3);
    const lienTous = `/trajet?${new URLSearchParams({ de: gare.nom, a: action.a, jour, heure: debut })}`;
    if (trains.length === 0) {
      ajouter({
        auteur: "nora",
        texte: `Je n'ai pas trouvé de train direct de ${gare.nom} vers ${action.a} après ${debut}. La page des résultats cherche aussi les trajets avec correspondance.`,
        lienTous,
      });
      return;
    }
    ajouter({
      auteur: "nora",
      texte: `Voici les prochains trains de ${gare.nom} vers ${trains[0].gareArrivee}, à partir de ${debut} :`,
      trains,
      lienTous,
    });
  }

  // ---------- Les bus entre la gare et une destination : Nora a compris, l'APPLICATION cherche ----------
  async function itineraireBus(action, nomGare = null, lieuChoisi = null) {
    // Le réseau : donné par le serveur (vérifié), sinon retrouvé d'après la ville. Chargé seulement maintenant.
    const code = action.reseau || reseauDeVille(action.ville);
    const reseau = code ? await chargerReseau(code) : null;
    if (!reseau) {
      ajouter({ auteur: "nora", texte: "Les données des transports ne sont pas disponibles pour le moment. Réessayez plus tard." });
      return;
    }

    // 1. La gare : précisée, déduite, ou à choisir. Deuxième protection : elle doit être couverte.
    let gare = nomGare;
    // « la gare de Boulogne » peut désigner plusieurs gares : on ne choisit jamais à la place du voyageur.
    // Et si le nom n'est pas reconnu, on ne refuse pas : la ville est la bonne (le serveur l'a vérifiée),
    // on propose donc toutes ses gares.
    let candidates = action.gare ? garesCorrespondantes(reseau, action.gare) : [];
    if (candidates.length === 0) candidates = Object.keys(reseau.gares);
    if (!gare) {
      const gares = candidates;
      if (gares.length !== 1) {
        ajouter({
          auteur: "nora",
          texte: action.sens === "vers_gare" ? "Quelle gare voulez-vous rejoindre ?" : "De quelle gare partez-vous ?",
          choixBus: { type: "gare", options: gares.map((nom) => ({ cle: nom, texte: libelleGare(nom) })), action },
        });
        return;
      }
      gare = gares[0];
    }
    const couverte = { code, reseau, nom: gare, gare: reseau.gares[gare] };
    const ville = infosReseau(code).ville;
    const nomAffiche = libelleGare(gare);              // le nom courant, pour les phrases ; « gare » reste le vrai nom

    // 2. Le lieu : retrouvé, ou à choisir s'il y en a plusieurs bien distincts
    let lieu = lieuChoisi;
    if (!lieu) {
      const lieux = await chercherLieu(action.lieu, couverte.gare, ville, reseau);
      if (lieux.length === 0) {
        const lieuTexte = `${action.lieu}, ${ville}`;
        const garePhrase = `Gare de ${nomAffiche}`;
        ajouter({
          auteur: "nora",
          texte: `Je ne trouve pas « ${action.lieu} » dans mes données. Vous pouvez préciser l'adresse, ou chercher directement sur le site officiel du réseau :`,
          etapes: action.sens === "vers_gare"
            ? etapesSiteOfficiel(code, lieuTexte, garePhrase)
            : etapesSiteOfficiel(code, garePhrase, lieuTexte),
          site: SITES_RESEAUX[code],
        });
        return;
      }
      const distincts = lieux.filter((l, i) => lieux.slice(0, i).every((a) => distance(a.lat, a.lon, l.lat, l.lon) > 300));
      if (distincts.length > 1) {
        ajouter({
          auteur: "nora",
          texte: `Plusieurs lieux correspondent à « ${action.lieu} ». Lequel ?`,
          choixBus: {
            type: "lieu",
            options: distincts.slice(0, 3).map((l) => ({ cle: l, texte: `${l.nom} · ${(l.distance / 1000).toFixed(1).replace(".", ",")} km` })),
            action, gare,
          },
        });
        return;
      }
      lieu = distincts[0];
    }

    // 3. Les bus directs, dans le bon sens
    const depuis = action.sens !== "vers_gare";
    const pointGare = { lat: couverte.gare.lat, lon: couverte.gare.lon };
    const metres = Math.round(distance(pointGare.lat, pointGare.lon, lieu.lat, lieu.lon) / 50) * 50;
    // Seulement les bus plus rapides que d'y aller directement à pied
    const bus = plusRapideQueAPied(depuis ? busDepuisGare(couverte, lieu) : busVersGare(couverte, lieu), metres);
    const carte = depuis ? lienCarte(pointGare, lieu) : lienCarte(lieu, pointGare);
    const source = `Lignes : ${reseau.reseau} · Lieux : © les contributeurs d'OpenStreetMap`;
    const kilometres = (metres / 1000).toFixed(1).replace(".", ",");
    if (bus.length === 0 && metres <= 1200) {
      ajouter({
        auteur: "nora",
        texte: `${depuis ? lieu.nom : `La gare de ${nomAffiche}`} est tout près : ${metres} m, environ ${minutesAPied(metres)} minutes à pied. `
          + "Le plus rapide est d'y aller à pied.",
        carte, sourceBus: source,
      });
      return;
    }
    if (bus.length === 0) {
      const lieuTexte = lieu.detail ? `${lieu.nom}, ${ville}` : lieu.nom;
      const garePhrase = `Gare de ${nomAffiche}`;
      ajouter({
        auteur: "nora",
        texte: `Aucun ${infosReseau(code).modes.length > 1 ? "bus, tram ou métro" : "bus"} ne relie directement la gare de ${nomAffiche} et ${lieu.nom} (${kilometres} km, `
          + `environ ${minutesAPied(metres)} minutes à pied). Pour un trajet avec changement, le plus simple :`,
        etapes: depuis ? etapesSiteOfficiel(code, garePhrase, lieuTexte) : etapesSiteOfficiel(code, lieuTexte, garePhrase),
        site: SITES_RESEAUX[code],
        carte, sourceBus: source,
      });
      return;
    }
    // Quand la marche reste raisonnable, Nora la cite aussi : le voyageur choisit en connaissant les deux
    const modeMeilleur = decrireLigne(bus[0].ligne).mode;
    const enTransport = { bus: "En bus", tram: "En tram", metro: "En métro" }[modeMeilleur];
    ajouter({
      auteur: "nora",
      texte: metres <= 1500
        ? `À pied, comptez environ ${minutesAPied(metres)} min (${metres} m). ${enTransport}, c'est plus rapide :`
        : depuis
          ? `Voici comment rejoindre ${lieu.nom} depuis la gare de ${nomAffiche}, à ${kilometres} km :`
          : `Voici comment rejoindre la gare de ${nomAffiche} depuis ${lieu.nom}, à ${kilometres} km :`,
      bus, carte, sourceBus: source,
    });
  }

  function choisirBus(message, option) {
    setMessages((liste) => liste.map((m) => (m.id === message.id ? { ...m, choixBus: null } : m)));
    const { type, action, gare } = message.choixBus;
    if (type === "gare") {
      ajouter({ auteur: "vous", texte: option.texte });
      itineraireBus(action, option.cle);
    } else {
      ajouter({ auteur: "vous", texte: option.cle.nom });
      itineraireBus(action, gare, option.cle);
    }
  }

  function choisirGare(message, gare) {
    // On retire les boutons de choix, et on rappelle le choix dans la conversation
    setMessages((liste) => liste.map((m) => (m.id === message.id ? { ...m, choix: null } : m)));
    ajouter({ auteur: "vous", texte: gare.nom });
    rechercher(message.choix.action, gare);
  }

  // ---------- La voix ----------
  function ecouter() {
    if (!Reconnaissance) return;
    const reco = new Reconnaissance();
    reco.lang = "fr-FR";
    reco.interimResults = true;
    reco.onresult = (evenement) => {
      const texte = Array.from(evenement.results).map((r) => r[0].transcript).join("");
      setDictee({ texte });
    };
    reco.onerror = () => setDictee(null);
    reconnaissance.current = reco;
    setDictee({ texte: "" });
    reco.start();
  }

  function arreterDictee(envoi) {
    const texte = dictee?.texte || "";
    reconnaissance.current?.abort();
    setDictee(null);
    if (envoi && texte.trim()) envoyer(texte);
  }

  // Toucher un exemple : la phrase va dans la saisie, et la première partie à adapter est sélectionnée
  // (taper la remplace aussitôt). Rien n'est envoyé à Nora.
  function choisirExemple(e) {
    setSaisie(e.texte);
    setExemple(e);
    requestAnimationFrame(() => {
      const zone = champ.current;
      if (!zone) return;
      zone.focus();
      const debut = e.texte.indexOf(e.parties[0]);
      zone.setSelectionRange(debut, debut + e.parties[0].length);
    });
  }

  function lire(texte) {
    window.speechSynthesis.cancel();
    const phrase = new SpeechSynthesisUtterance(sansEmojis(texte));
    phrase.lang = "fr-FR";
    window.speechSynthesis.speak(phrase);
  }

  const suggestions = proposees?.length
    ? proposees
    : (contexte ? SUGGESTIONS_TRAIN : SUGGESTIONS).map((texte) => ({ texte, question: texte }));

  return (
    <div className={`nora-conversation nora-conversation--${taille}`}>
      <div className="nora-fil" aria-live="polite">
        {messages.length === 0 && !questionInitiale && (
          <div className={accueil ? "nora-accueil nora-accueil--contexte" : "nora-accueil"}>
            {!accueil && (
              // Téléphone : la bulle d'accueil, des exemples à compléter, les villes couvertes (voir Nora.css)
              <div className="nora-exemples">
                <div className="bulle bulle--nora nora-exemples__bulle">
                  <p className="nora-exemples__bonjour">Bonjour ! <span aria-hidden="true">👋</span></p>
                  <p>Dites-moi où vous allez après le train, ou posez-moi une question sur un risque de retard.</p>
                </div>
                <p className="nora-exemples__titre">Par exemple, touchez pour compléter :</p>
                {EXEMPLES.map((e) => (
                  <button key={e.texte} type="button" onClick={() => choisirExemple(e)}
                          className={exemple === e ? "nora-exemple nora-exemple--choisi" : "nora-exemple"}>
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor"
                         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                    <span>« {e.texte} »</span>
                  </button>
                ))}
                <p className="nora-exemples__villes">
                  Bus depuis les gares de {VILLES_BUS.map((v, i) => (
                    <span key={v.ville}>
                      {i > 0 && (i === VILLES_BUS.length - 1 ? " et " : ", ")}
                      <strong>{v.ville}</strong>{v.metro && " (aussi métro et tram)"}
                    </span>
                  ))}.
                </p>
              </div>
            )}
            {accueil ? (
              <p className="bulle bulle--nora nora-accueil__bulle">{accueil}</p>
            ) : (
              <>
                <AvatarNora taille={76} />
                <p className="nora-accueil__titre">Bonjour, je suis Nora</p>
                <p className="nora-accueil__signature">Je suis là pour votre trajet.</p>
                <p className="nora-accueil__texte">
                  Posez-moi une question sur Quai Nord, un train ou un risque de retard. Vous pouvez aussi me dire
                  d'où vous partez et où vous allez.
                </p>
              </>
            )}
            <div className={accueil ? "nora-suggestions" : "nora-suggestions nora-suggestions--ordinateur"}>
              {suggestions.map((s) => (
                <button key={s.texte} type="button" className="nora-suggestion" onClick={() => envoyer(s.question)}>
                  {s.texte}
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor"
                       strokeWidth="2" strokeLinecap="round"><path d="M9 6l6 6-6 6" /></svg>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (m.auteur === "vous" ? (
          <p key={m.id} className="bulle bulle--vous">{m.texte}</p>
        ) : m.erreur !== undefined && !m.texte ? (
          <div key={m.id} className="nora-alerte" role="alert">
            <p><strong>Nora ne répond pas pour le moment.</strong> Vérifiez votre connexion, puis réessayez.</p>
            {m.erreur && (
              <button type="button" className="nora-bouton" onClick={() => {
                setMessages((liste) => liste.filter((x) => x.id !== m.id));
                envoyer(m.erreur);
              }}>Réessayer</button>
            )}
          </div>
        ) : (
          <div key={m.id} className="bulle bulle--nora">
            <div className="bulle__haut">
              <p className="bulle__texte">{m.texte}</p>
              {peutLire && m.texte && (
                <button type="button" className="bulle__ecouter" aria-label="Écouter la réponse" onClick={() => lire(m.texte)}>
                  <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor"
                       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 9v6h4l5 4V5L8 9z" /><path d="M16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12" />
                  </svg>
                  <span aria-hidden="true">Écouter</span>
                </button>
              )}
            </div>

            {m.choix && (
              <div className="nora-choix">
                {m.choix.gares.map((g) => (
                  <button key={g.slug} type="button" className="nora-choix__bouton" onClick={() => choisirGare(m, g)}>
                    {g.nom}
                  </button>
                ))}
              </div>
            )}

            {m.choixBus && (
              <div className="nora-choix">
                {m.choixBus.options.map((o) => (
                  <button key={o.texte} type="button" className="nora-choix__bouton" onClick={() => choisirBus(m, o)}>
                    {o.texte}
                  </button>
                ))}
              </div>
            )}

            {m.bus?.length > 0 && (() => {
              const [meilleur, ...autres] = m.bus;
              return (
                <>
                  {/* La meilleure option, mise en avant, avec les étapes */}
                  <article className="bus-meilleur">
                    <div className="bus-meilleur__haut">
                      <span className="mini-bus__haut">
                        <PastilleLigne ligne={meilleur.ligne} />
                        <span className="bus-meilleur__trajet">{meilleur.depart.nom} → {meilleur.arrivee.nom}</span>
                      </span>
                      <span className="bus-meilleur__badge">
                        Le plus rapide{meilleur.minutesBus !== null ? ` · ${meilleur.minutesTotal} min` : ""}
                      </span>
                    </div>
                    <ol className="bus-meilleur__etapes">
                      <li>Marchez <strong>{minutesAPied(meilleur.depart.marche)} min</strong> jusqu'à {decrireLigne(meilleur.ligne).station} <strong>{meilleur.depart.nom}</strong></li>
                      <li>Prenez <strong>{decrireLigne(meilleur.ligne).prendre}</strong>, direction <strong>{meilleur.direction}</strong> · {decrireLigne(meilleur.ligne).arrets(meilleur.arrets)}{meilleur.nuit ? " (ligne de nuit)" : ""}{meilleur.occasionnel ? " (service peu fréquent)" : ""}</li>
                      <li>Descendez à <strong>{meilleur.arrivee.nom}</strong>, puis {minutesAPied(meilleur.arrivee.marche)} min à pied</li>
                    </ol>
                  </article>
                  {autres.length > 0 && <p className="bus-autres__titre">Autres possibilités</p>}
                  {autres.map((b) => (
                    <a key={`${b.ligne.nom}-${b.depart.id}-${b.arrivee.id}`} href={m.carte} target="_blank" rel="noopener noreferrer" className="bus-autre">
                      <PastilleLigne ligne={b.ligne} />
                      <span className="bus-autre__texte">
                        <strong>{b.depart.nom} → {b.arrivee.nom}</strong>
                        <span>
                          Direction {b.direction}{b.occasionnel ? " · peu fréquent" : ""}
                          {b.nuit && <> <span className="bus-autre__nuit">Ligne de nuit</span></>}
                        </span>
                      </span>
                      <strong>{b.minutesBus !== null ? `${b.minutesTotal} min` : `${b.arrets} arrêts`}</strong>
                    </a>
                  ))}
                </>
              );
            })()}

            {m.trains?.map((t) => {
              const risque = risqueDuTrain(risques, t.troncons[t.troncons.length - 1].train);
              const pourcentage = risque ? Math.round(risque.taux * 100) : null;
              const niveau = pourcentage !== null ? niveauRisque(pourcentage) : null;
              return (
                <Link key={t.heure + t.arrivee} to={m.lienTous} className="mini-train">
                  <span className="mini-train__haut">
                    <span>{t.heure} → {t.arrivee}</span>
                    {niveau && (
                      <span className={`mini-train__risque mini-train__risque--${niveau.classe}`}>
                        {pourcentage < 1 ? "< 1" : pourcentage} %
                      </span>
                    )}
                  </span>
                  <span className="mini-train__bas">
                    Direct · {formatDuree(t.dureeMin)}{niveau ? ` · risque de retard ${niveau.mot.toLowerCase()}` : ""}
                  </span>
                </Link>
              );
            })}

            {m.etapes && (
              <ol className="nora-etapes">
                {m.etapes.map((etape) => <li key={etape}>{etape}</li>)}
              </ol>
            )}
            {m.site && (
              <a href={m.site.url} target="_blank" rel="noopener noreferrer" className="nora-lien nora-lien--principal">
                Site officiel {m.site.nom} ↗
              </a>
            )}
            {m.lienTous && <Link to={m.lienTous} className="nora-lien">Voir tous les trains</Link>}
            {m.carte && (
              <a href={m.carte} target="_blank" rel="noopener noreferrer" className="nora-lien">Voir sur la carte ↗</a>
            )}
            {m.sourceBus && <p className="bulle__source">{m.sourceBus}</p>}
            {m.lienSncf && (
              <a href={SNCF_CONNECT} target="_blank" rel="noopener noreferrer" className="nora-lien">Aller sur SNCF Connect ↗</a>
            )}
            {m.sources?.length > 0 && (
              <p className="bulle__source">
                Source : <Link to="/faq">Questions fréquentes</Link> · « {m.sources[0]} »
              </p>
            )}
          </div>
        )))}

        {enAttente && (
          <div className="nora-attente">
            {/* La mascotte montre ce que fait Nora */}
            <span className="nora-attente__mascotte"><AvatarNora taille={52} expression={phase} /></span>
            <p className="bulle bulle--nora nora-ecrit" role="status">
              <span className="nora-ecrit__points" aria-hidden="true"><span /><span /><span /></span>
              <span className="nora-ecrit__ordinateur">Nora écrit…</span>
              <span className="nora-ecrit__telephone">{phase === "recherche" ? "Je cherche le meilleur trajet" : "Nora réfléchit"}</span>
            </p>
          </div>
        )}
        <div ref={fin} />
      </div>

      {/* ---------- Le bas : saisie, ou message de limite ---------- */}
      {limiteAtteinte ? (
        <section className="nora-limite" aria-label="Limite atteinte" role="status">
          <div className="nora-limite__haut">
            {limiteAtteinte.code === "plafond_site" && (
              // Les yeux fermés : Nora « fait une pause »
              <span className="nora-limite__mascotte"><AvatarNora taille={64} expression="ecoute" /></span>
            )}
            <p className="nora-limite__titre">
              {limiteAtteinte.message || "Vous avez posé vos questions du jour."}
            </p>
          </div>
          <p>
            {limiteAtteinte.code === "plafond_site"
              ? <>Elle fait une pause et sera de nouveau disponible <strong>{limiteAtteinte.reprise || "demain"}</strong>.
                  Les recherches de trains, de bus et de métro fonctionnent toujours.</>
              : <>Nora sera de nouveau disponible <strong>{limiteAtteinte.reprise || "demain"}</strong>. En attendant,
                  les trains, les bus et le métro restent consultables sans elle, et les réponses courantes sont dans la FAQ.</>}
          </p>
          <div className="nora-limite__boutons">
            <Link to="/" className="nora-bouton">Rechercher un trajet</Link>
            <Link to="/faq" className="nora-bouton nora-bouton--jaune">Voir les questions fréquentes</Link>
          </div>
        </section>
      ) : (
        <div className="nora-bas">
          {restantes !== null && restantes > 0 && restantes <= 3 && (
            <p className="nora-reste">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor"
                   strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
              <span>Plus que <strong>{restantes} question{restantes > 1 ? "s" : ""}</strong> à Nora aujourd'hui.</span>
            </p>
          )}
          {exemple && saisie && (
            <p className="nora-aide-exemple">Remplacez la gare ou la destination si besoin, puis envoyez.</p>
          )}
          <form className="nora-saisie" onSubmit={(e) => { e.preventDefault(); envoyer(saisie); }}>
            <label htmlFor="nora-question" className="visuellement-cache">Votre question</label>
            <textarea id="nora-question" ref={champ} rows={1} value={saisie} maxLength={500} autoComplete="off"
                      placeholder={Reconnaissance ? "Écrivez ou parlez…" : "Posez votre question…"}
                      onChange={(e) => setSaisie(e.target.value)} disabled={enAttente}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); envoyer(saisie); }
                      }}
                      />
            {Reconnaissance && (
              <button type="button" className="nora-rond nora-rond--micro" aria-label="Parler à Nora" onClick={ecouter}>
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor"
                     strokeWidth="2" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
              </button>
            )}
            <button type="submit" className="nora-rond nora-rond--envoyer" aria-label="Envoyer" disabled={enAttente || !saisie.trim()}>
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor"
                   strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
            </button>
          </form>
          <p className="nora-mention">
            Nora est une IA : elle peut se tromper. Ne partagez pas d'informations personnelles.
            {restantes !== null && ` Questions restantes aujourd'hui : ${restantes}.`}
          </p>
        </div>
      )}

      {/* ---------- La dictée vocale ---------- */}
      {dictee && (
        <div className="nora-dictee" role="dialog" aria-label="Dictée vocale">
          <div className="nora-dictee__fond" onClick={() => arreterDictee(false)} />
          <section className="nora-dictee__panneau">
            <p className="nora-dictee__titre">Je vous écoute…</p>
            <span className="nora-dictee__mascotte"><AvatarNora taille={96} expression="ecoute" /></span>
            <span className="nora-dictee__micro" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#14213D" strokeWidth="2.2"
                   strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
            </span>
            <p className="nora-dictee__texte" aria-live="polite">{dictee.texte ? `« ${dictee.texte} »` : "Parlez maintenant"}</p>
            <div className="nora-dictee__boutons">
              <button type="button" className="nora-dictee__annuler" onClick={() => arreterDictee(false)}>Annuler</button>
              <button type="button" className="nora-dictee__envoyer" onClick={() => arreterDictee(true)}>Envoyer</button>
            </div>
            <p className="nora-dictee__note">La reconnaissance de la voix est faite par votre navigateur. Rien n'est enregistré par Quai Nord.</p>
          </section>
        </div>
      )}
    </div>
  );
}
