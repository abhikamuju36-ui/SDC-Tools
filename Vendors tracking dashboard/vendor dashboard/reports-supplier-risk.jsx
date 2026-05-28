/* Supplier Risk Report — scatter plot, risk matrix, concentration analysis */

const SupplierRiskReport = () => {
  const vendors  = window.VENDORS  || [];
  const projects = window.PROJECTS || [];
  const rawPos   = window.PURCHASE_ORDERS_RAW || [];
  const today    = new Date().toISOString().split('T')[0];
  const [riskFilter, setRiskFilter] = React.useState('All');

  if (vendors.length === 0) {
    return <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-tertiary)' }}>Loading vendor data…</div>;
  }

  const totalSpend = vendors.reduce((s, v) => s + v.spend, 0) || 1;

  // ── Risk flags per vendor (computed first so bubbleData can use it) ──
  const overdueByVendor = {};
  rawPos.forEach(po => {
    if (!po._receivedDate && po._requiredDate && po._requiredDate < today) {
      overdueByVendor[po.vendor] = (overdueByVendor[po.vendor] || 0) + 1;
    }
  });

  // ── Bubble chart data — only vendors with actual spend in the current period ──
  const bubbleData = vendors.filter(v => v.spend > 0).map(v => {
    const color = v.score >= 88 ? '#74C415' : v.score >= 75 ? '#1574C4' : v.score >= 60 ? '#E8A020' : '#B42318';
    const overdue = overdueByVendor[v.name] || 0;
    return {
      label: v.name,
      x:     v.onTime,
      y:     v.spend,
      size:  v.orders,
      color,
      meta:  [
        `Score: ${v.score} · ${v.status}`,
        `${fmtUSD(v.spend, true)} · ${(v.spend / totalSpend * 100).toFixed(0)}% of fleet`,
        `${v.orders} POs · ${v.onTime}% on-time · ${v.leadDays}d lead`,
        '---',
        `Overdue (open): ${overdue} PO${overdue !== 1 ? 's' : ''}`,
        '→ Click to open vendor profile',
      ],
    };
  });

  const projectsByVendor = {};
  rawPos.forEach(po => {
    if (!projectsByVendor[po.vendor]) projectsByVendor[po.vendor] = new Set();
    if (po.project) projectsByVendor[po.vendor].add(po.project);
  });

  const riskRows = vendors.map(v => {
    const spendPct    = v.spend / totalSpend * 100;
    const overdue     = overdueByVendor[v.name] || 0;
    const projCount   = projectsByVendor[v.name]?.size || 0;
    const risks = [];
    if (spendPct > 30) risks.push({ type: 'Concentration', severity: spendPct > 45 ? 'High' : 'Medium', detail: `${spendPct.toFixed(0)}% of total spend` });
    if (v.score < 60)  risks.push({ type: 'Performance',   severity: 'High',   detail: `Score ${v.score}/100` });
    else if (v.score < 75) risks.push({ type: 'Performance', severity: 'Medium', detail: `Score ${v.score}/100` });
    if (overdue > 5)   risks.push({ type: 'Delivery',      severity: 'High',   detail: `${overdue} overdue POs` });
    else if (overdue > 2) risks.push({ type: 'Delivery',   severity: 'Medium', detail: `${overdue} overdue POs` });
    if (projCount >= 4) risks.push({ type: 'Dependency',   severity: 'Medium', detail: `Supplying ${projCount} projects` });
    const composite = risks.filter(r => r.severity === 'High').length * 3 + risks.filter(r => r.severity === 'Medium').length;
    return { ...v, risks, composite, spendPct, overdue, projCount };
  }).filter(v => v.risks.length > 0).sort((a, b) => b.composite - a.composite);

  const filtered = riskFilter === 'All' ? riskRows
    : riskRows.filter(v => v.risks.some(r => r.type === riskFilter));

  // ── KPIs ──
  const highRisk   = riskRows.filter(v => v.risks.some(r => r.severity === 'High')).length;
  const medRisk    = riskRows.filter(v => v.risks.every(r => r.severity !== 'High')).length;
  const topConc    = vendors[0] ? (vendors[0].spend / totalSpend * 100).toFixed(0) : 0;
  const totalOverdue = Object.values(overdueByVendor).reduce((s, n) => s + n, 0);

  // ── Multi-project dependency ──
  const multiProj = vendors
    .map(v => ({ ...v, projCount: projectsByVendor[v.name]?.size || 0, projects: [...(projectsByVendor[v.name] || [])] }))
    .filter(v => v.projCount >= 3)
    .sort((a, b) => b.projCount - a.projCount)
    .slice(0, 10);

  const severityColor = s => s === 'High' ? 'var(--danger)' : s === 'Medium' ? 'var(--warning)' : 'var(--positive)';
  const severityBg    = s => s === 'High' ? 'rgba(180,35,24,0.08)' : s === 'Medium' ? 'rgba(232,160,32,0.1)' : 'rgba(116,196,21,0.1)';

  const ACTION_MAP = {
    Concentration: 'Qualify alternative supplier',
    Performance:   'Initiate performance review',
    Delivery:      'Escalate — contact vendor',
    Dependency:    'Review single-source risk',
  };

  return (
    <>
      <div className="kpis">
        <KPI label="High-Risk Vendors" value={highRisk} glyph={Icon.alert}
          trendDir={highRisk > 0 ? 'down' : 'up'}
          caption="require immediate action" />
        <KPI label="Medium-Risk Vendors" value={medRisk} glyph={Icon.shield}
          trendDir={medRisk > 3 ? 'down' : 'flat'}
          caption="monitoring recommended" />
        <KPI label="Top Vendor Concentration" value={topConc + '%'} glyph={Icon.target}
          trendDir={topConc > 40 ? 'down' : 'up'}
          caption={vendors[0]?.name || ''} />
        <KPI label="Total Overdue POs" value={totalOverdue} glyph={Icon.clock}
          trendDir={totalOverdue > 0 ? 'down' : 'up'}
          caption="across all vendors" />
      </div>

      {/* Scatter plot */}
      <Card title="Spend vs. On-Time Performance"
        sub="Bubble size = order volume · Click a vendor to open their profile"
        actions={
          <div style={{ display: 'flex', gap: 8, fontSize: 11.5, alignItems: 'center' }}>
            {[
              { label: 'Preferred', color: '#74C415' },
              { label: 'Approved',  color: '#1574C4' },
              { label: 'Watch',     color: '#E8A020' },
              { label: 'Probation', color: '#B42318' },
            ].map(s => (
              <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-tertiary)' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: s.color, display: 'inline-block' }} />
                {s.label}
              </span>
            ))}
          </div>
        }>
        <ScatterPlot
          data={bubbleData}
          xLabel="On-Time Delivery %"
          onPointClick={(d) => window.navigateTo && window.navigateTo('vendor', d.label)}
        />
      </Card>

      {/* Risk Matrix */}
      <Card title="Vendor Risk Matrix"
        sub={`${riskRows.length} vendors flagged · sorted by composite risk score`}
        actions={
          <div style={{ display: 'flex', gap: 4 }}>
            {['All', 'Concentration', 'Performance', 'Delivery', 'Dependency'].map(f => (
              <button key={f} onClick={() => setRiskFilter(f)}
                style={{ padding: '3px 9px', borderRadius: 5, border: '1px solid var(--border)',
                  fontSize: 11, cursor: 'pointer', fontWeight: riskFilter === f ? 700 : 400,
                  background: riskFilter === f ? 'var(--sdc-blue)' : 'transparent',
                  color: riskFilter === f ? '#fff' : 'var(--text-tertiary)' }}>
                {f}
              </button>
            ))}
          </div>
        }
        bodyClass="flush">
        {filtered.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
            No vendors with {riskFilter.toLowerCase()} risk.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Score</th>
                  <th>Spend</th>
                  <th>Spend %</th>
                  <th>Overdue POs</th>
                  <th>Risk Flags</th>
                  <th>Recommended Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((v, i) => (
                  <tr key={i} style={{ cursor: 'pointer' }}
                    onClick={() => window.navigateTo && window.navigateTo('vendor', v.name)}>
                    <td>
                      <div style={{ fontWeight: 700, fontSize: 12.5 }}>{v.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{v.orders} POs</div>
                    </td>
                    <td>
                      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15,
                        color: v.score >= 75 ? 'var(--positive)' : v.score >= 60 ? 'var(--warning)' : 'var(--danger)' }}>
                        {v.score}
                      </span>
                    </td>
                    <td className="num strong">{fmtUSD(v.spend, true)}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ flex: 1, height: 5, background: 'var(--bg-subtle)', borderRadius: 3, overflow: 'hidden', minWidth: 50 }}>
                          <div style={{ height: '100%', width: Math.min(v.spendPct, 100) + '%',
                            background: v.spendPct > 40 ? 'var(--danger)' : v.spendPct > 25 ? 'var(--warning)' : 'var(--sdc-blue)',
                            borderRadius: 3 }} />
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{v.spendPct.toFixed(0)}%</span>
                      </div>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span style={{ fontWeight: 700, color: v.overdue > 5 ? 'var(--danger)' : v.overdue > 0 ? 'var(--warning)' : 'var(--positive)' }}>
                        {v.overdue}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {v.risks.map((r, j) => (
                          <span key={j} style={{ padding: '2px 7px', borderRadius: 4, fontSize: 10.5, fontWeight: 600,
                            background: severityBg(r.severity), color: severityColor(r.severity) }}
                            title={r.detail}>
                            {r.severity === 'High' ? '⚠ ' : '● '}{r.type}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                      {ACTION_MAP[v.risks[0]?.type] || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Multi-project dependency */}
      {multiProj.length > 0 && (
        <Card title="Cross-Project Vendor Dependency"
          sub="Vendors supplying 3+ projects — single-source disruption risk">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {multiProj.map((v, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.4fr auto auto', gap: 16, alignItems: 'center',
                padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)',
                background: 'var(--bg-subtle)', cursor: 'pointer' }}
                onClick={() => window.navigateTo && window.navigateTo('vendor', v.name)}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{v.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {v.projects.slice(0, 6).map(pid => (
                      <span key={pid} style={{ padding: '1px 6px', borderRadius: 3, background: 'rgba(21,116,196,0.1)',
                        color: 'var(--sdc-blue)', fontSize: 10.5, fontFamily: 'monospace' }}>{pid}</span>
                    ))}
                    {v.projects.length > 6 && <span style={{ color: 'var(--text-tertiary)', fontSize: 10.5 }}>+{v.projects.length - 6} more</span>}
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-display)',
                    color: v.projCount >= 6 ? 'var(--danger)' : v.projCount >= 4 ? 'var(--warning)' : 'var(--sdc-blue)' }}>
                    {v.projCount}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>projects</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{fmtUSD(v.spend, true)}</div>
                  <StatusPill s={v.status} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
};

window.SupplierRiskReport = SupplierRiskReport;
