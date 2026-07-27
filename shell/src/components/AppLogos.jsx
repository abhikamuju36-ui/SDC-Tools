/**
 * AppLogos — inline SVG card icons, brand-accurate per SDC Brand Guide 2026.
 * Designs match shell/build/icons/ PNGs (same geometry, same palette).
 */

/* ── Shared geometry ─────────────────────────────────────────────────────── */
const SQ =
  'M114.53 0L397.47 0C460.73 0 512 51.27 512 114.53L512 397.47' +
  'C512 460.73 460.73 512 397.47 512L114.53 512' +
  'C51.27 512 0 460.73 0 397.47L0 114.53C0 51.27 51.27 0 114.53 0Z';

function buildGearPath() {
  const teeth = 10, rO = 138, rI = 112, hw = 0.15;
  const pts = [];
  for (let i = 0; i < teeth; i++) {
    const a  = (i / teeth) * Math.PI * 2 - Math.PI / 2;
    const aN = ((i + 1) / teeth) * Math.PI * 2 - Math.PI / 2;
    [[a - hw, rO], [a + hw, rO], [a + hw + 0.10, rI], [aN - hw - 0.10, rI]]
      .forEach(([ang, r]) =>
        pts.push(`${(Math.cos(ang) * r).toFixed(2)},${(Math.sin(ang) * r).toFixed(2)}`)
      );
  }
  return `M ${pts.join(' L ')} Z`;
}
const GEAR = buildGearPath();

const P = {
  blue:  '#1574C4',
  navy:  '#061D39',
  lb:    '#AACEE8',
  yel:   '#FFDE51',
  green: '#74C415',
};
const BG_GRAD = (id) => (
  <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%"   stopColor="#ffffff" />
    <stop offset="100%" stopColor="#f4f7fb" />
  </linearGradient>
);

/* ── ASSEMBLIES LIBRARY ──────────────────────────────────────────────────── */
export function AssembliesLogo({ size = 48 }) {
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id="sq-al"><path d={SQ} /></clipPath>
        {BG_GRAD('bg-al')}
      </defs>
      <path d={SQ} fill="url(#bg-al)" />
      <path d={SQ} fill="none" stroke="rgba(6,29,57,0.12)" strokeWidth="2" />
      <g clipPath="url(#sq-al)">
        {/* Layered sheets */}
        <rect x="118" y="262" width="240" height="160" rx="14" fill="#dde9f5" stroke={P.lb} strokeWidth="1.5" />
        <rect x="138" y="288" width="120" height="6" rx="3" fill={P.lb} />
        <rect x="138" y="306" width="170" height="6" rx="3" fill={P.lb} />
        <rect x="138" y="324" width="90"  height="6" rx="3" fill={P.lb} />
        <rect x="138" y="232" width="260" height="170" rx="14" fill="#e9f1f9" stroke={P.lb} strokeWidth="1.5" />
        <rect x="158" y="260" width="140" height="6" rx="3" fill={P.lb} />
        <rect x="158" y="278" width="200" height="6" rx="3" fill={P.lb} />
        <rect x="158" y="296" width="110" height="6" rx="3" fill={P.lb} />
        <rect x="156" y="206" width="270" height="180" rx="14" fill="#ffffff" stroke={P.lb} strokeWidth="1.5" />
        <rect x="178" y="234" width="130" height="6" rx="3" fill="#9ab9d4" />
        <rect x="178" y="252" width="190" height="6" rx="3" fill="#9ab9d4" />
        <rect x="178" y="270" width="100" height="6" rx="3" fill="#9ab9d4" />
        {/* Gear — subtle shadow then main */}
        <g transform="translate(256,220) rotate(-12)">
          <g transform="translate(3,4)" opacity="0.18">
            <path d={GEAR} fill={P.navy} />
            <circle cx="0" cy="0" r="40" fill="#ffffff" />
            <circle cx="0" cy="0" r="14" fill={P.navy} />
          </g>
          <path d={GEAR} fill={P.blue} />
          <circle cx="0" cy="0" r="40" fill="#ffffff" />
          <circle cx="0" cy="0" r="14" fill={P.blue} />
        </g>
      </g>
    </svg>
  );
}

/* ── BUILD READINESS REPORT ──────────────────────────────────────────────── */
export function ReadinessLogo({ size = 48 }) {
  const rows = [
    { y: 156, ok: true,  w1: 150, w2: 100 },
    { y: 202, ok: true,  w1: 120, w2: 70  },
    { y: 248, ok: false, w1: 90,  w2: 140 },
  ];
  const circR = 48;
  const circ  = 2 * Math.PI * circR;
  const dash  = (circ * 0.72).toFixed(2);
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id="sq-rl"><path d={SQ} /></clipPath>
        {BG_GRAD('bg-rl')}
      </defs>
      <path d={SQ} fill="url(#bg-rl)" />
      <path d={SQ} fill="none" stroke="rgba(6,29,57,0.12)" strokeWidth="2" />
      <g clipPath="url(#sq-rl)">
        {/* Clipboard */}
        <rect x="216" y="76"  width="80" height="32" rx="8" fill={P.navy} />
        <rect x="232" y="68"  width="48" height="20" rx="6" fill={P.blue} />
        <rect x="116" y="100" width="280" height="336" rx="22" fill="#ffffff" stroke={P.lb} strokeWidth="2" />
        <rect x="140" y="124" width="232" height="288" rx="14" fill="#f4f8fc" />
        {/* Checklist rows */}
        {rows.map(({ y, ok, w1, w2 }) => (
          <g key={y}>
            <rect x="160" y={y} width="26" height="26" rx="6"
              fill={ok ? P.green : '#ffffff'}
              stroke={ok ? P.green : P.lb} strokeWidth="2.5" />
            {ok && (
              <path d={`M 166 ${y + 13} L 172 ${y + 19} L 181 ${y + 9}`}
                fill="none" stroke="#ffffff" strokeWidth="3.5"
                strokeLinecap="round" strokeLinejoin="round" />
            )}
            <rect x="200" y={y + 5}  width={w1} height="6" rx="3"
              fill={ok ? P.navy : 'rgba(6,29,57,0.28)'} opacity={ok ? 0.85 : 1} />
            <rect x="200" y={y + 19} width={w2} height="5" rx="2.5" fill={P.lb} />
          </g>
        ))}
        {/* Progress ring badge */}
        <g transform="translate(344,360)">
          <circle cx="0" cy="0" r="58" fill="#ffffff" stroke={P.lb} strokeWidth="2" />
          <circle cx="0" cy="0" r={circR} fill="none" stroke="#e6eef6" strokeWidth="10" />
          <circle cx="0" cy="0" r={circR} fill="none" stroke={P.blue} strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circ.toFixed(2)}`}
            transform="rotate(-90)" />
          <circle cx="0" cy="0" r="26" fill={P.yel} />
          <path d="M -12 0 L -3 9 L 14 -10" fill="none" stroke={P.green}
            strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </g>
    </svg>
  );
}

/* ── SDC SCHEDULER ───────────────────────────────────────────────────────── */
export function SchedulerLogo({ size = 48 }) {
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id="sq-sc"><path d={SQ} /></clipPath>
        {BG_GRAD('bg-sc')}
      </defs>
      <path d={SQ} fill="url(#bg-sc)" />
      <path d={SQ} fill="none" stroke="rgba(6,29,57,0.12)" strokeWidth="2" />
      <g clipPath="url(#sq-sc)">
        {/* Vertical grid lines */}
        {[1,2,3,4,5,6].map(i => (
          <line key={i} x1={88 + i * 56} y1="120" x2={88 + i * 56} y2="392"
            stroke="rgba(6,29,57,0.10)" strokeWidth="1.5" />
        ))}
        <line x1="80" y1="120" x2="432" y2="120" stroke={P.navy} strokeWidth="2" opacity="0.25" />
        {/* Tick marks */}
        {[0,1,2,3,4,5,6].map(i => (
          <rect key={i} x={82 + i * 56} y="106" width="12" height="4" rx="2" fill={P.lb} />
        ))}
        {/* Gantt bars */}
        <rect x="100" y="160" width="180" height="34" rx="8" fill={P.blue} />
        <rect x="156" y="214" width="220" height="34" rx="8" fill={P.lb} />
        <rect x="128" y="268" width="140" height="34" rx="8" fill={P.navy} />
        <rect x="184" y="322" width="200" height="34" rx="8" fill={P.blue} />
        {/* Milestone diamond */}
        <g transform="translate(384,339)">
          <rect x="-14" y="-14" width="28" height="28" rx="3" transform="rotate(45)"
            fill={P.yel} stroke={P.navy} strokeWidth="2" />
        </g>
        {/* Row dots */}
        {[177,231,285,339].map(y => (
          <circle key={y} cx="80" cy={y} r="4" fill={P.lb} />
        ))}
      </g>
    </svg>
  );
}

/* ── STATE LOGIC BUILDER ─────────────────────────────────────────────────── */
export function StateLogicLogo({ size = 48 }) {
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id="sq-sl"><path d={SQ} /></clipPath>
        {BG_GRAD('bg-sl')}
      </defs>
      <path d={SQ} fill="url(#bg-sl)" />
      <path d={SQ} fill="none" stroke="rgba(6,29,57,0.12)" strokeWidth="2" />
      <g clipPath="url(#sq-sl)">
        {/* PLC ladder rails */}
        <line x1="76"  y1="100" x2="76"  y2="412" stroke={P.lb} strokeWidth="2.5" opacity="0.85" />
        <line x1="436" y1="100" x2="436" y2="412" stroke={P.lb} strokeWidth="2.5" opacity="0.85" />
        {/* Rungs */}
        {[120,176,232,288,344,400].map(y => (
          <line key={y} x1="76" y1={y} x2="436" y2={y}
            stroke={P.lb} strokeWidth="2" opacity="0.7" />
        ))}
        {/* Contact symbols */}
        <g stroke={P.lb} strokeWidth="2.5" fill="none">
          <line x1="118" y1="115" x2="118" y2="125" />
          <line x1="128" y1="115" x2="128" y2="125" />
          <line x1="356" y1="395" x2="356" y2="405" />
          <line x1="366" y1="395" x2="366" y2="405" />
        </g>
        {/* Inactive state node */}
        <rect x="92" y="156" width="148" height="74" rx="16" fill="#ffffff" stroke={P.navy} strokeWidth="2.5" />
        <circle cx="116" cy="193" r="7" fill={P.lb} />
        <rect x="134" y="184" width="84" height="6" rx="3" fill="rgba(6,29,57,0.55)" />
        <rect x="134" y="198" width="60" height="5" rx="2.5" fill="rgba(6,29,57,0.28)" />
        {/* Focus rings */}
        <rect x="158" y="202" width="204" height="108" rx="24" fill="none" stroke={P.lb} strokeWidth="2" opacity="0.55" />
        <rect x="170" y="214" width="180" height="84"  rx="20" fill="none" stroke={P.blue} strokeWidth="2" opacity="0.35" />
        {/* Active state node */}
        <rect x="180" y="224" width="152" height="64" rx="14" fill={P.blue} />
        <circle cx="206" cy="256" r="7" fill={P.yel} />
        <rect x="224" y="247" width="86" height="6" rx="3" fill="#ffffff" />
        <rect x="224" y="261" width="60" height="5" rx="2.5" fill="#ffffff" opacity="0.7" />
        {/* Next state node */}
        <rect x="272" y="320" width="148" height="74" rx="16" fill="#ffffff" stroke={P.navy} strokeWidth="2.5" />
        <circle cx="296" cy="357" r="7" fill={P.lb} />
        <rect x="314" y="348" width="84" height="6" rx="3" fill="rgba(6,29,57,0.55)" />
        <rect x="314" y="362" width="60" height="5" rx="2.5" fill="rgba(6,29,57,0.28)" />
        {/* Transition arrows */}
        <g fill="none" stroke={P.navy} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M 200 230 C 220 254 240 252 240 224" />
          <path d="M 234 220 L 240 224 L 246 220" />
          <path d="M 290 288 C 300 308 304 316 308 318" />
          <path d="M 302 314 L 308 318 L 312 312" />
        </g>
      </g>
    </svg>
  );
}

/* ── SDC CALENDAR ────────────────────────────────────────────────────────── */
export function CalendarLogo({ size = 48 }) {
  const cols = 4, rows = 3, gx = 100, gy = 184, gw = 312, gh = 234;
  const cw = gw / cols, ch = gh / rows;
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = gx + c * cw + 4, y = gy + r * ch + 4, w = cw - 8, h = ch - 8;
      const hl = r === 1 && c === 2;
      const yd = !hl && ((r === 0 && c === 0) || (r === 2 && c === 3));
      cells.push(
        <g key={`${r}-${c}`}>
          <rect x={+x.toFixed(1)} y={+y.toFixed(1)}
            width={+w.toFixed(1)} height={+h.toFixed(1)} rx="10"
            fill={hl ? P.blue : '#f4f8fc'} stroke={hl ? P.blue : P.lb} strokeWidth="1.5" />
          <rect x={+(x + 10).toFixed(1)} y={+(y + 10).toFixed(1)}
            width={hl ? 22 : 14} height="6" rx="3"
            fill={hl ? '#ffffff' : P.lb} />
          {yd && <circle cx={+(x + 16).toFixed(1)} cy={+(y + h - 14).toFixed(1)} r="4" fill={P.yel} />}
          {hl && <circle cx={+(x + 16).toFixed(1)} cy={+(y + h - 14).toFixed(1)} r="4" fill="#ffffff" />}
        </g>
      );
    }
  }
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id="sq-ca"><path d={SQ} /></clipPath>
        {BG_GRAD('bg-ca')}
      </defs>
      <path d={SQ} fill="url(#bg-ca)" />
      <path d={SQ} fill="none" stroke="rgba(6,29,57,0.12)" strokeWidth="2" />
      <g clipPath="url(#sq-ca)">
        {/* Calendar frame */}
        <rect x="84" y="116" width="344" height="320" rx="22" fill="#ffffff" stroke={P.lb} strokeWidth="2" />
        {/* Dark header */}
        <rect x="84" y="116" width="344" height="56" rx="22" fill={P.navy} />
        <rect x="84" y="148" width="344" height="24" fill={P.navy} />
        {/* Hanger pegs */}
        <rect x="146" y="96"  width="14" height="40" rx="6" fill={P.navy} />
        <rect x="352" y="96"  width="14" height="40" rx="6" fill={P.navy} />
        {/* Header text placeholders */}
        <rect x="108" y="138" width="92" height="8" rx="4" fill="#ffffff" opacity="0.95" />
        <rect x="108" y="152" width="50" height="6" rx="3" fill="#ffffff" opacity="0.45" />
        {/* Day cells */}
        {cells}
        {/* Sync circular-arrow arc inside the header (270° CW, white) */}
        <g fill="none" stroke="rgba(255,255,255,0.82)" strokeWidth="7"
          strokeLinecap="round" strokeLinejoin="round">
          <path d="M 394 122 A 26 26 0 1 1 368 148" />
          <path d="M 361 141 L 368 148 L 375 141" />
        </g>
      </g>
    </svg>
  );
}

/* ── VENDOR TRACKER ──────────────────────────────────────────────────────── */
export function VendorLogo({ size = 48 }) {
  // Bar chart tops (floor=270): bars of height 126, 88, 110, 72
  const floor = 270;
  const bars = [
    { x: 118, h: 126, fill: P.blue,  op: null },
    { x: 205, h: 88,  fill: P.lb,    op: null },
    { x: 292, h: 110, fill: P.navy,  op: null },
    { x: 379, h: 72,  fill: P.blue,  op: '0.6' },
  ];
  const cx = bars.map(b => b.x + 29);      // [147, 234, 321, 408]
  const cy = bars.map(b => floor - b.h);   // [144, 182, 160, 198]
  const pts = cx.map((x, i) => `${x},${cy[i]}`).join(' ');

  return (
    <svg viewBox="0 0 512 512" width={size} height={size} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id="sq-vd"><path d={SQ} /></clipPath>
        {BG_GRAD('bg-vd')}
      </defs>
      <path d={SQ} fill="url(#bg-vd)" />
      <path d={SQ} fill="none" stroke="rgba(6,29,57,0.12)" strokeWidth="2" />
      <g clipPath="url(#sq-vd)">
        {/* Floor line */}
        <line x1="96" y1={floor} x2="416" y2={floor} stroke={P.navy} strokeWidth="2" opacity="0.15" />
        {/* Bars */}
        {bars.map((b, i) => (
          <rect key={i} x={b.x} y={floor - b.h} width="58" height={b.h} rx="8"
            fill={b.fill} opacity={b.op ?? undefined} />
        ))}
        {/* Growth trend line connecting bar tops */}
        <polyline points={pts} fill="none" stroke={P.green}
          strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
        {cx.map((x, i) => (
          <circle key={i} cx={x} cy={cy[i]} r="5" fill={P.green} />
        ))}
        {/* Vendor score rows */}
        <rect x="88" y="284" width="336" height="44" rx="10" fill="#f4f8fc" stroke={P.lb} strokeWidth="1.5" />
        <circle cx="113" cy="306" r="9" fill={P.blue} />
        <rect x="133" y="298" width="186" height="7" rx="3.5" fill={P.blue} opacity="0.85" />
        <rect x="133" y="311" width="104" height="5" rx="2.5" fill={P.lb} />

        <rect x="88" y="340" width="336" height="44" rx="10" fill="#f4f8fc" stroke={P.lb} strokeWidth="1.5" />
        <circle cx="113" cy="362" r="9" fill={P.green} />
        <rect x="133" y="354" width="148" height="7" rx="3.5" fill={P.green} opacity="0.85" />
        <rect x="133" y="367" width="82" height="5" rx="2.5" fill={P.lb} />

        <rect x="88" y="396" width="336" height="44" rx="10" fill="#f4f8fc" stroke={P.lb} strokeWidth="1.5" />
        <circle cx="113" cy="418" r="9" fill={P.yel} />
        <rect x="133" y="410" width="110" height="7" rx="3.5" fill={P.yel} opacity="0.9" />
        <rect x="133" y="423" width="60" height="5" rx="2.5" fill={P.lb} />
      </g>
    </svg>
  );
}

/* ── SDC PROJECTS REPORTS ────────────────────────────────────────────────── */
export function ReportsLogo({ size = 48 }) {
  const floor = 360;
  const bars = [
    { x: 150, h: 70,  fill: P.lb },
    { x: 214, h: 110, fill: P.blue },
    { x: 278, h: 92,  fill: P.navy },
    { x: 342, h: 140, fill: P.blue },
  ];
  const cx = bars.map(b => b.x + 24);
  const cy = bars.map(b => floor - b.h);
  const pts = cx.map((x, i) => `${x},${cy[i]}`).join(' ');
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id="sq-rp"><path d={SQ} /></clipPath>
        {BG_GRAD('bg-rp')}
      </defs>
      <path d={SQ} fill="url(#bg-rp)" />
      <path d={SQ} fill="none" stroke="rgba(6,29,57,0.12)" strokeWidth="2" />
      <g clipPath="url(#sq-rp)">
        {/* Report page */}
        <rect x="96" y="84" width="320" height="344" rx="22" fill="#ffffff" stroke={P.lb} strokeWidth="2" />
        {/* Dark header band */}
        <rect x="96" y="84" width="320" height="56" rx="22" fill={P.navy} />
        <rect x="96" y="116" width="320" height="24" fill={P.navy} />
        <rect x="120" y="103" width="120" height="9" rx="4.5" fill="#ffffff" opacity="0.95" />
        <rect x="120" y="120" width="70"  height="6" rx="3"   fill="#ffffff" opacity="0.45" />
        {/* Table-ish rows */}
        <rect x="120" y="166" width="180" height="6" rx="3" fill={P.lb} />
        <rect x="120" y="182" width="140" height="6" rx="3" fill={P.lb} />
        {/* Floor line */}
        <line x1="120" y1={floor} x2="392" y2={floor} stroke={P.navy} strokeWidth="2" opacity="0.15" />
        {/* Bars */}
        {bars.map((b, i) => (
          <rect key={i} x={b.x} y={floor - b.h} width="48" height={b.h} rx="8" fill={b.fill} />
        ))}
        {/* Upward trend line over the bars */}
        <polyline points={pts} fill="none" stroke={P.green} strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
        {cx.map((x, i) => (
          <circle key={i} cx={x} cy={cy[i]} r="5" fill={P.green} />
        ))}
      </g>
    </svg>
  );
}

/* ── Registry ────────────────────────────────────────────────────────────── */
const LOGOS = {
  assemblies: AssembliesLogo,
  readiness:  ReadinessLogo,
  scheduler:  SchedulerLogo,
  statelogic: StateLogicLogo,
  calendar:   CalendarLogo,
  vendor:     VendorLogo,
  reports:    ReportsLogo,
};

export default function AppLogo({ appId, size = 48 }) {
  const Logo = LOGOS[appId];
  return Logo ? <Logo size={size} /> : null;
}
