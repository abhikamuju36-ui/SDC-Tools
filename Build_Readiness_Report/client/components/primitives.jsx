// Shared UI primitives — Icons, Badges, Buttons
// (Babel JSX file — exports to window)

const { useState, useEffect, useRef, useMemo, useCallback } = React;

// ---- Icons (16x16, stroke 1.5) ----
const Icon = ({ d, size = 14, fill = "none", stroke = "currentColor", sw = 1.5, vb = "0 0 16 16", style }) => (
  <svg width={size} height={size} viewBox={vb} fill={fill} stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={style}>{d}</svg>
);

const IconSearch = (p) => <Icon {...p} d={<><circle cx="7" cy="7" r="4.5"/><path d="m13.5 13.5-3-3"/></>} />;
const IconChevronRight = (p) => <Icon {...p} d={<path d="m6 3 5 5-5 5"/>} />;
const IconChevronDown  = (p) => <Icon {...p} d={<path d="m3 6 5 5 5-5"/>} />;
const IconCaretRight   = (p) => <Icon {...p} fill="currentColor" stroke="none" d={<path d="M5 3v10l6-5z"/>} />;
const IconCaretDown    = (p) => <Icon {...p} fill="currentColor" stroke="none" d={<path d="M3 5h10l-5 6z"/>} />;
const IconLayers       = (p) => <Icon {...p} d={<><path d="M8 1.5 1.5 5 8 8.5 14.5 5 8 1.5z"/><path d="M1.5 8 8 11.5 14.5 8"/><path d="M1.5 11 8 14.5 14.5 11"/></>} />;
const IconBox          = (p) => <Icon {...p} d={<><path d="M8 1.5 14 4v8l-6 2.5L2 12V4z"/><path d="M2 4l6 2.5L14 4M8 6.5v8"/></>} />;
const IconAlert        = (p) => <Icon {...p} d={<><path d="M8 1.5 14.5 13H1.5z"/><path d="M8 6v3M8 11v.01"/></>} />;
const IconClock        = (p) => <Icon {...p} d={<><circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/></>} />;
const IconDollar       = (p) => <Icon {...p} d={<><path d="M8 1.5v13M11 4.5H6.5a2 2 0 0 0 0 4h3a2 2 0 0 1 0 4H4"/></>} />;
const IconMail         = (p) => <Icon {...p} d={<><rect x="1.5" y="3" width="13" height="10" rx="1.5"/><path d="m1.5 4 6.5 5 6.5-5"/></>} />;
const IconTruck        = (p) => <Icon {...p} d={<><path d="M1.5 4h8v6h-8zM9.5 6h3l2 2v2h-5z"/><circle cx="4" cy="12" r="1.2"/><circle cx="11" cy="12" r="1.2"/></>} />;
const IconUser         = (p) => <Icon {...p} d={<><circle cx="8" cy="5.5" r="2.5"/><path d="M2.5 14a5.5 5.5 0 0 1 11 0"/></>} />;
const IconCmd          = (p) => <Icon {...p} d={<><path d="M5 5h6v6H5z"/><path d="M5 5V3.5A1.5 1.5 0 1 0 3.5 5H5zM11 5h1.5A1.5 1.5 0 1 0 11 3.5V5zM5 11v1.5A1.5 1.5 0 1 1 3.5 11H5zM11 11h1.5A1.5 1.5 0 1 1 11 12.5V11z"/></>} />;
const IconExport       = (p) => <Icon {...p} d={<><path d="M8 10V2M5 5l3-3 3 3"/><path d="M2.5 10v3a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-3"/></>} />;
const IconFilter       = (p) => <Icon {...p} d={<path d="M2 3h12l-4.5 5.5V13l-3 1V8.5z"/>} />;
const IconCopy         = (p) => <Icon {...p} d={<><rect x="4.5" y="4.5" width="9" height="9" rx="1"/><path d="M11.5 4.5V3a1 1 0 0 0-1-1h-7a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h1.5"/></>} />;
const IconRefresh      = (p) => <Icon {...p} d={<><path d="M14 8a6 6 0 1 1-1.76-4.24"/><path d="M14 2v3.5h-3.5"/></>} />;
const IconSparkle      = (p) => <Icon {...p} d={<path d="M8 2v4M8 10v4M2 8h4M10 8h4M3.5 3.5l2.5 2.5M10 10l2.5 2.5M3.5 12.5 6 10M10 6l2.5-2.5"/>} />;
const IconCheck        = (p) => <Icon {...p} d={<path d="m3 8 3.5 3.5L13 5"/>} />;
const IconCircleX      = (p) => <Icon {...p} d={<><circle cx="8" cy="8" r="6"/><path d="m6 6 4 4M10 6l-4 4"/></>} />;
const IconX            = (p) => <Icon {...p} d={<path d="M3 3l10 10M13 3l-10 10"/>} />;
const IconSlash        = (p) => <Icon {...p} d={<><circle cx="8" cy="8" r="6"/><path d="m4 12 8-8"/></>} />;
const IconLink         = (p) => <Icon {...p} d={<><path d="M6.5 9.5a2.5 2.5 0 0 0 3.54 0l2-2a2.5 2.5 0 0 0-3.54-3.54l-1 1"/><path d="M9.5 6.5a2.5 2.5 0 0 0-3.54 0l-2 2a2.5 2.5 0 0 0 3.54 3.54l1-1"/></>} />;
const IconPlus         = (p) => <Icon {...p} d={<><path d="M8 3v10M3 8h10"/></>} />;
const IconMinus        = (p) => <Icon {...p} d={<path d="M3 8h10"/>} />;
const IconArrowRight   = (p) => <Icon {...p} d={<><path d="M3 8h10M9 4l4 4-4 4"/></>} />;
const IconCalendar     = (p) => <Icon {...p} d={<><rect x="2" y="3" width="12" height="11" rx="1"/><path d="M2 6.5h12M5 1.5v3M11 1.5v3"/></>} />;
const IconWrench       = (p) => <Icon {...p} d={<path d="M11.5 1.5a3.5 3.5 0 0 0-4.6 4.4l-5 5a1.5 1.5 0 0 0 2.1 2.1l5-5a3.5 3.5 0 0 0 4.4-4.6L11 4l-1.5-1.5z"/>} />;
const IconExternal     = (p) => <Icon {...p} d={<><path d="M11 2h3v3M14 2l-8 8"/><path d="M5 5H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-2"/></>} />;

// ---- Status badge ----
function StatusBadge({ status }) {
  const map = {
    "RCVD":      { cls: "badge-ready",   ico: <IconCheck size={10} sw={2} />, label: "RCVD" },
    "PEND":      { cls: "badge-pending", ico: <IconClock size={10} />, label: "PEND" },
    "NO PO":     { cls: "badge-threat",  ico: <IconCircleX size={10} />, label: "NO PO" },
    "ORD":       { cls: "badge-blue",    ico: null, label: "ORD" },
    "PO":        { cls: "badge-blue",    ico: null, label: "PO" },
    "PAST DUE":  { cls: "badge-threat",  ico: null, label: "PAST DUE" },
    "LATE/EXP":  { cls: "badge-threat",  ico: null, label: "LATE/EXP" },
    "EOR SOON":  { cls: "badge-pending", ico: null, label: "EOR SOON" },
    "OVERDUE":   { cls: "badge-threat",  ico: null, label: "OVERDUE" },
    "LONG-LEAD": { cls: "badge-blue",    ico: null, label: "LONG-LEAD" },
    "DUE":       { cls: "badge-pending", ico: null, label: "DUE" },
    "VEND":      { cls: "badge-pending", ico: null, label: "VEND" },
    "OPEN":      { cls: "badge-blue",    ico: null, label: "OPEN" },
    "RECEIVED":  { cls: "badge-ready",  ico: <IconCheck size={10} sw={2} />, label: "RECEIVED" },
  };
  const m = map[status] || { cls: "badge-neutral", label: status };
  return <span className={`badge ${m.cls}`}>{m.ico}{m.label}</span>;
}

// ---- Health ring ----
function HealthRing({ value, size = 38, stroke = 4 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - value / 100);
  let color = "var(--ready)";
  if (value < 60) color = "var(--threat)";
  else if (value < 85) color = "var(--pending)";
  return (
    <div style={{position: "relative", width: size, height: size, display:"inline-flex", alignItems:"center", justifyContent:"center"}}>
      <svg width={size} height={size} style={{transform: "rotate(-90deg)"}}>
        <circle cx={size/2} cy={size/2} r={r} stroke="var(--border)" strokeWidth={stroke} fill="none"/>
        <circle cx={size/2} cy={size/2} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
          style={{transition: "stroke-dashoffset .5s"}} />
      </svg>
      <span style={{position:"absolute", fontSize: Math.max(8, Math.round(size * 0.28)), fontFamily:"var(--font-mono)", fontWeight:600, color:"var(--ink-2)"}}>{value}</span>
    </div>
  );
}

// ---- Vendor avatar (initial chip) ----
function VendorAvatar({ vendor, size = 22 }) {
  const initials = (vendor || 'U').split(/[\s.]+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase().slice(0, 2);

  const palette = [
    '#3182CE','#429C5D','#805AD5','#DD6B20','#D44A4A',
    '#2B8A8A','#C05621','#6B46C1','#2F855A','#C53030',
    '#2C7A7B','#744210','#553C9A','#276749','#9B2C2C',
    '#2A69AC','#B7791F','#4A5568','#285E61','#702459',
  ];

  const overrides = { 'Steven Douglas Corp.': '#D44A4A' };

  const hash = (vendor || '').split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0);
  const bgColor = overrides[vendor] || palette[hash % palette.length];
  
  return (
    <span style={{
      width: size, height: size, borderRadius: 4,
      background: bgColor, color: "white",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.45, fontWeight: 700, letterSpacing: 0.02, flexShrink: 0,
    }}>{initials}</span>
  );
}

Object.assign(window, {
  Icon, IconSearch, IconChevronRight, IconChevronDown, IconCaretRight, IconCaretDown,
  IconLayers, IconBox, IconAlert, IconClock, IconDollar, IconMail, IconTruck, IconUser,
  IconCmd, IconExport, IconFilter, IconCopy, IconRefresh, IconSparkle, IconCheck,
  IconCircleX, IconX, IconSlash, IconLink, IconPlus, IconMinus, IconArrowRight, IconCalendar, IconWrench, IconExternal,
  StatusBadge, HealthRing, VendorAvatar,
});
