import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  DOSSIER, useIndexHoraires, useRisques, normaliser, joursAVenir, aujourdhuiIso, heureActuelle,
  trajetsDirects, formatDuree, risqueDuTrain, niveauRisque,
} from "../data/horaires";
import { SNCF_CONNECT } from "../data/faq";
import {
  useBus, gareCouverte, chercherLieu, busDepuisGare, busVersGare, lienCarte, minutesAPied, distance,
  plusRapideQueAPied, garesCorrespondantes, libelleGare,
} from "../data/bus";
import "./Nora.css";

// L'avatar de Nora : une bulle de discussion (volontairement pas un visage humain)
export function AvatarNora({ taille = 40 }) {
  return (
    <svg viewBox="0 0 40 40" width={taille} height={taille} aria-hidden="true" className="nora-avatar">
      <circle cx="20" cy="20" r="20" fill="#F2C230" />
      <path d="M11 14h18a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-9l-6 5v-5h-3a3 3 0 0 1-3-3v-8a3 3 0 0 1 3-3z" fill="#14213D" />
      <circle cx="15" cy="21" r="1.8" fill="#F2C230" /><circle cx="20" cy="21" r="1.8" fill="#F2C230" />
      <circle cx="25" cy="21" r="1.8" fill="#F2C230" />
    </svg>
  );
}

const SUGGESTIONS = [
  "Comment est calculé le risque ?",
  "Pourquoi je ne vois pas mon train ?",
  "Comment réserver un billet ?",
];
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
export default function NoraConversation({ contexte = null }) {
  const { index } = useIndexHoraires();
  const risques = useRisques();
  const reseauxBus = useBus();
  const [messages, setMessages] = useState([]);
  const [saisie, setSaisie] = useState("");
  const [enAttente, setEnAttente] = useState(false);
  const [limiteAtteinte, setLimiteAtteinte] = useState(false);
  const [restantes, setRestantes] = useState(null);
  const [dictee, setDictee] = useState(null);          // null, ou { texte } pendant l'écoute
  const reconnaissance = useRef(null);
  const fin = useRef(null);

  // À chaque nouveau message, on fait défiler jusqu'en bas
  useEffect(() => { fin.current?.scrollIntoView({ block: "end" }); }, [messages, enAttente]);

  const ajouter = (message) => setMessages((liste) => [...liste, { id: nouvelId(), ...message }]);

  // ---------- Parler à Nora (serveur /api/nora) ----------
  async function envoyer(texte) {
    const question = texte.trim();
    if (!question || enAttente || limiteAtteinte) return;
    setSaisie("");
    const historique = [...messages, { auteur: "vous", texte: question }]
      .filter((m) => m.texte)
      .slice(-8)
      .map((m) => ({ role: m.auteur === "vous" ? "user" : "assistant", content: m.texte.slice(0, 600) }));
    ajouter({ auteur: "vous", texte: question });
    setEnAttente(true);
    try {
      const reponse = await fetch("/api/nora", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: historique, contexte }),
      });
      if (reponse.status === 429) {
        setLimiteAtteinte(true);
        return;
      }
      if (!reponse.ok) throw new Error(String(reponse.status));
      const donnees = await reponse.json();
      setRestantes(donnees.questions_restantes);
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
    const code = normaliser(action.ville).startsWith("boulogne") ? "boulogne" : "calais";
    const reseau = reseauxBus?.[code];
    if (!reseau) {
      ajouter({ auteur: "nora", texte: "Les données des bus ne sont pas disponibles pour le moment. Réessayez plus tard." });
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
    const couverte = gareCouverte(reseauxBus, gare);
    const ville = code === "boulogne" ? "Boulogne-sur-Mer" : "Calais";
    const nomAffiche = libelleGare(gare);              // le nom courant, pour les phrases ; « gare » reste le vrai nom

    // 2. Le lieu : retrouvé, ou à choisir s'il y en a plusieurs bien distincts
    let lieu = lieuChoisi;
    if (!lieu) {
      const lieux = await chercherLieu(action.lieu, couverte.gare, ville, reseau);
      if (lieux.length === 0) {
        ajouter({ auteur: "nora", texte: `Je ne trouve pas « ${action.lieu} » près de la gare de ${nomAffiche}. Pouvez-vous préciser, avec une adresse par exemple ?` });
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
      ajouter({
        auteur: "nora",
        texte: `Aucun bus ne relie directement la gare de ${nomAffiche} et ${lieu.nom}. C'est à ${(metres / 1000).toFixed(1).replace(".", ",")} km, `
          + `environ ${minutesAPied(metres)} minutes à pied. Votre application de cartes peut proposer un trajet avec changement.`,
        carte, sourceBus: source,
      });
      return;
    }
    ajouter({
      auteur: "nora",
      texte: depuis
        ? `Voici comment rejoindre ${lieu.nom} depuis la gare de ${nomAffiche} :`
        : `Voici comment rejoindre la gare de ${nomAffiche} depuis ${lieu.nom} :`,
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

  function lire(texte) {
    window.speechSynthesis.cancel();
    const phrase = new SpeechSynthesisUtterance(texte);
    phrase.lang = "fr-FR";
    window.speechSynthesis.speak(phrase);
  }

  const suggestions = contexte ? SUGGESTIONS_TRAIN : SUGGESTIONS;

  return (
    <div className="nora-conversation">
      <div className="nora-fil" aria-live="polite">
        {messages.length === 0 && (
          <div className="nora-accueil">
            <AvatarNora taille={76} />
            <p className="nora-accueil__titre">Bonjour, je suis Nora</p>
            <p className="nora-accueil__signature">Je suis là pour votre trajet.</p>
            <p className="nora-accueil__texte">
              Posez-moi une question sur Quai Nord, un train ou un risque de retard. Vous pouvez aussi me dire
              d'où vous partez et où vous allez.
            </p>
            <div className="nora-suggestions">
              {suggestions.map((s) => (
                <button key={s} type="button" className="nora-suggestion" onClick={() => envoyer(s)}>
                  {s}
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
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor"
                       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 9v6h4l5 4V5L8 9z" /><path d="M16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12" />
                  </svg>
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

            {m.bus?.map((b) => (
              <a key={`${b.ligne.nom}-${b.direction}`} href={m.carte} target="_blank" rel="noopener noreferrer" className="mini-bus">
                <span className="mini-bus__haut">
                  <span className="ligne-bus" style={{ background: b.ligne.couleur, color: b.ligne.texte }}>{b.ligne.nom}</span>
                  <span>{b.depart.nom} → {b.arrivee.nom}</span>
                </span>
                <span className="mini-bus__bas">
                  Direction {b.direction} · {b.arrets} arrêt{b.arrets > 1 ? "s" : ""}
                  {b.minutesBus !== null ? ` · environ ${b.minutesTotal} min` : ""}
                  {b.occasionnel ? " · service peu fréquent" : ""}
                  {` · ${minutesAPied(b.depart.marche + b.arrivee.marche)} min à pied au total`}
                </span>
              </a>
            ))}

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
          <p className="bulle bulle--nora nora-ecrit" role="status">
            <span className="nora-ecrit__points" aria-hidden="true"><span /><span /><span /></span>
            Nora écrit…
          </p>
        )}
        <div ref={fin} />
      </div>

      {/* ---------- Le bas : saisie, ou message de limite ---------- */}
      {limiteAtteinte ? (
        <section className="nora-limite" aria-label="Limite atteinte">
          <p className="nora-limite__titre">Vous avez posé vos questions du jour.</p>
          <p>Nora sera de nouveau disponible demain. En attendant, les réponses aux questions courantes sont dans la FAQ.</p>
          <Link to="/faq" className="nora-bouton nora-bouton--jaune">Voir les questions fréquentes</Link>
        </section>
      ) : (
        <div className="nora-bas">
          <form className="nora-saisie" onSubmit={(e) => { e.preventDefault(); envoyer(saisie); }}>
            <label htmlFor="nora-question" className="visuellement-cache">Votre question</label>
            <input id="nora-question" type="text" value={saisie} maxLength={500} autoComplete="off"
                   placeholder={Reconnaissance ? "Écrivez ou parlez…" : "Posez votre question…"}
                   onChange={(e) => setSaisie(e.target.value)} disabled={enAttente} />
            {Reconnaissance && (
              <button type="button" className="nora-rond nora-rond--micro" aria-label="Parler à Nora" onClick={ecouter}>
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor"
                     strokeWidth="2" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
              </button>
            )}
            <button type="submit" className="nora-rond nora-rond--envoyer" aria-label="Envoyer" disabled={enAttente || !saisie.trim()}>
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor"
                   strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
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
