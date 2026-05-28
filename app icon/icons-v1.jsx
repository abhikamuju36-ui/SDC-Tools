// SDC Tools — 5 app icons
// Container: 512×512 squircle, deep navy bg, ~15% padding, transparent outside

const PALETTE = {
  bg: "#0d0d1a",
  bgLift: "#14142a",       // slightly lighter inner panel
  bgEdge: "#070710",       // darker inner edge
  blue: "#3b6ef5",
  blueDeep: "#1d4ed8",
  teal: "#00c2a8",
  tealDeep: "#009480",
  white: "#ffffff",
  amber: "#f59e0b",
  ink: "#8c93b4",          // muted line color on navy
  inkDim: "#3a3f5c",
};

/* ─── Squircle container with iOS-style superellipse ───────────────────── */
// Uses cubic-bezier approximation of a continuous-curvature squircle.
// For 512×512 the corner radius reads ~115px visually.
function squirclePath(size = 512) {
  const s = size;
  const r = s * 0.2237; // ~115 for 512
  const c = r * 0.55228; // smoothing handle
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

function SquircleFrame({ id, children, glow }) {
  const clipId = `sq-${id}`;
  const glowId = `glow-${id}`;
  return (
    <svg viewBox="0 0 512 512" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style={{ display: "block" }}>
      <defs>
        <clipPath id={clipId}>
          <path d={squirclePath(512)} />
        </clipPath>
        {glow && (
          <radialGradient id={glowId} cx="50%" cy="38%" r="60%">
            <stop offset="0%" stopColor={glow} stopOpacity="0.22" />
            <stop offset="60%" stopColor={glow} stopOpacity="0.04" />
            <stop offset="100%" stopColor={glow} stopOpacity="0" />
          </radialGradient>
        )}
      </defs>
      {/* base fill */}
      <path d={squirclePath(512)} fill={PALETTE.bg} />
      {/* subtle inner glow */}
      {glow && <rect x="0" y="0" width="512" height="512" fill={`url(#${glowId})`} clipPath={`url(#${clipId})`} />}
      {/* subtle top-edge sheen (1.5px) — gives iOS depth without a drop shadow */}
      <path
        d={squirclePath(512)}
        fill="none"
        stroke="rgba(255,255,255,0.06)"
        strokeWidth="1.5"
        style={{ mixBlendMode: "screen" }}
      />
      <g clipPath={`url(#${clipId})`}>{children}</g>
    </svg>
  );
}

/* ─── ICON 1 — Assemblies Library ──────────────────────────────────────── */
// Stack of 3 sheets in navy tints; isometric gear emerges from the stack
// in electric blue with white edge highlight.
function IconAssemblies() {
  return (
    <SquircleFrame id="assemblies" glow={PALETTE.blue}>
      {/* Stack of layered sheets — three sheets, offset, navy tints */}
      <g>
        {/* Sheet 3 (back) */}
        <rect x="118" y="262" width="240" height="160" rx="14" fill="#1c1f3a" stroke="rgba(255,255,255,0.05)" strokeWidth="1.5" />
        {/* sheet 3 lines */}
        <rect x="138" y="288" width="120" height="6" rx="3" fill={PALETTE.inkDim} />
        <rect x="138" y="306" width="170" height="6" rx="3" fill={PALETTE.inkDim} />
        <rect x="138" y="324" width="90" height="6"  rx="3" fill={PALETTE.inkDim} />

        {/* Sheet 2 (middle), shifted up-right */}
        <rect x="138" y="232" width="260" height="170" rx="14" fill="#23274a" stroke="rgba(255,255,255,0.06)" strokeWidth="1.5" />
        <rect x="158" y="260" width="140" height="6" rx="3" fill={PALETTE.ink} opacity="0.45" />
        <rect x="158" y="278" width="200" height="6" rx="3" fill={PALETTE.ink} opacity="0.45" />
        <rect x="158" y="296" width="110" height="6" rx="3" fill={PALETTE.ink} opacity="0.45" />

        {/* Sheet 1 (front) — slightly off white-ish, reads as the "active" sheet */}
        <rect x="156" y="206" width="270" height="180" rx="14" fill="#2c3260" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" />
        <rect x="178" y="234" width="130" height="6" rx="3" fill={PALETTE.ink} opacity="0.6" />
        <rect x="178" y="252" width="190" height="6" rx="3" fill={PALETTE.ink} opacity="0.6" />
        <rect x="178" y="270" width="100" height="6" rx="3" fill={PALETTE.ink} opacity="0.6" />
      </g>

      {/* Isometric gear emerging — drawn front-facing then skewed slightly for iso feel */}
      <g transform="translate(256 220) rotate(-12)">
        {/* gear extrusion (side depth) — darker blue, offset down/right */}
        <g transform="translate(6 12)">
          <Gear color={PALETTE.blueDeep} accent={PALETTE.blueDeep} />
        </g>
        {/* gear face */}
        <Gear color={PALETTE.blue} accent={PALETTE.white} />
      </g>
    </SquircleFrame>
  );
}

function Gear({ color, accent }) {
  // 10-tooth gear, ~140px radius
  const teeth = 10;
  const rOuter = 140;
  const rInner = 110;
  const toothHalfWidth = 0.18; // radians half-width
  const pts = [];
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2 - Math.PI / 2;
    const aNext = ((i + 1) / teeth) * Math.PI * 2 - Math.PI / 2;
    // outer (tooth tip) — two corners
    pts.push([Math.cos(a - toothHalfWidth) * rOuter, Math.sin(a - toothHalfWidth) * rOuter]);
    pts.push([Math.cos(a + toothHalfWidth) * rOuter, Math.sin(a + toothHalfWidth) * rOuter]);
    // inner (root) — two corners going to next tooth
    pts.push([Math.cos(a + toothHalfWidth + 0.10) * rInner, Math.sin(a + toothHalfWidth + 0.10) * rInner]);
    pts.push([Math.cos(aNext - toothHalfWidth - 0.10) * rInner, Math.sin(aNext - toothHalfWidth - 0.10) * rInner]);
  }
  const d = "M " + pts.map((p) => p.map((n) => n.toFixed(2)).join(" ")).join(" L ") + " Z";
  return (
    <g>
      <path d={d} fill={color} />
      {/* top-edge highlight — only the upper arc, achieved with a thin offset stroke */}
      <path d={d} fill="none" stroke={accent} strokeWidth="3" strokeLinejoin="round" opacity={accent === PALETTE.white ? 0.85 : 0} />
      {/* center bore */}
      <circle cx="0" cy="0" r="40" fill={PALETTE.bg} />
      <circle cx="0" cy="0" r="40" fill="none" stroke={accent} strokeWidth="3" opacity={accent === PALETTE.white ? 0.85 : 0} />
      {/* spoke crosshair */}
      <circle cx="0" cy="0" r="14" fill={accent === PALETTE.white ? PALETTE.white : PALETTE.blueDeep} />
    </g>
  );
}

/* ─── ICON 2 — Build Readiness Report ──────────────────────────────────── */
function IconBuildReadiness() {
  return (
    <SquircleFrame id="readiness" glow={PALETTE.blue}>
      {/* Clipboard */}
      <g>
        {/* clip top */}
        <rect x="216" y="76"  width="80"  height="32" rx="8" fill="#3a3f5c" />
        <rect x="232" y="68"  width="48"  height="20" rx="6" fill="#5b6390" />
        {/* board */}
        <rect x="116" y="100" width="280" height="336" rx="22" fill="#1c1f3a" stroke="rgba(255,255,255,0.06)" strokeWidth="1.5" />
        {/* inner panel */}
        <rect x="140" y="124" width="232" height="288" rx="14" fill="#11142a" />

        {/* Checklist rows */}
        {[0,1,2].map((i) => {
          const y = 156 + i * 46;
          const checked = i < 2;
          return (
            <g key={i}>
              {/* checkbox */}
              <rect x="160" y={y} width="26" height="26" rx="6" fill={checked ? PALETTE.teal : "transparent"} stroke={checked ? PALETTE.teal : "#3a3f5c"} strokeWidth="2.5" />
              {checked && (
                <path d={`M ${166} ${y+13} L ${172} ${y+19} L ${181} ${y+9}`} fill="none" stroke={PALETTE.bg} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
              )}
              {/* row text */}
              <rect x="200" y={y+5} width={i===0?150:i===1?120:90} height="6" rx="3" fill={checked ? PALETTE.ink : PALETTE.inkDim} opacity={checked ? 0.85 : 1} />
              <rect x="200" y={y+19} width={i===0?100:i===1?70:140} height="5" rx="2.5" fill={PALETTE.inkDim} />
            </g>
          );
        })}

        {/* Progress ring overlay — sits in lower-right of clipboard */}
        <g transform="translate(344 360)">
          {/* track */}
          <circle cx="0" cy="0" r="58" fill={PALETTE.bg} />
          <circle cx="0" cy="0" r="48" fill="none" stroke="#23274a" strokeWidth="10" />
          {/* progress arc — 72% */}
          <circle
            cx="0" cy="0" r="48"
            fill="none"
            stroke={PALETTE.blue}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 48 * 0.72} ${2 * Math.PI * 48}`}
            transform="rotate(-90)"
          />
          {/* center: amber warning circle with teal checkmark cutting through */}
          <circle cx="0" cy="0" r="26" fill={PALETTE.amber} />
          <path d="M -12 0 L -3 9 L 14 -10" fill="none" stroke={PALETTE.teal} strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </g>
    </SquircleFrame>
  );
}

/* ─── ICON 3 — SDC Scheduler ───────────────────────────────────────────── */
function IconScheduler() {
  return (
    <SquircleFrame id="scheduler" glow={PALETTE.teal}>
      {/* Grid background */}
      <g opacity="0.5">
        {[1,2,3,4,5,6].map((i) => (
          <line key={i} x1={88 + i * 56} y1="120" x2={88 + i * 56} y2="392" stroke="#23274a" strokeWidth="1.5" />
        ))}
        {/* top axis line */}
        <line x1="80" y1="120" x2="432" y2="120" stroke="#3a3f5c" strokeWidth="2" />
        {/* date ticks */}
        {[0,1,2,3,4,5,6].map((i) => (
          <rect key={i} x={82 + i * 56} y="106" width="12" height="4" rx="2" fill="#5b6390" />
        ))}
      </g>

      {/* Gantt bars */}
      <g>
        <rect x="100" y="160" width="180" height="34" rx="8" fill={PALETTE.blue} />
        <rect x="100" y="160" width="180" height="34" rx="8" fill="url(#barSheen-1)" opacity="0.0" />

        <rect x="156" y="214" width="220" height="34" rx="8" fill={PALETTE.teal} />

        <rect x="128" y="268" width="140" height="34" rx="8" fill={PALETTE.blue} opacity="0.85" />

        <rect x="184" y="322" width="200" height="34" rx="8" fill={PALETTE.teal} opacity="0.85" />
        {/* milestone diamond on the rightmost bar */}
        <g transform="translate(384 339)">
          <rect x="-14" y="-14" width="28" height="28" rx="3" transform="rotate(45)" fill={PALETTE.amber} />
        </g>
      </g>

      {/* row labels — small dots on the left */}
      <g>
        {[177, 231, 285, 339].map((y, i) => (
          <circle key={i} cx="80" cy={y} r="4" fill="#3a3f5c" />
        ))}
      </g>
    </SquircleFrame>
  );
}

/* ─── ICON 4 — State Logic Builder ─────────────────────────────────────── */
function IconStateLogic() {
  return (
    <SquircleFrame id="state" glow={PALETTE.blue}>
      {/* Subtle circuit / ladder logic texture behind */}
      <g opacity="0.55">
        {/* ladder rails */}
        <line x1="76"  y1="100" x2="76"  y2="412" stroke="#1f2340" strokeWidth="2" />
        <line x1="436" y1="100" x2="436" y2="412" stroke="#1f2340" strokeWidth="2" />
        {/* ladder rungs */}
        {[120,176,232,288,344,400].map((y) => (
          <line key={y} x1="76" y1={y} x2="436" y2={y} stroke="#1a1d36" strokeWidth="2" />
        ))}
        {/* contact symbols scattered */}
        <g stroke="#23274a" strokeWidth="2.5" fill="none">
          <line x1="118" y1="115" x2="118" y2="125" />
          <line x1="128" y1="115" x2="128" y2="125" />
          <line x1="356" y1="395" x2="356" y2="405" />
          <line x1="366" y1="395" x2="366" y2="405" />
        </g>
      </g>

      {/* Node 1 — top-left, idle */}
      <g>
        <rect x="92" y="156" width="148" height="74" rx="16" fill="#1c1f3a" stroke="#3a3f5c" strokeWidth="2.5" />
        <circle cx="116" cy="193" r="7" fill="#5b6390" />
        <rect x="134" y="184" width="84" height="6" rx="3" fill={PALETTE.ink} opacity="0.6" />
        <rect x="134" y="198" width="60" height="5" rx="2.5" fill={PALETTE.inkDim} />
      </g>

      {/* Node 2 — center, ACTIVE (electric blue glow) */}
      <g>
        {/* outer halo */}
        <rect x="172" y="216" width="168" height="80" rx="18" fill="none" stroke={PALETTE.blue} strokeWidth="2" opacity="0.35" transform="translate(0 0) scale(1)" />
        <rect x="166" y="210" width="180" height="92" rx="20" fill="none" stroke={PALETTE.blue} strokeWidth="1.5" opacity="0.18" />
        {/* node body */}
        <rect x="180" y="224" width="152" height="64" rx="14" fill={PALETTE.blue} />
        <circle cx="206" cy="256" r="7" fill={PALETTE.white} />
        <rect x="224" y="247" width="86" height="6" rx="3" fill={PALETTE.white} opacity="0.95" />
        <rect x="224" y="261" width="60" height="5" rx="2.5" fill={PALETTE.white} opacity="0.65" />
      </g>

      {/* Node 3 — bottom-right, idle */}
      <g>
        <rect x="272" y="320" width="148" height="74" rx="16" fill="#1c1f3a" stroke="#3a3f5c" strokeWidth="2.5" />
        <circle cx="296" cy="357" r="7" fill="#5b6390" />
        <rect x="314" y="348" width="84" height="6" rx="3" fill={PALETTE.ink} opacity="0.6" />
        <rect x="314" y="362" width="60" height="5" rx="2.5" fill={PALETTE.inkDim} />
      </g>

      {/* Arrows connecting nodes */}
      <g fill="none" stroke={PALETTE.teal} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
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
  // 4 cols × 3 rows grid
  const cols = 4, rows = 3;
  const gridX = 100, gridY = 184;
  const gridW = 312, gridH = 234;
  const cellW = gridW / cols;
  const cellH = gridH / rows;
  const highlight = { col: 2, row: 1 }; // 0-indexed
  return (
    <SquircleFrame id="calendar" glow={PALETTE.blue}>
      {/* Calendar body */}
      <rect x="84" y="116" width="344" height="320" rx="22" fill="#14172e" stroke="rgba(255,255,255,0.06)" strokeWidth="1.5" />
      {/* header bar */}
      <rect x="84" y="116" width="344" height="56" rx="22" fill="#1c2046" />
      {/* mask the bottom corners of header so it doesn't show rounding mid-card */}
      <rect x="84" y="148" width="344" height="24" fill="#1c2046" />
      {/* rings/hangers */}
      <rect x="146" y="96"  width="14" height="40" rx="6" fill="#3a3f5c" />
      <rect x="352" y="96"  width="14" height="40" rx="6" fill="#3a3f5c" />
      {/* month label */}
      <rect x="108" y="138" width="92" height="8" rx="4" fill={PALETTE.ink} opacity="0.7" />
      <rect x="108" y="152" width="50" height="6" rx="3" fill={PALETTE.inkDim} />

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
              <rect x={x} y={y} width={w} height={h} rx="10" fill={isHighlight ? PALETTE.teal : "#1f2342"} />
              {/* date number tick */}
              <rect
                x={x + 10} y={y + 10}
                width={isHighlight ? 22 : 14} height="6" rx="3"
                fill={isHighlight ? PALETTE.bg : PALETTE.inkDim}
              />
              {/* event dot for a couple cells */}
              {!isHighlight && ((r === 0 && c === 0) || (r === 2 && c === 3)) && (
                <circle cx={x + 16} cy={y + h - 14} r="4" fill={PALETTE.blue} />
              )}
              {isHighlight && (
                <circle cx={x + 16} cy={y + h - 14} r="4" fill={PALETTE.bg} />
              )}
            </g>
          );
        })
      )}

      {/* Sync arc wrapping the top-right corner */}
      <g fill="none" stroke={PALETTE.blue} strokeWidth="8" strokeLinecap="round">
        <path d="M 360 86 A 70 70 0 0 1 430 156" />
        {/* arrow head */}
        <path d="M 422 138 L 432 156 L 414 162" strokeLinejoin="round" />
      </g>
    </SquircleFrame>
  );
}

/* ─── Index of icons ───────────────────────────────────────────────────── */
const ICONS = [
  { id: "assemblies",  name: "Assemblies Library",      sub: "SolidWorks CAD vault",            Cmp: IconAssemblies },
  { id: "readiness",   name: "Build Readiness Report",  sub: "Live build status & sign-off",    Cmp: IconBuildReadiness },
  { id: "scheduler",   name: "SDC Scheduler",           sub: "Gantt & resource loading",        Cmp: IconScheduler },
  { id: "statelogic",  name: "State Logic Builder",     sub: "PLC state-machine → L5X",         Cmp: IconStateLogic },
  { id: "calendar",    name: "SDC Calendar",            sub: "Company-wide synced calendar",    Cmp: IconCalendar },
];

Object.assign(window, { ICONS, PALETTE, SquircleFrame, IconAssemblies, IconBuildReadiness, IconScheduler, IconStateLogic, IconCalendar });
