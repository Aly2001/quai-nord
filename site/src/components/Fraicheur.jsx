import { useIndexHoraires, useRisques, useMeteo, lireDate, formatMaj, ilYa, tempsReelFrais } from "../data/horaires";
import "./Fraicheur.css";

// Indique quand les données ont été mises à jour.
// Si les horaires ont plus de 36 heures, un avertissement s'affiche :
// la mise à jour quotidienne n'a sans doute pas eu lieu (PC éteint, par exemple).
//
// partie : "tout" (par défaut), "alerte" (seulement l'avertissement, s'il y en a un)
//          ou "infos" (seulement les dates). L'accueil place l'alerte tout en haut,
//          et les dates plus bas, sous les favoris.
// Les pictogrammes des pastilles (variante « pastilles », sur la page des résultats)
const DESSINS = {
  horaires: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  risques: <path d="M6 20V12M12 20V6M18 20v-4" />,
  meteo: <path d="M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 18z" />,
};
function Marque({ type, pastilles }) {
  if (!pastilles) return <span className="fraicheur__point" aria-hidden="true" />;
  return (
    <svg className="fraicheur__icone" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{DESSINS[type]}</svg>
  );
}

export default function Fraicheur({ tempsReel = null, sombre = false, partie = "tout", pastilles = false }) {
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
    <div className={`fraicheur${sombre ? " fraicheur--sombre" : ""}${montrerAlerte ? " fraicheur--alerte" : ""}${pastilles ? " fraicheur--pastilles" : ""}`}
         role={montrerAlerte ? "alert" : undefined}>
      {montrerAlerte && (
        <p className="fraicheur__alerte">
          Les données n'ont pas été mises à jour depuis plus d'un jour : certains horaires peuvent avoir changé.
        </p>
      )}
      {montrerInfos && <ul className="fraicheur__liste">
        <li><Marque type="horaires" pastilles={pastilles} />Horaires : {formatMaj(dateHoraires)}</li>
        {risques && <li><Marque type="risques" pastilles={pastilles} />Risques : {formatMaj(lireDate(risques.genere_le))}</li>}
        {meteo && <li><Marque type="meteo" pastilles={pastilles} />Météo : {formatMaj(lireDate(meteo.maj))}</li>}
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
