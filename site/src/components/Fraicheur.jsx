import { useIndexHoraires, useRisques, useMeteo, lireDate, formatMaj, ilYa, tempsReelFrais } from "../data/horaires";
import "./Fraicheur.css";

// Indique quand les données ont été mises à jour.
// Si les horaires ont plus de 36 heures, un avertissement s'affiche :
// la mise à jour quotidienne n'a sans doute pas eu lieu (PC éteint, par exemple).
//
// partie : "tout" (par défaut), "alerte" (seulement l'avertissement, s'il y en a un)
//          ou "infos" (seulement les dates). L'accueil place l'alerte tout en haut,
//          et les dates plus bas, sous les favoris.
export default function Fraicheur({ tempsReel = null, sombre = false, partie = "tout" }) {
  const { index } = useIndexHoraires();
  const risques = useRisques();
  const meteo = useMeteo();
  if (!index) return null;

  const dateHoraires = lireDate(index.genere_le);
  const ancien = Date.now() - dateHoraires.getTime() > 36 * 3600 * 1000;

  const montrerAlerte = ancien && partie !== "infos";
  const montrerInfos = partie !== "alerte";
  if (!montrerAlerte && !montrerInfos) return null;

  return (
    <div className={`fraicheur${sombre ? " fraicheur--sombre" : ""}${montrerAlerte ? " fraicheur--alerte" : ""}`}
         role={montrerAlerte ? "alert" : undefined}>
      {montrerAlerte && (
        <p className="fraicheur__alerte">
          Les données n'ont pas été mises à jour depuis plus d'un jour : certains horaires peuvent avoir changé.
        </p>
      )}
      {montrerInfos && <ul className="fraicheur__liste">
        <li><span className="fraicheur__point" aria-hidden="true" />Horaires : {formatMaj(dateHoraires)}</li>
        {risques && <li><span className="fraicheur__point" aria-hidden="true" />Risques : {formatMaj(lireDate(risques.genere_le))}</li>}
        {meteo && <li><span className="fraicheur__point" aria-hidden="true" />Météo : {formatMaj(lireDate(meteo.maj))}</li>}
        {tempsReelFrais(tempsReel) && (
          <li className="fraicheur__direct">
            <span className="fraicheur__point fraicheur__point--direct" aria-hidden="true" />
            En direct : {ilYa(new Date(tempsReel.maj * 1000))}
          </li>
        )}
      </ul>}
    </div>
  );
}
