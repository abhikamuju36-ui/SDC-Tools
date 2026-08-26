// Build Readiness Tab — Premium SDC Design
import React, { useState, useMemo, useEffect } from 'react';
import TimelineRibbon from '../timeline.jsx';
import { PoTracker } from '../tabs/tab-po.jsx';
import {
  IconSearch, IconX, IconCaretDown, IconCaretRight,
  IconCircleX, IconCheck, IconAlert, IconClock, VendorAvatar,
} from '../primitives.jsx';

function useColResize(initial) {
  const [widths, setWidths] = useState(initial);
  const drag = React.useRef(null);
  const startDrag = (idx, e) => {
    e.preventDefault();
    drag.current = { idx, x: e.clientX, w: widths[idx] };
    const onMove = ev => {
      if (!drag.current) return;
      const { idx, x, w } = drag.current;
      setWidths(prev => { const n = [...prev]; n[idx] = Math.max(40, w + (ev.clientX - x)); return n; });
    };
    const onUp = () => {
      drag.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };
  const template = widths.map(w => `${w}px`).join(' ');
  return { template, startDrag };
}

const ColHandle = ({ onMouseDown }) => (
  <div
    onMouseDown={onMouseDown}
    style={{ position: 'absolute', right: 0, top: '15%', bottom: '15%', width: 3, cursor: 'col-resize', zIndex: 1, background: 'var(--border-strong)', opacity: 0.35, borderRadius: 2, transition: 'opacity 0.15s' }}
    onMouseEnter={e => e.currentTarget.style.opacity = '1'}
    onMouseLeave={e => e.currentTarget.style.opacity = '0.35'}
  />
);

// ── Delivery Slip · No Purchase Order · Upcoming Deliveries ─────────────────
//
// Every number and every row in these three cards comes from the SDC Projects
// Reports app, via /api/procurement/:jobId → its
// /api/integration/jobs/:jobId/procurement. Nothing here derives eligibility,
// counts a window or picks a date: this component lays out a payload.
//
// That is deliberate. These cards used to be computed right here from
// `poActions` (this app's PO action list) and `nopo` (bomTree.js's
// findNoPoParts), and all three disagreed with the Reports app's Job Hours
// Details page — which is the accepted source of truth for these insights —
// for every job:
//
//   • Delivery Slip only looked at [today-7d, today+1d), so anything more than
//     a week overdue silently left the card whose job is surfacing late work.
//     The rule is "has a PO, not received, due on or before today+7d", with no
//     lower bound at all.
//   • No Purchase Order counted `POQty === 0`, which treats an inventory pull
//     or an in-house process schedule as a procurement gap and ignores BOM
//     release status entirely — so it invented missing sub-parts underneath
//     assemblies that were bought whole.
//   • Upcoming Deliveries only ever saw parts that already had a PO line, and
//     its week picker was cumulative (4W = weeks 1-4) where the reference
//     shows one week at a time.
//
// See server/services/plannerClient.js for why the fix was to read the Reports
// app rather than to port its BOM rules into this codebase a second time.
//
// `procurement` is `{ available: false, reason }` whenever the Reports app is
// unreachable, unconfigured, in demo mode, or has no BOM for the job. There is
// no fallback to the old local arithmetic on purpose — a confidently wrong
// number is worse than a visibly absent one, and having two implementations is
// what caused this in the first place.
function RiskPartsPanel({ procurement }) {
  const [slipCollapsed,     setSlipCollapsed]     = useState(false);
  const [nopCollapsed,      setNopCollapsed]       = useState(false);
  const [upcomingCollapsed, setUpcomingCollapsed]  = useState(false);
  // Which single week of Upcoming Deliveries is on screen. Weeks are per-week
  // buckets, not cumulative — week 4 is "due in week 4", matching the
  // reference. Defaults to week 1.
  const [upcomingWeek,      setUpcomingWeek]       = useState(1);
  const slip     = useColResize([110, 200, 68, 68, 72, 70]);
  const nop      = useColResize([110, 200, 70, 40, 70]);
  const upcoming = useColResize([76, 130, 240, 110, 90, 80, 80, 80]);

  const todayStart = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);

  const risk = procurement?.available ? procurement.risk : null;

  const slipping = risk?.deliverySlip.parts ?? [];
  const nopoParts = risk?.noPo.parts ?? [];

  const weeks = risk?.upcoming.weeks ?? [];
  const selectedWeek = weeks.find(w => w.week === upcomingWeek) ?? weeks[0] ?? null;
  const upcomingParts = selectedWeek?.parts ?? [];

  // The date a part is measured against — the PO line's Expected date when it
  // has one, else the BOM's Required date. Same fallback the Reports app's own
  // rule uses (procurement-risk.ts `dueMs`), so a row's shown date can never
  // disagree with the window that selected it.
  const dueOf = p => p.expectedDate || p.requiredDate;

  const upcomingStats = useMemo(() => {
    // Blank suppliers excluded, matching the reference's own
    // `.filter(Boolean)` — an unnamed supplier is missing data, not a supplier.
    const suppliers = new Set(upcomingParts.map(p => p.supplier).filter(Boolean)).size;
    const dues = upcomingParts.map(p => dueOf(p)).filter(Boolean).sort();
    return { suppliers, nearest: dues[0] ?? null };
  }, [upcomingParts]);

  // `YYYY-MM-DD` day strings from the API. Parsed as local noon rather than
  // passed to `new Date('2026-08-26')`, which JS reads as UTC midnight and
  // renders as the previous day for anyone west of Greenwich.
  const parseDay = d => {
    if (!d) return null;
    const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
    if (!y || !m || !day) return null;
    return new Date(y, m - 1, day, 12, 0, 0, 0);
  };
  const fmtDate = d => {
    const t = parseDay(d);
    return t ? t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
  };
  const money = v => (v > 0
    ? `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—');

  const CARD   = { background: 'var(--bg-raised)', border: '1px solid var(--border-subtle)', borderRadius: 8, overflow: 'hidden' };
  const HDR_BASE = { display: 'grid', gap: 10, padding: '8px 14px 7px', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--ink-4)', textTransform: 'uppercase', background: 'var(--bg-sunken)', borderBottom: '1px solid var(--border-subtle)' };
  const ROW_BASE = { display: 'grid', gap: 10, padding: '7px 14px', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', fontSize: 12 };
  const CELL_H   = { position: 'relative', overflow: 'hidden' };
  const EMPTY    = { padding: '20px 14px', textAlign: 'center', color: 'var(--ink-4)', fontSize: 12 };

  const Stat = ({ label, value, valueColor }) => (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--ink-4)', textTransform: 'uppercase' }}>{label}</span>
      <span className="mono" style={{ fontSize: 15, fontWeight: 700, color: valueColor || 'var(--ink)', letterSpacing: '-0.01em' }}>{value}</span>
    </span>
  );

  const HideBtn = ({ collapsed, onToggle }) => (
    <button onClick={onToggle} style={{ height: 26, padding: '0 10px', border: '1px solid var(--border)', background: 'var(--bg-raised)', borderRadius: 6, color: 'var(--ink-4)', fontSize: 11, fontWeight: 500, letterSpacing: '0.02em', display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', whiteSpace: 'nowrap' }}>
      {collapsed ? 'Show' : 'Hide'} <span style={{ fontSize: 9 }}>{collapsed ? '↓' : '↑'}</span>
    </button>
  );

  // Shown in every card's body when the Reports app couldn't be read, with the
  // actual reason rather than a bare dash — an empty card and an unavailable
  // card mean completely different things to whoever is chasing a part.
  const Unavailable = () => (
    <div style={{ ...EMPTY, lineHeight: 1.5 }}>
      Unavailable — {procurement?.reason || 'the SDC Projects Reports app could not be reached.'}
    </div>
  );

  const dash = '—';
  const slipStats = risk
    ? { parts: risk.deliverySlip.partCount,
        avgLate: risk.deliverySlip.avgLateDays > 0 ? `+${risk.deliverySlip.avgLateDays}d` : dash,
        hasLate: risk.deliverySlip.avgLateDays > 0,
        oldestReq: fmtDate(risk.deliverySlip.oldestRequired) }
    : { parts: dash, avgLate: dash, hasLate: false, oldestReq: dash };
  const nopStats = risk
    ? { parts: risk.noPo.partCount, thisWeek: risk.noPo.thisWeek, oldestReq: fmtDate(risk.noPo.oldestRequired) }
    : { parts: dash, thisWeek: dash, oldestReq: dash };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, margin: '12px 0' }}>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

      {/* ── Delivery Slip Card ── */}
      <div style={CARD}>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto auto auto', alignItems: 'center', gap: 20, padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#b8861b' }}>
            <span style={{ width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#fbf1d6', color: '#b8861b', borderRadius: 4, fontWeight: 800, fontSize: 12 }}>!</span>
            Delivery Slip
          </span>
          <span />
          <Stat label="Parts"    value={slipStats.parts} valueColor="#b8861b" />
          <Stat label="Avg Late" value={slipStats.avgLate} valueColor={slipStats.hasLate ? '#c43e1c' : 'var(--ink-3)'} />
          <Stat label="Oldest Req" value={slipStats.oldestReq} />
          <HideBtn collapsed={slipCollapsed} onToggle={() => setSlipCollapsed(c => !c)} />
        </div>
        {!slipCollapsed && (
          <>
            <div style={{ ...HDR_BASE, gridTemplateColumns: slip.template }}>
              {['Part #','Description','Req Date','Exp Date','Order Date','Cost'].map((lbl, i) => (
                <span key={i} style={{ ...CELL_H, textAlign: i === 5 ? 'right' : 'left' }}>{lbl}<ColHandle onMouseDown={e => slip.startDrag(i, e)} /></span>
              ))}
            </div>
            <div style={{ maxHeight: 150, overflowY: 'auto' }}>
              {!risk
                ? <Unavailable />
                : slipping.length === 0
                ? <div style={EMPTY}>Nothing overdue or due in the next 7 days</div>
                : slipping.map(p => {
                  const due = parseDay(dueOf(p));
                  return (
                  <div key={p.id} className="row-hover" style={{ ...ROW_BASE, gridTemplateColumns: slip.template }}>
                    <span className="mono" style={{ fontSize: 11, fontWeight: 600, color: 'var(--sdc-blue)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.pn}</span>
                    <span style={{ fontSize: 12, letterSpacing: '0.02em', textTransform: 'uppercase', color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.desc}</span>
                    <span className="mono" style={{ color: 'var(--ink-3)', fontSize: 11, whiteSpace: 'nowrap' }}>{fmtDate(p.requiredDate)}</span>
                    <span className="mono" style={{ fontWeight: 600, color: due && due < todayStart ? '#c43e1c' : 'var(--ink-2)', fontSize: 11, whiteSpace: 'nowrap' }}>{fmtDate(dueOf(p))}</span>
                    <span className="mono" style={{ color: 'var(--ink-3)', fontSize: 11, whiteSpace: 'nowrap' }}>{fmtDate(p.poDate)}</span>
                    <span className="mono" style={{ textAlign: 'right', fontSize: 11, color: p.unitPrice > 0 ? 'var(--ink-2)' : 'var(--ink-4)' }}>{money(p.unitPrice)}</span>
                  </div>
                  );
                })
              }
            </div>
          </>
        )}
      </div>

      {/* ── No PO Card ── */}
      <div style={CARD}>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto auto auto', alignItems: 'center', gap: 20, padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#c43e1c' }}>
            <span style={{ width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#fbeae3', color: '#c43e1c', borderRadius: 4, fontWeight: 800, fontSize: 13 }}>×</span>
            No Purchase Order
          </span>
          <span />
          <Stat label="Parts"     value={nopStats.parts}    valueColor="#c43e1c" />
          <Stat label="This Week" value={nopStats.thisWeek} />
          <Stat label="Oldest Req" value={nopStats.oldestReq} />
          <HideBtn collapsed={nopCollapsed} onToggle={() => setNopCollapsed(c => !c)} />
        </div>
        {!nopCollapsed && (
          <>
            <div style={{ ...HDR_BASE, gridTemplateColumns: nop.template }}>
              {['Part #','Description','Req Date','Qty','Cost'].map((lbl, i) => (
                <span key={i} style={{ ...CELL_H, textAlign: i >= 3 ? 'right' : 'left' }}>{lbl}<ColHandle onMouseDown={e => nop.startDrag(i, e)} /></span>
              ))}
            </div>
            <div style={{ maxHeight: 150, overflowY: 'auto' }}>
              {!risk
                ? <Unavailable />
                : nopoParts.length === 0
                ? <div style={EMPTY}>Every requirement is covered</div>
                : nopoParts.map(p => (
                  <div key={p.id} className="row-hover" style={{ ...ROW_BASE, gridTemplateColumns: nop.template }}>
                    <span className="mono" style={{ fontSize: 11, fontWeight: 600, color: 'var(--sdc-blue)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.pn}</span>
                    <span style={{ fontSize: 12, letterSpacing: '0.02em', textTransform: 'uppercase', color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.desc}</span>
                    <span className="mono" style={{ color: 'var(--ink-3)', fontSize: 11, whiteSpace: 'nowrap' }}>{fmtDate(p.requiredDate)}</span>
                    <span className="mono" style={{ textAlign: 'right', fontWeight: 600, color: 'var(--ink-2)', fontSize: 12 }}>{p.qty}</span>
                    <span className="mono" style={{ textAlign: 'right', fontSize: 11, color: p.unitPrice > 0 ? 'var(--ink-2)' : 'var(--ink-4)' }}>{money(p.unitPrice)}</span>
                  </div>
                ))
              }
            </div>
          </>
        )}
      </div>

    </div>{/* end 2-col grid */}

    {/* ── Upcoming Deliveries Card ── */}
    <div style={CARD}>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto auto 1fr auto auto auto auto', alignItems: 'center', gap: 16, padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#0d7490' }}>
          <span style={{ width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#e0f5fa', color: '#0d7490', borderRadius: 4, fontWeight: 800, fontSize: 11 }}>→</span>
          Upcoming Deliveries
        </span>
        {/* Week selector pills — one bucket per week (W1 = due in the next 7
            days, W2 = the 7 days after that, …), not cumulative. Buckets and
            their counts both come from the Reports app, so the pill row is
            however many weeks it serves. */}
        <div style={{ display: 'flex', gap: 4 }}>
          {(weeks.length ? weeks : [{ week: 1, count: null }]).map(w => (
            <button key={w.week} onClick={() => setUpcomingWeek(w.week)} title={`Due in week ${w.week}`} style={{
              padding: '3px 9px', fontSize: 11, fontWeight: 600, borderRadius: 5, cursor: 'pointer', border: 'none',
              background: upcomingWeek === w.week ? '#0d7490' : 'var(--bg-sunken)',
              color: upcomingWeek === w.week ? '#fff' : 'var(--ink-3)',
              transition: 'all 0.15s',
            }}>
              W{w.week}
              {w.count ? <span style={{ marginLeft: 4, opacity: 0.75, fontWeight: 500 }}>{w.count}</span> : null}
            </button>
          ))}
        </div>
        <span />
        <Stat label="Parts"     value={risk ? upcomingParts.length : dash} valueColor="#0d7490" />
        <Stat label="Suppliers" value={risk ? upcomingStats.suppliers : dash} />
        <Stat label="Nearest"   value={risk ? fmtDate(upcomingStats.nearest) : dash} />
        <HideBtn collapsed={upcomingCollapsed} onToggle={() => setUpcomingCollapsed(c => !c)} />
      </div>
      {!upcomingCollapsed && (
        <>
          <div style={{ ...HDR_BASE, gridTemplateColumns: upcoming.template }}>
            {['PO #','Part #','Description','Supplier','Exp Date','Req Date','Order Date','Cost'].map((lbl, i) => (
              <span key={i} style={{ ...CELL_H, textAlign: i === 7 ? 'right' : 'left' }}>{lbl}<ColHandle onMouseDown={e => upcoming.startDrag(i, e)} /></span>
            ))}
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {!risk
              ? <Unavailable />
              : upcomingParts.length === 0
              ? <div style={EMPTY}>Nothing due in week {upcomingWeek}</div>
              : upcomingParts.map(p => {
                  const due = parseDay(dueOf(p));
                  const daysAway = due ? Math.ceil((due - todayStart) / 86400000) : null;
                  const urgColor = daysAway == null ? 'var(--ink-3)' : daysAway <= 7 ? '#b8861b' : daysAway <= 14 ? '#0d7490' : 'var(--ink-3)';
                  return (
                    <div key={p.id} className="row-hover" style={{ ...ROW_BASE, gridTemplateColumns: upcoming.template }}>
                      <span className="mono" style={{ fontSize: 11, fontWeight: 600, color: p.poNumber ? 'var(--ink-2)' : 'var(--ink-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.poNumber || '—'}</span>
                      <span className="mono" style={{ fontSize: 11, fontWeight: 600, color: 'var(--sdc-blue)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.pn}</span>
                      <span style={{ fontSize: 12, letterSpacing: '0.02em', textTransform: 'uppercase', color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.desc}</span>
                      <span style={{ fontSize: 11, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.supplier || '—'}</span>
                      <span className="mono" style={{ fontWeight: 700, color: urgColor, fontSize: 11, whiteSpace: 'nowrap' }}>
                        {fmtDate(dueOf(p))}
                        {daysAway != null && <span style={{ fontSize: 9, fontWeight: 400, color: 'var(--ink-4)', marginLeft: 4 }}>in {daysAway}d</span>}
                      </span>
                      <span className="mono" style={{ color: 'var(--ink-3)', fontSize: 11, whiteSpace: 'nowrap' }}>{fmtDate(p.requiredDate)}</span>
                      <span className="mono" style={{ color: 'var(--ink-3)', fontSize: 11, whiteSpace: 'nowrap' }}>{fmtDate(p.poDate)}</span>
                      <span className="mono" style={{ textAlign: 'right', fontSize: 11, color: p.unitPrice > 0 ? 'var(--ink-2)' : 'var(--ink-4)' }}>{money(p.unitPrice)}</span>
                    </div>
                  );
                })
            }
          </div>
        </>
      )}
    </div>

    </div>
  );
}

function ReadinessTab({ data, onDrillDown, highlightPoIds = [], onClearHighlight }) {
  const { job } = data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <TimelineRibbon job={job} poActions={data.poActions} onDrillDown={onDrillDown} />

      <RiskPartsPanel procurement={data.procurement} />

      {/* Vendor Cards — always shown at bottom */}
      <div style={{ marginTop: 4 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 10 }}>Vendor Status</div>
        <PoTracker poActions={data.poActions} query="" highlightPoIds={highlightPoIds} onClearHighlight={onClearHighlight} />
      </div>
    </div>
  );
}

function AssemblyRow({ a, jobId, isLast, depth = 0, expandAction }) {
  const [open, setOpen] = useState(false);
  const [childExpandAction, setChildExpandAction] = useState({ type: null, version: 0 });
  const [partsLimit, setPartsLimit] = useState(50);
  const node = a.node || {};
  const children = node.children || [];
  const parts = node.parts || [];

  useEffect(() => {
    if (expandAction.type === 'expand') { setOpen(true); setChildExpandAction(p => ({ type: 'expand', version: p.version + 1 })); }
    if (expandAction.type === 'collapse') { setOpen(false); setPartsLimit(50); setChildExpandAction(p => ({ type: 'collapse', version: p.version + 1 })); }
  }, [expandAction.version]);

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (!next) setPartsLimit(50);
    if (next) setChildExpandAction(p => ({ type: 'expand', version: p.version + 1 }));
  };

  const pct     = a.pct || a.stats?.pct || 0;
  const received = a.ready || a.stats?.received || 0;
  const total    = a.total || a.stats?.total || 0;
  const noPO     = a.noPo  || a.stats?.noPO  || 0;

  const healthColor = pct >= 85 ? 'var(--ready)' : pct >= 60 ? 'var(--pending)' : 'var(--threat)';
  const healthInk   = pct >= 85 ? 'var(--ready-ink)' : pct >= 60 ? '#92400e' : 'var(--threat-ink)';
  const isSub = depth > 0;

  const PART_COLS = "3px 54px 28px 90px 1fr 90px 110px 52px 52px 52px";

  return (
    <div style={{ position: 'relative', borderBottom: isLast ? "none" : "1px solid var(--border-subtle)" }}>
      {/* Full vertical tree line bridging to next sibling */}
      {depth > 0 && !isLast && (
        <div style={{
          position: 'absolute',
          left: 12 + (depth - 1) * 24 + 10,
          top: 0,
          bottom: 0,
          width: 1,
          background: 'var(--ink-4)',
          opacity: 0.5,
          zIndex: 0,
          pointerEvents: 'none'
        }} />
      )}

      {/* ── Assembly header ── */}
      <div
        onClick={handleToggle}
        className="row-hover"
        style={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: "20px auto 1fr auto",
          alignItems: "center",
          gap: 10,
          padding: `${isSub ? 2 : 4}px 12px ${isSub ? 2 : 4}px ${12 + depth * 24}px`,
          cursor: "pointer",
          borderLeft: `4px solid ${open ? healthColor : 'transparent'}`,
          background: open
            ? (isSub ? 'rgba(0,0,0,0.02)' : 'var(--bg-sunken)')
            : (isSub ? 'transparent' : 'var(--bg-raised)'),
          transition: "background 0.15s, border-color 0.15s",
        }}
      >
        {/* Solidworks-style tree connector */}
        {depth > 0 && (
          <div style={{
            position: 'absolute',
            left: 12 + (depth - 1) * 24 + 10,
            top: 0,
            bottom: '50%',
            width: 14,
            borderLeft: isLast ? '1px solid var(--ink-4)' : 'none',
            borderBottom: '1px solid var(--ink-4)',
            opacity: 0.5,
            zIndex: 0,
            pointerEvents: 'none'
          }} />
        )}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ink-4)" }}>
          {open ? <IconCaretDown size={11} /> : <IconCaretRight size={11} />}
        </div>

        <span className="mono" style={{
          fontSize: 11, fontWeight: 700, color: "var(--sdc-blue)", padding: "2px 8px",
          background: "var(--sdc-blue-soft)", border: "1px solid var(--sdc-blue-border,rgba(37,99,235,0.25))",
          borderRadius: 4, whiteSpace: 'nowrap',
        }}>{a.code || a.pn}</span>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
          <span style={{
            fontWeight: 500, fontSize: isSub ? 11 : 12,
            color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>{a.desc || 'No Description'}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9, color: 'var(--ink-4)' }}>
            <span style={{ color: healthInk, fontWeight: 700 }}>{received}/{total} parts</span>
            {children.length > 0 && <span>· {children.length} sub-assy</span>}
            {noPO > 0 && <span style={{ color: 'var(--threat-ink)', fontWeight: 700 }}>· {noPO} no&nbsp;PO</span>}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 6 }}>
          <div style={{ width: 60, height: 4, background: 'var(--bg-sunken)', borderRadius: 2, overflow: 'hidden', border: '1px solid var(--border-subtle)' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: healthColor, transition: 'width 0.4s' }} />
          </div>
          <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: healthInk, minWidth: 28, textAlign: 'right' }}>{pct}%</span>
        </div>


      </div>

      {open && (
        <div className="fade-in" style={{ background: "var(--bg)", borderTop: "1px solid var(--border-subtle)" }}>

          {/* Sub-assemblies first */}
          {children.map((child, i) => (
            <AssemblyRow
              key={child.pn + i}
              a={{ ...child, code: child.pn, node: child }}
              jobId={jobId}
              isLast={i === children.length - 1 && parts.length === 0}
              depth={depth + 1}
              expandAction={childExpandAction}
            />
          ))}

          {/* Parts column header */}
          {parts.length > 0 && (
            <div style={{ position: 'relative' }}>
              {/* Full vertical line passing through header */}
              <div style={{
                position: 'absolute',
                left: 12 + depth * 24 + 10,
                top: 0,
                bottom: 0,
                width: 1,
                background: 'var(--ink-4)',
                opacity: 0.5,
                zIndex: 0,
                pointerEvents: 'none'
              }} />
              <div style={{
                display: "grid", gridTemplateColumns: PART_COLS, gap: 8,
                padding: `4px 10px 4px ${36 + depth * 24}px`,
                fontSize: 8, color: "#ffffff", letterSpacing: "0.06em",
                textTransform: "uppercase", fontWeight: 700,
                borderTop: children.length > 0 ? '2px solid var(--border-subtle)' : 'none',
                borderBottom: "1px solid var(--ink)",
                background: 'var(--ink-2)',
              }}>
              <span />
              <span>Status</span>
              <span style={{ textAlign: "right" }}>Qty</span>
              <span>Part #</span>
              <span>Description</span>
              <span>Manufacturer</span>
              <span>Supplier</span>
              <span>Req Date</span>
              <span>Expected</span>
              <span>Rcvd Date</span>
              </div>
            </div>
          )}

          {/* Parts */}
          {parts.slice(0, partsLimit).map((p, i) => {
            const po = p.pos?.[0] || {};
            const isNoPo  = p.status === 'noPO' || p.status === 'no_po';
            const isRcvd  = p.status === 'received';
            const isLate  = !isRcvd && !isNoPo && po.dueDate && new Date(po.dueDate) < new Date();

            const stripColor  = isRcvd ? 'var(--ready)' : isNoPo ? 'var(--threat)' : isLate ? '#f97316' : '#f59e0b';
            const statusColor = isRcvd ? 'var(--ready-ink)' : isNoPo ? 'var(--threat-ink)' : isLate ? '#c2410c' : '#92400e';
            const rowBg       = isRcvd ? 'var(--ready-soft)' : isNoPo ? 'var(--threat-soft)' : isLate ? 'rgba(249,115,22,0.04)' : 'transparent';

            const fmtDate = d => d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';

            const cell = { padding: "6px 0", alignSelf: 'center' };

            return (
              <div key={i} className="row-hover" style={{ position: 'relative' }}>
                {/* Full vertical line if NOT last part */}
                {i < parts.length - 1 && (
                  <div style={{
                    position: 'absolute',
                    left: 12 + depth * 24 + 10,
                    top: 0,
                    bottom: 0,
                    width: 1,
                    background: 'var(--ink-4)',
                    opacity: 0.5,
                    zIndex: 0,
                    pointerEvents: 'none'
                  }} />
                )}
                {/* L-connector / Branch */}
                <div style={{
                  position: 'absolute',
                  left: 12 + depth * 24 + 10,
                  top: 0,
                  bottom: '50%',
                  width: 14,
                  borderBottom: '1px solid var(--ink-4)',
                  borderLeft: i === parts.length - 1 ? '1px solid var(--ink-4)' : 'none',
                  opacity: 0.5,
                  zIndex: 0,
                  pointerEvents: 'none'
                }} />

                <div style={{
                  display: "grid", gridTemplateColumns: PART_COLS, gap: 8,
                  padding: `0 10px 0 ${36 + depth * 24}px`,
                  alignItems: "stretch",
                  borderBottom: i === parts.length - 1 ? "none" : "1px solid var(--border-subtle)",
                  background: rowBg,
                }}>
                {/* Colored left strip */}
                <div style={{ background: stripColor, alignSelf: 'stretch' }} />

                {/* Status */}
                <div style={{ display: "flex", alignItems: "center", ...cell }}>
                  <span style={{ color: statusColor, fontWeight: 800, fontSize: 8, letterSpacing: '0.04em', display: "inline-flex", alignItems: "center", gap: 2 }}>
                    {isNoPo  ? <><IconCircleX size={9} sw={2.5} /> NO PO</>
                    : isRcvd ? <><IconCheck size={9} sw={2.5} /> RCVD</>
                    : isLate ? <><IconAlert size={9} sw={2} /> LATE</>
                              : <><IconClock size={9} sw={2} /> ON ORDER</>}
                  </span>
                </div>

                {/* Qty */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', ...cell }}>
                  <span className="mono tnum" style={{ color: "var(--ink-2)", fontSize: 11, fontWeight: 600 }}>{p.qty}</span>
                </div>

                {/* Part # */}
                <div style={{ display: 'flex', alignItems: 'center', overflow: 'hidden', ...cell }}>
                  <span className="mono" style={{ fontSize: 10, color: "var(--sdc-blue)", fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.pn}</span>
                </div>

                {/* Description */}
                <div style={{ display: 'flex', alignItems: 'center', overflow: 'hidden', ...cell }}>
                  <span style={{ color: "var(--ink)", fontWeight: isNoPo ? 600 : 500, fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.desc}</span>
                </div>

                {/* Manufacturer */}
                <div style={{ display: 'flex', alignItems: 'center', overflow: 'hidden', ...cell }}>
                  <span style={{ color: "var(--ink-3)", fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.manufacturer === 'SDC' ? 'In-house (SDC)' : p.manufacturer || '—'}
                  </span>
                </div>

                {/* Supplier */}
                <div style={{ display: "flex", alignItems: "center", gap: 4, overflow: 'hidden', ...cell }}>
                  {po.supplier && <VendorAvatar vendor={po.supplier} size={14} />}
                  <span style={{ color: "var(--ink-2)", fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {po.supplier || '—'}
                  </span>
                </div>

                {/* Req Date */}
                <div style={{ display: 'flex', alignItems: 'center', ...cell }}>
                  <span className="mono" style={{ color: "var(--ink-3)", fontSize: 9 }}>{fmtDate(p.requiredDate)}</span>
                </div>

                {/* Expected */}
                <div style={{ display: 'flex', alignItems: 'center', ...cell }}>
                  <span className="mono" style={{ color: isLate ? '#c2410c' : "var(--ink-3)", fontSize: 9, fontWeight: (po.dueDate && p.requiredDate && new Date(po.dueDate) > new Date(p.requiredDate)) ? 700 : 400 }}>{fmtDate(po.dueDate)}</span>
                </div>

                {/* Rcvd Date */}
                <div style={{ display: 'flex', alignItems: 'center', ...cell }}>
                  <span className="mono" style={{ color: p.receivedDate ? 'var(--ready-ink)' : "var(--ink-4)", fontSize: 9 }}>{fmtDate(p.receivedDate)}</span>
                </div>
              </div>
            </div>
          );
          })}

          {/* Show more / show all button for large parts lists */}
          {parts.length > partsLimit && (
            <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>Showing {partsLimit} of {parts.length} parts</span>
              <button
                onClick={e => { e.stopPropagation(); setPartsLimit(l => Math.min(l + 50, parts.length)); }}
                style={{ fontSize: 11, color: 'var(--sdc-blue)', background: 'none', border: '1px solid var(--sdc-blue-border,rgba(37,99,235,0.25))', borderRadius: 4, padding: '3px 10px', cursor: 'pointer' }}
              >
                Show next 50
              </button>
              <button
                onClick={e => { e.stopPropagation(); setPartsLimit(parts.length); }}
                style={{ fontSize: 11, color: 'var(--fg-3)', background: 'none', border: '1px solid var(--border-soft)', borderRadius: 4, padding: '3px 10px', cursor: 'pointer' }}
              >
                Show all {parts.length}
              </button>
            </div>
          )}

        </div>
      )}
    </div>
  );
}

function AssemblyList({ data }) {
  const { jobId, readiness, job } = data;
  const [query, setQuery] = useState('');
  const [expandAction, setExpandAction] = useState({ type: null, version: 0 });
  const [statusFilter, setStatusFilter] = useState('all');

  const stats = useMemo(() => {
    let totalParts = 0, receivedParts = 0;
    readiness.forEach(s => s.assemblies.forEach(a => {
      totalParts += (a.total || a.stats?.total || 0);
      receivedParts += (a.ready || a.stats?.received || 0);
    }));
    return { totalParts, receivedParts };
  }, [readiness]);

  const filteredSpecs = useMemo(() => {
    const q = query.toLowerCase();
    return readiness.map(s => ({
      ...s,
      assemblies: s.assemblies.filter(a => {
        const pct = a.pct || a.stats?.pct || 0;
        const status = (pct >= 85) ? 'ready' : (pct >= 60) ? 'close' : 'blocked';
        const matchesStatus = statusFilter === 'all' || status === statusFilter;
        if (!matchesStatus) return false;
        if (!query) return true;
        return (a.name || '').toLowerCase().includes(q) || 
               (a.desc || '').toLowerCase().includes(q) ||
               (a.code || '').toLowerCase().includes(q);
      }),
    })).filter(s => s.assemblies.length > 0);
  }, [readiness, statusFilter, query]);

  const handleExpandAll = () => setExpandAction({ type: 'expand', version: expandAction.version + 1 });
  const handleCollapseAll = () => setExpandAction({ type: 'collapse', version: expandAction.version + 1 });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '0 20px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
        <div className="search" style={{ flex: 1 }}>
          <IconSearch size={14} />
          <input
            placeholder="Search parts, assemblies, suppliers…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          {query && (
            <button onClick={() => setQuery('')} style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: 'var(--ink-4)' }}>
              <IconX size={14} />
            </button>
          )}
        </div>
        <div style={{ display: "flex", gap: 4, background: "var(--bg-sunken)", border: "1px solid var(--border)", borderRadius: 6, padding: 3 }}>
          {['all', 'ready', 'close', 'blocked'].map(id => (
            <button key={id} onClick={() => setStatusFilter(id)} style={{
              padding: "4px 10px", fontSize: 11, fontWeight: 500, borderRadius: 4,
              background: statusFilter === id ? "var(--bg-raised)" : "transparent",
              color: statusFilter === id ? "var(--ink)" : "var(--ink-3)",
              display: "inline-flex", alignItems: "center", gap: 6
            }}>
              {id !== 'all' && <span className={`dot-led ${id === 'ready' ? 'ready' : id === 'close' ? 'pending' : 'threat'}`} style={{ margin: 0 }} />}
              {id.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div style={{
        position: "sticky", top: 0, zIndex: 10,
        background: "rgba(255,255,255,0.9)", backdropFilter: "blur(8px)",
        border: "1px solid var(--border)", borderBottom: "2px solid var(--border-strong)",
        borderRadius: 8, padding: "10px 18px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        boxShadow: "var(--shadow-md)"
      }}>
        <div style={{ display: "flex", gap: 32, alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: "var(--ink-4)", textTransform: "uppercase" }}>Build Start</span>
            <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: "var(--threat-ink)" }}>{job.buildStart ? new Date(job.buildStart).toLocaleDateString() : 'TBD'}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: "var(--ink-4)", textTransform: "uppercase" }}>Readiness</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 100, height: 6, background: "var(--bg-sunken)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${Math.round((stats.receivedParts / (stats.totalParts || 1)) * 100)}%`, height: "100%", background: "var(--ready)" }} />
              </div>
              <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: "var(--ready-ink)" }}>{Math.round((stats.receivedParts / (stats.totalParts || 1)) * 100)}%</span>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="sdc-btn sdc-btn--secondary sdc-btn--sm" onClick={handleExpandAll}>Expand All</button>
          <button className="sdc-btn sdc-btn--secondary sdc-btn--sm" onClick={handleCollapseAll}>Collapse All</button>
        </div>
      </div>

      <div className="sdc-card" style={{ overflow: "hidden" }}>
        {filteredSpecs.map(spec => (
          <div key={spec.spec}>
            <div style={{ padding: "8px 14px", background: "var(--bg-sunken)", borderBottom: "1px solid var(--border-subtle)" }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>Spec {spec.spec} — {spec.title}</span>
            </div>
            {spec.assemblies.map((a, i) => (
              <AssemblyRow key={a.name} a={a} jobId={jobId} isLast={i === spec.assemblies.length - 1} expandAction={expandAction} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export { AssemblyList };
export default ReadinessTab;
