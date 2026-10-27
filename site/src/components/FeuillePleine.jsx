// La feuille « liste pleine » : quand le voyageur ajoute un 6e train (suivi ou favori) ou un 6e trajet,
// on lui montre sa liste et c'est LUI qui choisit lequel retirer. Le nouvel élément est ajouté dans le même geste.
//   titre, question : le texte en haut ; elements : [{ cle, texte, detail }] ;
//   action : « Arrêter » ou « Retirer » ; onRetirer(cle) ; onFermer() (Annuler).
import { useEffect, useRef } from "react";
import { useLangue } from "../langue/langue";
import "./Suivre.css";
import "./FeuillePleine.css";

export function FeuillePleine({ titre, question, elements, action, onRetirer, onFermer }) {
  const { t } = useLangue();
  const premier = useRef(null);
  useEffect(() => { premier.current?.focus(); }, []);           // le clavier et le lecteur d'écran arrivent dans la feuille
  return (
    <div className="feuille-suivre" role="dialog" aria-modal="true" aria-label={titre}>
      <button type="button" className="feuille-suivre__fond" aria-label={t("plein.annuler")} onClick={onFermer} />
      <div className="feuille-suivre__contenu">
        <span className="feuille-suivre__poignee" aria-hidden="true" />
        <p className="feuille-suivre__titre">{titre}</p>
        <p className="feuille-suivre__train">{question}</p>
        <ul className="feuille-pleine__liste">
          {elements.map((e, i) => (
            <li key={e.cle}>
              <span><strong>{e.texte}</strong>{e.detail && <small>{e.detail}</small>}</span>
              <button type="button" ref={i === 0 ? premier : null} onClick={() => onRetirer(e.cle)}
                      aria-label={`${action} : ${e.texte}`}>{action}</button>
            </li>
          ))}
        </ul>
        <button type="button" className="feuille-pleine__annuler" onClick={onFermer}>{t("plein.annuler")}</button>
      </div>
    </div>
  );
}
