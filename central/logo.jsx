// SDC Tools — App logomark variants
// Three options: Gear + Nodes, Circuit Hub, Stacked S Mark.
// All built purely from SVG primitives. Size via the `size` prop.

const SDC_COLORS = {
  blue:   '#1574C4',
  navy:   '#061D39',
  light:  '#AACEE8',
  yellow: '#FFDE51',
  green:  '#74C415',
  lime:   '#BEFA4F',
  gray:   '#D9D9D9',
  black:  '#231F20',
  purple: '#7C3AED',
  amber:  '#D97706',
};

// ─────────────────────────────────────────────────────────────────────────────
// Option A — Gear + Nodes
// A precise 12-tooth gear in SDC Blue with four coloured status nodes at
// the cardinal points — "one controlled system, four apps unified."
function LogoGearNodes({ size = 64 }) {
  const teeth  = 12;
  const cx = 256, cy = 256;
  const rOuter = 162;
  const rInner = 132;
  const rHub   = 68;
  const rHole  = 28;
  const half   = (Math.PI / teeth) * 0.44;

  const pt = (r, ang) => `${cx + Math.cos(ang) * r},${cy + Math.sin(ang) * r}`;
  const gearPath = Array.from({ length: teeth }, (_, i) => {
    const a  = (i / teeth) * Math.PI * 2 - Math.PI / 2;
    const a1 = a - half,  a2 = a + half;
    const a3 = a + (Math.PI / teeth) - half;
    const a4 = a + (Math.PI / teeth) + half;
    return (i === 0 ? `M${pt(rOuter,a1)}` : `L${pt(rOuter,a1)}`)
      + ` L${pt(rOuter,a2)} L${pt(rInner,a3)} L${pt(rInner,a4)}`;
  }).join(' ') + ' Z';

  const nodes = [
    { angle: -Math.PI / 2, color: SDC_COLORS.green,  label: 'Assemblies'  },  // N
    { angle:  0,           color: SDC_COLORS.light,  label: 'Readiness'   },  // E
    { angle:  Math.PI / 2, color: SDC_COLORS.yellow, label: 'Scheduler'   },  // S
    { angle:  Math.PI,     color: SDC_COLORS.purple, label: 'State Logic' },  // W
  ];

  return (
    <svg width={size} height={size} viewBox="0 0 512 512"
         xmlns="http://www.w3.org/2000/svg" aria-label="SDC Tools">
      {/* Background */}
      <rect width="512" height="512" rx="114" fill={SDC_COLORS.navy} />
      {/* Subtle inner border */}
      <rect x="5" y="5" width="502" height="502" rx="110"
            fill="none" stroke="rgba(21,116,196,0.22)" strokeWidth="2" />
      {/* Faint outer ring */}
      <circle cx={cx} cy={cy} r={rOuter + 24}
              fill="none" stroke="rgba(170,206,232,0.07)" strokeWidth="1.5" />
      {/* Gear body */}
      <path d={gearPath} fill={SDC_COLORS.blue} />
      {/* Hub ring */}
      <circle cx={cx} cy={cy} r={rHub}
              fill={SDC_COLORS.navy} stroke={SDC_COLORS.blue} strokeWidth="7" />
      {/* Center dot */}
      <circle cx={cx} cy={cy} r={rHole} fill={SDC_COLORS.blue} />
      {/* Cardinal nodes */}
      {nodes.map((n, i) => {
        const r = rOuter + 32;
        const x = cx + Math.cos(n.angle) * r;
        const y = cy + Math.sin(n.angle) * r;
        return (
          <g key={i} aria-label={n.label}>
            {/* node halo */}
            <circle cx={x} cy={y} r="26" fill={SDC_COLORS.navy}
                    stroke={n.color} strokeWidth="3" strokeOpacity="0.5" />
            {/* node fill */}
            <circle cx={x} cy={y} r="13" fill={n.color} />
          </g>
        );
      })}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Option B — Circuit Hub
// Central hexagon on Dark Navy, four diagonal arms each capped with a coloured
// node — one per app. Clean, schematic, industrial.
function LogoCircuitHub({ size = 64 }) {
  const cx = 256, cy = 256;
  const rHex  = 88;
  const rLine = 184;

  // Hexagon points (flat-top orientation)
  const hexPts = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    return `${cx + Math.cos(a) * rHex},${cy + Math.sin(a) * rHex}`;
  }).join(' ');

  const diag = Math.PI / 4;
  const arms = [
    { angle: -3 * diag, color: SDC_COLORS.blue,   label: 'Assemblies'  },  // NW
    { angle:    -diag,  color: SDC_COLORS.green,  label: 'Readiness'   },  // NE
    { angle:     diag,  color: SDC_COLORS.yellow, label: 'Scheduler'   },  // SE
    { angle:  3 * diag, color: SDC_COLORS.purple, label: 'State Logic' },  // SW
  ];

  return (
    <svg width={size} height={size} viewBox="0 0 512 512"
         xmlns="http://www.w3.org/2000/svg" aria-label="SDC Tools">
      {/* Background */}
      <rect width="512" height="512" rx="114" fill={SDC_COLORS.navy} />
      <rect x="5" y="5" width="502" height="502" rx="110"
            fill="none" stroke="rgba(21,116,196,0.22)" strokeWidth="2" />

      {/* Arm lines + end nodes */}
      {arms.map((arm, i) => {
        const xEnd = cx + Math.cos(arm.angle) * rLine;
        const yEnd = cy + Math.sin(arm.angle) * rLine;
        const xMid = cx + Math.cos(arm.angle) * (rHex + 6);
        const yMid = cy + Math.sin(arm.angle) * (rHex + 6);
        return (
          <g key={i} aria-label={arm.label}>
            {/* arm */}
            <line x1={xMid} y1={yMid} x2={xEnd} y2={yEnd}
                  stroke={SDC_COLORS.blue} strokeWidth="9"
                  strokeLinecap="round" opacity="0.7" />
            {/* subtle mid-tick */}
            <circle cx={(xMid + xEnd) / 2} cy={(yMid + yEnd) / 2}
                    r="4" fill={arm.color} opacity="0.5" />
            {/* end node ring */}
            <circle cx={xEnd} cy={yEnd} r="26"
                    fill={SDC_COLORS.navy} stroke={arm.color} strokeWidth="6" />
            {/* end node fill */}
            <circle cx={xEnd} cy={yEnd} r="11" fill={arm.color} />
          </g>
        );
      })}

      {/* Hexagon */}
      <polygon points={hexPts}
               fill={SDC_COLORS.navy} stroke={SDC_COLORS.blue}
               strokeWidth="9" strokeLinejoin="round" />

      {/* Inner 2×2 app dot grid */}
      <circle cx={cx - 24} cy={cy - 24} r="10" fill={SDC_COLORS.blue}   opacity="0.9" />
      <circle cx={cx + 24} cy={cy - 24} r="10" fill={SDC_COLORS.green}  opacity="0.9" />
      <circle cx={cx - 24} cy={cy + 24} r="10" fill={SDC_COLORS.yellow} opacity="0.9" />
      <circle cx={cx + 24} cy={cy + 24} r="10" fill={SDC_COLORS.purple} opacity="0.9" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Option C — Stacked S Mark
// SDC oval + S letterform (faithful to brand) above a 2×2 coloured dot grid.
// Anchors the tool directly to the Steven Douglas Corp. parent brand.
function LogoStackedS({ size = 64 }) {
  // The S path is drawn in the coordinate space of the translated group (cx=0,cy=0)
  // Matches the SDC corporate "S" — broad curves, rounded terminals.
  const dots = [
    { x: -56, y: 128, c: SDC_COLORS.blue   },
    { x:  56, y: 128, c: SDC_COLORS.green  },
    { x: -56, y: 190, c: SDC_COLORS.yellow },
    { x:  56, y: 190, c: SDC_COLORS.purple },
  ];

  return (
    <svg width={size} height={size} viewBox="0 0 512 512"
         xmlns="http://www.w3.org/2000/svg" aria-label="SDC Tools">
      {/* Background */}
      <rect width="512" height="512" rx="114" fill={SDC_COLORS.navy} />
      <rect x="5" y="5" width="502" height="502" rx="110"
            fill="none" stroke="rgba(21,116,196,0.22)" strokeWidth="2" />

      {/* SDC oval + S in same transform context */}
      <g transform="translate(256 168)">
        {/* Oval — faithful to SDC brand mark proportions */}
        <ellipse cx="0" cy="0" rx="145" ry="98"
                 fill="none" stroke={SDC_COLORS.blue} strokeWidth="15" />
        {/* S letterform — broad strokes, perfectly centred */}
        <path
          d="M 52 -44
             C 52 -68, 28 -80, -4 -80
             C -38 -80, -64 -64, -64 -38
             C -64 -16, -44 -6, -14 2
             L 14 10
             C 44 18, 64 28, 64 52
             C 64 76, 38 90, 4 90
             C -32 90, -60 76, -60 50"
          fill="none"
          stroke={SDC_COLORS.blue}
          strokeWidth="22"
          strokeLinecap="round" />
      </g>

      {/* Divider */}
      <line x1="100" y1="304" x2="412" y2="304"
            stroke="rgba(170,206,232,0.14)" strokeWidth="2" />

      {/* 2×2 dot grid — one per app */}
      {dots.map((d, i) => (
        <g key={i} transform={`translate(${256 + d.x} ${336 + (d.y - 128)})`}>
          <circle r="22" fill={SDC_COLORS.navy}
                  stroke="rgba(170,206,232,0.16)" strokeWidth="1.5" />
          <circle r="11" fill={d.c} />
        </g>
      ))}
    </svg>
  );
}

function Logo({ variant = 'circuit', size = 64 }) {
  if (variant === 'gear')    return <LogoGearNodes  size={size} />;
  if (variant === 'stacked') return <LogoStackedS   size={size} />;
  return <LogoCircuitHub size={size} />;
}

Object.assign(window, {
  Logo, LogoGearNodes, LogoCircuitHub, LogoStackedS, SDC_COLORS,
});
