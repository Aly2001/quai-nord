import "./DecorVoies.css";

// Le décor des bandeaux : des voies ferrées en perspective, dessinées en SVG.
// Utilisé sur l'accueil (grand bandeau) et sur la page des résultats (bandeau fin).
// cadrage : quelle partie du dessin garder quand le bandeau est moins haut que le dessin
export default function DecorVoies({ cadrage = "xMidYMax slice", discret = false }) {
  const fuite = { x: 760, y: 240 };                    // point de fuite à l'horizon
  const traverses = Array.from({ length: 16 }, (_, i) => {
    const t = Math.pow((i + 1) / 16, 2.2);              // de plus en plus espacées vers nous
    return { t };
  });
  const point = (xBas, t) => fuite.x + (xBas - fuite.x) * t;   // x d'une voie à la hauteur t
  const hauteur = (t) => fuite.y + (620 - fuite.y) * t;

  return (
    <svg className={discret ? "decor decor--discret" : "decor"} viewBox="0 0 1440 620"
         preserveAspectRatio={cadrage} aria-hidden="true">
      <defs>
        <linearGradient id="ciel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#14213D" />
          <stop offset="0.45" stopColor="#1C2E55" />
          <stop offset="1" stopColor="#14213D" />
        </linearGradient>
        <radialGradient id="lueur" cx="760" cy="240" r="460" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#F2C230" stopOpacity="0.35" />
          <stop offset="1" stopColor="#F2C230" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="1440" height="620" fill="url(#ciel)" />
      <circle cx="760" cy="240" r="460" fill="url(#lueur)" />
      <line x1="0" y1="240" x2="1440" y2="240" stroke="#5FB3CE" strokeOpacity="0.2" />

      {/* Le quai, avec sa ligne jaune */}
      <polygon points={`${fuite.x},${fuite.y} 1440,${fuite.y + 60} 1440,620 1180,620`} fill="#0F1A33" />
      <line x1={fuite.x} y1={fuite.y} x2="1200" y2="620" stroke="#F2C230" strokeWidth="6" strokeDasharray="22 14" />

      {/* Deux voies */}
      {[[330, 560], [700, 930]].map(([gauche, droite], v) => (
        <g key={v}>
          {traverses.map(({ t }, i) => (
            <line key={i} x1={point(gauche - 30, t)} y1={hauteur(t)} x2={point(droite + 30, t)} y2={hauteur(t)}
                  stroke="#5FB3CE" strokeOpacity={0.12 + t * 0.25} strokeWidth={1 + t * 5} />
          ))}
          <line x1={fuite.x} y1={fuite.y} x2={gauche} y2="620" stroke="#C9D3E3" strokeOpacity="0.7" strokeWidth="3" />
          <line x1={fuite.x} y1={fuite.y} x2={droite} y2="620" stroke="#C9D3E3" strokeOpacity="0.7" strokeWidth="3" />
        </g>
      ))}

      {/* Poteaux de la caténaire */}
      {[0.18, 0.35, 0.6, 1].map((t, i) => (
        <line key={i} x1={point(150, t)} y1={hauteur(t)} x2={point(150, t)} y2={hauteur(t) - 260 * t}
              stroke="#C9D3E3" strokeOpacity="0.35" strokeWidth={1 + t * 4} />
      ))}
    </svg>
  );
}
