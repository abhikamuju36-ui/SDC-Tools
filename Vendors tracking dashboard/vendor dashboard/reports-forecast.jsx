/* Spend Forecast Report */

const SpendForecastReport = () => {
  const orders   = window.ORDERS   || [];
  const projects = window.PROJECTS || [];

  // Group total spend and budget by project
  const projectMap = {};
  projects.forEach(p => {
    projectMap[p.id] = { name: p.name, budget: p.budget || 0, spend: 0 };
  });
  orders.forEach(o => {
    const key = `P-${o.projectId}`;
    if (projectMap[key]) projectMap[key].spend += o.amount || 0;
  });

  const rows = Object.values(projectMap)
    .filter(p => p.budget > 0 || p.spend > 0)
    .map(p => ({
      ...p,
      remaining: p.budget - p.spend,
      pct: p.budget > 0 ? Math.min(100, Math.round((p.spend / p.budget) * 100)) : 0,
      atRisk: p.budget > 0 && p.spend / p.budget > 0.85,
    }))
    .sort((a, b) => b.pct - a.pct);

  const totalBudget  = rows.reduce((s, r) => s + r.budget, 0);
  const totalSpend   = rows.reduce((s, r) => s + r.spend,  0);
  const atRiskCount  = rows.filter(r => r.atRisk).length;

  const fmt = v => '$' + (v >= 1_000_000
    ? (v / 1_000_000).toFixed(1) + 'M'
    : v >= 1_000 ? (v / 1_000).toFixed(0) + 'K' : v.toFixed(0));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {[
          { label: 'Total Budget',    value: fmt(totalBudget),  sub: `${projects.length} projects` },
          { label: 'Total Spend',     value: fmt(totalSpend),   sub: `${Math.round((totalSpend / (totalBudget || 1)) * 100)}% consumed` },
          { label: 'At-Risk Projects', value: atRiskCount,      sub: '>85% budget consumed' },
        ].map(k => (
          <div key={k.label} style={{
            background: 'var(--surface-2, #0d2a4a)',
            border: '1px solid var(--border, rgba(255,255,255,0.08))',
            borderRadius: 12, padding: '20px 24px',
          }}>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary, #7a9ab8)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>{k.label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary, #fff)', fontFamily: 'var(--font-display, Montserrat, sans-serif)' }}>{k.value}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary, #aacee8)', marginTop: 4 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Budget burn table */}
      <div style={{
        background: 'var(--surface-2, #0d2a4a)',
        border: '1px solid var(--border, rgba(255,255,255,0.08))',
        borderRadius: 12, overflow: 'hidden',
      }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border, rgba(255,255,255,0.08))', fontSize: 13, fontWeight: 600, color: 'var(--text-primary, #fff)' }}>
          Budget Runway by Project
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border, rgba(255,255,255,0.08))' }}>
              {['Project', 'Budget', 'Spend', 'Remaining', 'Burn %'].map(h => (
                <th key={h} style={{ padding: '10px 16px', textAlign: h === 'Project' ? 'left' : 'right', color: 'var(--text-tertiary, #7a9ab8)', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: 32, textAlign: 'center', color: 'var(--text-tertiary, #7a9ab8)' }}>No budget data available</td></tr>
            ) : rows.map((r, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--border, rgba(255,255,255,0.05))', background: r.atRisk ? 'rgba(239,68,68,0.05)' : undefined }}>
                <td style={{ padding: '10px 16px', color: 'var(--text-primary, #fff)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.atRisk && <span style={{ color: '#ef4444', marginRight: 6 }}>⚠</span>}
                  {r.name}
                </td>
                <td style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text-secondary, #aacee8)' }}>{fmt(r.budget)}</td>
                <td style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text-secondary, #aacee8)' }}>{fmt(r.spend)}</td>
                <td style={{ padding: '10px 16px', textAlign: 'right', color: r.remaining < 0 ? '#ef4444' : 'var(--text-secondary, #aacee8)' }}>{fmt(r.remaining)}</td>
                <td style={{ padding: '10px 16px', textAlign: 'right', minWidth: 120 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                    <div style={{ width: 72, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                      <div style={{ width: `${r.pct}%`, height: '100%', borderRadius: 3, background: r.pct > 85 ? '#ef4444' : r.pct > 60 ? '#f59e0b' : '#22c55e', transition: 'width 0.3s' }} />
                    </div>
                    <span style={{ color: r.pct > 85 ? '#ef4444' : 'var(--text-secondary, #aacee8)', width: 36, textAlign: 'right' }}>{r.pct}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
