import { useId, useMemo, useState } from "react";
import { proposerGares, morceauxEnGras } from "../data/suggestionsGares";
import { useLangue } from "../langue/langue";
import { chargerGaresCouvertes, gareLaPlusProche, DISTANCE_MAX_GARE, libelleGare } from "../data/bus";

// Un champ de gare, avec NOS propositions sous le champ (la liste du navigateur s'affiche mal sur iPhone).
// Au clavier : flèches haut et bas pour choisir, Entrée pour valider, Échap pour fermer.
export default function ChampGare({ id, label, valeur, onChange, noms, recents = [], placeholder, position = false, icone }) {
  const idListe = useId();
  const { t } = useLangue();
  const [ouvert, setOuvert] = useState(false);
  const [actif, setActif] = useState(-1);
  const [message, setMessage] = useState("");
  const propositions = useMemo(() => proposerGares(noms, valeur, recents), [noms, valeur, recents]);
  const avecPosition = position && !valeur.trim();
  const options = [...(avecPosition ? [{ type: "position" }] : []), ...propositions.map((nom) => ({ type: "gare", nom }))];
  const visible = ouvert && options.length > 0;

  function choisir(option) {
    if (option.type === "position") return gareProche();
    onChange(option.nom);
    setOuvert(false);
    setActif(-1);
  }

  // La gare (couverte) la plus proche : la position reste sur le téléphone
  function gareProche() {
    setOuvert(false);
    if (!navigator.geolocation) { setMessage("Votre appareil ne donne pas sa position."); return; }
    setMessage("Je cherche la gare la plus proche…");
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      const gare = gareLaPlusProche(await chargerGaresCouvertes(), coords.latitude, coords.longitude);
      if (!gare || gare.metres > DISTANCE_MAX_GARE) { setMessage("Aucune gare connue près de vous : tapez son nom."); return; }
      onChange(gare.nom);
      setMessage("");
    }, () => setMessage("Position refusée : tapez le nom de la gare."), { timeout: 10_000, maximumAge: 60_000 });
  }

  function touche(e) {
    if (!visible) { if (e.key === "ArrowDown") setOuvert(true); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActif((i) => Math.min(i + 1, options.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActif((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && actif >= 0) { e.preventDefault(); choisir(options[actif]); }
    else if (e.key === "Escape") setOuvert(false);
  }

  return (
    <div className="boite champ-gare">
      {icone}
      <div className="boite__contenu">
        <label htmlFor={id}>{label}</label>
        <input id={id} type="text" required autoComplete="off" spellCheck={false} placeholder={placeholder} value={valeur}
               role="combobox" aria-expanded={visible} aria-controls={idListe} aria-autocomplete="list"
               aria-activedescendant={actif >= 0 ? `${idListe}-${actif}` : undefined}
               onChange={(e) => { onChange(e.target.value); setOuvert(true); setActif(-1); setMessage(""); }}
               onFocus={() => setOuvert(true)}
               onBlur={() => setTimeout(() => setOuvert(false), 150)}
               onKeyDown={touche} />
        {message && <p className="champ-gare__message" role="status">{message}</p>}
      </div>
      {valeur && (
        <button type="button" className="champ-gare__effacer" aria-label={`${t("gare.effacer")} : ${label}`}
                onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(""); setOuvert(true); }}>✕</button>
      )}
      {visible && (
        <ul className="champ-gare__liste" role="listbox" id={idListe}>
          {!valeur.trim() && <li className="champ-gare__titre" role="presentation">{t("gare.suggestions")}</li>}
          {options.map((option, i) => (
            <li key={option.type === "position" ? "position" : option.nom} id={`${idListe}-${i}`} role="option"
                aria-selected={i === actif} className={i === actif ? "champ-gare__option champ-gare__option--actif" : "champ-gare__option"}
                onMouseDown={(e) => e.preventDefault()} onClick={() => choisir(option)}>
              {option.type === "position" ? (
                <><span className="champ-gare__pictogramme" aria-hidden="true">📍</span>
                  <span><strong>{t("gare.proche")}</strong><small>{t("gare.proche.detail")}</small></span></>
              ) : (
                <><span className="champ-gare__pictogramme" aria-hidden="true">{recents.includes(option.nom) ? "🕘" : "🚉"}</span>
                  <span>
                    {morceauxEnGras(libelleGare(option.nom), valeur).map((m, j) => (m.gras ? <strong key={j}>{m.texte}</strong> : <span key={j}>{m.texte}</span>))}
                    {recents.includes(option.nom) && <small>{t("gare.recente")}</small>}
                  </span></>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
