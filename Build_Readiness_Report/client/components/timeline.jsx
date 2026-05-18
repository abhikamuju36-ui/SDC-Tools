const { useState, useMemo, useRef, useEffect } = React;

// ── PO classification relative to build start ──────────────────────────
const CLS = {
  red:        { color: '#dc2626', bg: 'rgba(220,38,38,0.08)',  label: 'Missing',   sub: 'Past due, nothing received', rank: 3 },
  yellow:     { color: '#ca8a04', bg: 'rgba(202,138,4,0.08)',  label: 'Partial',   sub: 'Some parts received',        rank: 2 },
  lightGreen: { color: '#4ade80', bg: 'rgba(74,222,128,0.06)', label: 'On Track',  sub: 'Not due yet',                rank: 1 },
  green:      { color: '#16a34a', bg: 'rgba(22,163,74,0.06)',  label: 'Received',  sub: 'All parts received',         rank: 0 },
};

function poReceiptClass(po, today) {
  const parts = (po.parts || []).filter(p => (p.qty || 0) > 0);
  if (parts.length === 0) return 'green';
  const allRcvd = parts.every(p => (p.received || 0) >= p.qty);
  if (allRcvd) return 'green';
  const anyRcvd = parts.some(p => (p.received || 0) > 0);
  if (anyRcvd) return 'yellow';
  // nothing received — check due date
  if (po.dueDate && new Date(po.dueDate) < today) return 'red';
  return 'lightGreen';
}

function useTimelineDrag(scrollRef) {
  const dragging = useRef(false);
  const startX   = useRef(0);
  const startScroll = useRef(0);
  const moved    = useRef(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onDown = (e) => {
      if (e.button !== 0) return;
      dragging.current   = true;
      moved.current      = false;
      startX.current     = e.clientX;
      startScroll.current = el.scrollLeft;
      el.style.cursor    = 'grabbing';
      el.style.userSelect = 'none';
    };
    const onMove = (e) => {
      if (!dragging.current) return;
      const dx = e.clientX - startX.current;
      if (Math.abs(dx) > 3) moved.current = true;
      el.scrollLeft = startScroll.current - dx;
    };
    const onUp = () => {
      dragging.current = false;
      el.style.cursor  = 'grab';
      el.style.userSelect = '';
    };

    el.style.cursor = 'grab';
    el.addEventListener('mousedown',  onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    return () => {
      el.removeEventListener('mousedown',  onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
    };
  }, [scrollRef]);

  // returns true if mouse was dragged (suppress click on child elements)
  return moved;
}

function TimelineRibbon({ job, poActions, smartsheet, onDrillDown }) {
  const [viewMode, setViewMode] = useState('ribbon'); // 'ribbon' or 'gantt'
  const [hoveredItem, setHoveredItem] = useState(null);
  const [pinnedItem, setPinnedItem] = useState(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);
  const scrollRef = useRef(null);
  const wasDragged = useTimelineDrag(scrollRef);

  const activeItem = pinnedItem || hoveredItem;

  const updateScrollBtns = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 10);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 10);
  };

  // Close pinned tooltip on outside click
  useEffect(() => {
    if (!pinnedItem) return;
    const handler = e => {
      if (!e.target.closest('[data-timeline-tooltip]') && !e.target.closest('[data-timeline-diamond]'))
        setPinnedItem(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [pinnedItem]);
  const today = new Date();
  const buildStart = job.buildStart ? new Date(job.buildStart) : today;
  const hasBuildStart = !!job.buildStart;
  const ship = job.shipDate ? new Date(job.shipDate) : null;

  const displayMilestones = useMemo(() => {
    if (smartsheet?.milestones?.length > 0) {
      return smartsheet.milestones.map((m, i) => ({
        id: `ss-${i}`, label: m.name,
        color: m.health.toLowerCase() === 'red' ? 'threat' : m.health.toLowerCase() === 'yellow' ? 'pending' : 'ready',
        actualDate: m.finish ? new Date(m.finish) : null,
      }));
    }
    return [
      { id: 'all',      label: 'All Parts',   color: 'ready',   offset: -20 },
      { id: 'panel',    label: 'Panel Build',  color: 'blue',    offset: -15 },
      { id: 'wiring',   label: 'Wiring',       color: 'pending', offset: 10  },
      { id: 'complete', label: 'Complete',     color: 'ready',   offset: 20  },
      { id: 'power',    label: 'Power Up',     color: 'ready',   offset: 25  },
    ].map(m => { const d = new Date(buildStart); d.setDate(d.getDate() + m.offset); return { ...m, actualDate: d }; });
  }, [smartsheet, buildStart]);

  // ── Classified markers (all POs grouped by due date) ──────────────────
  const classifiedMarkers = useMemo(() => {
    const now = new Date();
    const map = {};
    [...(poActions?.critical || []), ...(poActions?.warning || []), ...(poActions?.onTrack || []), ...(poActions?.delivered || [])].forEach(entry => {
      if (!entry.po?.dueDate) return;
      const d = new Date(entry.po.dueDate);
      const key = d.toISOString().split('T')[0];
      const cls = poReceiptClass(entry.po, now);
      if (!map[key]) map[key] = { date: d, items: [], cls };
      map[key].items.push(entry);
      if (CLS[cls].rank > CLS[map[key].cls].rank) map[key].cls = cls;
    });
    return Object.values(map);
  }, [poActions]);

  // ── Summary buckets (all POs across all categories) ───────────────────
  const summary = useMemo(() => {
    const now = new Date();
    const buckets = { red: [], yellow: [], lightGreen: [], green: [], unscheduled: [] };
    [...(poActions?.critical || []), ...(poActions?.warning || []), ...(poActions?.onTrack || []), ...(poActions?.delivered || [])].forEach(entry => {
      const cls = poReceiptClass(entry.po, now);
      if (cls === 'green') { buckets.green.push(entry); return; }
      if (!entry.po?.dueDate) { buckets.unscheduled.push(entry); return; }
      buckets[cls].push(entry);
    });
    return buckets;
  }, [poActions]);

  // ── Gantt tasks: Smartsheet tasks OR fallback from PO data ────────────
  const ganttTasks = useMemo(() => {
    if (smartsheet?.tasks?.length > 0) return smartsheet.tasks;
    const now = new Date();
    const allEntries = [
      ...(poActions?.critical || []),
      ...(poActions?.warning || []),
      ...(poActions?.onTrack || []),
      ...(poActions?.delivered || []),
    ];
    return allEntries
      .filter(e => e.po?.dueDate)
      .map(e => {
        const parts = (e.po.parts || []).filter(p => (p.qty || 0) > 0);
        const qty  = parts.reduce((s, p) => s + (p.qty  || 0), 0);
        const rcvd = parts.reduce((s, p) => s + (p.received || 0), 0);
        const cls  = poReceiptClass(e.po, now);
        // Fallback start: PO date, or 14 days before due if missing
        const dueD = new Date(e.po.dueDate);
        const startFallback = new Date(+dueD - 14 * 86400000).toISOString().split('T')[0];
        return {
          id:      e.po.poId,
          name:    `${e.supplier || 'Unknown'} — PO ${e.po.poId}`,
          start:   e.po.poDate || startFallback,
          finish:  e.po.dueDate,
          percent: qty > 0 ? rcvd / qty : 0,
          // 4-way health so colors stay distinct
          health:  cls === 'red' ? 'Red' : cls === 'yellow' ? 'Yellow' : cls === 'green' ? 'Received' : 'OnTrack',
        };
      })
      .sort((a, b) => new Date(a.finish) - new Date(b.finish));
  }, [smartsheet, poActions]);

  // ── View range ─────────────────────────────────────────────────────────
  const allDates = [
    new Date(+today - 30 * 86400000),
    ...classifiedMarkers.map(m => m.date),
    ...displayMilestones.filter(m => m.actualDate).map(m => m.actualDate),
    buildStart,
    ...(ship ? [ship] : []),
  ];
  const earliest = new Date(Math.min(...allDates.map(d => +d)));
  const latestKnown = new Date(Math.max(...allDates.map(d => +d)));
  const rangeEnd = ship ? new Date(+ship + 30 * 86400000) : new Date(+latestKnown + 60 * 86400000);
  const rangeStart = new Date(earliest);
  rangeStart.setDate(rangeStart.getDate() - rangeStart.getDay() - 21);

  const DAY_W = 22;
  const totalDays = Math.ceil((+rangeEnd - +rangeStart) / 86400000);
  const totalWidth = totalDays * DAY_W;
  const EDGE_PAD = 10;
  const dayToX = d => Math.max(EDGE_PAD, Math.min(totalWidth - EDGE_PAD, ((+new Date(d) - +rangeStart) / 86400000) * DAY_W));
  const todayX = dayToX(today);


  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, todayX - el.clientWidth * 0.3);
    setTimeout(updateScrollBtns, 50);
  }, []); // eslint-disable-line

  const weeks = [];
  { let w = new Date(rangeStart); while (+w <= +rangeEnd) { weeks.push(new Date(w)); w = new Date(+w + 7 * 86400000); } }

  const months = [];
  {
    let mc = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
    let idx = 0;
    while (+mc <= +rangeEnd) {
      const mEnd = new Date(mc.getFullYear(), mc.getMonth() + 1, 0);
      const start = +mc < +rangeStart ? rangeStart : mc;
      const end = +mEnd > +rangeEnd ? rangeEnd : mEnd;
      months.push({
        label: mc.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
        year: mc.getFullYear(),
        isYearStart: mc.getMonth() === 0, // January = year boundary
        startX: dayToX(start),
        width: Math.max(0, dayToX(end) - dayToX(start)),
        even: idx % 2 === 0,
      });
      mc = new Date(mc.getFullYear(), mc.getMonth() + 1, 1);
      idx++;
    }
  }

  // Build year spans for the year band above months
  const yearBands = [];
  {
    let curYear = null, bandStart = 0;
    months.forEach((m, i) => {
      if (m.year !== curYear) {
        if (curYear !== null) yearBands.push({ year: curYear, startX: bandStart, endX: m.startX });
        curYear = m.year;
        bandStart = m.startX;
      }
      if (i === months.length - 1) yearBands.push({ year: curYear, startX: bandStart, endX: m.startX + m.width });
    });
  }

  const fmt = d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const fmtFull = d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const bsDays = Math.round((+buildStart - +today) / 86400000);
  const M = { ready: 'var(--ready)', pending: 'var(--pending)', blue: 'var(--sdc-blue)', threat: 'var(--threat)' };

  const milestones = displayMilestones
    .filter(m => m.actualDate)
    .sort((a, b) => +a.actualDate - +b.actualDate)
    .map((m, i) => ({ ...m, row: i % 2 }));

  // ── Combined Gantt rows: milestone diamonds + task/summary bars ────────
  const ganttRows = viewMode === 'gantt' ? (
    smartsheet?.tasks?.length > 0
      // Smartsheet connected: use tasks directly, type from flags
      ? ganttTasks.map(t => ({
          ...t,
          type: t.isMilestone ? 'milestone' : t.isSummary ? 'summary' : 'task',
          label: t.name,
          date: (t.isMilestone && (t.finish || t.start)) ? new Date(t.finish || t.start) : null,
          colorKey: (t.health || '').toLowerCase().includes('red') ? 'threat'
                  : (t.health || '').toLowerCase().includes('yellow') ? 'pending' : 'ready',
        }))
      // No Smartsheet tasks: fallback milestones + PO bars
      : [
          ...milestones.map(m => ({ type: 'milestone', id: m.id, label: m.label, date: m.actualDate, colorKey: m.color })),
          ...ganttTasks.map(t => ({ type: 'po', ...t })),
        ]
  ) : [];

  const TY = 160;
  const totalPOs = Object.values(summary).reduce((s, arr) => s + arr.length, 0);

  // ── V2 header derived values ───────────────────────────────────────────
  const totalAsm     = Math.max(1, job.kpis.assemblies);
  const scorePct     = Math.round((job.kpis.ready / totalAsm) * 100);
  const healthStat   = scorePct >= 85 ? 'ON TRACK' : scorePct >= 60 ? 'AT RISK' : 'BEHIND';
  const hColor       = scorePct >= 85 ? '#16a34a' : scorePct >= 60 ? '#ca8a04' : '#dc2626';
  const hBg          = scorePct >= 85 ? 'rgba(22,163,74,0.1)' : scorePct >= 60 ? 'rgba(202,138,4,0.1)' : 'rgba(220,38,38,0.1)';
  const needAction   = summary.red.length + summary.yellow.length;
  const distTotal    = Math.max(1, job.kpis.ready + job.kpis.close + job.kpis.blocked);
  const distReadyPct = Math.round(job.kpis.ready  / distTotal * 100);
  const distClosePct = Math.round(job.kpis.close  / distTotal * 100);
  const distBlockPct = 100 - distReadyPct - distClosePct;
  const GS = 64, GR = GS / 2 - 4, GC = 2 * Math.PI * GR;
  const gaugeMax   = Math.max(30, bsDays + 5);
  const gaugeOff   = GC * (1 - Math.max(0, Math.min(1, bsDays / gaugeMax)));
  const gaugeColor = bsDays < 0 ? '#dc2626' : bsDays < 7 ? '#ca8a04' : 'var(--sdc-blue)';

  return (
    <div className="card" style={{ padding: '20px 24px 20px', marginBottom: 24, background: 'var(--bg-raised)' }}>

      {/* ── V2 Header: 3-column grid ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', alignItems: 'center', gap: 24, paddingBottom: 14, borderBottom: '1px solid var(--border-subtle)' }}>

        {/* Left: score lockup */}
        <div>
          <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--ink-4)', textTransform: 'uppercase', marginBottom: 4 }}>Schedule Health</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 38, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1, color: hColor }}>{scorePct}%</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: hBg, color: hColor, borderRadius: 999, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', flexShrink: 0 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: hColor, flexShrink: 0 }} />
              {healthStat}
            </span>
          </div>
        </div>

        {/* Center: KPI cards */}
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ minWidth: 120, padding: '9px 14px', border: `1px solid ${job.kpis.blocked > 0 ? 'rgba(220,38,38,0.3)' : 'var(--border-subtle)'}`, borderRadius: 6, background: job.kpis.blocked > 0 ? 'rgba(220,38,38,0.06)' : 'var(--bg-sunken)' }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 4, color: job.kpis.blocked > 0 ? '#dc2626' : 'var(--ink-4)' }}>Risks</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, lineHeight: 1, color: job.kpis.blocked > 0 ? '#dc2626' : 'var(--ink)' }}>{job.kpis.blocked}</div>
            <div style={{ fontSize: 10.5, marginTop: 3, color: job.kpis.blocked > 0 ? 'rgba(220,38,38,0.7)' : 'var(--ink-4)' }}>blocked milestones</div>
          </div>
          <div style={{ minWidth: 120, padding: '9px 14px', border: `1px solid ${needAction > 0 ? 'rgba(202,138,4,0.35)' : 'var(--border-subtle)'}`, borderRadius: 6, background: needAction > 0 ? 'rgba(202,138,4,0.07)' : 'var(--bg-sunken)' }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 4, color: needAction > 0 ? '#ca8a04' : 'var(--ink-4)' }}>Need Action</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, lineHeight: 1, color: needAction > 0 ? '#ca8a04' : 'var(--ink)' }}>{needAction}</div>
            <div style={{ fontSize: 10.5, marginTop: 3, color: needAction > 0 ? 'rgba(202,138,4,0.75)' : 'var(--ink-4)' }}>POs awaiting</div>
          </div>
          <div style={{ minWidth: 120, padding: '9px 14px', border: '1px solid var(--border-subtle)', borderRadius: 6, background: 'var(--bg-sunken)' }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 4, color: 'var(--ink-4)' }}>Open Parts</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, lineHeight: 1, color: 'var(--ink)' }}>{job.kpis.noPO}</div>
            <div style={{ fontSize: 10.5, marginTop: 3, color: 'var(--ink-4)' }}>no PO assigned</div>
          </div>
        </div>

        {/* Right: gauge + date stack + Smartsheet */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: GS, height: GS, position: 'relative', flexShrink: 0 }}>
            <svg width={GS} height={GS}>
              <circle cx={GS/2} cy={GS/2} r={GR} fill="none" stroke="var(--border)" strokeWidth="3.5" />
              <circle cx={GS/2} cy={GS/2} r={GR} fill="none" stroke={gaugeColor} strokeWidth="3.5"
                strokeLinecap="round" strokeDasharray={GC} strokeDashoffset={gaugeOff}
                transform={`rotate(-90 ${GS/2} ${GS/2})`}
                style={{ transition: 'stroke-dashoffset 0.5s' }}
              />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 700, color: gaugeColor }}>{Math.abs(bsDays)}</span>
              <span style={{ fontSize: 7.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--ink-4)', textTransform: 'uppercase', marginTop: 2 }}>{bsDays >= 0 ? 'TO BUILD' : 'PAST BUILD'}</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, paddingLeft: 16, borderLeft: '1px solid var(--border-subtle)' }}>
            {[['Today', fmtFull(today), false], ['Build', hasBuildStart ? fmtFull(buildStart) : 'TBD', hasBuildStart && bsDays < 7], ['Ship', ship ? fmtFull(ship) : 'TBD', false]].map(([lbl, val, warn]) => (
              <div key={lbl} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-4)', width: 34, flexShrink: 0 }}>{lbl}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 12, color: warn ? '#dc2626' : val === 'TBD' ? 'var(--ink-4)' : 'var(--ink)' }}>{val}</span>
              </div>
            ))}
          </div>
          {smartsheet?.permalink && (
            <a href={smartsheet.permalink} target="_blank" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 12px', background: 'var(--sdc-blue-soft)', color: 'var(--sdc-blue-ink)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11.5, fontWeight: 600, textDecoration: 'none', flexShrink: 0 }}>
              <span style={{ width: 12, height: 12, background: 'var(--sdc-blue)', borderRadius: 2, flexShrink: 0 }} />
              Open Schedule <span style={{ fontSize: 10, opacity: 0.7 }}>↗</span>
            </a>
          )}
        </div>
      </div>

      {/* ── Distribution bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 0 12px', borderBottom: '1px solid var(--border-subtle)', marginBottom: 12 }}>
        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)', whiteSpace: 'nowrap' }}>Distribution</span>
        <div style={{ flex: 1, height: 8, borderRadius: 4, display: 'flex', overflow: 'hidden' }}>
          {distReadyPct > 0 && <div style={{ width: `${distReadyPct}%`, background: '#16a34a' }} />}
          {distClosePct > 0 && <div style={{ width: `${distClosePct}%`, background: '#ca8a04' }} />}
          {distBlockPct > 0 && <div style={{ width: `${distBlockPct}%`, background: '#dc2626' }} />}
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 14, fontSize: 11.5, color: 'var(--ink-2)', flexShrink: 0 }}>
          {[['#16a34a', job.kpis.ready, 'ready'], ['#ca8a04', job.kpis.close, 'close'], ['#dc2626', job.kpis.blocked, 'blocked']].map(([color, count, label]) => (
            <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
              {count} <span style={{ color: 'var(--ink-4)', fontFamily: 'inherit', fontWeight: 400 }}>{label}</span>
            </span>
          ))}
        </div>
      </div>

      {/* ── Scrollable Calendar Strip ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>Schedule & PO Tracking</div>
        <button onClick={() => setViewMode(v => v === 'ribbon' ? 'gantt' : 'ribbon')} style={{ padding: '4px 12px', background: 'var(--bg-sunken)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, fontWeight: 600, color: 'var(--ink-2)', cursor: 'pointer' }}>
          {viewMode === 'ribbon' ? 'Switch to Full Gantt View' : 'Switch to Timeline Ribbon'}
        </button>
      </div>

      <div style={{ display: 'flex', border: '1px solid var(--border-subtle)', borderRadius: 8, overflow: 'hidden', background: 'var(--bg-raised)' }}>
        {/* Left fixed pane (Gantt only) */}
        {viewMode === 'gantt' && ganttRows.length > 0 && (
          <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid var(--border-strong)', background: 'var(--bg-raised)', zIndex: 50, display: 'flex', flexDirection: 'column' }}>
            <div style={{ height: 56, borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-sunken)', padding: '0 14px', display: 'flex', alignItems: 'center', fontSize: 10, fontWeight: 700, color: 'var(--ink-4)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Schedule
            </div>
            <div style={{ paddingTop: 120 }}>
              {ganttRows.map((row, i) => {
                if (row.type === 'milestone') {
                  const c = M[row.colorKey] || '#6b7280';
                  return (
                    <div key={`lp-${i}`} style={{ height: 28, padding: '0 14px 0 ' + (14 + (row.indentLevel || 0) * 16) + 'px', display: 'flex', alignItems: 'center', gap: 7, borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-sunken)', fontSize: 10.5, fontWeight: 700, color: 'var(--ink-1)' }}>
                      <span style={{ display: 'inline-block', width: 8, height: 8, background: c, transform: 'rotate(45deg)', borderRadius: 1, flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label || row.name}</span>
                    </div>
                  );
                }
                if (row.type === 'summary') {
                  return (
                    <div key={`lp-${i}`} style={{ height: 28, padding: '0 14px 0 ' + (14 + (row.indentLevel || 0) * 16) + 'px', display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', background: i % 2 === 0 ? 'rgba(37,99,235,0.04)' : 'rgba(37,99,235,0.07)', fontSize: 11, fontWeight: 700, color: 'var(--sdc-blue)', letterSpacing: '0.01em' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>▸ {row.name}</span>
                    </div>
                  );
                }
                // task or po
                const isRcvd = (row.health || '') === 'Received' || (row.percent || 0) >= 1;
                const isCrit = row.onCritical;
                return (
                  <div key={`lp-${i}`} style={{ height: 28, padding: '0 14px 0 ' + (14 + (row.indentLevel || 0) * 16) + 'px', display: 'flex', alignItems: 'center', gap: 5, borderBottom: '1px solid var(--border-subtle)', fontSize: 11, color: isRcvd ? 'var(--ink-4)' : isCrit ? '#dc2626' : 'var(--ink)', background: i % 2 === 0 ? 'var(--bg-raised)' : 'var(--bg-sunken)' }}>
                    {isCrit && !isRcvd && <span style={{ width: 3, height: 14, background: '#dc2626', borderRadius: 2, flexShrink: 0 }} />}
                    {isRcvd && <span style={{ color: '#16a34a', fontSize: 9, fontWeight: 800, flexShrink: 0 }}>✓</span>}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: isRcvd ? 'line-through' : 'none' }}>{row.name}</span>
                    {row.assignee && <span style={{ marginLeft: 'auto', fontSize: 8.5, color: 'var(--ink-4)', flexShrink: 0, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.assignee}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Scrollable area */}
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          {canScrollLeft && (
            <button onClick={() => { scrollRef.current.scrollBy({ left: -300, behavior: 'smooth' }); }} style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', zIndex: 40, width: 28, height: 28, borderRadius: '50%', background: 'var(--bg-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: 'var(--ink-2)', pointerEvents: 'all' }}>‹</button>
          )}
          {canScrollRight && (
            <button onClick={() => { scrollRef.current.scrollBy({ left: 300, behavior: 'smooth' }); }} style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)', zIndex: 40, width: 28, height: 28, borderRadius: '50%', background: 'var(--bg-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: 'var(--ink-2)', pointerEvents: 'all' }}>›</button>
          )}
        <div ref={scrollRef} onScroll={updateScrollBtns} style={{ overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'thin', scrollbarColor: 'var(--border) transparent' }}>
          <div style={{ width: totalWidth, position: 'relative' }}>

          {/* TODAY full-height line */}
          <div style={{ position: 'absolute', left: todayX, top: 0, bottom: 0, width: 2, transform: 'translateX(-50%)', background: 'var(--sdc-blue)', opacity: 0.65, zIndex: 30, pointerEvents: 'none' }} />

          {/* Year band */}
          <div style={{ position: 'relative', height: 18, borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-sunken)' }}>
            {yearBands.map((yb, i) => (
              <div key={i} style={{ position: 'absolute', left: yb.startX, width: yb.endX - yb.startX, height: '100%', borderLeft: i > 0 ? '2px solid var(--border)' : 'none', display: 'flex', alignItems: 'center', paddingLeft: 8, overflow: 'hidden' }}>
                <span style={{ fontSize: 9, fontWeight: 900, color: 'var(--ink-2)', letterSpacing: '0.12em', whiteSpace: 'nowrap' }}>{yb.year}</span>
              </div>
            ))}
          </div>

          {/* Month band */}
          <div style={{ position: 'relative', height: 20, borderBottom: '1px solid var(--border-subtle)' }}>
            {months.map((m, i) => (
              <div key={i} style={{ position: 'absolute', left: m.startX, width: m.width, height: '100%', background: m.even ? 'var(--bg-sunken)' : 'var(--bg)', borderLeft: i > 0 ? '1px solid var(--border-subtle)' : 'none', display: 'flex', alignItems: 'center', paddingLeft: 6, overflow: 'hidden' }}>
                <span style={{ fontSize: 8.5, fontWeight: 800, color: m.isYearStart ? 'var(--sdc-blue)' : 'var(--ink-3)', letterSpacing: '0.1em', whiteSpace: 'nowrap' }}>{m.label}</span>
              </div>
            ))}
          </div>

          {/* Week tick ruler */}
          <div style={{ position: 'relative', height: 18, borderBottom: '1px solid var(--border-subtle)' }}>
            {months.map((m, i) => m.even ? <div key={i} style={{ position: 'absolute', left: m.startX, width: m.width, height: '100%', background: 'var(--bg-sunken)' }} /> : null)}
            {months.slice(1).map((m, i) => <div key={i} style={{ position: 'absolute', left: m.startX, top: 0, bottom: 0, width: 1, background: 'var(--border-subtle)' }} />)}
            {weeks.map((week, i) => {
              const x = dayToX(week);
              if (x < 5 || x > totalWidth - 5) return null;
              const isThisWeek = +week <= +today && +today < +week + 7 * 86400000;
              const label = week.getDate() === 1 ? week.toLocaleDateString('en-US', { month: 'short' }) : week.getDate();
              return (
                <div key={i} style={{ position: 'absolute', left: x, top: 0, bottom: 0, transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 2, pointerEvents: 'none' }}>
                  <div style={{ width: 1, height: 4, background: isThisWeek ? 'var(--sdc-blue)' : 'var(--border)', marginBottom: 1 }} />
                  <span style={{ fontSize: 7.5, color: isThisWeek ? 'var(--sdc-blue)' : 'var(--ink-5)', fontWeight: isThisWeek ? 700 : 400, fontVariantNumeric: 'tabular-nums' }}>{label}</span>
                </div>
              );
            })}
          </div>

          {/* Track area */}
          <div style={{ position: 'relative', height: viewMode === 'gantt' && ganttRows.length > 0 ? TY + (ganttRows.length * 28) + 40 : TY + 80, background: 'var(--bg-raised)' }}>
            {months.map((m, i) => m.even ? <div key={i} style={{ position: 'absolute', left: m.startX, width: m.width, top: 0, bottom: 0, background: 'rgba(0,0,0,0.012)' }} /> : null)}
            {months.slice(1).map((m, i) => <div key={i} style={{ position: 'absolute', left: m.startX, top: 0, bottom: 0, width: 1, background: 'var(--border-subtle)', opacity: 0.4 }} />)}

            <div style={{ position: 'absolute', left: 0, right: 0, top: TY, height: 5, background: 'var(--bg-sunken)', borderRadius: 3 }} />
            <div style={{ position: 'absolute', left: 0, width: dayToX(today), top: TY, height: 5, background: 'linear-gradient(90deg, var(--ready), var(--sdc-blue))', borderRadius: 3 }} />

            {summary.red.length + summary.yellow.length > 0 && dayToX(buildStart) > dayToX(today) && (
              <div style={{ position: 'absolute', left: dayToX(today), width: dayToX(buildStart) - dayToX(today), top: TY, height: 5, background: 'repeating-linear-gradient(45deg, rgba(220,38,38,0.12) 0 4px, rgba(220,38,38,0.45) 4px 5px)', borderRadius: 3 }} />
            )}

            <div style={{ position: 'absolute', left: dayToX(buildStart), top: TY, bottom: 0, width: 1.5, background: 'var(--threat)', opacity: 0.45, transform: 'translateX(-50%)', pointerEvents: 'none', zIndex: 5 }} />
            {ship && <div style={{ position: 'absolute', left: dayToX(ship), top: TY, bottom: 0, width: 1, background: 'var(--ink-4)', opacity: 0.25, transform: 'translateX(-50%)', pointerEvents: 'none' }} />}

            <div style={{ position: 'absolute', left: todayX, top: TY - 22, transform: 'translateX(-50%)', background: 'var(--sdc-blue)', color: '#fff', fontSize: 7.5, fontWeight: 800, letterSpacing: '0.08em', padding: '2px 5px', borderRadius: 3, whiteSpace: 'nowrap', zIndex: 35, pointerEvents: 'none' }}>TODAY</div>
            <div style={{ position: 'absolute', left: dayToX(buildStart), top: TY + 13, transform: 'translateX(-50%)', background: 'var(--threat)', color: '#fff', fontSize: 7, fontWeight: 800, letterSpacing: '0.06em', padding: '2px 5px', borderRadius: 3, whiteSpace: 'nowrap', zIndex: 20, pointerEvents: 'none' }}>BUILD START</div>
            {ship && <div style={{ position: 'absolute', left: dayToX(ship), top: TY + 13, transform: 'translateX(-50%)', background: 'var(--bg-sunken)', border: '1px solid var(--border)', color: 'var(--ink-3)', fontSize: 7, fontWeight: 700, letterSpacing: '0.06em', padding: '2px 5px', borderRadius: 3, whiteSpace: 'nowrap', zIndex: 15, pointerEvents: 'none' }}>SHIP</div>}

            {/* Milestone chips — ribbon mode only */}
            {viewMode === 'ribbon' && milestones.map(m => {
              const x = dayToX(m.actualDate);
              const c = M[m.color] || 'var(--ink-4)';

              const labelTop = m.row === 0 ? 15 : 85;
              const stemH = TY - 5 - (labelTop + 22);

              return (
                <div key={m.id} onMouseEnter={e => setHoveredItem({ type: 'milestone', data: m, date: m.actualDate, rect: e.currentTarget.getBoundingClientRect() })} onMouseLeave={() => setHoveredItem(null)} style={{ position: 'absolute', left: x, top: 0, bottom: 0, transform: 'translateX(-50%)', zIndex: 10, cursor: 'pointer' }}>
                  <div style={{ position: 'absolute', top: labelTop, left: '50%', transform: 'translateX(-50%)', background: 'var(--bg-raised)', border: `1.5px solid ${c}`, borderRadius: 4, padding: '2px 7px', fontSize: 8, fontWeight: 700, letterSpacing: '0.05em', color: c, textTransform: 'uppercase', whiteSpace: 'nowrap', boxShadow: '0 1px 4px rgba(0,0,0,0.09)' }}>
                    {m.label}
                  </div>
                  {stemH > 2 && <div style={{ position: 'absolute', top: labelTop + 22, left: '50%', transform: 'translateX(-50%)', width: 1, height: stemH, background: c, opacity: 0.28 }} />}
                  <div style={{ position: 'absolute', top: TY + 2, left: '50%', transform: 'translate(-50%, -50%) rotate(45deg)', width: 9, height: 9, background: c, border: '2px solid var(--bg-raised)', borderRadius: 2, boxShadow: `0 0 0 1px ${c}`, zIndex: 12 }} />
                </div>
              );
            })}

            {/* Classified PO threat markers — ribbon mode only */}
            {viewMode === 'ribbon' && classifiedMarkers.map((m, i) => {
              const { color } = CLS[m.cls];
              const size = 11;
              const isPinned = pinnedItem?.data === m;
              return (
                <div key={i}
                  data-timeline-diamond="1"
                  onMouseEnter={e => !pinnedItem && setHoveredItem({ type: 'threat', data: m, rect: e.currentTarget.getBoundingClientRect() })}
                  onMouseLeave={() => !pinnedItem && setHoveredItem(null)}
                  onClick={e => {
                    if (wasDragged.current) { wasDragged.current = false; return; }
                    e.stopPropagation();
                    setHoveredItem(null);
                    setPinnedItem(isPinned ? null : { type: 'threat', data: m, rect: e.currentTarget.getBoundingClientRect() });
                  }}
                  style={{ position: 'absolute', top: TY + 7, left: dayToX(m.date), transform: 'translateX(-50%) rotate(45deg)', width: size, height: size, background: color, border: isPinned ? `2px solid var(--bg-raised)` : '1.5px solid var(--bg-raised)', borderRadius: 1, boxShadow: isPinned ? `0 0 0 2px ${color}, 0 0 8px ${color}80` : `0 0 5px ${color}60`, zIndex: isPinned ? 20 : 15, cursor: 'pointer', transition: 'box-shadow 0.15s', opacity: m.cls === 'green' ? 0.5 : 1 }}
                />
              );
            })}

            {/* ── Gantt view: rows (milestone diamonds, summary bars, task bars) ── */}
            {viewMode === 'gantt' && ganttRows.map((row, i) => {
              const rowTop = TY + (i * 28);
              const rowMid = rowTop + 14;
              const band = i % 2 === 1 ? (
                <div key={`band-${i}`} style={{ position: 'absolute', top: rowTop, left: 0, right: 0, height: 28, background: 'rgba(0,0,0,0.018)', pointerEvents: 'none' }} />
              ) : null;

              // ── MILESTONE row ──
              if (row.type === 'milestone') {
                const c = M[row.colorKey] || '#6b7280';
                const x = row.date ? dayToX(row.date) : null;
                if (!x) return band;
                return (
                  <React.Fragment key={`ms-${i}`}>
                    {band}
                    <div style={{ position: 'absolute', top: rowMid, left: 0, right: 0, height: 1, background: `${c}22`, pointerEvents: 'none', zIndex: 2 }} />
                    <div style={{ position: 'absolute', top: 56, left: x, width: 1, height: rowMid - 56, background: `${c}20`, transform: 'translateX(-50%)', pointerEvents: 'none', zIndex: 2 }} />
                    <div
                      onMouseEnter={e => setHoveredItem({ type: 'milestone', data: row, date: row.date, rect: e.currentTarget.getBoundingClientRect() })}
                      onMouseLeave={() => setHoveredItem(null)}
                      style={{ position: 'absolute', top: rowMid - 8, left: x, transform: 'translateX(-50%) rotate(45deg)', width: 16, height: 16, background: c, border: '2.5px solid var(--bg-raised)', borderRadius: 2, boxShadow: `0 0 0 1.5px ${c}, 0 2px 8px ${c}50`, zIndex: 15, cursor: 'pointer' }}
                    />
                    <div style={{ position: 'absolute', top: rowMid - 9, left: x + 14, fontSize: 8.5, fontWeight: 700, color: c, letterSpacing: '0.04em', whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 16 }}>
                      {fmt(row.date)}
                    </div>
                  </React.Fragment>
                );
              }

              // ── SUMMARY row ──
              if (row.type === 'summary') {
                if (!row.start && !row.finish) return band;
                const sx = dayToX(row.start || row.finish);
                const fx = dayToX(row.finish || row.start);
                const w  = Math.max(8, fx - sx);
                return (
                  <React.Fragment key={`sum-${i}`}>
                    {band}
                    <div style={{ position: 'absolute', top: rowMid - 5, left: sx, width: w, height: 10, background: 'var(--sdc-blue)', borderRadius: 2, opacity: 0.35, zIndex: 9 }} />
                    <div style={{ position: 'absolute', top: rowMid - 5, left: sx, width: w, height: 10, background: 'transparent', border: '1.5px solid var(--sdc-blue)', borderRadius: 2, opacity: 0.6, zIndex: 10 }} />
                    {/* End caps */}
                    <div style={{ position: 'absolute', top: rowMid + 4, left: sx, width: 0, height: 0, borderLeft: '5px solid var(--sdc-blue)', borderTop: '5px solid transparent', opacity: 0.6, zIndex: 10 }} />
                    <div style={{ position: 'absolute', top: rowMid + 4, left: fx, width: 0, height: 0, borderRight: '5px solid var(--sdc-blue)', borderTop: '5px solid transparent', transform: 'translateX(-100%)', opacity: 0.6, zIndex: 10 }} />
                  </React.Fragment>
                );
              }

              // ── TASK / PO row ──
              const h = row.health || '';
              const isRed      = h.toLowerCase().includes('red');
              const isYellow   = h.toLowerCase().includes('yellow');
              const isReceived = h === 'Received' || (row.percent || 0) >= 1;
              const isCrit     = !!row.onCritical;
              const c = isRed ? '#dc2626' : isYellow ? '#ca8a04' : isReceived ? '#16a34a' : 'var(--sdc-blue)';
              const opacity    = isReceived ? 0.5 : 0.88;
              const pct        = Math.round((row.percent || 0) * 100);
              const startXPos  = dayToX(row.start || row.finish || buildStart);
              const finishXPos = dayToX(row.finish || row.start || today);
              const barWidth   = Math.max(4, finishXPos - startXPos - 10);

              return (
                <React.Fragment key={`task-${i}`}>
                  {band}
                  <div
                    title={`${row.name}${row.assignee ? ' · ' + row.assignee : ''} · ${pct}%${row.predecessorDisplay ? ' · Pred: ' + row.predecessorDisplay : ''}`}
                    style={{ position: 'absolute', top: rowTop + 7, left: startXPos, width: barWidth, height: 14, background: c, borderRadius: '3px 0 0 3px', opacity, cursor: 'default', zIndex: 10, overflow: 'hidden', boxShadow: isCrit ? `0 0 0 1.5px #dc2626, 0 0 0 2.5px #dc262630` : '0 1px 3px rgba(0,0,0,0.1)' }}
                  >
                    {pct > 0 && pct < 100 && <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: 'rgba(255,255,255,0.28)', borderRadius: '3px 0 0 3px' }} />}
                    {barWidth > 40 && (
                      <span style={{ position: 'absolute', right: 5, top: '50%', transform: 'translateY(-50%)', fontSize: 7.5, fontWeight: 700, color: '#fff', letterSpacing: '0.04em', pointerEvents: 'none' }}>
                        {isReceived ? '✓' : `${pct}%`}
                      </span>
                    )}
                  </div>
                  {/* Diamond at due date */}
                  <div
                    style={{ position: 'absolute', top: rowMid - 6, left: finishXPos, transform: 'translateX(-50%) rotate(45deg)', width: 12, height: 12, background: isReceived ? c : 'var(--bg-raised)', border: `2px solid ${c}`, borderRadius: 2, boxShadow: isCrit ? `0 0 0 1px #dc262670` : `0 0 0 1px ${c}50`, zIndex: 14, opacity }}
                  />
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>
      </div>
      </div>


      {/* ── Legend ── */}
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 8, color: 'var(--ink-5)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>Timeline markers:</span>
        {Object.entries(CLS).map(([cls, cfg]) => (
          <div key={cls} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 7, height: 7, background: cfg.color, borderRadius: 1, transform: 'rotate(45deg)', flexShrink: 0 }} />
            <span style={{ fontSize: 8, color: 'var(--ink-4)' }}>{cfg.label}</span>
          </div>
        ))}
        {summary.unscheduled.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 7, height: 7, background: '#9ca3af', borderRadius: 1, transform: 'rotate(45deg)', flexShrink: 0 }} />
            <span style={{ fontSize: 8, color: 'var(--ink-4)' }}>Unscheduled ({summary.unscheduled.length})</span>
          </div>
        )}
        <span style={{ fontSize: 8, color: 'var(--ink-5)', marginLeft: 'auto' }}>{totalPOs} POs total across all categories</span>
      </div>

      {/* ── Tooltip (hover preview + click-to-pin for full interactive view) ── */}
      {activeItem && (() => {
        const { type, data, rect, date } = activeItem;
        const isPinned = !!pinnedItem;

        // Smart positioning
        const tipW = isPinned ? 440 : 400;
        const estH = isPinned ? 600 : 350;
        const spaceAbove = rect.top - 12;
        const spaceBelow = window.innerHeight - rect.bottom - 12;
        const useBelow = spaceAbove < estH;
        const availH = useBelow ? spaceBelow : spaceAbove;
        const maxTipH = Math.max(200, Math.min(estH, availH));
        const hPos = { left: Math.max(8, Math.min(window.innerWidth - tipW - 8, rect.left + rect.width / 2 - tipW / 2)) };
        const vPos = useBelow ? { top: rect.bottom + 10 } : { bottom: window.innerHeight - rect.top + 10 };
        const baseStyle = {
          position: 'fixed', ...hPos, ...vPos, width: tipW, maxHeight: maxTipH, zIndex: 1000,
          boxShadow: isPinned ? '0 8px 32px rgba(0,0,0,0.22)' : 'var(--shadow-lg)',
          pointerEvents: isPinned ? 'all' : 'none',
          borderRadius: 10, overflow: 'hidden',
          transition: 'width 0.15s, box-shadow 0.15s',
        };

        if (type === 'milestone') {
          const dft = Math.round((+date - +today) / 86400000);
          return (
            <div data-timeline-tooltip="1" style={{ ...baseStyle, background: 'var(--bg-raised)', border: '1px solid var(--border)', padding: '12px 14px' }}>
              <div style={{ fontSize: 10, color: 'var(--ink-4)', borderBottom: '1px solid var(--border-subtle)', paddingBottom: 6, marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                <span>MILESTONE · {fmt(date)}</span>
                <span className={`badge badge-${data.color || 'neutral'}`}>{dft >= 0 ? 'ON TRACK' : 'DELAYED'}</span>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{data.label}</div>
              <div className="mono" style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>
                {dft >= 0 ? `Target in ${dft} days` : `Delayed by ${Math.abs(dft)} days`}
              </div>
            </div>
          );
        }

        // ── V1 Minimal tooltip ────────────────────────────────────────
        const cfg = CLS[data.cls] || CLS.red;
        const bsDaysRemaining = Math.round((+buildStart - +data.date) / 86400000);

        // Aggregate totals across all POs in this date group
        const allParts = data.items.flatMap(e => e.po.parts || []);
        const grpQty   = allParts.reduce((s, p) => s + (p.qty || 0), 0);
        const grpRcvd  = allParts.reduce((s, p) => s + (p.received || 0), 0);
        const grpPct   = grpQty > 0 ? Math.round(grpRcvd / grpQty * 100) : 0;
        const barColor = grpPct === 100 ? '#16a34a' : grpPct > 0 ? '#ca8a04' : cfg.color;
        const pillLabel = { green: 'ON TIME', lightGreen: 'ON TRACK', yellow: 'PARTIAL', red: 'MISSING' }[data.cls] || cfg.label;
        const uniqueSuppliers = [...new Set(data.items.map(e => e.supplier).filter(Boolean))];
        const supplierMeta = uniqueSuppliers.length === 1 ? uniqueSuppliers[0] : `${uniqueSuppliers.length} suppliers · ${data.items.length} POs`;
        const flatParts = data.items.flatMap(e => (e.po.parts || []).map(p => ({ ...p, _poId: e.po.poId, _supplier: e.supplier })));
        const MAX_PARTS = 8;

        const partRow = (p, pi, total, showBorder) => {
          const rcvd = (p.received || 0) >= (p.qty || 1) && (p.qty || 0) > 0;
          const partial = (p.received || 0) > 0 && !rcvd;
          const dotColor = rcvd ? '#16a34a' : partial ? '#ca8a04' : cfg.color;
          const price = p.price ? `$${Number(p.price).toLocaleString(undefined, {minimumFractionDigits: 2})}` : '—';
          const isFirst = pi === 0;
          const isLast = pi === total - 1;
          
          return (
            <div key={pi} style={{ position: 'relative', display: 'grid', gridTemplateColumns: '12px 1fr auto', gap: 12, alignItems: 'flex-start', padding: '10px 16px 10px 32px', borderBottom: showBorder ? '1px solid var(--border-subtle)' : 'none' }}>
              {total > 1 && (
                <div style={{ 
                  position: 'absolute', left: 38, width: 2, background: 'var(--border-strong)', opacity: 0.35,
                  top: isFirst ? 18 : 0, 
                  bottom: isLast ? 'auto' : 0,
                  height: isLast ? 18 : 'auto',
                  zIndex: 1
                }} />
              )}
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, marginTop: 9, flexShrink: 0, position: 'relative', zIndex: 2 }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ color: 'var(--ink)', fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }}>
                  {p.partDesc || 'Unnamed Part'}
                </div>
                <div className="mono" style={{ color: 'var(--sdc-blue)', fontSize: 10.5, fontWeight: 700, marginBottom: 4, wordBreak: 'break-all' }}>
                  {p.partNumber}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 10, color: 'var(--ink-4)', fontFamily: 'var(--font-mono)', letterSpacing: '0.01em' }}>
                  <span>QTY: <span style={{ color: 'var(--ink-1)', fontWeight: 600 }}>{p.qty}</span></span>
                  <span>COST: <span style={{ color: 'var(--ink-1)', fontWeight: 600 }}>{price}</span></span>
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 3, fontSize: 10, color: 'var(--ink-4)', fontFamily: 'var(--font-mono)' }}>
                   <span>REQ: <span style={{ color: 'var(--ink-2)', fontWeight: 600 }}>{p.requiredDate ? fmt(p.requiredDate) : '—'}</span></span>
                   <span>EXP: <span style={{ color: 'var(--ink-2)', fontWeight: 600 }}>{p.expectedDate ? fmt(p.expectedDate) : '—'}</span></span>
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: rcvd ? '#16a34a' : 'var(--ink-2)', fontWeight: 700 }}>{p.received || 0}/{p.qty || 0}</div>
              </div>
            </div>
          );
        };

        return (
          <div data-timeline-tooltip="1" style={{ ...baseStyle, background: 'var(--bg-raised)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', boxShadow: isPinned ? '0 8px 32px rgba(0,0,0,0.18)' : '0 8px 24px rgba(20,14,4,0.1), 0 1px 2px rgba(20,14,4,0.04)' }}>

          {/* Head: ETA · date + status pill */}
          <div style={{ padding: '14px 16px 12px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.005em', marginBottom: 3 }}>ETA · {fmt(data.date)}</div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{supplierMeta}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', background: cfg.bg, color: cfg.color, borderRadius: 999, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.color }} />{pillLabel}
              </span>
              {isPinned && (
                <button onClick={() => setPinnedItem(null)} style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--bg-sunken)', border: '1px solid var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--ink-3)', flexShrink: 0 }}>✕</button>
              )}
            </div>
          </div>

          {/* Progress: "N of N received" + slim bar */}
          <div style={{ padding: '0 16px 12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6, fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
              <span><span style={{ color: 'var(--ink)', fontWeight: 600 }}>{grpRcvd}</span> of <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{grpQty}</span> received</span>
              <span style={{ color: barColor, fontWeight: 600 }}>{grpPct}%</span>
            </div>
            <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${grpPct}%`, background: barColor, borderRadius: 2, transition: 'width 0.3s' }} />
            </div>
          </div>

          {/* Parts dot-list */}
          <div style={{ borderTop: '1px solid var(--border-subtle)', overflowY: isPinned ? 'auto' : 'hidden', maxHeight: isPinned ? 300 : 220, flex: 1, minHeight: 0 }}>
            {isPinned
              ? data.items.map((entry, ei) => {
                  const parts = entry.po.parts || [];
                  const isLast = ei === data.items.length - 1;
                  return (
                    <div key={ei}>
                      {(uniqueSuppliers.length > 1 || data.items.length > 1) && (
                        <div style={{ 
                          padding: '7px 16px', fontSize: 10.5, fontWeight: 800, letterSpacing: '0.04em', color: 'var(--ink-1)', textTransform: 'uppercase', 
                          background: 'var(--bg-sunken)', borderBottom: '1px solid var(--border-subtle)', borderLeft: '4px solid var(--sdc-blue)',
                          display: 'flex', alignItems: 'center', gap: 10
                        }}>
                          <div style={{ width: 14, height: 14, borderRadius: 3, background: 'var(--sdc-blue)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8 }}>V</div>
                          {uniqueSuppliers.length > 1 ? entry.supplier : `Purchase Order ${entry.po.poId}`}
                        </div>
                      )}
                      {parts.map((p, pi) => partRow(p, pi, parts.length, pi < parts.length - 1 || !isLast))}
                    </div>
                  );
                })
              : (() => {
                  const shown = flatParts.slice(0, MAX_PARTS);
                  const overflow = flatParts.length - shown.length;
                  return (
                    <>
                      {shown.map((p, pi) => partRow(p, pi, pi < shown.length - 1))}
                      {overflow > 0 && (
                        <div style={{ padding: '7px 16px', fontSize: 11, color: 'var(--ink-4)', fontStyle: 'italic', borderTop: '1px solid var(--border-subtle)' }}>
                          +{overflow} more · click to see all
                        </div>
                      )}
                    </>
                  );
                })()
            }
          </div>

          {/* Footer */}
          <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', background: 'var(--bg-sunken)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--ink-3)', flexShrink: 0 }}>
            <span>{data.items.length} PO{data.items.length !== 1 ? 's' : ''} · {bsDaysRemaining > 0 ? `${bsDaysRemaining}d before build` : bsDaysRemaining === 0 ? 'build starts today' : `${Math.abs(bsDaysRemaining)}d past build`}</span>
            {onDrillDown && (
              <button
                onClick={() => { setPinnedItem(null); onDrillDown(data.items.map(e => e.po.poId)); }}
                style={{ color: '#1d4ed8', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', fontSize: 11.5, padding: 0 }}
              >
                View →
              </button>
            )}
          </div>
        </div>
        );
      })()}
    </div>
  );
}

window.TimelineRibbon = TimelineRibbon;
