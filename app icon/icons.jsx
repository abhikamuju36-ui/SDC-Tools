// SDC Tools — 5 app icons (LIGHT THEME, SDC brand palette)
// All colors lifted from SDC_Brand_Guide_2026.pdf
//   PRIMARY BLUE #1574C4 · DARK NAVY #061D39 · LIGHT BLUE #AACEE8
//   YELLOW #FFDE51 · GREEN #74C415 · GRAY #D9D9D9 · BLACK #231F20

const PALETTE = {
  bg:        "#ffffff",
  bgSoft:    "#f4f7fb",      // faintest light-blue tinted off-white for layering
  blue:      "#1574C4",      // SDC primary blue
  navy:      "#061D39",      // SDC dark navy
  lightBlue: "#AACEE8",      // SDC light blue
  yellow:    "#FFDE51",      // SDC yellow
  green:     "#74C415",      // SDC green
  gray:      "#D9D9D9",      // SDC gray
  black:     "#231F20",      // SDC black
  // working tints, derived from brand:
  ink:       "rgba(6,29,57,0.55)",
  inkDim:    "rgba(6,29,57,0.28)",
  inkFaint:  "rgba(6,29,57,0.10)",
  hairline:  "rgba(6,29,57,0.12)",
};

/* ─── Squircle container (iOS-style superellipse) ──────────────────────── */
function squirclePath(size = 512) {
  const s = size;
  const r = s * 0.2237;          // ~115 for 512
  const c = r * 0.55228;
  return `
    M ${r} 0
    L ${s - r} 0
    C ${s - r + c} 0 ${s} ${r - c} ${s} ${r}
    L ${s} ${s - r}
    C ${s} ${s - r + c} ${s - r + c} ${s} ${s - r} ${s}
    L ${r} ${s}
    C ${r - c} ${s} 0 ${s - r + c} 0 ${s - r}
    L 0 ${r}
    C 0 ${r - c} ${r - c} 0 ${r} 0
    Z
  `;
}

function SquircleFrame({ id, children }) {
  const clipId = `sq-${id}`;
  const bgId = `sqbg-${id}`;
  return (
    <svg viewBox="0 0 512 512" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style={{ display: "block" }}>
      <defs>
        <clipPath id={clipId}>
          <path d={squirclePath(512)} />
        </clipPath>
        {/* whisper-faint top→bottom shading, white→light-blue tint */}
        <linearGradient id={bgId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#f4f7fb" />
        </linearGradient>
      </defs>
      {/* squircle fill */}
      <path d={squirclePath(512)} fill={`url(#${bgId})`} />
      {/* hairline border in dark navy @ 12% — crisp small-size definition */}
      <path d={squirclePath(512)} fill="none" stroke={PALETTE.hairline} strokeWidth="2" />
      <g clipPath={`url(#${clipId})`}>{children}</g>
    </svg>
  );
}

/* ─── ICON 1 — Assemblies Library ──────────────────────────────────────── */
// Stack of layered sheets (light blue tints) + isometric gear in SDC blue
// with a dark-navy outline for crisp definition.
function IconAssemblies() {
  return (
    <SquircleFrame id="assemblies">
      {/* Stack of layered sheets — 3 sheets in increasing tints */}
      <g>
        {/* Sheet 3 (back) */}
        <rect x="118" y="262" width="240" height="160" rx="14" fill="#dde9f5" stroke={PALETTE.lightBlue} strokeWidth="1.5" />
        <rect x="138" y="288" width="120" height="6" rx="3" fill={PALETTE.lightBlue} />
        <rect x="138" y="306" width="170" height="6" rx="3" fill={PALETTE.lightBlue} />
        <rect x="138" y="324" width="90"  height="6" rx="3" fill={PALETTE.lightBlue} />

        {/* Sheet 2 (middle) */}
        <rect x="138" y="232" width="260" height="170" rx="14" fill="#e9f1f9" stroke={PALETTE.lightBlue} strokeWidth="1.5" />
        <rect x="158" y="260" width="140" height="6" rx="3" fill={PALETTE.lightBlue} />
        <rect x="158" y="278" width="200" height="6" rx="3" fill={PALETTE.lightBlue} />
        <rect x="158" y="296" width="110" height="6" rx="3" fill={PALETTE.lightBlue} />

        {/* Sheet 1 (front) */}
        <rect x="156" y="206" width="270" height="180" rx="14" fill="#ffffff" stroke={PALETTE.lightBlue} strokeWidth="1.5" />
        <rect x="178" y="234" width="130" height="6" rx="3" fill="#9ab9d4" />
        <rect x="178" y="252" width="190" height="6" rx="3" fill="#9ab9d4" />
        <rect x="178" y="270" width="100" height="6" rx="3" fill="#9ab9d4" />
      </g>

      {/* Isometric gear — slight tilt, navy "extrusion" behind for depth */}
      <g transform="translate(256 220) rotate(-12)">
        {/* extruded depth (darker navy, offset) */}
        <g transform="translate(6 12)">
          <Gear color={PALETTE.navy} stroke="none" />
        </g>
        {/* face */}
        <Gear color={PALETTE.blue} stroke={PALETTE.navy} />
      </g>
    </SquircleFrame>
  );
}

function Gear({ color, stroke }) {
  const teeth = 10;
  const rOuter = 140;
  const rInner = 110;
  const toothHalfWidth = 0.18;
  const pts = [];
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2 - Math.PI / 2;
    const aNext = ((i + 1) / teeth) * Math.PI * 2 - Math.PI / 2;
    pts.push([Math.cos(a - toothHalfWidth) * rOuter, Math.sin(a - toothHalfWidth) * rOuter]);
    pts.push([Math.cos(a + toothHalfWidth) * rOuter, Math.sin(a + toothHalfWidth) * rOuter]);
    pts.push([Math.cos(a + toothHalfWidth + 0.10) * rInner, Math.sin(a + toothHalfWidth + 0.10) * rInner]);
    pts.push([Math.cos(aNext - toothHalfWidth - 0.10) * rInner, Math.sin(aNext - toothHalfWidth - 0.10) * rInner]);
  }
  const d = "M " + pts.map((p) => p.map((n) => n.toFixed(2)).join(" ")).join(" L ") + " Z";
  const hasStroke = stroke && stroke !== "none";
  return (
    <g>
      <path d={d} fill={color} stroke={hasStroke ? stroke : "none"} strokeWidth={hasStroke ? 3 : 0} strokeLinejoin="round" />
      {/* center bore */}
      <circle cx="0" cy="0" r="40" fill="#ffffff" stroke={hasStroke ? stroke : "none"} strokeWidth={hasStroke ? 3 : 0} />
      <circle cx="0" cy="0" r="14" fill={hasStroke ? PALETTE.navy : color} />
    </g>
  );
}

/* ─── ICON 2 — Build Readiness Report ──────────────────────────────────── */
function IconBuildReadiness() {
  return (
    <SquircleFrame id="readiness">
      <g>
        {/* clip top */}
        <rect x="216" y="76"  width="80" height="32" rx="8" fill={PALETTE.navy} />
        <rect x="232" y="68"  width="48" height="20" rx="6" fill={PALETTE.blue} />
        {/* clipboard body */}
        <rect x="116" y="100" width="280" height="336" rx="22" fill="#ffffff" stroke={PALETTE.lightBlue} strokeWidth="2" />
        {/* inner panel — very light blue tint */}
        <rect x="140" y="124" width="232" height="288" rx="14" fill="#f4f8fc" />

        {/* Checklist rows */}
        {[0,1,2].map((i) => {
          const y = 156 + i * 46;
          const checked = i < 2;
          return (
            <g key={i}>
              <rect
                x="160" y={y} width="26" height="26" rx="6"
                fill={checked ? PALETTE.green : "#ffffff"}
                stroke={checked ? PALETTE.green : PALETTE.lightBlue}
                strokeWidth="2.5"
              />
              {checked && (
                <path
                  d={`M ${166} ${y+13} L ${172} ${y+19} L ${181} ${y+9}`}
                  fill="none" stroke="#ffffff" strokeWidth="3.5"
                  strokeLinecap="round" strokeLinejoin="round"
                />
              )}
              {/* row text */}
              <rect x="200" y={y+5}  width={i===0?150:i===1?120:90}  height="6" rx="3"
                    fill={checked ? PALETTE.navy : PALETTE.inkDim} opacity={checked ? 0.85 : 1} />
              <rect x="200" y={y+19} width={i===0?100:i===1?70:140} height="5" rx="2.5" fill={PALETTE.lightBlue} />
            </g>
          );
        })}

        {/* Progress ring overlay (lower-right of clipboard) */}
        <g transform="translate(344 360)">
          <circle cx="0" cy="0" r="58" fill="#ffffff" stroke={PALETTE.lightBlue} strokeWidth="2" />
          <circle cx="0" cy="0" r="48" fill="none" stroke="#e6eef6" strokeWidth="10" />
          <circle
            cx="0" cy="0" r="48"
            fill="none" stroke={PALETTE.blue} strokeWidth="10" strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 48 * 0.72} ${2 * Math.PI * 48}`}
            transform="rotate(-90)"
          />
          {/* yellow warning circle with green checkmark */}
          <circle cx="0" cy="0" r="26" fill={PALETTE.yellow} />
          <path d="M -12 0 L -3 9 L 14 -10" fill="none" stroke={PALETTE.green} strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </g>
    </SquircleFrame>
  );
}

/* ─── ICON 3 — SDC Scheduler ───────────────────────────────────────────── */
function IconScheduler() {
  return (
    <SquircleFrame id="scheduler">
      {/* Grid background */}
      <g>
        {[1,2,3,4,5,6].map((i) => (
          <line key={i} x1={88 + i * 56} y1="120" x2={88 + i * 56} y2="392" stroke={PALETTE.inkFaint} strokeWidth="1.5" />
        ))}
        <line x1="80" y1="120" x2="432" y2="120" stroke={PALETTE.navy} strokeWidth="2" opacity="0.25" />
        {[0,1,2,3,4,5,6].map((i) => (
          <rect key={i} x={82 + i * 56} y="106" width="12" height="4" rx="2" fill={PALETTE.lightBlue} />
        ))}
      </g>

      {/* Gantt bars */}
      <g>
        <rect x="100" y="160" width="180" height="34" rx="8" fill={PALETTE.blue} />
        <rect x="156" y="214" width="220" height="34" rx="8" fill={PALETTE.lightBlue} />
        <rect x="128" y="268" width="140" height="34" rx="8" fill={PALETTE.navy} />
        <rect x="184" y="322" width="200" height="34" rx="8" fill={PALETTE.blue} />
        {/* milestone diamond (yellow) on the rightmost bar */}
        <g transform="translate(384 339)">
          <rect x="-14" y="-14" width="28" height="28" rx="3" transform="rotate(45)" fill={PALETTE.yellow} stroke={PALETTE.navy} strokeWidth="2" />
        </g>
      </g>

      {/* row indicator dots on the left */}
      <g>
        {[177, 231, 285, 339].map((y, i) => (
          <circle key={i} cx="80" cy={y} r="4" fill={PALETTE.lightBlue} />
        ))}
      </g>
    </SquircleFrame>
  );
}

/* ─── ICON 4 — State Logic Builder ─────────────────────────────────────── */
function IconStateLogic() {
  return (
    <SquircleFrame id="state">
      {/* Subtle ladder logic texture */}
      <g>
        {/* ladder rails */}
        <line x1="76"  y1="100" x2="76"  y2="412" stroke={PALETTE.lightBlue} strokeWidth="2" opacity="0.6" />
        <line x1="436" y1="100" x2="436" y2="412" stroke={PALETTE.lightBlue} strokeWidth="2" opacity="0.6" />
        {/* ladder rungs */}
        {[120,176,232,288,344,400].map((y) => (
          <line key={y} x1="76" y1={y} x2="436" y2={y} stroke={PALETTE.lightBlue} strokeWidth="1.5" opacity="0.45" />
        ))}
        {/* contact symbols scattered (small NO contacts) */}
        <g stroke={PALETTE.lightBlue} strokeWidth="2.5" fill="none">
          <line x1="118" y1="115" x2="118" y2="125" />
          <line x1="128" y1="115" x2="128" y2="125" />
          <line x1="356" y1="395" x2="356" y2="405" />
          <line x1="366" y1="395" x2="366" y2="405" />
        </g>
      </g>

      {/* Node 1 — idle (white card, navy outline) */}
      <g>
        <rect x="92" y="156" width="148" height="74" rx="16" fill="#ffffff" stroke={PALETTE.navy} strokeWidth="2.5" />
        <circle cx="116" cy="193" r="7" fill={PALETTE.lightBlue} />
        <rect x="134" y="184" width="84" height="6" rx="3" fill={PALETTE.ink} />
        <rect x="134" y="198" width="60" height="5" rx="2.5" fill={PALETTE.inkDim} />
      </g>

      {/* Node 2 — ACTIVE (SDC blue with soft light-blue halo) */}
      <g>
        {/* halo rings */}
        <rect x="158" y="202" width="204" height="108" rx="24" fill="none" stroke={PALETTE.lightBlue} strokeWidth="2" opacity="0.55" />
        <rect x="170" y="214" width="180" height="84" rx="20" fill="none" stroke={PALETTE.blue} strokeWidth="2" opacity="0.35" />
        {/* node body */}
        <rect x="180" y="224" width="152" height="64" rx="14" fill={PALETTE.blue} />
        <circle cx="206" cy="256" r="7" fill={PALETTE.yellow} />
        <rect x="224" y="247" width="86" height="6" rx="3" fill="#ffffff" />
        <rect x="224" y="261" width="60" height="5" rx="2.5" fill="#ffffff" opacity="0.7" />
      </g>

      {/* Node 3 — idle */}
      <g>
        <rect x="272" y="320" width="148" height="74" rx="16" fill="#ffffff" stroke={PALETTE.navy} strokeWidth="2.5" />
        <circle cx="296" cy="357" r="7" fill={PALETTE.lightBlue} />
        <rect x="314" y="348" width="84" height="6" rx="3" fill={PALETTE.ink} />
        <rect x="314" y="362" width="60" height="5" rx="2.5" fill={PALETTE.inkDim} />
      </g>

      {/* Arrows between nodes — dark navy, crisp */}
      <g fill="none" stroke={PALETTE.navy} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
        {/* Node1 → Node2 */}
        <path d="M 200 230 C 220 254 240 252 240 224" />
        <path d="M 234 220 L 240 224 L 246 220" />
        {/* Node2 → Node3 */}
        <path d="M 290 288 C 300 308 304 316 308 318" />
        <path d="M 302 314 L 308 318 L 312 312" />
      </g>
    </SquircleFrame>
  );
}

/* ─── ICON 5 — SDC Calendar ────────────────────────────────────────────── */
function IconCalendar() {
  const cols = 4, rows = 3;
  const gridX = 100, gridY = 184;
  const gridW = 312, gridH = 234;
  const cellW = gridW / cols;
  const cellH = gridH / rows;
  const highlight = { col: 2, row: 1 };
  return (
    <SquircleFrame id="calendar">
      {/* card body */}
      <rect x="84" y="116" width="344" height="320" rx="22" fill="#ffffff" stroke={PALETTE.lightBlue} strokeWidth="2" />
      {/* header bar — dark navy */}
      <rect x="84" y="116" width="344" height="56" rx="22" fill={PALETTE.navy} />
      <rect x="84" y="148" width="344" height="24" fill={PALETTE.navy} />
      {/* hangers */}
      <rect x="146" y="96"  width="14" height="40" rx="6" fill={PALETTE.navy} />
      <rect x="352" y="96"  width="14" height="40" rx="6" fill={PALETTE.navy} />
      {/* month label */}
      <rect x="108" y="138" width="92" height="8" rx="4" fill="#ffffff" opacity="0.95" />
      <rect x="108" y="152" width="50" height="6" rx="3" fill="#ffffff" opacity="0.45" />

      {/* Grid cells */}
      {Array.from({ length: rows }).map((_, r) =>
        Array.from({ length: cols }).map((__, c) => {
          const x = gridX + c * cellW + 4;
          const y = gridY + r * cellH + 4;
          const w = cellW - 8;
          const h = cellH - 8;
          const isHighlight = r === highlight.row && c === highlight.col;
          return (
            <g key={`${r}-${c}`}>
              <rect x={x} y={y} width={w} height={h} rx="10"
                    fill={isHighlight ? PALETTE.blue : "#f4f8fc"}
                    stroke={isHighlight ? PALETTE.blue : PALETTE.lightBlue}
                    strokeWidth="1.5" />
              {/* date tick */}
              <rect
                x={x + 10} y={y + 10}
                width={isHighlight ? 22 : 14} height="6" rx="3"
                fill={isHighlight ? "#ffffff" : PALETTE.lightBlue}
              />
              {/* event dots */}
              {!isHighlight && ((r === 0 && c === 0) || (r === 2 && c === 3)) && (
                <circle cx={x + 16} cy={y + h - 14} r="4" fill={PALETTE.yellow} />
              )}
              {isHighlight && (
                <circle cx={x + 16} cy={y + h - 14} r="4" fill="#ffffff" />
              )}
            </g>
          );
        })
      )}

      {/* Sync arc — SDC blue, top-right */}
      <g fill="none" stroke={PALETTE.blue} strokeWidth="8" strokeLinecap="round">
        <path d="M 360 86 A 70 70 0 0 1 430 156" />
        <path d="M 422 138 L 432 156 L 414 162" strokeLinejoin="round" />
      </g>
    </SquircleFrame>
  );
}

/* ─── Index ────────────────────────────────────────────────────────────── */
const ICONS = [
  { id: "assemblies",  name: "Assemblies Library",      sub: "SolidWorks CAD vault",            Cmp: IconAssemblies },
  { id: "readiness",   name: "Build Readiness Report",  sub: "Live build status & sign-off",    Cmp: IconBuildReadiness },
  { id: "scheduler",   name: "SDC Scheduler",           sub: "Gantt & resource loading",        Cmp: IconScheduler },
  { id: "statelogic",  name: "State Logic Builder",     sub: "PLC state-machine → L5X",         Cmp: IconStateLogic },
  { id: "calendar",    name: "SDC Calendar",            sub: "Company-wide synced calendar",    Cmp: IconCalendar },
];

Object.assign(window, { ICONS, PALETTE, SquircleFrame, IconAssemblies, IconBuildReadiness, IconScheduler, IconStateLogic, IconCalendar });
