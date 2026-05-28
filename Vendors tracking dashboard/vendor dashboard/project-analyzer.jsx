/* Project Analyzer — multi-project view with sub-tabs:
   Overview | Delivery Analysis | Hours & Cost
   Includes: active/inactive filter, project type filter, multi-select, date range */

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtSchedDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtSchedShort(iso) {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function healthToStatus(h) {
  const s = (h || '').toString().toLowerCase();
  if (s.includes('red')    || s.includes('behind') || s.includes('delay')) return 'Delayed';
  if (s.includes('yellow') || s.includes('risk')   || s.includes('warn'))  return 'At Risk';
  if (s.includes('green')  || s.includes('track')  || s.includes('good'))  return 'On Track';
  if (s.includes('complete') || s.includes('done') || s.includes('100'))   return 'Received';
  return 'Open';
}

// ── Multi-select Project Picker ───────────────────────────────────────────────

const ProjectMultiPicker = ({ allProjects, selectedIds, onChange, showActive, onToggleActive, typeFilter, onTypeFilter }) => {
  const [open, setOpen]   = React.useState(false);
  const [dropPos, setDropPos] = React.useState({ top: 0, left: 0, width: 320 });
  const triggerRef = React.useRef(null);
  const panelRef   = React.useRef(null);

  // Close on outside click
  React.useEffect(() => {
    const handler = e => {
      if (triggerRef.current && !triggerRef.current.contains(e.target) &&
          panelRef.current   && !panelRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const openDropdown = () => {
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setDropPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 340) });
    }
    setOpen(v => !v);
  };

  const visible = allProjects
    .filter(p => !showActive || p.isActive !== false)
    .filter(p => typeFilter === 'All' || !typeFilter || p.projectType === typeFilter);

  const allSelected  = visible.every(p => selectedIds.includes(p.id));
  const someSelected = !allSelected && visible.some(p => selectedIds.includes(p.id));

  const toggle = (id) => {
    onChange(selectedIds.includes(id)
      ? selectedIds.filter(x => x !== id)
      : [...selectedIds, id]);
  };

  const selectAll  = () => onChange(visible.map(p => p.id));
  const clearAll   = () => onChange([]);

  const label = selectedIds.length === 0
    ? 'All Projects'
    : selectedIds.length === 1
      ? (allProjects.find(p => p.id === selectedIds[0])?.name || selectedIds[0])
      : `${selectedIds.length} projects selected`;

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      {/* Trigger button */}
      <button ref={triggerRef} className="select" onClick={openDropdown}
        style={{ minWidth: 220, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 8, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
          background: open ? 'var(--bg-elevated)' : undefined,
          borderColor: open ? 'var(--sdc-blue)' : undefined }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{label}</span>
        <span style={{ fontSize: 10, opacity: 0.6 }}>{open ? '▲' : '▼'}</span>
      </button>

      {/* Dropdown panel — fixed so it floats above all page content */}
      {open && (
        <div ref={panelRef} style={{
          position: 'fixed', top: dropPos.top, left: dropPos.left,
          zIndex: 1200, minWidth: dropPos.width, maxWidth: 460,
          maxHeight: 440, display: 'flex', flexDirection: 'column',
          background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10,
          boxShadow: '0 12px 40px rgba(0,0,0,0.28)' }}>
          {/* Filters */}
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={showActive} onChange={e => onToggleActive(e.target.checked)} />
              Active only
            </label>
            <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
              {['All','Custom','Duplicate','Hybrid'].map(t => (
                <button key={t}
                  onClick={() => onTypeFilter(t)}
                  style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)',
                    fontSize: 11, cursor: 'pointer', fontWeight: typeFilter === t ? 700 : 400,
                    background: typeFilter === t ? 'var(--sdc-blue)' : 'transparent',
                    color: typeFilter === t ? '#fff' : 'var(--text-tertiary)' }}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Select / Clear all */}
          <div style={{ padding: '6px 14px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 12, fontSize: 12 }}>
            <button onClick={selectAll} style={{ background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--sdc-blue)', padding: 0, fontSize: 12 }}>Select all ({visible.length})</button>
            {selectedIds.length > 0 && (
              <button onClick={clearAll} style={{ background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-tertiary)', padding: 0, fontSize: 12 }}>Clear</button>
            )}
          </div>

          {/* Project list */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {visible.map(p => (
              <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10,
                padding: '7px 14px', cursor: 'pointer',
                background: selectedIds.includes(p.id) ? 'rgba(21,116,196,0.06)' : undefined,
                borderBottom: '1px solid var(--border)' }}>
                <input type="checkbox" checked={selectedIds.includes(p.id)} onChange={() => toggle(p.id)} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontFamily: 'monospace', color: 'var(--text-tertiary)', fontSize: 11 }}>{p.id}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, fontSize: 10.5, color: 'var(--text-tertiary)', marginTop: 1 }}>
                    {p.projectType && (
                      <span style={{ padding: '1px 5px', borderRadius: 3, fontSize: 10,
                        background: p.projectType === 'Duplicate' ? 'rgba(170,206,232,0.3)'
                          : p.projectType === 'Hybrid' ? 'rgba(255,222,81,0.2)' : 'rgba(21,116,196,0.1)',
                        color: p.projectType === 'Duplicate' ? '#2B6EA8' : p.projectType === 'Hybrid' ? '#8a6700' : 'var(--sdc-blue)',
                        fontWeight: 600 }}>
                        {p.projectType}
                      </span>
                    )}
                    <StatusPill s={p.status} />
                    <span>{fmtUSD(p.spent, true)} spent</span>
                  </div>
                </div>
              </label>
            ))}
            {visible.length === 0 && (
              <div style={{ padding: '20px 14px', color: 'var(--text-tertiary)', fontSize: 12, textAlign: 'center' }}>
                No projects match the current filters.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Overview Sub-tab ─────────────────────────────────────────────────────────

const ProjectOverview = ({ projects, selectedIds, dateFrom, dateTo }) => {
  const [schedule, setSchedule] = React.useState(null);
  const [schedLoading, setSchedLoading] = React.useState(false);
  const [focusId, setFocusId] = React.useState(null);

  // Focus project for single-project views (schedule, top vendor)
  const focusProject = focusId
    ? projects.find(p => p.id === focusId) || projects[0]
    : projects[0];

  React.useEffect(() => {
    if (!focusProject) return;
    const rawId = focusProject.id.replace(/^P-/, '');
    setSchedLoading(true);
    setSchedule(null);
    fetch('/api/projects/' + rawId + '/schedule')
      .then(r => r.ok ? r.json() : { milestones: [], tasks: [], isMock: true })
      .then(data => setSchedule(data))
      .catch(() => setSchedule({ milestones: [], tasks: [], isMock: true }))
      .finally(() => setSchedLoading(false));
  }, [focusProject?.id]);

  if (!projects || projects.length === 0) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>No projects selected.</div>;
  }

  // POs for all selected projects
  const allPos = (window.PURCHASE_ORDERS || []).filter(po => {
    const pid = po.project;
    const inProject = selectedIds.length === 0 || selectedIds.includes(pid);
    const rawPos = window.PURCHASE_ORDERS_RAW || [];
    const rawPo  = rawPos.find(r => r.po === po.po);
    const od = rawPo?._orderDate || '';
    const inDate = (!dateFrom || od >= dateFrom) && (!dateTo || od <= dateTo);
    return inProject && inDate;
  });

  const projectPOs   = allPos.filter(po => projects.some(p => p.id === po.project));
  const projectVendors = [...new Set(projectPOs.map(p => p.vendor))];

  // Aggregates
  const totalBudget = projects.reduce((s, p) => s + (p.budget || 0), 0);
  const totalSpent  = projectPOs.reduce((s, p) => s + (p.amount || 0), 0) || projects.reduce((s, p) => s + (p.spent || 0), 0);

  // Vendor share across all selected projects
  const vendorShare = projectVendors.map((v, i) => {
    const sum = projectPOs.filter(p => p.vendor === v).reduce((a, b) => a + b.amount, 0);
    return { name: v, value: sum, color: ['#1574C4','#061D39','#74C415','#AACEE8','#FFDE51','#5A8FBE','#9FB4C9'][i % 7] };
  }).sort((a, b) => b.value - a.value);

  // Cumulative spend by month
  const cum = (() => {
    const now = new Date();
    const slots = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      slots.push({ month: d.toLocaleDateString('en-US', { month: 'short' }), year: d.getFullYear(), mon: d.getMonth(), value: 0 });
    }
    projectPOs.forEach(po => {
      if (!po.orderMonth || !po.orderYear) return;
      const slot = slots.find(s => s.month === po.orderMonth && s.year === po.orderYear);
      if (slot) slot.value += po.amount;
    });
    let acc = 0;
    return slots.map(s => { acc += s.value; return { month: s.month, value: acc }; });
  })();

  const pctUsed  = totalBudget > 0 ? totalSpent / totalBudget * 100 : 0;
  const topVendor = vendorShare[0] ? (window.VENDORS || []).find(v => v.name === vendorShare[0].name) : null;
  const schedTasks = schedule && !schedule.isMock && schedule.tasks
    ? schedule.tasks.filter(t => t.indentLevel <= 2).slice(0, 30) : [];
  const hasSched = schedTasks.length > 0;

  return (
    <>
      {/* Multi-project summary strip when > 1 project */}
      {projects.length > 1 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {projects.map(p => (
            <button key={p.id}
              onClick={() => setFocusId(focusId === p.id ? null : p.id)}
              style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '4px 10px',
                borderRadius: 6, border: '1px solid var(--border)', background: focusId === p.id ? 'var(--sdc-blue)' : 'var(--bg-elevated)',
                color: focusId === p.id ? '#fff' : 'var(--text)', cursor: 'pointer', fontSize: 11.5, fontWeight: 600 }}>
              <span style={{ opacity: 0.7, fontFamily: 'monospace', fontSize: 10.5 }}>{p.id}</span>
              <span style={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
            </button>
          ))}
          <span style={{ alignSelf: 'center', fontSize: 11, color: 'var(--text-tertiary)' }}>
            — click to focus schedule
          </span>
        </div>
      )}

      {/* KPI row */}
      <div className="kpis">
        <KPI label="Materials Budget"
          value={totalBudget > 0 ? fmtUSD(totalBudget, true) : '—'}
          glyph={Icon.dollar} caption={projects.length + ' project' + (projects.length !== 1 ? 's' : '')} />
        <KPI label="Procurement Spend"
          value={fmtUSD(totalSpent, true)}
          glyph={Icon.card}
          trend={totalBudget > 0 ? pctUsed.toFixed(0) + '%' : undefined}
          trendDir={pctUsed > 95 ? 'down' : pctUsed > 80 ? 'flat' : 'up'}
          caption="of materials budget" />
        <KPI label="Remaining"
          value={totalBudget > 0 ? fmtUSD(totalBudget - totalSpent, true) : '—'}
          glyph={Icon.shield}
          caption={(totalBudget - totalSpent < 0) ? 'Over budget' : 'Within plan'} />
        <KPI label="Active Vendors"
          value={projectVendors.length}
          glyph={Icon.users}
          caption={projectPOs.length.toLocaleString() + ' POs'} />
      </div>

      {/* Primary vendor scorecard */}
      {topVendor && (
        <Card title={projects.length === 1 ? 'Primary Vendor on this Project' : 'Top Vendor by Spend'}
          sub={'Performance snapshot for ' + topVendor.name}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr 1fr', gap: 20, alignItems: 'center' }}>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18 }}>{topVendor.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2, display: 'flex', gap: 12 }}>
                {topVendor.city && <span>{Icon.pin} {topVendor.city}</span>}
                {topVendor.contact && <span>{topVendor.contact}</span>}
              </div>
              <div style={{ marginTop: 8 }}><StatusPill s={topVendor.status} /></div>
            </div>
            <div><div className="kpi-label">Score</div><div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 26 }}>{topVendor.score}</div></div>
            <div><div className="kpi-label">On Time</div><div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 26 }}>{topVendor.onTime}%</div></div>
            <div><div className="kpi-label">Lead Time</div><div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 26 }}>{topVendor.leadDays}d</div></div>
            <div><div className="kpi-label">Defect Rate</div><div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 26 }}>{topVendor.defect}%</div></div>
          </div>
        </Card>
      )}

      <div style={{ height: 16 }} />

      {/* Vendor share + Cumulative */}
      <div className="grid-2">
        <Card title="Vendor Budget Share" sub="Spend distribution among suppliers">
          {vendorShare.length > 0 ? (
            <div className="donut-wrap">
              <Donut data={vendorShare} size={170} thickness={24}
                centerValue={fmtUSD(totalSpent, true)} centerLabel="COMMITTED" />
              <div className="donut-legend">
                {vendorShare.slice(0, 7).map((c, i) => (
                  <div className="legend-row" key={i}>
                    <span className="legend-swatch" style={{ background: c.color }}></span>
                    <span>{c.name}</span>
                    <span className="legend-value">{fmtUSD(c.value, true)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>No PO spend recorded.</div>
          )}
        </Card>

        <Card title="Cumulative Procurement Spend" sub="Rolling 6-month spend">
          {cum.some(m => m.value > 0)
            ? <LineChart data={cum} yFmt={v => '$' + (v >= 1e6 ? (v/1e6).toFixed(1)+'M' : (v/1e3).toFixed(0)+'K')} color="#1574C4" />
            : <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>No order history in the last 6 months.</div>
          }
        </Card>
      </div>

      {/* Schedule (focus project only) */}
      <Card
        title={'Project Schedule' + (projects.length > 1 ? ' — ' + focusProject.id : '')}
        sub={hasSched ? ('Live from Smartsheet · ' + schedTasks.length + ' tasks') : 'Smartsheet schedule'}
        actions={schedule?.permalink
          ? <a href={schedule.permalink} target="_blank" rel="noreferrer" className="btn btn-ghost" style={{ textDecoration: 'none' }}>{Icon.external} Open in Smartsheet</a>
          : null}
        bodyClass="flush">
        {schedLoading && (
          <div style={{ padding: '32px 24px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
            <div style={{ width: 24, height: 24, border: '3px solid var(--border)', borderTop: '3px solid var(--sdc-blue)', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 12px' }}></div>
            Syncing schedule…
          </div>
        )}
        {!schedLoading && hasSched && (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th style={{ width: '38%' }}>Task</th><th>Assignee</th><th>Start</th><th>Finish</th><th style={{ width: 90 }}>Progress</th><th>Status</th></tr></thead>
              <tbody>
                {schedTasks.map(t => {
                  const status = healthToStatus(t.health);
                  return (
                    <tr key={t.id} style={t.isSummary ? { background: 'var(--bg-subtle)', fontWeight: 700 } : {}}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: t.indentLevel * 16 }}>
                          {t.isMilestone && <span style={{ color: 'var(--sdc-blue)', fontSize: 11, fontWeight: 700 }}>◆</span>}
                          {t.onCritical && !t.isMilestone && <span style={{ color: 'var(--danger)', fontSize: 10 }}>●</span>}
                          <span style={{ fontSize: 12.5 }}>{t.name}</span>
                          {t.onCritical && <span style={{ fontSize: 10, background: 'rgba(180,35,24,0.1)', color: 'var(--danger)', padding: '1px 5px', borderRadius: 4, fontWeight: 600 }}>CRIT</span>}
                        </div>
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>{t.assignee || '—'}</td>
                      <td className="muted" style={{ fontSize: 12 }}>{fmtSchedShort(t.start)}</td>
                      <td className="muted" style={{ fontSize: 12 }}>{fmtSchedShort(t.finish)}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ flex: 1, height: 5, background: 'var(--bg-subtle)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: (t.percent * 100) + '%', background: t.percent >= 1 ? 'var(--positive)' : 'var(--sdc-blue)', borderRadius: 3 }}/>
                          </div>
                          <span style={{ fontSize: 10.5, color: 'var(--text-tertiary)', minWidth: 24 }}>{Math.round(t.percent * 100)}%</span>
                        </div>
                      </td>
                      <td><StatusPill s={status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!schedLoading && !hasSched && (
          <div style={{ padding: '28px 24px', display: 'flex', gap: 14 }}>
            <span style={{ color: 'var(--text-tertiary)' }}>{Icon.calendar}</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>No Smartsheet schedule linked</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>
                Name the sheet starting with the project number to auto-link.
              </div>
            </div>
          </div>
        )}
      </Card>

      <div style={{ height: 16 }} />

      {/* PO Ledger */}
      <Card title="Purchase Orders"
        sub={projects.map(p => p.id).join(' · ') + ' · ' + projectPOs.length.toLocaleString() + ' POs · ' + fmtUSD(totalSpent, true)}
        bodyClass="flush">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>PO #</th>
                {projects.length > 1 && <th>Project</th>}
                <th>Vendor</th>
                <th>Category</th>
                <th className="num">Amount</th>
                <th>Issued</th>
                <th>Expected</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {projectPOs.slice(0, 300).map((p, i) => (
                <tr key={i}>
                  <td className="strong">{p.po}</td>
                  {projects.length > 1 && <td className="muted" style={{ fontSize: 11 }}>{p.project}</td>}
                  <td>{p.vendor}</td>
                  <td className="muted">{p.category}</td>
                  <td className="num strong">{fmtUSD(p.amount)}</td>
                  <td className="muted">{p.issued}</td>
                  <td className="muted">{p.expected}</td>
                  <td><StatusPill s={p.status} /></td>
                </tr>
              ))}
              {projectPOs.length > 300 && (
                <tr><td colSpan={projects.length > 1 ? 8 : 7} style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: '10px', fontSize: 12 }}>
                  Showing 300 of {projectPOs.length.toLocaleString()} POs
                </td></tr>
              )}
              {projectPOs.length === 0 && (
                <tr><td colSpan={projects.length > 1 ? 8 : 7} style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 32 }}>No POs on selected projects.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────

const ProjectAnalyzer = () => {
  const allProjects = window.PROJECTS || [];
  const defaultIdx  = Math.min(2, allProjects.length - 1);

  // Consume navigation param (set by window.navigateTo('project', projectId))
  const _navId = window.__navParams;
  const navProject = _navId
    ? allProjects.find(p =>
        p.id === _navId ||
        p.id === 'P-' + String(_navId).replace(/^P-/, '')
      )
    : null;

  // Filter state
  const [showActiveOnly, setShowActiveOnly] = React.useState(false);
  const [typeFilter,     setTypeFilter]     = React.useState('All');
  const [selectedIds,    setSelectedIds]    = React.useState(
    navProject                            ? [navProject.id]
    : allProjects.length > 0             ? [allProjects[defaultIdx].id]
    : []
  );
  const [dateFrom, setDateFrom] = React.useState('');
  const [dateTo,   setDateTo]   = React.useState('');
  const [subTab,   setSubTab]   = React.useState('overview');

  // Clear nav params after consuming so stale params don't affect future mounts
  React.useEffect(() => { window.__navParams = null; }, []);

  // Derived selected projects
  const selectedProjects = selectedIds.length > 0
    ? allProjects.filter(p => selectedIds.includes(p.id))
    : allProjects.filter(p => !showActiveOnly || p.isActive !== false)
                 .filter(p => typeFilter === 'All' || p.projectType === typeFilter);

  const subTabs = [
    { id: 'overview',  label: 'Overview',           icon: Icon.layers  },
    { id: 'delivery',  label: 'Delivery Analysis',   icon: Icon.truck   },
    { id: 'hours',     label: 'Hours & Cost',         icon: Icon.clock   },
  ];

  return (
    <>
      {/* ── Filter bar ── */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center',
        background: 'var(--bg-elevated)', borderRadius: 10, border: '1px solid var(--border)',
        padding: '12px 16px', marginBottom: 16 }}>

        {/* Multi-project picker */}
        <ProjectMultiPicker
          allProjects={allProjects}
          selectedIds={selectedIds}
          onChange={setSelectedIds}
          showActive={showActiveOnly}
          onToggleActive={setShowActiveOnly}
          typeFilter={typeFilter}
          onTypeFilter={setTypeFilter} />

        {/* Date range */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-tertiary)' }}>
          {Icon.calendar}
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="form-input" style={{ padding: '4px 8px', fontSize: 12, width: 130 }}
            title="Order date from" />
          <span>→</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="form-input" style={{ padding: '4px 8px', fontSize: 12, width: 130 }}
            title="Order date to" />
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(''); setDateTo(''); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 14 }}
              title="Clear date filter">✕</button>
          )}
        </div>

        {/* Summary chips — clickable to filter by project type */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {['Custom','Duplicate','Hybrid'].map(t => {
            const cnt = allProjects.filter(p => p.projectType === t).length;
            if (cnt === 0) return null;
            const sel = selectedProjects.filter(p => p.projectType === t).length;
            const isActive = typeFilter === t && selectedIds.length === 0;
            const baseColor = t === 'Duplicate' ? '#2B6EA8' : t === 'Hybrid' ? '#8a6700' : 'var(--sdc-blue)';
            const baseBg    = t === 'Duplicate' ? 'rgba(170,206,232,0.25)' : t === 'Hybrid' ? 'rgba(255,222,81,0.2)' : 'rgba(21,116,196,0.1)';
            return (
              <span key={t}
                onClick={() => {
                  if (isActive) {
                    setTypeFilter('All');     // toggle off
                  } else {
                    setTypeFilter(t);
                    setSelectedIds([]);        // clear project picks, let type filter drive
                  }
                }}
                title={isActive ? `Clear ${t} filter` : `Show all ${t} projects`}
                style={{ padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                  cursor: 'pointer', transition: 'all 0.12s',
                  background: isActive ? baseColor : baseBg,
                  color: isActive ? '#fff' : baseColor,
                  boxShadow: isActive ? '0 0 0 2px ' + baseColor + '55' : undefined }}>
                {t}: {sel}/{cnt}
              </span>
            );
          })}
          {selectedProjects.length > 0 && (
            <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
              {selectedProjects.length} project{selectedProjects.length !== 1 ? 's' : ''} ·{' '}
              {fmtUSD(selectedProjects.reduce((s, p) => s + (p.spent || 0), 0), true)} spend
            </span>
          )}
        </div>
      </div>

      {/* ── Sub-tab nav ── */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        {subTabs.map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
              background: 'none', border: 'none', cursor: 'pointer', fontSize: 13,
              fontFamily: 'var(--font-display)', letterSpacing: 0.3, fontWeight: subTab === t.id ? 700 : 500,
              color: subTab === t.id ? 'var(--sdc-blue)' : 'var(--text-tertiary)',
              borderBottom: subTab === t.id ? '2px solid var(--sdc-blue)' : '2px solid transparent',
              marginBottom: -1 }}>
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Sub-tab content ── */}
      {subTab === 'overview' && (
        <ProjectOverview
          projects={selectedProjects}
          selectedIds={selectedIds}
          dateFrom={dateFrom}
          dateTo={dateTo} />
      )}

      {subTab === 'delivery' && (
        <DeliveryAnalysis projectIds={selectedProjects.map(p => p.id)} />
      )}

      {subTab === 'hours' && (
        <HoursCostAnalysis
          projectIds={selectedProjects.map(p => p.id)}
          projectTypeFilter={typeFilter} />
      )}
    </>
  );
};

window.ProjectAnalyzer = ProjectAnalyzer;
