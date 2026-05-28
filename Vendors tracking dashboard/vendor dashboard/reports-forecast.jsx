/* Spend Forecast Report */

const SpendForecastReport = () => {
  const pos      = window.PURCHASE_ORDERS || [];
  const projects = window.PROJECTS        || [];

  // Group total spend and budget by project (use o.project which is already P-XXXXX)
  const projectMap = {};
  projects.forEach(p => {
    projectMap[p.id] = { id: p.id, name: p.name, budget: p.budget || 0, spend: 0, status: p.status };
  });
  pos.forEach(o => {
    if (projectMap[o.project]) projectMap[o.project].spend += o.amount || 0;
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

  const totalBudget = rows.reduce((s, r) => s + r.budget, 0);
  const totalSpend  = rows.reduce((s, r) => s + r.spend,  0);
  const atRiskCount = rows.filter(r => r.atRisk).length;

  const fmt = v => {
    const abs = Math.abs(v);
    const str = abs >= 1_000_000 ? (abs / 1_000_000).toFixed(1) + 'M'
              : abs >= 1_000     ? (abs / 1_000).toFixed(0) + 'K'
              : abs.toFixed(0);
    return (v < 0 ? '-$' : '$') + str;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {[
          { label: 'Total Budget',     value: fmt(totalBudget), sub: `${projects.length} projects` },
          { label: 'Total Spend',      value: fmt(totalSpend),  sub: `${Math.round((totalSpend / (totalBudget || 1)) * 100)}% consumed` },
          { label: 'At-Risk Projects', value: atRiskCount,      sub: '>85% budget consumed' },
        ].map(k => (
          <div key={k.label} style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 12, padding: '20px 24px',
          }}>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>{k.label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>{k.value}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Budget burn table */}
      <div style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 12, overflow: 'hidden',
      }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
          Budget Runway by Project
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Project', 'Budget', 'Spend', 'Remaining', 'Burn %'].map(h => (
                <th key={h} style={{ padding: '10px 16px', textAlign: h === 'Project' ? 'left' : 'right',
                  color: 'var(--text-tertiary)', fontWeight: 500, fontSize: 11,
                  textTransform: 'uppercase', letterSpacing: 0.8 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: 32, textAlign: 'center', color: 'var(--text-tertiary)' }}>No budget data available</td></tr>
            ) : rows.map((r, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: r.atRisk ? 'rgba(180,35,24,0.04)' : undefined }}>
                <td style={{ padding: '10px 16px', color: 'var(--text-primary)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.atRisk && <span style={{ color: 'var(--danger)', marginRight: 6 }}>⚠</span>}
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'monospace', marginRight: 6 }}>{r.id}</span>
                  {r.name}
                </td>
                <td style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text-secondary)' }}>{fmt(r.budget)}</td>
                <td style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text-secondary)' }}>{fmt(r.spend)}</td>
                <td style={{ padding: '10px 16px', textAlign: 'right', color: r.remaining < 0 ? 'var(--danger)' : 'var(--text-secondary)' }}>{fmt(r.remaining)}</td>
                <td style={{ padding: '10px 16px', textAlign: 'right', minWidth: 130 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                    <div style={{ width: 72, height: 6, borderRadius: 3, background: 'var(--bg-subtle)', overflow: 'hidden' }}>
                      <div style={{ width: `${r.pct}%`, height: '100%', borderRadius: 3,
                        background: r.pct > 85 ? 'var(--danger)' : r.pct > 60 ? 'var(--warning)' : 'var(--positive)',
                        transition: 'width 0.3s' }} />
                    </div>
                    <span style={{ color: r.pct > 85 ? 'var(--danger)' : 'var(--text-secondary)', width: 36, textAlign: 'right' }}>{r.pct}%</span>
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

window.SpendForecastReport = SpendForecastReport;
