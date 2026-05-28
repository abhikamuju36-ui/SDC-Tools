/* Overview tab — fleet-wide view with interactive charts */

const Overview = () => {
  const [categoryFilter, setCategoryFilter] = React.useState(null);
  const [viewMode,       setViewMode]       = React.useState('spend');   // 'spend' | 'budget'
  const [trendPeriod,    setTrendPeriod]    = React.useState('6M');      // '3M' | '6M' | '1Y'
  const ledgerRef = React.useRef(null);

  // ── Ledger filter state ──────────────────────────────────────────────────
  const [showFilter,    setShowFilter]    = React.useState(false);
  const [filterVendor,  setFilterVendor]  = React.useState('');
  const [filterStatus,  setFilterStatus]  = React.useState(new Set()); // empty = all
  const [filterAmtMin,  setFilterAmtMin]  = React.useState('');
  const [filterAmtMax,  setFilterAmtMax]  = React.useState('');

  const ALL_STATUSES = ['Open', 'In Transit', 'Received', 'Delayed'];

  const toggleStatus = s => setFilterStatus(prev => {
    const next = new Set(prev);
    next.has(s) ? next.delete(s) : next.add(s);
    return next;
  });

  const activeFilterCount = (filterVendor.trim() ? 1 : 0)
    + (filterStatus.size > 0 ? 1 : 0)
    + (filterAmtMin.trim() || filterAmtMax.trim() ? 1 : 0)
    + (categoryFilter ? 1 : 0);

  const clearAllFilters = () => {
    setFilterVendor(''); setFilterStatus(new Set());
    setFilterAmtMin(''); setFilterAmtMax(''); setCategoryFilter(null);
  };

  const totalSpend  = window.PROJECTS.reduce((a, b) => a + b.spent, 0);
  const avgOrder    = window.PURCHASE_ORDERS.length > 0
    ? Math.round(window.PURCHASE_ORDERS.reduce((a, b) => a + b.amount, 0) / window.PURCHASE_ORDERS.length) : 0;
  const onTimeAvg   = window.VENDORS.length > 0
    ? window.VENDORS.reduce((a, b) => a + b.onTime, 0) / window.VENDORS.length : 0;
  const avgLead     = window.VENDORS.length > 0
    ? window.VENDORS.reduce((a, b) => a + b.leadDays, 0) / window.VENDORS.length : 0;

  // Top 15 projects for bar chart — $ spend view
  const projectSpendData = [...window.PROJECTS]
    .filter(p => p.spent > 0)
    .sort((a, b) => b.spent - a.spent)
    .slice(0, 15)
    .map(p => ({ label: p.id, value: p.spent, _id: p.id }));

  // Top 15 projects for bar chart — % budget view (only projects with a budget)
  const projectBudgetData = [...window.PROJECTS]
    .filter(p => p.budget > 0 && p.spent > 0)
    .map(p => ({ label: p.id, value: Math.round(p.spent / p.budget * 100), _id: p.id,
      color: p.spent / p.budget > 0.95 ? '#B42318' : p.spent / p.budget > 0.85 ? '#E8A020' : '#1574C4' }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 15);

  const projectBarData = viewMode === 'budget' ? projectBudgetData : projectSpendData;

  // Spend timeline — recomputed per selected period
  const spendTimeline = React.useMemo(() => {
    const months = trendPeriod === '3M' ? 3 : trendPeriod === '1Y' ? 12 : 6;
    const now = new Date();
    const slots = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      slots.push({ month: d.toLocaleDateString('en-US', { month: 'short' }), year: d.getFullYear(), mon: d.getMonth(), value: 0 });
    }
    (window.PURCHASE_ORDERS_RAW || []).forEach(po => {
      if (!po._orderDate) return;
      const d = new Date(po._orderDate);
      if (isNaN(d.getTime())) return;
      const slot = slots.find(s => s.year === d.getFullYear() && s.mon === d.getMonth());
      if (slot) slot.value += po.amount;
    });
    return slots.map(s => ({ month: s.month, value: s.value }));
  }, [trendPeriod]);

  const concentration   = window.VENDORS.slice(0, 5).map((v, i) => ({
    name: v.name, value: v.spend, _name: v.name,
    color: ["#1574C4", "#061D39", "#74C415", "#AACEE8", "#FFDE51"][i],
  }));
  const totalVendorSpend = window.VENDORS.reduce((a, b) => a + b.spend, 0);
  const top1Pct = concentration.length > 0 && totalVendorSpend > 0
    ? (concentration[0].value / totalVendorSpend * 100) : 0;

  // Fill rate by category (receivedQty / purchaseQty)
  const fillByCategory = (() => {
    const cats = {};
    (window.PURCHASE_ORDERS_RAW || []).forEach(po => {
      if (!po.category) return;
      if (!cats[po.category]) cats[po.category] = { ordered: 0, received: 0, count: 0 };
      cats[po.category].ordered  += po.purchaseQty  || 0;
      cats[po.category].received += po.receivedQty || 0;
      cats[po.category].count++;
    });
    return Object.entries(cats)
      .filter(([, v]) => v.ordered > 0)
      .map(([name, v]) => {
        const rate = v.received / v.ordered * 100;
        return { label: name, value: Math.round(rate), color: rate >= 90 ? '#74C415' : rate >= 75 ? '#1574C4' : '#E8A020',
          _ordered: v.ordered, _received: v.received, _count: v.count };
      })
      .sort((a, b) => a.value - b.value);
  })();

  // Tooltip functions
  const projectTooltipFn = d => {
    const proj = window.PROJECTS.find(p => p.id === d._id);
    const lines = [d._id];
    if (proj) {
      if (viewMode === 'budget' && proj.budget > 0) {
        lines.push(`Budget Used: ${d.value}%`);
        lines.push(`${fmtUSD(proj.spent, true)} of ${fmtUSD(proj.budget, true)}`);
      } else {
        lines.push(`Spend: ${fmtUSD(proj.spent, true)}`);
        if (proj.budget > 0) lines.push(`Budget: ${fmtUSD(proj.budget, true)} · ${Math.round(proj.spent / proj.budget * 100)}% used`);
      }
    }
    lines.push('---');
    lines.push('→ Click to open Project Analyzer');
    return lines;
  };

  const fillTooltipFn = d => [
    d.label,
    `Fill Rate: ${d.value}%`,
    `Received: ${(d._received || 0).toLocaleString()} units`,
    `Ordered: ${(d._ordered || 0).toLocaleString()} units`,
    `${(d._count || 0).toLocaleString()} POs in category`,
  ];

  const concentrationTooltipFn = (d, total) => {
    const vendor = window.VENDORS.find(v => v.name === d._name);
    const lines = [d.name, fmtUSD(d.value, true), `${fmtPct(d.value / total * 100)} of fleet spend`];
    if (vendor) {
      lines.push(`Score: ${vendor.score} · ${vendor.onTime}% on-time`);
      lines.push(`${vendor.orders} POs · ${vendor.leadDays}d avg lead`);
    }
    lines.push('---');
    lines.push('→ Click to open vendor profile');
    return lines;
  };

  // PO ledger — apply all active filters
  const filteredPOs = window.PURCHASE_ORDERS.filter(p => {
    if (categoryFilter && p.category !== categoryFilter)                            return false;
    if (filterVendor.trim() && !p.vendor.toLowerCase().includes(filterVendor.trim().toLowerCase())) return false;
    if (filterStatus.size > 0 && !filterStatus.has(p.status))                      return false;
    if (filterAmtMin.trim() && p.amount < parseFloat(filterAmtMin))                return false;
    if (filterAmtMax.trim() && p.amount > parseFloat(filterAmtMax))                return false;
    return true;
  });

  return (
    <>
      {/* KPI row */}
      <div className="kpis">
        <KPI label="Total Spend YTD"
          value={fmtUSD(totalSpend, true)} glyph={Icon.dollar}
          caption={window.PROJECTS.filter(p => p.spent > 0).length + " active projects"} />
        <KPI label="Avg Order Size"
          value={"$" + (avgOrder >= 1000 ? (avgOrder / 1000).toFixed(1) + "K" : avgOrder)}
          glyph={Icon.card}
          caption={"across " + window.PURCHASE_ORDERS.length.toLocaleString() + " POs"} />
        <KPI label="On-Time Delivery"
          value={fmtPct(onTimeAvg, 1)} glyph={Icon.truck}
          trendDir={onTimeAvg >= 90 ? "up" : "down"}
          trend={onTimeAvg >= 90 ? "Above target" : "Below target"}
          caption="vs 90% threshold" />
        <KPI label="Avg Lead Time"
          value={avgLead.toFixed(1)} unit="days" glyph={Icon.clock}
          caption={window.VENDORS.length + " active suppliers"} />
      </div>

      {/* Spend by Project (clickable) + Vendor Concentration (clickable) */}
      <div className="grid-2">
        <Card title="Spend by Project"
          sub={viewMode === 'budget' ? 'Budget utilisation % · red = over 95% · click to open Project Analyzer' : 'Click a project to open Project Analyzer'}
          actions={
            <div className="segment">
              <button className={viewMode === 'spend' ? 'active' : ''} onClick={() => setViewMode('spend')}>$ Spend</button>
              <button className={viewMode === 'budget' ? 'active' : ''} onClick={() => setViewMode('budget')}>% Budget</button>
            </div>
          }>
          <BarChart
            data={projectBarData}
            valueFmt={viewMode === 'budget' ? v => v + '%' : v => fmtUSD(v, true)}
            color={viewMode === 'budget' ? undefined : '#1574C4'}
            onBarClick={d => window.navigateTo && window.navigateTo('project', d._id)}
            tooltipFn={projectTooltipFn}
          />
        </Card>

        <Card title="Vendor Concentration"
          sub={concentration.length > 0 ? `Top supplier holds ${top1Pct.toFixed(0)}% · click segment to open vendor` : 'Loading…'}>
          {concentration.length > 0 ? (
            <div className="donut-wrap">
              <Donut data={concentration} size={170} thickness={24}
                centerValue={fmtUSD(totalVendorSpend, true)} centerLabel="TOTAL SPEND"
                onSegmentClick={d => window.navigateTo && window.navigateTo('vendor', d._name)}
                tooltipFn={concentrationTooltipFn} />
              <div className="donut-legend">
                {concentration.map((c, i) => (
                  <div className="legend-row" key={i} style={{ cursor: 'pointer' }}
                    onClick={() => window.navigateTo && window.navigateTo('vendor', c._name)}>
                    <span className="legend-swatch" style={{ background: c.color }} />
                    <span>{c.name}</span>
                    <span className="legend-value">{fmtUSD(c.value, true)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>No vendor data loaded yet.</div>
          )}
        </Card>
      </div>

      {/* PO aging */}
      <Card title="Purchase Order Aging"
        sub="How long open POs have been outstanding"
        actions={<button className="btn btn-ghost" onClick={() => ledgerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{Icon.external} View ledger</button>}
        bodyClass="flush">
        <div className="aging-grid">
          {window.PO_AGING.map((a, i) => (
            <div className="aging-cell" key={i}>
              <div className="label">{a.label}</div>
              <div className="value">{a.count} <span style={{ fontSize: 12, color: "var(--text-tertiary)", fontWeight: 500 }}>POs</span></div>
              <div className="bar"><span style={{ width: `${a.pct * 100}%`, background: a.color }} /></div>
            </div>
          ))}
        </div>
      </Card>

      <div style={{ height: 16 }} />

      {/* Spend trend + Activity */}
      <div className="grid-2">
        <Card title="Spend Trend"
          sub="Monthly PO outflow · hover for values"
          actions={
            <div className="segment">
              {['3M','6M','1Y'].map(p => (
                <button key={p} className={trendPeriod === p ? 'active' : ''} onClick={() => setTrendPeriod(p)}>{p}</button>
              ))}
            </div>
          }>
          <LineChart data={spendTimeline} yFmt={v => "$" + (v >= 1e6 ? (v/1e6).toFixed(1)+"M" : (v/1e3).toFixed(0)+"K")} />
        </Card>

        <Card title="Recent Activity" sub="POs, deliveries, and risk events" bodyClass="flush">
          <div className="activity">
            {window.ACTIVITY.map((a, i) => (
              <div className="activity-row" key={i}>
                <div className={"activity-dot " + a.kind}>
                  {a.kind === "ship" ? Icon.truck : a.kind === "po" ? Icon.file : a.kind === "risk" ? Icon.alert : a.kind === "late" ? Icon.clock : Icon.check}
                </div>
                <div>
                  <div className="activity-text">{a.text}</div>
                  <div className="activity-time">{a.time}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Spend by category + Fill rate */}
      <div className="grid-2">
        <Card title="Spend by Category" sub="Across all open POs">
          <div style={{ marginBottom: 16 }}>
            <StackBar segments={window.SPEND_BY_CATEGORY} height={10} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {window.SPEND_BY_CATEGORY.map((c, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '12px 1fr auto', gap: 10, alignItems: 'center', fontSize: 12.5,
                cursor: 'pointer', padding: '2px 4px', borderRadius: 5, background: categoryFilter === c.name ? 'rgba(21,116,196,0.07)' : undefined }}
                onClick={() => setCategoryFilter(categoryFilter === c.name ? null : c.name)}
                title="Click to filter PO ledger by category">
                <span className="legend-swatch" style={{ background: c.color }} />
                <span style={{ fontWeight: categoryFilter === c.name ? 700 : 400 }}>{c.name}</span>
                <span className="legend-value">{fmtUSD(c.value, true)}</span>
              </div>
            ))}
          </div>
          {categoryFilter && (
            <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--sdc-blue)', display: 'flex', alignItems: 'center', gap: 6 }}>
              Filtering PO ledger by: <strong>{categoryFilter}</strong>
              <button onClick={() => setCategoryFilter(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 13, padding: 0, lineHeight: 1 }}>✕</button>
            </div>
          )}
        </Card>

        <Card title="Fill Rate by Category"
          sub="Quantity received vs. ordered · hover to see rate"
          actions={<span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Ordered qty fill %</span>}>
          {fillByCategory.length > 0 ? (
            <BarChart data={fillByCategory} valueFmt={v => v + '%'} height={220} tooltipFn={fillTooltipFn} />
          ) : (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>No receiving data available.</div>
          )}
        </Card>
      </div>

      {/* Vendor Scorecards (clickable → Vendor Analyzer) */}
      <Card title="Vendor Scorecards"
        sub="Click a vendor to open their profile · composite rating from delivery, lead time and defect rate"
        actions={
          <button className="btn btn-ghost" onClick={() => window.navigateTo && window.navigateTo('supplier-risk')}>
            {Icon.shield} Risk Report
          </button>
        }
        bodyClass="flush">
        <div className="score-list">
          {window.VENDORS.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-tertiary)' }}>No vendor data loaded yet.</div>
          )}
          {window.VENDORS.slice(0, 8).map((v, i) => (
            <div className="score-row" key={i} style={{ cursor: 'pointer' }}
              onClick={() => window.navigateTo && window.navigateTo('vendor', v.name)}>
              <span className="score-rank">0{i + 1}</span>
              <div style={{ flex: 1 }}>
                <div className="score-name">{v.name}</div>
                <div className="score-meta">{v.orders} orders · {fmtUSD(v.spend, true)} · {fmtPct(v.onTime)} on time</div>
                <div className="score-bar">
                  <span style={{ width: `${v.score}%`, background: v.score >= 90 ? "var(--positive)" : v.score >= 80 ? "var(--sdc-blue)" : v.score >= 75 ? "var(--warning)" : "var(--danger)" }} />
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                <span className="score-value">{v.score}</span>
                <StatusPill s={v.status} />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* PO Ledger (filterable by category) */}
      <div ref={ledgerRef} />
      <Card title={categoryFilter ? `Purchase Orders — ${categoryFilter}` : "Purchase Order Ledger"}
        sub={filteredPOs.length.toLocaleString() + " POs" + (categoryFilter ? ` in ${categoryFilter}` : " across all active projects")}
        actions={
          <>
            {categoryFilter && (
              <button className="btn btn-ghost" onClick={() => setCategoryFilter(null)}>✕ Clear filter</button>
            )}
            <button className="btn btn-ghost" onClick={() => setShowFilter(s => !s)}
              style={{ position: 'relative', background: showFilter ? 'rgba(21,116,196,0.08)' : undefined,
                color: showFilter ? 'var(--sdc-blue)' : undefined, borderColor: showFilter ? 'var(--sdc-blue)' : undefined }}>
              {Icon.filter} Filter
              {activeFilterCount > 0 && (
                <span style={{ position: 'absolute', top: -6, right: -6, minWidth: 16, height: 16,
                  borderRadius: 8, background: 'var(--sdc-blue)', color: '#fff',
                  fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', padding: '0 4px', lineHeight: 1 }}>
                  {activeFilterCount}
                </span>
              )}
            </button>
            <button className="btn btn-secondary">{Icon.download} Export</button>
          </>
        }
        bodyClass="flush">

        {/* ── Filter panel ── */}
        {showFilter && (
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)',
            background: 'var(--bg-subtle)', display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>

            {/* Status checkboxes */}
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-tertiary)',
                textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>Status</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {ALL_STATUSES.map(s => {
                  const active = filterStatus.has(s);
                  return (
                    <button key={s} onClick={() => toggleStatus(s)}
                      style={{ padding: '3px 10px', borderRadius: 5, fontSize: 11.5, cursor: 'pointer',
                        fontWeight: active ? 700 : 400, border: '1px solid var(--border)',
                        background: active ? 'var(--sdc-blue)' : 'var(--bg-elevated)',
                        color: active ? '#fff' : 'var(--text-secondary)', transition: 'all .12s' }}>
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Vendor search */}
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-tertiary)',
                textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>Vendor</div>
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  placeholder="Search vendor name…"
                  value={filterVendor}
                  onChange={e => setFilterVendor(e.target.value)}
                  style={{ padding: '4px 28px 4px 9px', borderRadius: 5, border: '1px solid var(--border)',
                    background: 'var(--bg-elevated)', color: 'var(--text-primary)',
                    fontSize: 12, width: 180, outline: 'none' }}
                />
                {filterVendor && (
                  <button onClick={() => setFilterVendor('')}
                    style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--text-tertiary)', fontSize: 13, lineHeight: 1, padding: 0 }}>✕</button>
                )}
              </div>
            </div>

            {/* Amount range */}
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-tertiary)',
                textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>Amount ($)</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="number"
                  placeholder="Min"
                  value={filterAmtMin}
                  onChange={e => setFilterAmtMin(e.target.value)}
                  style={{ padding: '4px 8px', borderRadius: 5, border: '1px solid var(--border)',
                    background: 'var(--bg-elevated)', color: 'var(--text-primary)',
                    fontSize: 12, width: 90, outline: 'none' }}
                />
                <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>–</span>
                <input
                  type="number"
                  placeholder="Max"
                  value={filterAmtMax}
                  onChange={e => setFilterAmtMax(e.target.value)}
                  style={{ padding: '4px 8px', borderRadius: 5, border: '1px solid var(--border)',
                    background: 'var(--bg-elevated)', color: 'var(--text-primary)',
                    fontSize: 12, width: 90, outline: 'none' }}
                />
              </div>
            </div>

            {/* Clear all */}
            <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 1 }}>
              <button onClick={clearAllFilters}
                style={{ padding: '4px 12px', borderRadius: 5, border: '1px solid var(--border)',
                  background: 'transparent', color: 'var(--text-tertiary)', fontSize: 12,
                  cursor: 'pointer', opacity: activeFilterCount > 0 ? 1 : 0.4 }}>
                Clear all
              </button>
            </div>

          </div>
        )}

        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>PO #</th><th>Order Detail ID</th><th>Project</th><th>Vendor</th><th>Category</th>
                <th className="num">Amount</th><th>Issued</th><th>Expected</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredPOs.length === 0 && (
                <tr><td colSpan="9" style={{ textAlign: 'center', padding: 32, color: 'var(--text-tertiary)' }}>No purchase orders loaded yet.</td></tr>
              )}
              {filteredPOs.map((p, i) => {
                const poParts  = (p.po || '').split('-');
                const poBase   = poParts.slice(0, 2).join('-');          // e.g. PO-105361
                const detailId = poParts[poParts.length - 1] || p.po;   // e.g. 32406
                return (
                <tr key={i}>
                  <td className="strong">{poBase}</td>
                  <td className="muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{detailId}</td>
                  <td className="muted" style={{ cursor: 'pointer', color: 'var(--sdc-blue)' }}
                    onClick={() => window.navigateTo && window.navigateTo('project', p.project)}>
                    {p.project}
                  </td>
                  <td style={{ cursor: 'pointer' }}
                    onClick={() => window.navigateTo && window.navigateTo('vendor', p.vendor)}>
                    {p.vendor}
                  </td>
                  <td className="muted" style={{ cursor: 'pointer' }}
                    onClick={() => setCategoryFilter(p.category === categoryFilter ? null : p.category)}>
                    {p.category}
                  </td>
                  <td className="num strong">{fmtUSD(p.amount)}</td>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                    {p.issued || <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                    {p._issuedFallback && p.issued && (
                      <span title="PurchaseDate not set in TotalETO — showing DateRequired as issued date (fallback)"
                        style={{ marginLeft: 5, cursor: 'help', color: 'var(--warning)', fontSize: 11 }}>⚠</span>
                    )}
                  </td>
                  <td className="muted">{p.expected || <span style={{ color: 'var(--text-tertiary)' }}>—</span>}</td>
                  <td><StatusPill s={p.status} /></td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
};

window.Overview = Overview;
