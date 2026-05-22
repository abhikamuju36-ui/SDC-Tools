'use strict';
const fs   = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'shell', 'build', 'icons');
fs.mkdirSync(OUT, { recursive: true });

const P = {
  blue:      '#1574C4',
  navy:      '#061D39',
  lightBlue: '#AACEE8',
  yellow:    '#FFDE51',
  green:     '#74C415',
  ink:       'rgba(6,29,57,0.55)',
  inkDim:    'rgba(6,29,57,0.28)',
  inkFaint:  'rgba(6,29,57,0.10)',
  hairline:  'rgba(6,29,57,0.12)',
};

/* ── Squircle ───────────────────────────────────────────────────────────── */
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

/* Light background frame (sub-apps) */
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

/* ── Gear (FIXED: no heavy stroke, subtle offset shadow) ─────────────────── */
function gearPath() {
  const teeth = 10, rO = 138, rI = 112, hw = 0.15;
  const pts = [];
  for (let i = 0; i < teeth; i++) {
    const a  = (i / teeth) * Math.PI * 2 - Math.PI / 2;
    const aN = ((i+1) / teeth) * Math.PI * 2 - Math.PI / 2;
    [[a-hw,rO],[a+hw,rO],[a+hw+0.10,rI],[aN-hw-0.10,rI]].forEach(([ang,r]) =>
      pts.push(`${(Math.cos(ang)*r).toFixed(2)},${(Math.sin(ang)*r).toFixed(2)}`)
    );
  }
  return `M ${pts.join(' L ')} Z`;
}
function gear(color) {
  const d = gearPath();
  return `<path d="${d}" fill="${color}"/>
    <circle cx="0" cy="0" r="40" fill="#ffffff"/>
    <circle cx="0" cy="0" r="14" fill="${color}"/>`;
}

/* ── ICON 1 — Assemblies (FIXED: clean gear, no heavy shadow) ────────────── */
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
    <g transform="translate(3,4)" opacity="0.18">${gear(P.navy)}</g>
    ${gear(P.blue)}
  </g>`);
}

/* ── ICON 2 — Build Readiness (unchanged) ───────────────────────────────── */
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

/* ── ICON 3 — Scheduler (unchanged) ─────────────────────────────────────── */
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

/* ── ICON 4 — State Logic (FIXED: darker grid lines) ────────────────────── */
function iconStateLogic() {
  const rungs = [120,176,232,288,344,400].map(y =>
    `<line x1="76" y1="${y}" x2="436" y2="${y}" stroke="${P.lightBlue}" stroke-width="2" opacity="0.7"/>`).join('');
  return frame('statelogic', `
  <line x1="76"  y1="100" x2="76"  y2="412" stroke="${P.lightBlue}" stroke-width="2.5" opacity="0.85"/>
  <line x1="436" y1="100" x2="436" y2="412" stroke="${P.lightBlue}" stroke-width="2.5" opacity="0.85"/>
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

/* ── ICON 5 — Calendar (FIXED: sync arc fully inside header) ────────────── */
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
  <g fill="none" stroke="rgba(255,255,255,0.82)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M 394 122 A 26 26 0 1 1 368 148"/>
    <path d="M 361 141 L 368 148 L 375 141"/>
  </g>`);
}

/* ── ICON — SDC Tools Main App ──────────────────────────────────────────── */
function iconSDCTools() {
  const sq = squirclePath(512);
  const cx = 256, cy = 236, R = 128;

  const apps = [
    { angle: -90, color: '#1574C4' },   // Assemblies  — top
    { angle: -18, color: '#74C415' },   // Readiness   — top-right
    { angle:  54, color: '#FFDE51' },   // Scheduler   — bottom-right
    { angle: 126, color: '#AACEE8' },   // State Logic — bottom-left
    { angle: 198, color: '#1574C4' },   // Calendar    — top-left
  ];
  const rad = a => a * Math.PI / 180;
  const pts = apps.map(a => ({
    x: cx + R * Math.cos(rad(a.angle)),
    y: cy + R * Math.sin(rad(a.angle)),
    color: a.color,
  }));

  const penta = pts.map((p, i) => {
    const n = pts[(i+1) % 5];
    return `<line x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}"
             x2="${n.x.toFixed(1)}" y2="${n.y.toFixed(1)}"
             stroke="rgba(255,255,255,0.1)" stroke-width="1.5"/>`;
  }).join('');

  const spokes = pts.map(p =>
    `<line x1="${cx}" y1="${cy}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}"
     stroke="rgba(255,255,255,0.18)" stroke-width="2"/>`
  ).join('');

  const dots = pts.map(p => `
    <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="30"
      fill="${p.color}" opacity="0.92"/>
    <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="30"
      fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="2.5"/>
  `).join('');

  // Center SDC hub: dark inset circle + white oval ring + stylised S
  const hub = `
    <circle cx="${cx}" cy="${cy}" r="55" fill="#091e3a"/>
    <ellipse cx="${cx}" cy="${cy}" rx="42" ry="28"
      fill="none" stroke="rgba(255,255,255,0.88)" stroke-width="4.5"/>
    <path d="M 272 228 C 284 222 282 238 256 240 C 230 242 228 256 240 258"
      fill="none" stroke="rgba(255,255,255,0.88)" stroke-width="7"
      stroke-linecap="round"/>
  `;

  // Subtle label bars at bottom
  const bars = `
    <rect x="194" y="408" width="124" height="6" rx="3" fill="rgba(255,255,255,0.18)"/>
    <rect x="214" y="422" width="84"  height="5" rx="2.5" fill="rgba(255,255,255,0.10)"/>
  `;

  return `<svg viewBox="0 0 512 512" width="512" height="512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="sq-tools"><path d="${sq}"/></clipPath>
    <radialGradient id="bg-tools" cx="50%" cy="40%" r="65%">
      <stop offset="0%" stop-color="#0e2d54"/>
      <stop offset="100%" stop-color="#061D39"/>
    </radialGradient>
  </defs>
  <path d="${sq}" fill="url(#bg-tools)"/>
  <g clip-path="url(#sq-tools)">
    ${penta}
    ${spokes}
    ${dots}
    ${hub}
    ${bars}
  </g>
</svg>`;
}

/* ── ICON 6 — Vendor Tracker ─────────────────────────────────────────────── */
function iconVendor() {
  const floor = 270;
  const bars = [
    { x: 118, h: 126, fill: P.blue,      op: '' },
    { x: 205, h: 88,  fill: P.lightBlue, op: '' },
    { x: 292, h: 110, fill: P.navy,      op: '' },
    { x: 379, h: 72,  fill: P.blue,      op: 'opacity="0.6"' },
  ];
  const barsSvg = bars.map(b =>
    `<rect x="${b.x}" y="${floor - b.h}" width="58" height="${b.h}" rx="8" fill="${b.fill}" ${b.op}/>`
  ).join('\n  ');
  const trendPts = bars.map((b, i) => `${b.x + 29},${floor - b.h}`).join(' ');
  const trendDots = bars.map(b =>
    `<circle cx="${b.x + 29}" cy="${floor - b.h}" r="5" fill="${P.green}"/>`
  ).join('\n  ');
  return frame('vendor', `
  <line x1="96" y1="${floor}" x2="416" y2="${floor}" stroke="${P.navy}" stroke-width="2" opacity="0.15"/>
  ${barsSvg}
  <polyline points="${trendPts}" fill="none" stroke="${P.green}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
  ${trendDots}
  <rect x="88" y="284" width="336" height="44" rx="10" fill="#f4f8fc" stroke="${P.lightBlue}" stroke-width="1.5"/>
  <circle cx="113" cy="306" r="9" fill="${P.blue}"/>
  <rect x="133" y="298" width="186" height="7" rx="3.5" fill="${P.blue}" opacity="0.85"/>
  <rect x="133" y="311" width="104" height="5" rx="2.5" fill="${P.lightBlue}"/>
  <rect x="88" y="340" width="336" height="44" rx="10" fill="#f4f8fc" stroke="${P.lightBlue}" stroke-width="1.5"/>
  <circle cx="113" cy="362" r="9" fill="${P.green}"/>
  <rect x="133" y="354" width="148" height="7" rx="3.5" fill="${P.green}" opacity="0.85"/>
  <rect x="133" y="367" width="82" height="5" rx="2.5" fill="${P.lightBlue}"/>
  <rect x="88" y="396" width="336" height="44" rx="10" fill="#f4f8fc" stroke="${P.lightBlue}" stroke-width="1.5"/>
  <circle cx="113" cy="418" r="9" fill="${P.yellow}"/>
  <rect x="133" y="410" width="110" height="7" rx="3.5" fill="${P.yellow}" opacity="0.9"/>
  <rect x="133" y="423" width="60" height="5" rx="2.5" fill="${P.lightBlue}"/>`);
}

/* ── Build ICO (PNG-in-ICO, Vista+) ─────────────────────────────────────── */
async function buildIco(sharp, pngPath, icoPath) {
  const sizes   = [16, 32, 48, 256];
  const images  = await Promise.all(sizes.map(s =>
    sharp(pngPath).resize(s, s).png().toBuffer()
  ));
  const count   = sizes.length;
  const header  = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  let offset = 6 + count * 16;
  const entries = images.map((img, i) => {
    const sz = sizes[i];
    const e  = Buffer.alloc(16);
    e.writeUInt8(sz === 256 ? 0 : sz, 0);
    e.writeUInt8(sz === 256 ? 0 : sz, 1);
    e.writeUInt8(0, 2); e.writeUInt8(0, 3);
    e.writeUInt16LE(1,  4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(img.length, 8);
    e.writeUInt32LE(offset,     12);
    offset += img.length;
    return e;
  });
  fs.writeFileSync(icoPath, Buffer.concat([header, ...entries, ...images]));
}

/* ── Render ──────────────────────────────────────────────────────────────── */
const subIcons = {
  assemblies: iconAssemblies(),
  readiness:  iconReadiness(),
  scheduler:  iconScheduler(),
  statelogic: iconStateLogic(),
  calendar:   iconCalendar(),
  vendor:     iconVendor(),
};

async function main() {
  const sharp = require('sharp');

  // Sub-app icons → shell/build/icons/
  for (const [name, svg] of Object.entries(subIcons)) {
    const out = path.join(OUT, `${name}.png`);
    await sharp(Buffer.from(svg)).resize(512, 512).png().toFile(out);
    console.log(`✓ ${name}.png`);
  }

  // Main SDC Tools icon → shell/build/icon.png + icon.ico
  const mainPng = path.join(__dirname, 'shell', 'build', 'icon.png');
  const mainIco = path.join(__dirname, 'shell', 'build', 'icon.ico');
  await sharp(Buffer.from(iconSDCTools())).resize(512, 512).png().toFile(mainPng);
  console.log('✓ icon.png (main app)');
  await buildIco(sharp, mainPng, mainIco);
  console.log('✓ icon.ico (main app)');

  console.log('\nAll icons saved.');
}

main().catch(e => { console.error(e); process.exit(1); });
