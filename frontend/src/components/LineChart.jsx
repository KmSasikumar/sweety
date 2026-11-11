// Simple SVG line chart — no external chart library needed.
// points: [{ label, value }] — values in mg/dL.
export default function LineChart({ points, height = 180, yMin = 70, yMax = 200 }) {
  if (!points || points.length === 0) {
    return <p className="empty">No data for this period yet.</p>;
  }
  const width = 640;
  const padL = 36;
  const padR = 12;
  const padT = 14;
  const padB = 28;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const x = (i) =>
    points.length === 1 ? padL + innerW / 2 : padL + (i / (points.length - 1)) * innerW;
  const y = (v) => padT + innerH - ((Math.min(Math.max(v, yMin), yMax) - yMin) / (yMax - yMin)) * innerH;

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${(padT + innerH).toFixed(1)} L${x(0).toFixed(1)},${(padT + innerH).toFixed(1)} Z`;

  const gridValues = [70, 100, 140, 180];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: '100%', height: 'auto', display: 'block' }}
      role="img"
      aria-label="Glucose trend chart"
    >
      <defs>
        <linearGradient id="sweety-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e63946" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#e63946" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {gridValues.map((g) => (
        <g key={g}>
          <line x1={padL} x2={width - padR} y1={y(g)} y2={y(g)} stroke="#e5e9ed" strokeWidth="1" />
          <text x={padL - 8} y={y(g) + 4} textAnchor="end" fontSize="11" fill="#9ca3af">
            {g}
          </text>
        </g>
      ))}
      {/* Dashed reference line at 70 mg/dL (low threshold) */}
      <line
        x1={padL}
        x2={width - padR}
        y1={y(70)}
        y2={y(70)}
        stroke="#9ca3af"
        strokeWidth="1.5"
        strokeDasharray="5 5"
      />
      <text x={width - padR} y={y(70) - 5} textAnchor="end" fontSize="11" fill="#9ca3af">
        70
      </text>
      <path d={area} fill="url(#sweety-area)" />
      <path d={line} fill="none" stroke="#e63946" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.value)} r="4" fill="#e63946" stroke="#fff" strokeWidth="2" />
          <text x={x(i)} y={height - 8} textAnchor="middle" fontSize="11" fill="#9ca3af">
            {p.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
