/* Delivery Calendar — month grid view of all expected POs */

const DeliveryCalendarReport = () => {
  const rawPos = window.PURCHASE_ORDERS_RAW || [];
  const now    = new Date();

  const [year,           setYear]           = React.useState(now.getFullYear());
  const [month,          setMonth]          = React.useState(now.getMonth());
  const [selectedDay,    setSelectedDay]    = React.useState(null);
  const [projectFilter,  setProjectFilter]  = React.useState(new Set());
  const [showProjPicker, setShowProjPicker] = React.useState(false);
  const [projSearch,     setProjSearch]     = React.useState('');
  const [pickerPos,      setPickerPos]      = React.useState({ top: 0, left: 0 });
  const triggerRef = React.useRef(null);
  const panelRef   = React.useRef(null);

  const todayStr = now.toISOString().split('T')[0];

  // Close project picker on outside click
  React.useEffect(() => {
    const handler = e => {
      if (triggerRef.current && !triggerRef.current.contains(e.target) &&
          panelRef.current   && !panelRef.current.contains(e.target)) {
        setShowProjPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else             setMonth(m => m - 1);
    setSelectedDay(null);
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else              setMonth(m => m + 1);
    setSelectedDay(null);
  }

  const monthName   = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // All unique project IDs in the data
  const allProjectIds = React.useMemo(() => (
    [...new Set(rawPos.map(po => po.project).filter(Boolean))].sort()
  ), [rawPos.length]);

  // Project name lookup
  const projectNames = React.useMemo(() => {
    const m = {};
    (window.PROJECTS || []).forEach(p => { m[p.id] = p.name; });
    return m;
  }, []);

  // PO count per project (for the picker list)
  const poCountByProject = React.useMemo(() => {
    const c = {};
    rawPos.forEach(po => { if (po.project) c[po.project] = (c[po.project] || 0) + 1; });
    return c;
  }, [rawPos.length]);

  // Filtered POs (apply project filter)
  const filteredRawPos = projectFilter.size === 0
    ? rawPos
    : rawPos.filter(po => projectFilter.has(po.project));

  // Visible projects in picker (respects search)
  const visibleProjs = allProjectIds.filter(pid =>
    !projSearch.trim() || pid.toLowerCase().includes(projSearch.trim().toLowerCase())
  );

  const openPicker = () => {
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setPickerPos({ top: r.bottom + 4, left: r.left });
    }
    setShowProjPicker(v => !v);
  };

  const toggleProject = pid => setProjectFilter(prev => {
    const n = new Set(prev); n.has(pid) ? n.delete(pid) : n.add(pid); return n;
  });

  // Build a map: dateStr → POs expected (filtered)
  const poByDay = {};
  filteredRawPos.forEach(po => {
    const due = po._revisedDate || po._requiredDate;
    if (!due) return;
    const d = new Date(due);
    if (isNaN(d.getTime())) return;
    if (d.getFullYear() === year && d.getMonth() === month) {
      if (!poByDay[due]) poByDay[due] = [];
      poByDay[due].push(po);
    }
  });

  function dayStr(day) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function dayStatus(ds, pos) {
    if (!pos || pos.length === 0) return 'empty';
    if (ds < todayStr) {
      const openPos = pos.filter(p => p.status !== 'Received');
      return openPos.length > 0 ? 'overdue' : 'delivered';
    }
    if (ds === todayStr) return 'today';
    const diff = Math.round((new Date(ds) - now) / 86400000);
    if (diff <= 3) return 'soon';
    return 'normal';
  }

  const STATUS_STYLE = {
    empty:     { bg: 'transparent',              border: 'var(--border)',             text: 'var(--text-tertiary)', badge: null      },
    delivered: { bg: 'rgba(116,196,21,0.05)',    border: 'rgba(116,196,21,0.18)',     text: 'var(--text-tertiary)', badge: '#74C415' },
    overdue:   { bg: 'rgba(180,35,24,0.07)',     border: 'rgba(180,35,24,0.25)',      text: 'var(--danger)',        badge: '#B42318' },
    today:     { bg: 'rgba(21,116,196,0.08)',    border: 'var(--sdc-blue)',           text: 'var(--sdc-blue)',      badge: '#1574C4' },
    soon:      { bg: 'rgba(232,160,32,0.07)',    border: 'rgba(232,160,32,0.3)',      text: '#B87D10',              badge: '#E8A020' },
    normal:    { bg: 'rgba(116,196,21,0.05)',    border: 'rgba(116,196,21,0.2)',      text: 'var(--positive)',      badge: '#74C415' },
  };

  // KPIs (all from filtered data)
  const monthPos    = Object.values(poByDay).flat();
  const overduePos  = monthPos.filter(po => (po._revisedDate || po._requiredDate) < todayStr && po.status !== 'Received');
  const todayPos    = poByDay[todayStr] || [];
  const plus7Str    = (() => { const x = new Date(now); x.setDate(x.getDate() + 7); return x.toISOString().split('T')[0]; })();
  const upcomingPos = monthPos.filter(po => {
    const d = po._revisedDate || po._requiredDate;
    return d >= todayStr && d <= plus7Str;
  });
  const selectedPos = selectedDay ? (poByDay[selectedDay] || []) : [];

  // Upcoming 14-day list (filtered)
  const plus14Str = (() => { const x = new Date(now); x.setDate(x.getDate() + 14); return x.toISOString().split('T')[0]; })();
  const upcoming14 = filteredRawPos.filter(po => {
    const due = po._revisedDate || po._requiredDate;
    return due && due >= todayStr && due <= plus14Str;
  }).sort((a, b) => (a._revisedDate || a._requiredDate).localeCompare(b._revisedDate || b._requiredDate));

  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <>
      {/* KPI row */}
      <div className="kpis">
        <KPI label="Overdue This Month" value={overduePos.length} glyph={Icon.alert}
          trendDir={overduePos.length > 0 ? 'down' : 'up'} caption="past due, not received" />
        <KPI label="Due Today" value={todayPos.length} glyph={Icon.calendar}
          trendDir="flat" caption="expected deliveries" />
        <KPI label="Due Next 7 Days" value={upcomingPos.length} glyph={Icon.truck}
          caption="upcoming this week" />
        <KPI label="Total This Month" value={monthPos.length} glyph={Icon.package}
          caption={fmtUSD(monthPos.reduce((s, p) => s + (p.amount || 0), 0), true) + ' value'} />
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Project picker trigger */}
        <button ref={triggerRef} onClick={openPicker}
          style={{ padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
            display: 'flex', alignItems: 'center', gap: 6,
            border: `1px solid ${projectFilter.size > 0 ? 'var(--sdc-blue)' : 'var(--border)'}`,
            background: projectFilter.size > 0 ? 'rgba(21,116,196,0.08)' : 'transparent',
            color: projectFilter.size > 0 ? 'var(--sdc-blue)' : 'var(--text-secondary)',
            position: 'relative' }}>
          {Icon.filter}
          {projectFilter.size === 0 ? 'All Projects' : `${projectFilter.size} project${projectFilter.size !== 1 ? 's' : ''}`}
          <span style={{ fontSize: 9, opacity: 0.6 }}>{showProjPicker ? '▲' : '▼'}</span>
          {projectFilter.size > 0 && (
            <span style={{ position: 'absolute', top: -6, right: -6, minWidth: 16, height: 16,
              borderRadius: 8, background: 'var(--sdc-blue)', color: '#fff',
              fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center',
              justifyContent: 'center', padding: '0 4px' }}>
              {projectFilter.size}
            </span>
          )}
        </button>

        {/* Active filter chips (show up to 4 then overflow) */}
        {[...projectFilter].slice(0, 4).map(pid => (
          <span key={pid} style={{ padding: '3px 8px', borderRadius: 5, fontSize: 11, fontWeight: 600,
            background: 'rgba(21,116,196,0.1)', color: 'var(--sdc-blue)',
            display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
            {pid}
            <button onClick={() => toggleProject(pid)}
              style={{ background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--sdc-blue)', fontSize: 11, padding: 0, lineHeight: 1 }}>✕</button>
          </span>
        ))}
        {projectFilter.size > 4 && (
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>+{projectFilter.size - 4} more</span>
        )}

        {projectFilter.size > 0 && (
          <button onClick={() => setProjectFilter(new Set())}
            style={{ background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-tertiary)', fontSize: 12, padding: '0 4px', marginLeft: 2 }}>
            Clear all
          </button>
        )}

        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-tertiary)' }}>
          {projectFilter.size === 0
            ? `${allProjectIds.length} projects`
            : `Showing ${projectFilter.size} of ${allProjectIds.length} projects`}
        </span>
      </div>

      {/* Project picker panel — fixed, floats above everything */}
      {showProjPicker && (
        <div ref={panelRef} style={{
          position: 'fixed', top: pickerPos.top, left: pickerPos.left,
          zIndex: 1200, width: 320, maxHeight: 420, display: 'flex', flexDirection: 'column',
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: '0 12px 40px rgba(0,0,0,0.28)' }}>

          {/* Search box */}
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
            <input type="text" placeholder="Search project / job ID…" value={projSearch}
              onChange={e => setProjSearch(e.target.value)} autoFocus
              style={{ width: '100%', padding: '5px 9px', borderRadius: 5, boxSizing: 'border-box',
                border: '1px solid var(--border)', background: 'var(--bg-subtle)',
                color: 'var(--text-primary)', fontSize: 12, outline: 'none' }} />
          </div>

          {/* Select / Clear all */}
          <div style={{ padding: '5px 12px', borderBottom: '1px solid var(--border)',
            display: 'flex', gap: 12, fontSize: 11.5, alignItems: 'center' }}>
            <button onClick={() => setProjectFilter(new Set(visibleProjs))}
              style={{ background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--sdc-blue)', padding: 0, fontSize: 11.5 }}>
              Select all ({visibleProjs.length})
            </button>
            {projectFilter.size > 0 && (
              <button onClick={() => setProjectFilter(new Set())}
                style={{ background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-tertiary)', padding: 0, fontSize: 11.5 }}>
                Clear
              </button>
            )}
            <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--text-tertiary)' }}>
              {projectFilter.size > 0 ? `${projectFilter.size} selected` : 'all'}
            </span>
          </div>

          {/* Project list */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {visibleProjs.map(pid => (
              <label key={pid} style={{ display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
                background: projectFilter.has(pid) ? 'rgba(21,116,196,0.06)' : undefined }}>
                <input type="checkbox" checked={projectFilter.has(pid)}
                  onChange={() => toggleProject(pid)} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, fontFamily: 'monospace',
                    color: projectFilter.has(pid) ? 'var(--sdc-blue)' : 'var(--text-primary)' }}>
                    {pid}
                  </div>
                  {projectNames[pid] && (
                    <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {projectNames[pid]}
                    </div>
                  )}
                </div>
                <span style={{ fontSize: 10.5, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                  {poCountByProject[pid] || 0} POs
                </span>
              </label>
            ))}
            {visibleProjs.length === 0 && (
              <div style={{ padding: '20px 12px', textAlign: 'center',
                color: 'var(--text-tertiary)', fontSize: 12 }}>
                No projects match "{projSearch}"
              </div>
            )}
          </div>
        </div>
      )}

      {/* Legend */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 12, fontSize: 12, color: 'var(--text-tertiary)', alignItems: 'center', flexWrap: 'wrap' }}>
        <span>Legend:</span>
        {[['Overdue (open)','#B42318'], ['Due Today','#1574C4'], ['Due Soon (≤3d)','#E8A020'], ['Scheduled','#74C415'], ['Delivered','#74C415']].map(([l, c]) => (
          <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: 'inline-block', opacity: 0.8 }} />
            {l}
          </span>
        ))}
      </div>

      {/* Calendar card */}
      <Card bodyClass="flush">
        {/* Month header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
          <button onClick={prevMonth} style={{ background: 'none', border: '1px solid var(--border)',
            borderRadius: 7, padding: '5px 10px', cursor: 'pointer', color: 'var(--text)', display: 'flex', alignItems: 'center' }}>
            {Icon.chevLeft}
          </button>
          <div style={{ textAlign: 'center' }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, letterSpacing: 0.5 }}>
              {monthName}
            </span>
            {projectFilter.size > 0 && (
              <div style={{ fontSize: 11, color: 'var(--sdc-blue)', marginTop: 2 }}>
                Filtered: {projectFilter.size} project{projectFilter.size !== 1 ? 's' : ''}
              </div>
            )}
          </div>
          <button onClick={nextMonth} style={{ background: 'none', border: '1px solid var(--border)',
            borderRadius: 7, padding: '5px 10px', cursor: 'pointer', color: 'var(--text)', display: 'flex', alignItems: 'center' }}>
            {Icon.chevRight}
          </button>
        </div>

        <div style={{ padding: '0 16px 16px' }}>
          {/* Day-of-week headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4, marginTop: 12 }}>
            {DOW.map(d => (
              <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700,
                color: 'var(--text-tertiary)', fontFamily: 'var(--font-display)', letterSpacing: 0.5, padding: '4px 0' }}>
                {d}
              </div>
            ))}
          </div>

          {/* Calendar cells */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {Array(firstDay).fill(null).map((_, i) => <div key={'e' + i} />)}

            {Array(daysInMonth).fill(null).map((_, i) => {
              const day = i + 1;
              const ds  = dayStr(day);
              const pos = poByDay[ds] || [];
              const st  = dayStatus(ds, pos);
              const style = STATUS_STYLE[st];
              const isSelected = selectedDay === ds;
              return (
                <div key={day} onClick={() => setSelectedDay(isSelected ? null : ds)}
                  style={{
                    minHeight: 64, borderRadius: 8, padding: '6px 8px',
                    background: isSelected ? 'rgba(21,116,196,0.12)' : style.bg,
                    border: `1px solid ${isSelected ? 'var(--sdc-blue)' : style.border}`,
                    cursor: pos.length > 0 ? 'pointer' : 'default',
                    transition: 'all 0.12s',
                    boxShadow: isSelected ? '0 0 0 2px rgba(21,116,196,0.25)' : undefined,
                  }}>
                  <div style={{ fontSize: 12, fontWeight: ds === todayStr ? 800 : 500,
                    color: ds === todayStr ? 'var(--sdc-blue)' : 'var(--text)',
                    marginBottom: 4 }}>
                    {day}
                    {ds === todayStr && <span style={{ fontSize: 9, marginLeft: 3, color: 'var(--sdc-blue)', fontWeight: 700 }}>TODAY</span>}
                  </div>
                  {pos.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '2px 6px', borderRadius: 4, fontSize: 10.5, fontWeight: 700,
                        background: style.badge, color: '#fff', alignSelf: 'flex-start' }}>
                        {pos.length} PO{pos.length !== 1 ? 's' : ''}
                      </span>
                      {pos.slice(0, 2).map((po, j) => (
                        <div key={j} style={{ fontSize: 9.5, color: 'var(--text-tertiary)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={po.vendor}>
                          {po.vendor?.split(' ').slice(0, 2).join(' ')}
                        </div>
                      ))}
                      {pos.length > 2 && <div style={{ fontSize: 9.5, color: 'var(--text-tertiary)' }}>+{pos.length - 2} more</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Selected day detail */}
      {selectedDay && selectedPos.length > 0 && (
        <Card
          title={`Deliveries for ${new Date(selectedDay + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`}
          sub={`${selectedPos.length} PO${selectedPos.length !== 1 ? 's' : ''} · ${fmtUSD(selectedPos.reduce((s, p) => s + (p.amount || 0), 0), true)} total value`}
          actions={<button onClick={() => setSelectedDay(null)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, color: 'var(--text-tertiary)' }}>✕ Close</button>}
          bodyClass="flush">
          <div className="table-wrap">
            <table className="data" style={{ fontSize: 12 }}>
              <thead>
                <tr><th>PO #</th><th>Project</th><th>Vendor</th><th>Part</th><th className="num">Amount</th><th>Required</th><th>Revised</th><th>Status</th></tr>
              </thead>
              <tbody>
                {selectedPos.map((po, i) => {
                  const isLate = selectedDay < todayStr;
                  return (
                    <tr key={i} style={{ background: isLate ? 'rgba(180,35,24,0.04)' : undefined }}>
                      <td className="strong" style={{ fontFamily: 'monospace', fontSize: 11.5 }}>{po.po}</td>
                      <td className="muted" style={{ cursor: 'pointer', color: 'var(--sdc-blue)' }}
                        onClick={() => window.navigateTo && window.navigateTo('project', po.project)}>
                        {po.project}
                      </td>
                      <td>{po.vendor}</td>
                      <td className="muted" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={po.partDesc}>{po.partDesc || po.partNumber || '—'}</td>
                      <td className="num strong">{fmtUSD(po.amount)}</td>
                      <td className="muted">{po._requiredDate ? new Date(po._requiredDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</td>
                      <td>{po._revisedDate && po._revisedDate !== po._requiredDate
                        ? <span style={{ color: '#8a6700', fontWeight: 600, fontSize: 11 }}>{new Date(po._revisedDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ▲</span>
                        : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                      </td>
                      <td><StatusPill s={po.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Upcoming 14-day list */}
      {upcoming14.length > 0 && (
        <Card title="Next 14 Days — Upcoming Deliveries"
          sub={`${upcoming14.length} POs expected · ${fmtUSD(upcoming14.reduce((s, p) => s + (p.amount || 0), 0), true)} total`}
          bodyClass="flush">
          <div className="table-wrap">
            <table className="data" style={{ fontSize: 12 }}>
              <thead>
                <tr><th>Due Date</th><th>PO #</th><th>Project</th><th>Vendor</th><th>Part</th><th className="num">Amount</th><th>Status</th></tr>
              </thead>
              <tbody>
                {upcoming14.map((po, i) => {
                  const due  = po._revisedDate || po._requiredDate;
                  const diff = Math.round((new Date(due + 'T12:00:00') - now) / 86400000);
                  return (
                    <tr key={i}>
                      <td>
                        <div style={{ fontWeight: 700, fontSize: 12, color: diff <= 1 ? 'var(--warning)' : 'var(--text)' }}>
                          {new Date(due + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                        </div>
                        <div style={{ fontSize: 10.5, color: diff === 0 ? 'var(--sdc-blue)' : diff <= 2 ? 'var(--warning)' : 'var(--text-tertiary)' }}>
                          {diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : `In ${diff} days`}
                        </div>
                      </td>
                      <td className="strong" style={{ fontFamily: 'monospace', fontSize: 11.5 }}>{po.po}</td>
                      <td className="muted" style={{ cursor: 'pointer', color: 'var(--sdc-blue)' }}
                        onClick={() => window.navigateTo && window.navigateTo('project', po.project)}>
                        {po.project}
                      </td>
                      <td>{po.vendor}</td>
                      <td className="muted" style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={po.partDesc}>{po.partDesc || po.partNumber || '—'}</td>
                      <td className="num strong">{fmtUSD(po.amount)}</td>
                      <td><StatusPill s={po.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
};

window.DeliveryCalendarReport = DeliveryCalendarReport;
