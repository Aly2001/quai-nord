// « 🧭 Y aller à pied » : à chaque étape à pied, un bouton qui ouvre l'itinéraire, la destination déjà remplie.
//  - sur iPhone : l'application Plans d'Apple, en mode à pied ;
//  - ailleurs   : Google Maps, en mode à pied.
// Le point de départ est laissé à Plans / Google Maps (ils utilisent la position avec leur propre autorisation) :
// Quai Nord n'écrit JAMAIS la position du voyageur dans le lien, seulement la destination, qui est publique.
import { useLangue } from "../langue/langue";
import "./Marche.css";

const surIphone = () => typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent || "");

export function lienMarche(vers) {
  const point = `${vers.lat},${vers.lon}`;
  return surIphone()
    ? `https://maps.apple.com/?${new URLSearchParams({ daddr: point, dirflg: "w" })}`
    : `https://www.google.com/maps/dir/?${new URLSearchParams({ api: "1", destination: point, travelmode: "walking" })}`;
}

// vers : { lat, lon } ; genre : « arret » (Y aller à pied), « gare » (Rejoindre la gare à pied), « lieu » (Itinéraire jusqu'à…)
export function LienMarche({ vers, genre = "arret", nom = "" }) {
  const { t } = useLangue();
  if (!vers || vers.lat === undefined || vers.lon === undefined) return null;
  const texte = genre === "gare" ? t("marche.gare") : genre === "lieu" ? t("marche.lieu", { lieu: nom }) : t("marche.arret");
  return (
    <a className="lien-marche" href={lienMarche(vers)} target="_blank" rel="noopener noreferrer">
      <span aria-hidden="true">🧭</span> {texte} <span aria-hidden="true">↗</span>
    </a>
  );
}
