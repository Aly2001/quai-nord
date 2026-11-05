// Petits graphiques en SVG, sans bibliothèque : des courbes nuit par nuit et des barres
export function Courbes({ series, etiquettes, seuil, min, max, legendeSeuil, description }) {
  const L = 360, H = 200, g = 32, d = 10, h = 14, b = 28;
  const n = etiquettes.length;
  const X = (i) => g + (n <= 1 ? 0 : (i * (L - g - d)) / (n - 1));
  const Y = (v) => h + ((max - v) * (H - h - b)) / (max - min);
  const graduations = [];
  for (let v = Math.ceil(min / 5) * 5; v <= max; v += 5) graduations.push(v);
  return (
    <svg viewBox={`0 0 ${L} ${H}`} className="graphique" role="img" aria-label={description}>
      {graduations.map((v) => (
        <g key={v}><line x1={g} x2={L - d} y1={Y(v)} y2={Y(v)} className="graphique__grille" />
          <text x={g - 6} y={Y(v) + 4} textAnchor="end" className="graphique__texte">{v}</text></g>
      ))}
      {seuil !== undefined && (<>
        <line x1={g} x2={L - d} y1={Y(seuil)} y2={Y(seuil)} className="graphique__seuil" />
        <text x={L - d} y={Y(seuil) - 5} textAnchor="end" className="graphique__texte graphique__texte--seuil">{legendeSeuil}</text>
      </>)}
      {series.map((s) => {
        const points = s.valeurs.map((v, i) => (v === null || v === undefined ? null : [X(i), Y(Math.max(min, Math.min(max, v)))])).filter(Boolean);
        return (
          <g key={s.nom}>
            <polyline points={points.map((p) => p.join(",")).join(" ")} fill="none" stroke={s.couleur} strokeWidth="2.5" strokeLinejoin="round" />
            {points.length > 0 && <circle cx={points.at(-1)[0]} cy={points.at(-1)[1]} r="4" fill={s.couleur} />}
          </g>
        );
      })}
      {[0, Math.floor((n - 1) / 2), n - 1].filter((v, i, t) => t.indexOf(v) === i && n > 0).map((i, k) => (
        <text key={i} x={X(i)} y={H - 8} textAnchor={k === 0 ? "start" : k === 2 ? "end" : "middle"} className="graphique__texte">{etiquettes[i]}</text>
      ))}
    </svg>
  );
}

export function BarresDoubles({ a, b, etiquettes, max, couleurs, description }) {
  const L = 360, H = 180, g = 30, d = 6, h = 8, bas = 26;
  const n = etiquettes.length, pas = (L - g - d) / Math.max(1, n), larg = pas * 0.36;
  const Y = (v) => h + ((max - v) * (H - h - bas)) / max;
  return (
    <svg viewBox={`0 0 ${L} ${H}`} className="graphique" role="img" aria-label={description}>
      {[0, 20, 40].filter((v) => v <= max).map((v) => (
        <g key={v}><line x1={g} x2={L - d} y1={Y(v)} y2={Y(v)} className="graphique__grille" />
          <text x={g - 6} y={Y(v) + 4} textAnchor="end" className="graphique__texte">{v}</text></g>
      ))}
      {etiquettes.map((e, i) => {
        const x = g + i * pas + pas * 0.12;
        return (
          <g key={e + i}>
            <rect x={x} y={Y(a[i])} width={larg} height={Y(0) - Y(a[i])} rx="2" fill={couleurs[0]} />
            <rect x={x + larg + 1} y={Y(b[i])} width={larg} height={Y(0) - Y(b[i])} rx="2" fill={couleurs[1]} />
          </g>
        );
      })}
      {[0, Math.floor((n - 1) / 2), n - 1].filter((v, i, t) => t.indexOf(v) === i && n > 0).map((i) => (
        <text key={i} x={g + i * pas + pas / 2} y={H - 8} textAnchor="middle" className="graphique__texte">{etiquettes[i]}</text>
      ))}
    </svg>
  );
}

// Des barres horizontales, avec la valeur au bout
export function BarresH({ lignes, sombre }) {
  const max = Math.max(...lignes.map((l) => l.valeur || 0), 1);
  return (
    <div className={sombre ? "barres barres--sombre" : "barres"}>
      {lignes.map((l) => (
        <div key={l.nom} className="barres__ligne">
          <span className="barres__nom">{l.nom}</span>
          <span className="barres__piste"><span className={l.fort ? "barres__barre barres__barre--fort" : "barres__barre"} style={{ width: `${(100 * (l.valeur || 0)) / max}%` }} /></span>
          <span className="barres__valeur">{l.texte}</span>
        </div>
      ))}
    </div>
  );
}

// Des barres verticales serrées (une par jour), la plus haute en couleur
export function BarresJours({ jours, description }) {
  const L = 360, H = 160, bas = 22;
  const max = Math.max(...jours.map((j) => j.taux || 0), 1);
  const pas = (L - 10) / Math.max(1, jours.length);
  const pic = jours.reduce((m, j) => ((j.taux || 0) > (m?.taux || 0) ? j : m), null);
  return (
    <svg viewBox={`0 0 ${L} ${H}`} className="graphique" role="img" aria-label={description}>
      {jours.map((j, i) => {
        const haut = ((j.taux || 0) * (H - bas - 18)) / max;
        return <rect key={j.date} x={5 + i * pas} y={H - bas - haut} width={Math.max(2, pas - 3)} height={haut} rx="2"
                     className={j === pic ? "graphique__barre graphique__barre--pic" : "graphique__barre"} />;
      })}
      {pic && (() => {
        const x = 5 + jours.indexOf(pic) * pas;
        const aDroite = x > L / 2;                 // près du bord droit : le texte s'aligne à droite de la barre
        return <text x={aDroite ? x + pas - 3 : x} y={12} textAnchor={aDroite ? "end" : "start"} className="graphique__texte graphique__texte--pic">
          {pic.etiquette} · {String(pic.taux).replace(".", ",")} %</text>;
      })()}
      {jours.length > 0 && (<>
        <text x="5" y={H - 6} className="graphique__texte">{jours[0].etiquette}</text>
        <text x={L - 5} y={H - 6} textAnchor="end" className="graphique__texte">{jours.at(-1).etiquette}</text>
      </>)}
    </svg>
  );
}
