/* Shared UI primitives: icons (Lucide subset, inline), KPI, Card, Pill,
   simple SVG charts (bar, donut, line, stacked-area) — minimal, dependency-free */

const { useMemo, useState, useEffect, useRef } = React;

/* ---------- Icons ---------- */
const Ic = ({ d, w = 16, h = 16, stroke = 2 }) => (
  <svg width={w} height={h} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
);
const Icon = {
  home:       <Ic d={<><path d="M3 9 12 2l9 7v11a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2z"/></>} />,
  layers:     <Ic d={<><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/></>} />,
  sliders:    <Ic d={<><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></>} />,
  users:      <Ic d={<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>} />,
  file:       <Ic d={<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>} />,
  settings:   <Ic d={<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></>} />,
  search:     <Ic d={<><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>} />,
  bell:       <Ic d={<><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></>} />,
  plus:       <Ic d={<><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>} />,
  dollar:     <Ic d={<><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></>} />,
  card:       <Ic d={<><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></>} />,
  truck:      <Ic d={<><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></>} />,
  check:      <Ic d={<><polyline points="20 6 9 17 4 12"/></>} />,
  calendar:   <Ic d={<><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>} />,
  arrowUp:    <Ic d={<><path d="M7 17 17 7"/><path d="M7 7h10v10"/></>} stroke={2.5}/>,
  arrowDown:  <Ic d={<><path d="M7 7 17 17"/><path d="M17 7v10H7"/></>} stroke={2.5}/>,
  alert:      <Ic d={<><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>} />,
  zap:        <Ic d={<><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></>} />,
  download:   <Ic d={<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>} />,
  filter:     <Ic d={<><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></>} />,
  more:       <Ic d={<><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></>} />,
  package:    <Ic d={<><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></>} />,
  trend:      <Ic d={<><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></>} />,
  building:   <Ic d={<><rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></>} />,
  shield:     <Ic d={<><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></>} />,
  clock:      <Ic d={<><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>} />,
  mail:       <Ic d={<><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22,6 12,13 2,6"/></>} />,
  phone:      <Ic d={<><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></>} />,
  pin:        <Ic d={<><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></>} />,
  external:   <Ic d={<><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></>} />,
};

/* ---------- Helpers ---------- */
const fmtUSD = (n, compact = false) => {
  if (compact) {
    if (n >= 1e6) return "$" + (n/1e6).toFixed(n >= 1e7 ? 1 : 2) + "M";
    if (n >= 1e3) return "$" + (n/1e3).toFixed(0) + "K";
    return "$" + n;
  }
  return "$" + n.toLocaleString();
};
const fmtPct = (n, digits = 1) => n.toFixed(digits) + "%";

/* ---------- KPI ---------- */
const KPI = ({ label, value, unit, glyph, trend, trendDir = "up", caption, accent }) => (
  <div className="kpi">
    <div className="kpi-head">
      <span className="kpi-label">{label}</span>
      <span className="kpi-glyph" style={accent ? { background: accent.bg, color: accent.fg } : undefined}>
        {glyph}
      </span>
    </div>
    <div className="kpi-value">
      <span>{value}</span>
      {unit ? <span className="unit">{unit}</span> : null}
    </div>
    <div className="kpi-foot">
      {trend ? (
        <span className={"trend " + trendDir}>
          {trendDir === "up" ? Icon.arrowUp : trendDir === "down" ? Icon.arrowDown : null}
          {trend}
        </span>
      ) : null}
      {caption ? <span>{caption}</span> : null}
    </div>
  </div>
);

/* ---------- Card ---------- */
const Card = ({ title, sub, actions, children, className = "", bodyClass = "" }) => (
  <section className={"card " + className}>
    {(title || actions) && (
      <header className="card-head">
        <div>
          {title && <h3 className="card-title">{title}</h3>}
          {sub && <p className="card-sub">{sub}</p>}
        </div>
        {actions ? <div className="card-actions">{actions}</div> : null}
      </header>
    )}
    <div className={"card-body " + bodyClass}>{children}</div>
  </section>
);

/* ---------- Pill ---------- */
const STATUS_PILL = {
  "Shipped":     "info",
  "Received":    "success",
  "In Transit":  "info",
  "Open":        "neutral",
  "Delayed":     "danger",
  "On Track":    "success",
  "At Risk":     "warn",
  "Closing":     "info",
  "Preferred":   "success",
  "Approved":    "neutral",
  "Watch":       "warn",
};
const StatusPill = ({ s }) => (
  <span className={"pill " + (STATUS_PILL[s] || "neutral")}>
    <span className="dot"></span>{s}
  </span>
);

/* ---------- Charts ---------- */
/* Bar chart (vertical) - clean, no animations */
const BarChart = ({ data, height = 260, valueFmt = (v) => v, color = "#1574C4", maxBars = 0 }) => {
  const max = Math.max(...data.map(d => d.value)) * 1.05;
  const arr = maxBars ? data.slice(0, maxBars) : data;
  const w = 100 / arr.length;
  return (
    <div className="chart" style={{ height }}>
      <svg width="100%" height="100%" viewBox={`0 0 100 100`} preserveAspectRatio="none" style={{display:"block"}}>
        {[0.25,0.5,0.75,1].map((p,i)=>(
          <line key={i} x1="0" x2="100" y1={100 - p*90} y2={100 - p*90} stroke="#EEF0F3" strokeWidth="0.2" vectorEffect="non-scaling-stroke"/>
        ))}
        {arr.map((d, i) => {
          const h = (d.value / max) * 90;
          return (
            <g key={i}>
              <rect
                x={i * w + w * 0.18}
                y={100 - h}
                width={w * 0.64}
                height={h}
                fill={d.color || color}
                rx="0.6"
              />
            </g>
          );
        })}
      </svg>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${arr.length}, 1fr)`, gap: 0, marginTop: 6 }}>
        {arr.map((d, i) => (
          <div key={i} style={{ textAlign: "center", fontSize: 10.5, color: "var(--text-tertiary)", padding: "2px 2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.label}>
            {d.label}
          </div>
        ))}
      </div>
    </div>
  );
};

/* Horizontal stacked bar (single row) */
const StackBar = ({ segments, height = 10 }) => {
  const total = segments.reduce((a,b) => a + b.value, 0);
  return (
    <div style={{ display: "flex", width: "100%", height, borderRadius: 999, overflow: "hidden", background: "var(--bg-subtle)" }}>
      {segments.map((s, i) => (
        <div key={i} title={`${s.name}: ${fmtUSD(s.value, true)}`} style={{
          width: `${(s.value/total)*100}%`,
          background: s.color,
        }} />
      ))}
    </div>
  );
};

/* Donut chart with center label */
const Donut = ({ data, size = 180, thickness = 26, centerLabel, centerValue }) => {
  const total = data.reduce((a,b) => a + b.value, 0);
  const cx = size/2, cy = size/2, r = (size - thickness) / 2;
  let acc = 0;
  const segs = data.map((d, i) => {
    const start = (acc / total) * Math.PI * 2 - Math.PI/2;
    acc += d.value;
    const end = (acc / total) * Math.PI * 2 - Math.PI/2;
    const x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end),   y2 = cy + r * Math.sin(end);
    const large = (end - start) > Math.PI ? 1 : 0;
    return (
      <path key={i} d={`M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`}
            stroke={d.color} strokeWidth={thickness} fill="none" strokeLinecap="butt"/>
    );
  });
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--bg-subtle)" strokeWidth={thickness}/>
      {segs}
      {centerValue && (
        <>
          <text x={cx} y={cy - 4} textAnchor="middle" fontFamily="Montserrat" fontWeight="700" fontSize="20" fill="var(--text)">{centerValue}</text>
          <text x={cx} y={cy + 14} textAnchor="middle" fontFamily="Inter" fontSize="10.5" fill="var(--text-tertiary)" letterSpacing="0.8">{centerLabel}</text>
        </>
      )}
    </svg>
  );
};

/* Line / area chart */
const LineChart = ({ data, height = 240, color = "#1574C4", fillOpacity = 0.12, yFmt = v => v, showArea = true }) => {
  const max = Math.max(...data.map(d => d.value)) * 1.1;
  const min = 0;
  const W = 600, H = 180;
  const padL = 40, padR = 10, padT = 14, padB = 26;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const px = i => padL + (i / (data.length - 1)) * innerW;
  const py = v => padT + (1 - (v - min) / (max - min)) * innerH;

  const path = data.map((d, i) => `${i===0?"M":"L"} ${px(i)} ${py(d.value)}`).join(" ");
  const area = path + ` L ${px(data.length-1)} ${padT + innerH} L ${px(0)} ${padT + innerH} Z`;

  const ticks = 4;
  return (
    <div className="chart" style={{ height }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {[...Array(ticks+1)].map((_, i) => {
          const v = min + ((max - min) * i / ticks);
          const y = py(v);
          return (
            <g key={i}>
              <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="#EEF0F3" strokeWidth="1"/>
              <text x={padL - 6} y={y + 3} textAnchor="end" fontSize="9.5" fill="var(--text-tertiary)" fontFamily="Inter">{yFmt(v)}</text>
            </g>
          );
        })}
        {showArea && <path d={area} fill={color} fillOpacity={fillOpacity}/>}
        <path d={path} stroke={color} strokeWidth="2" fill="none" strokeLinejoin="round"/>
        {data.map((d, i) => (
          <g key={i}>
            <circle cx={px(i)} cy={py(d.value)} r="3" fill="white" stroke={color} strokeWidth="2"/>
            <text x={px(i)} y={H - padB + 14} textAnchor="middle" fontSize="10" fill="var(--text-tertiary)" fontFamily="Inter">{d.month || d.quarter || d.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
};

/* Dual-bar (target vs actual) */
const DualBars = ({ data, height = 240, colors = ["#AACEE8", "#1574C4"] }) => {
  const max = Math.max(...data.flatMap(d => [d.target, d.actual])) * 1.1;
  const W = 600, H = 180;
  const padL = 40, padR = 10, padT = 14, padB = 26;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const groupW = innerW / data.length;
  const barW = groupW * 0.32;
  const ticks = 4;
  return (
    <div className="chart" style={{ height }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {[...Array(ticks+1)].map((_, i) => {
          const v = (max * i / ticks);
          const y = padT + (1 - i/ticks) * innerH;
          return (
            <g key={i}>
              <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="#EEF0F3" strokeWidth="1"/>
              <text x={padL - 6} y={y + 3} textAnchor="end" fontSize="9.5" fill="var(--text-tertiary)" fontFamily="Inter">${Math.round(v)}K</text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const xCenter = padL + groupW * i + groupW/2;
          const hT = (d.target/max) * innerH;
          const hA = (d.actual/max) * innerH;
          return (
            <g key={i}>
              <rect x={xCenter - barW - 2} y={padT + innerH - hT} width={barW} height={hT} fill={colors[0]} rx="1.5"/>
              <rect x={xCenter + 2}        y={padT + innerH - hA} width={barW} height={hA} fill={colors[1]} rx="1.5"/>
              <text x={xCenter} y={H - padB + 14} textAnchor="middle" fontSize="10" fill="var(--text-tertiary)" fontFamily="Inter">{d.quarter}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

/* Health 5-segment bar */
const HealthBar = ({ score }) => (
  <div className="health" title={`Health ${score}/5`}>
    {[1,2,3,4,5].map(i => <span key={i} className={"seg " + (i <= score ? "on" : "")}/>)}
  </div>
);

Object.assign(window, {
  Ic, Icon, fmtUSD, fmtPct,
  KPI, Card, StatusPill, BarChart, StackBar, Donut, LineChart, DualBars, HealthBar
});
