'use strict';
/**
 * generate-icons.js
 * Converts the JSX icon definitions from app icon/icons.jsx
 * into 512×512 PNG files in shell/build/icons/.
 * Run: node generate-icons.js
 */
const fs   = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'shell', 'build', 'icons');
fs.mkdirSync(OUT, { recursive: true });

const P = {
  bg:        '#ffffff',
  bgSoft:    '#f4f7fb',
  blue:      '#1574C4',
  navy:      '#061D39',
  lightBlue: '#AACEE8',
  yellow:    '#FFDE51',
  green:     '#74C415',
  gray:      '#D9D9D9',
  black:     '#231F20',
  ink:       'rgba(6,29,57,0.55)',
  inkDim:    'rgba(6,29,57,0.28)',
  inkFaint:  'rgba(6,29,57,0.10)',
  hairline:  'rgba(6,29,57,0.12)',
};

/* ── Squircle (iOS superellipse) ────────────────────────────────────────── */
function squirclePath(s = 512) {
  const r = s * 0.2237, c = r * 0.55228;
  const f = n => n.toFixed(2);
  return [
    `M ${f(r)} 0`, `L ${f(s-r)} 0`,
    `C ${f(s-r+c)} 0 ${s} ${f(r-c)} ${s} ${f(r)}`,
    `L ${s} ${f(s-r)}`,
    `C ${s} ${f(s-r+c)} ${f(s-r+c)} ${s} ${f(s-r)} ${s}`,
    `L ${f(r)} ${s}`,
    `C ${f(r-c)} ${s} 0 ${f(s-r+c)} 0 ${f(s-r)}`,
    `L 0 ${f(r)}`,
    `C 0 ${f(r-c)} ${f(r-c)} 0 ${f(r)} 0 Z`,
  ].join(' ');
}

function frame(id, inner) {
  const sq = squirclePath(512);
  return `<svg viewBox="0 0 512 512" width="512" height="512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="sq-${id}"><path d="${sq}"/></clipPath>
    <linearGradient id="bg-${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#f4f7fb"/>
    </linearGradient>
  </defs>
  <path d="${sq}" fill="url(#bg-${id})"/>
  <path d="${sq}" fill="none" stroke="${P.hairline}" stroke-width="2"/>
  <g clip-path="url(#sq-${id})">${inner}</g>
</svg>`;
}

/* ── Gear path ──────────────────────────────────────────────────────────── */
function gearPath() {
  const teeth = 10, rO = 140, rI = 110, hw = 0.18;
  const pts = [];
  for (let i = 0; i < teeth; i++) {
    const a  = (i / teeth) * Math.PI * 2 - Math.PI / 2;
    const aN = ((i+1) / teeth) * Math.PI * 2 - Math.PI / 2;
    [[a-hw, rO],[a+hw, rO],[a+hw+0.10, rI],[aN-hw-0.10, rI]].forEach(([ang, r]) =>
      pts.push(`${(Math.cos(ang)*r).toFixed(2)},${(Math.sin(ang)*r).toFixed(2)}`)
    );
  }
  return `M ${pts.join(' L ')} Z`;
}
function gear(color, stroke) {
  const d = gearPath();
  const sw = stroke && stroke !== 'none' ? `stroke="${stroke}" stroke-width="3" stroke-linejoin="round"` : 'stroke="none"';
  const dotFill = stroke && stroke !== 'none' ? P.navy : color;
  return `<path d="${d}" fill="${color}" ${sw}/>
    <circle cx="0" cy="0" r="40" fill="#ffffff" ${sw}/>
    <circle cx="0" cy="0" r="14" fill="${dotFill}"/>`;
}

/* ── ICON 1 — Assemblies Library ────────────────────────────────────────── */
function iconAssemblies() {
  return frame('assemblies', `
  <rect x="118" y="262" width="240" height="160" rx="14" fill="#dde9f5" stroke="${P.lightBlue}" stroke-width="1.5"/>
  <rect x="138" y="288" width="120" height="6" rx="3" fill="${P.lightBlue}"/>
  <rect x="138" y="306" width="170" height="6" rx="3" fill="${P.lightBlue}"/>
  <rect x="138" y="324" width="90"  height="6" rx="3" fill="${P.lightBlue}"/>
  <rect x="138" y="232" width="260" height="170" rx="14" fill="#e9f1f9" stroke="${P.lightBlue}" stroke-width="1.5"/>
  <rect x="158" y="260" width="140" height="6" rx="3" fill="${P.lightBlue}"/>
  <rect x="158" y="278" width="200" height="6" rx="3" fill="${P.lightBlue}"/>
  <rect x="158" y="296" width="110" height="6" rx="3" fill="${P.lightBlue}"/>
  <rect x="156" y="206" width="270" height="180" rx="14" fill="#ffffff" stroke="${P.lightBlue}" stroke-width="1.5"/>
  <rect x="178" y="234" width="130" height="6" rx="3" fill="#9ab9d4"/>
  <rect x="178" y="252" width="190" height="6" rx="3" fill="#9ab9d4"/>
  <rect x="178" y="270" width="100" height="6" rx="3" fill="#9ab9d4"/>
  <g transform="translate(256,220) rotate(-12)">
    <g transform="translate(6,12)">${gear(P.navy,'none')}</g>
    ${gear(P.blue, P.navy)}
  </g>`);
}

/* ── ICON 2 — Build Readiness Report ───────────────────────────────────── */
function iconReadiness() {
  const rows = [
    { y:156, ok:true,  w1:150, w2:100 },
    { y:202, ok:true,  w1:120, w2:70  },
    { y:248, ok:false, w1:90,  w2:140 },
  ];
  const chk = rows.map(({ y, ok, w1, w2 }) => `
    <rect x="160" y="${y}" width="26" height="26" rx="6"
      fill="${ok ? P.green : '#ffffff'}"
      stroke="${ok ? P.green : P.lightBlue}" stroke-width="2.5"/>
    ${ok ? `<path d="M 166 ${y+13} L 172 ${y+19} L 181 ${y+9}"
      fill="none" stroke="#ffffff" stroke-width="3.5"
      stroke-linecap="round" stroke-linejoin="round"/>` : ''}
    <rect x="200" y="${y+5}" width="${w1}" height="6" rx="3"
      fill="${ok ? P.navy : P.inkDim}" opacity="${ok ? 0.85 : 1}"/>
    <rect x="200" y="${y+19}" width="${w2}" height="5" rx="2.5" fill="${P.lightBlue}"/>`).join('');
  const r = 2 * Math.PI * 48;
  return frame('readiness', `
  <rect x="216" y="76" width="80" height="32" rx="8" fill="${P.navy}"/>
  <rect x="232" y="68" width="48" height="20" rx="6" fill="${P.blue}"/>
  <rect x="116" y="100" width="280" height="336" rx="22" fill="#ffffff" stroke="${P.lightBlue}" stroke-width="2"/>
  <rect x="140" y="124" width="232" height="288" rx="14" fill="#f4f8fc"/>
  ${chk}
  <g transform="translate(344,360)">
    <circle cx="0" cy="0" r="58" fill="#ffffff" stroke="${P.lightBlue}" stroke-width="2"/>
    <circle cx="0" cy="0" r="48" fill="none" stroke="#e6eef6" stroke-width="10"/>
    <circle cx="0" cy="0" r="48" fill="none" stroke="${P.blue}" stroke-width="10"
      stroke-linecap="round"
      stroke-dasharray="${(r*0.72).toFixed(2)} ${r.toFixed(2)}"
      transform="rotate(-90)"/>
    <circle cx="0" cy="0" r="26" fill="${P.yellow}"/>
    <path d="M -12 0 L -3 9 L 14 -10" fill="none" stroke="${P.green}"
      stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/>
  </g>`);
}

/* ── ICON 3 — SDC Scheduler ─────────────────────────────────────────────── */
function iconScheduler() {
  const vl = [1,2,3,4,5,6].map(i =>
    `<line x1="${88+i*56}" y1="120" x2="${88+i*56}" y2="392" stroke="${P.inkFaint}" stroke-width="1.5"/>`).join('');
  const tk = [0,1,2,3,4,5,6].map(i =>
    `<rect x="${82+i*56}" y="106" width="12" height="4" rx="2" fill="${P.lightBlue}"/>`).join('');
  const dt = [177,231,285,339].map(y =>
    `<circle cx="80" cy="${y}" r="4" fill="${P.lightBlue}"/>`).join('');
  return frame('scheduler', `
  ${vl}
  <line x1="80" y1="120" x2="432" y2="120" stroke="${P.navy}" stroke-width="2" opacity="0.25"/>
  ${tk}
  <rect x="100" y="160" width="180" height="34" rx="8" fill="${P.blue}"/>
  <rect x="156" y="214" width="220" height="34" rx="8" fill="${P.lightBlue}"/>
  <rect x="128" y="268" width="140" height="34" rx="8" fill="${P.navy}"/>
  <rect x="184" y="322" width="200" height="34" rx="8" fill="${P.blue}"/>
  <g transform="translate(384,339)">
    <rect x="-14" y="-14" width="28" height="28" rx="3" transform="rotate(45)"
      fill="${P.yellow}" stroke="${P.navy}" stroke-width="2"/>
  </g>
  ${dt}`);
}

/* ── ICON 4 — State Logic Builder ───────────────────────────────────────── */
function iconStateLogic() {
  const rungs = [120,176,232,288,344,400].map(y =>
    `<line x1="76" y1="${y}" x2="436" y2="${y}" stroke="${P.lightBlue}" stroke-width="1.5" opacity="0.45"/>`).join('');
  return frame('statelogic', `
  <line x1="76" y1="100" x2="76" y2="412" stroke="${P.lightBlue}" stroke-width="2" opacity="0.6"/>
  <line x1="436" y1="100" x2="436" y2="412" stroke="${P.lightBlue}" stroke-width="2" opacity="0.6"/>
  ${rungs}
  <g stroke="${P.lightBlue}" stroke-width="2.5" fill="none">
    <line x1="118" y1="115" x2="118" y2="125"/>
    <line x1="128" y1="115" x2="128" y2="125"/>
    <line x1="356" y1="395" x2="356" y2="405"/>
    <line x1="366" y1="395" x2="366" y2="405"/>
  </g>
  <rect x="92" y="156" width="148" height="74" rx="16" fill="#ffffff" stroke="${P.navy}" stroke-width="2.5"/>
  <circle cx="116" cy="193" r="7" fill="${P.lightBlue}"/>
  <rect x="134" y="184" width="84" height="6" rx="3" fill="${P.ink}"/>
  <rect x="134" y="198" width="60" height="5" rx="2.5" fill="${P.inkDim}"/>
  <rect x="158" y="202" width="204" height="108" rx="24" fill="none" stroke="${P.lightBlue}" stroke-width="2" opacity="0.55"/>
  <rect x="170" y="214" width="180" height="84" rx="20" fill="none" stroke="${P.blue}" stroke-width="2" opacity="0.35"/>
  <rect x="180" y="224" width="152" height="64" rx="14" fill="${P.blue}"/>
  <circle cx="206" cy="256" r="7" fill="${P.yellow}"/>
  <rect x="224" y="247" width="86" height="6" rx="3" fill="#ffffff"/>
  <rect x="224" y="261" width="60" height="5" rx="2.5" fill="#ffffff" opacity="0.7"/>
  <rect x="272" y="320" width="148" height="74" rx="16" fill="#ffffff" stroke="${P.navy}" stroke-width="2.5"/>
  <circle cx="296" cy="357" r="7" fill="${P.lightBlue}"/>
  <rect x="314" y="348" width="84" height="6" rx="3" fill="${P.ink}"/>
  <rect x="314" y="362" width="60" height="5" rx="2.5" fill="${P.inkDim}"/>
  <g fill="none" stroke="${P.navy}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M 200 230 C 220 254 240 252 240 224"/>
    <path d="M 234 220 L 240 224 L 246 220"/>
    <path d="M 290 288 C 300 308 304 316 308 318"/>
    <path d="M 302 314 L 308 318 L 312 312"/>
  </g>`);
}

/* ── ICON 5 — SDC Calendar ──────────────────────────────────────────────── */
function iconCalendar() {
  const cols=4, rows=3, gx=100, gy=184, gw=312, gh=234;
  const cw=gw/cols, ch=gh/rows;
  let cells = '';
  for (let r=0; r<rows; r++) for (let c=0; c<cols; c++) {
    const x=gx+c*cw+4, y=gy+r*ch+4, w=cw-8, h=ch-8;
    const hl = r===1 && c===2;
    const yd = !hl && ((r===0&&c===0)||(r===2&&c===3));
    cells += `
    <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="10"
      fill="${hl?P.blue:'#f4f8fc'}" stroke="${hl?P.blue:P.lightBlue}" stroke-width="1.5"/>
    <rect x="${(x+10).toFixed(1)}" y="${(y+10).toFixed(1)}" width="${hl?22:14}" height="6" rx="3"
      fill="${hl?'#ffffff':P.lightBlue}"/>
    ${yd?`<circle cx="${(x+16).toFixed(1)}" cy="${(y+h-14).toFixed(1)}" r="4" fill="${P.yellow}"/>`:''}
    ${hl?`<circle cx="${(x+16).toFixed(1)}" cy="${(y+h-14).toFixed(1)}" r="4" fill="#ffffff"/>`:''}`;
  }
  return frame('calendar', `
  <rect x="84" y="116" width="344" height="320" rx="22" fill="#ffffff" stroke="${P.lightBlue}" stroke-width="2"/>
  <rect x="84" y="116" width="344" height="56" rx="22" fill="${P.navy}"/>
  <rect x="84" y="148" width="344" height="24" fill="${P.navy}"/>
  <rect x="146" y="96" width="14" height="40" rx="6" fill="${P.navy}"/>
  <rect x="352" y="96" width="14" height="40" rx="6" fill="${P.navy}"/>
  <rect x="108" y="138" width="92" height="8" rx="4" fill="#ffffff" opacity="0.95"/>
  <rect x="108" y="152" width="50" height="6" rx="3" fill="#ffffff" opacity="0.45"/>
  ${cells}
  <g fill="none" stroke="${P.blue}" stroke-width="8" stroke-linecap="round">
    <path d="M 360 86 A 70 70 0 0 1 430 156"/>
    <path d="M 422 138 L 432 156 L 414 162" stroke-linejoin="round"/>
  </g>`);
}

/* ── Render all to PNG via sharp ────────────────────────────────────────── */
const icons = {
  assemblies: iconAssemblies(),
  readiness:  iconReadiness(),
  scheduler:  iconScheduler(),
  statelogic: iconStateLogic(),
  calendar:   iconCalendar(),
};

async function main() {
  const sharp = require('sharp');
  for (const [name, svg] of Object.entries(icons)) {
    const out = path.join(OUT, `${name}.png`);
    await sharp(Buffer.from(svg)).resize(512, 512).png().toFile(out);
    console.log(`✓ ${name}.png`);
  }
  console.log('\nAll icons saved to shell/build/icons/');
}

main().catch(e => { console.error(e); process.exit(1); });
