import { RESEAUX } from "../data/bus";
import { useLangue } from "../langue/langue";
import { LANGUES } from "../langue/traductions";
import "./Footer.css";

// Les noms courts des réseaux de bus, tram et métro (« ilévia (Lille) » -> « ilévia »), lus dans la liste unique
const NOMS_RESEAUX = RESEAUX.map((r) => r.nom.replace(/ \(.*\)$/, ""));

export default function Footer() {
  const { t, langue, setLangue } = useLangue();
  const et = langue === "en" ? "and" : "et";
  const reseaux = `${NOMS_RESEAUX.slice(0, -1).join(", ")} ${et} ${NOMS_RESEAUX[NOMS_RESEAUX.length - 1]}`;
  return (
    <footer className="pied">
      <div className="conteneur pied__contenu">
        <span className="pied__logo">Quai <span>Nord</span></span>
        <p className="pied__texte">{t("pied.texte", { reseaux })}</p>
        <div className="pied__langue" role="group" aria-label={t("langue.titre")}>
          🌐 {LANGUES.map((l) => (
            <button key={l.code} type="button" lang={l.code} aria-pressed={l.code === langue}
                    className={l.code === langue ? "pied__choix pied__choix--actif" : "pied__choix"} onClick={() => setLangue(l.code)}>
              {l.nom}
            </button>
          ))}
        </div>
      </div>
    </footer>
  );
}
