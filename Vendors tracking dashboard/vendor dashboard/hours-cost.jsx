/* hours-cost.jsx
   Hours & Cost Analysis sub-tab
   Shows Quoted (estimated) vs Actual hours and labor costs per project.
   Engineering hours, Manufacturing hours, Materials, Margins, future projections. */

// ── helpers ──────────────────────────────────────────────────────────────────

function hrsBar(est, act, color) {
  if (!est && !act) return <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>No data</span>;
  const max   = Math.max(est || 0, act || 0, 1);
  const estW  = ((est || 0) / max * 100).toFixed(1);
  const actW  = ((act || 0) / max * 100).toFixed(1);
  const over  = act > est * 1.05;
  const under = est > 0 && act < est * 0.95;
  return (
    <div style={{ minWidth: 140 }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 3, fontSize: 11, color: 'var(--text-tertiary)' }}>
        <span>Est: <strong style={{ color: 'var(--text)' }}>{(est || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} h</strong></span>
        <span style={{ marginLeft: 8 }}>Act: <strong style={{ color: over ? 'var(--danger)' : under ? 'var(--positive)' : 'var(--text)' }}>{(act || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} h</strong></span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-subtle)', overflow: 'hidden', marginBottom: 2 }}>
        <div style={{ height: '100%', width: estW + '%', background: 'var(--border)', borderRadius: 3 }}></div>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-subtle)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: actW + '%', background: over ? 'var(--danger)' : color, borderRadius: 3 }}></div>
      </div>
    </div>
  );
}

function marginPill(pct) {
  if (pct == null || pct === 0) return <span style={{ color: 'var(--text-tertiary)' }}>—</span>;
  const color = pct >= 20 ? 'var(--positive)' : pct >= 10 ? 'var(--sdc-blue)' : pct >= 0 ? 'var(--warning)' : 'var(--danger)';
  return (
    <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11.5, fontWeight: 700,
      background: pct >= 0 ? 'rgba(116,196,21,0.12)' : 'rgba(180,35,24,0.1)', color }}>
      {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
    </span>
  );
}

// ── component ─────────────────────────────────────────────────────────────────

const HoursCostAnalysis = ({ projectIds, projectTypeFilter }) => {
  const allProjects = window.PROJECTS || [];
  const costingMap  = window.COSTING_MAP || {};

  // Filter to selected projects
  const targetIds = (projectIds || []).map(id => id.startsWith('P-') ? id : 'P-' + id);
  const projects = targetIds.length > 0
    ? allProjects.filter(p => targetIds.includes(p.id))
    : allProjects.filter(p => !projectTypeFilter || projectTypeFilter === 'All' || p.projectType === projectTypeFilter);

  // Merge costing data
  const rows = projects.map(p => {
    const rawId = p.id.replace(/^P-/, '');
    const c = costingMap[rawId] || costingMap[p.id] || {};
    return { ...p, ...c };
  }).filter(r => r.estEngHrs > 0 || r.actEngHrs > 0 || r.estMfgHrs > 0 || r.actMfgHrs > 0
    || r.estEngLabor > 0 || r.actEngLabor > 0 || r.estMfgLabor > 0 || r.actMfgLabor > 0);

  // Aggregates
  const agg = rows.reduce((a, r) => ({
    estEngHrs:  a.estEngHrs  + (r.estEngHrs  || 0),
    actEngHrs:  a.actEngHrs  + (r.actEngHrs  || 0),
    estMfgHrs:  a.estMfgHrs  + (r.estMfgHrs  || 0),
    actMfgHrs:  a.actMfgHrs  + (r.actMfgHrs  || 0),
    estEngLabor:  a.estEngLabor  + (r.estEngLabor  || 0),
    actEngLabor:  a.actEngLabor  + (r.actEngLabor  || 0),
    estMfgLabor:  a.estMfgLabor  + (r.estMfgLabor  || 0),
    actMfgLabor:  a.actMfgLabor  + (r.actMfgLabor  || 0),
    estMaterials:    a.estMaterials    + (r.estMaterials    || 0),
    actMaterials:    a.actMaterials    + (r.actMaterials    || 0),
    totalEstimate:   a.totalEstimate   + (r.totalEstimate   || 0),
    totalActualCost: a.totalActualCost + (r.totalActualCost || 0),
    salesPrice:      a.salesPrice      + (r.salesPrice      || 0),
  }), { estEngHrs:0, actEngHrs:0, estMfgHrs:0, actMfgHrs:0,
    estEngLabor:0, actEngLabor:0, estMfgLabor:0, actMfgLabor:0,
    estMaterials:0, actMaterials:0, totalEstimate:0, totalActualCost:0, salesPrice:0 });

  const aggBudgetMargin = agg.salesPrice > 0
    ? ((agg.salesPrice - agg.totalEstimate) / agg.salesPrice * 100) : 0;
  const aggActMargin = agg.salesPrice > 0
    ? ((agg.salesPrice - agg.totalActualCost) / agg.salesPrice * 100) : 0;

  // Future projection: use avg actuals-to-estimate ratio for projects with both
  const completedRows = rows.filter(r => r.actEngHrs > 0 && r.estEngHrs > 0);
  const avgEngFactor  = completedRows.length > 0
    ? completedRows.reduce((s, r) => s + r.actEngHrs / r.estEngHrs, 0) / completedRows.length : 1;
  const completedMfg  = rows.filter(r => r.actMfgHrs > 0 && r.estMfgHrs > 0);
  const avgMfgFactor  = completedMfg.length > 0
    ? completedMfg.reduce((s, r) => s + r.actMfgHrs / r.estMfgHrs, 0) / completedMfg.length : 1;

  const hasData = rows.length > 0;

  if (!hasData) {
    return (
      <Card title="Hours & Cost Analysis" sub="Quoted vs Actual from ETO">
        <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
          {Object.keys(costingMap).length === 0
            ? 'Costing data not available — ETO costing module may not be configured for these projects.'
            : 'No hours data available for selected projects. Select projects with engineering/manufacturing estimates.'}
        </div>
      </Card>
    );
  }

  return (
    <>
      {/* Summary KPIs */}
      <div className="kpis" style={{ marginBottom: 16 }}>
        <KPI label="Total Eng Hours" glyph={Icon.clock}
          value={(agg.actEngHrs || agg.estEngHrs).toLocaleString(undefined, {maximumFractionDigits:0})}
          unit="h"
          trend={agg.estEngHrs > 0 ? ((agg.actEngHrs / agg.estEngHrs - 1) * 100).toFixed(0) + '% vs est' : undefined}
          trendDir={agg.actEngHrs <= agg.estEngHrs ? 'up' : 'down'}
          caption={agg.estEngHrs > 0 ? `est ${agg.estEngHrs.toLocaleString(undefined,{maximumFractionDigits:0})} h` : 'no estimate'} />
        <KPI label="Total Mfg Hours" glyph={Icon.zap}
          value={(agg.actMfgHrs || agg.estMfgHrs).toLocaleString(undefined, {maximumFractionDigits:0})}
          unit="h"
          trend={agg.estMfgHrs > 0 ? ((agg.actMfgHrs / agg.estMfgHrs - 1) * 100).toFixed(0) + '% vs est' : undefined}
          trendDir={agg.actMfgHrs <= agg.estMfgHrs ? 'up' : 'down'}
          caption={agg.estMfgHrs > 0 ? `est ${agg.estMfgHrs.toLocaleString(undefined,{maximumFractionDigits:0})} h` : 'no estimate'} />
        <KPI label="Budget Margin" glyph={Icon.trend}
          value={aggBudgetMargin.toFixed(1)} unit="%"
          trendDir={aggBudgetMargin >= 15 ? 'up' : aggBudgetMargin >= 0 ? 'flat' : 'down'}
          caption="from sales price vs estimate" />
        <KPI label="Actual Margin" glyph={Icon.dollar}
          value={aggActMargin.toFixed(1)} unit="%"
          trendDir={aggActMargin >= 15 ? 'up' : aggActMargin >= 0 ? 'flat' : 'down'}
          caption="from sales price vs actual cost" />
      </div>

      {/* Eng factor projection callout */}
      {completedRows.length > 1 && (
        <div style={{ marginBottom: 16, padding: '12px 18px', borderRadius: 10,
          background: 'var(--sdc-light-blue-tint)', border: '1px solid var(--sdc-blue)',
          fontSize: 13, display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 11.5,
            letterSpacing: 1, textTransform: 'uppercase', color: '#0f5a9c' }}>
            Future Projection
          </span>
          <span>
            Based on <strong>{completedRows.length}</strong> projects with both est + actual hours:
            Eng runs at <strong style={{ color: avgEngFactor > 1.1 ? 'var(--danger)' : 'var(--positive)' }}>{(avgEngFactor * 100).toFixed(0)}%</strong> of estimate,
            Mfg at <strong style={{ color: avgMfgFactor > 1.1 ? 'var(--danger)' : 'var(--positive)' }}>{(avgMfgFactor * 100).toFixed(0)}%</strong> of estimate.
          </span>
          {avgEngFactor > 1.05 && (
            <span style={{ fontSize: 12, color: 'var(--danger)' }}>
              ⚠ New project quotes should add {((avgEngFactor - 1) * 100).toFixed(0)}% contingency on engineering.
            </span>
          )}
        </div>
      )}

      {/* Per-project table */}
      <Card title="Project Hours & Cost Detail"
        sub={`${rows.length} projects · Quoted vs Actual · Labor + Materials + Margins`}
        bodyClass="flush">
        <div className="table-wrap">
          <table className="data" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th>Project</th>
                <th>Type</th>
                <th>Engineering Hours</th>
                <th>Mfg Hours</th>
                <th className="num">Est Eng Labor</th>
                <th className="num">Act Eng Labor</th>
                <th className="num">Est Mfg Labor</th>
                <th className="num">Act Mfg Labor</th>
                <th className="num">Est Materials</th>
                <th className="num">Act Materials</th>
                <th>Budget Margin</th>
                <th>Actual Margin</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <div style={{ fontWeight: 700, fontSize: 12 }}>{r.id}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', maxWidth: 160, overflow: 'hidden',
                      textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                  </td>
                  <td>
                    <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10.5, fontWeight: 600,
                      background: r.projectType === 'Duplicate' ? 'rgba(170,206,232,0.3)'
                        : r.projectType === 'Hybrid' ? 'rgba(255,222,81,0.25)' : 'rgba(21,116,196,0.12)',
                      color: r.projectType === 'Duplicate' ? '#2B6EA8'
                        : r.projectType === 'Hybrid' ? '#8a6700' : 'var(--sdc-blue)' }}>
                      {r.projectType || 'Custom'}
                    </span>
                  </td>
                  <td>{hrsBar(r.estEngHrs, r.actEngHrs, 'var(--sdc-blue)')}</td>
                  <td>{hrsBar(r.estMfgHrs, r.actMfgHrs, '#0f5a9c')}</td>
                  <td className="num">{r.estEngLabor > 0 ? fmtUSD(r.estEngLabor, true) : '—'}</td>
                  <td className="num">
                    {r.actEngLabor > 0
                      ? <span style={{ color: r.actEngLabor > r.estEngLabor * 1.05 ? 'var(--danger)' : undefined }}>
                          {fmtUSD(r.actEngLabor, true)}
                        </span>
                      : '—'}
                  </td>
                  <td className="num">{r.estMfgLabor > 0 ? fmtUSD(r.estMfgLabor, true) : '—'}</td>
                  <td className="num">
                    {r.actMfgLabor > 0
                      ? <span style={{ color: r.actMfgLabor > r.estMfgLabor * 1.05 ? 'var(--danger)' : undefined }}>
                          {fmtUSD(r.actMfgLabor, true)}
                        </span>
                      : '—'}
                  </td>
                  <td className="num">{r.estMaterials > 0 ? fmtUSD(r.estMaterials, true) : '—'}</td>
                  <td className="num">{r.actMaterials > 0 ? fmtUSD(r.actMaterials, true) : '—'}</td>
                  <td style={{ textAlign: 'center' }}>{marginPill(r.budgetMargin)}</td>
                  <td style={{ textAlign: 'center' }}>{marginPill(r.actualMargin)}</td>
                </tr>
              ))}
            </tbody>
            {/* Totals row */}
            <tfoot>
              <tr style={{ fontWeight: 700, background: 'var(--bg-subtle)', borderTop: '2px solid var(--border)' }}>
                <td colSpan="2" style={{ fontFamily: 'var(--font-display)', fontSize: 11.5, letterSpacing: 0.5 }}>
                  TOTAL / AGGREGATE
                </td>
                <td>{hrsBar(agg.estEngHrs, agg.actEngHrs, 'var(--sdc-blue)')}</td>
                <td>{hrsBar(agg.estMfgHrs, agg.actMfgHrs, 'var(--sdc-blue)')}</td>
                <td className="num">{fmtUSD(agg.estEngLabor, true)}</td>
                <td className="num">{fmtUSD(agg.actEngLabor, true)}</td>
                <td className="num">{fmtUSD(agg.estMfgLabor, true)}</td>
                <td className="num">{fmtUSD(agg.actMfgLabor, true)}</td>
                <td className="num">{fmtUSD(agg.estMaterials, true)}</td>
                <td className="num">{fmtUSD(agg.actMaterials, true)}</td>
                <td style={{ textAlign: 'center' }}>{marginPill(aggBudgetMargin)}</td>
                <td style={{ textAlign: 'center' }}>{marginPill(aggActMargin)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {/* Project-type breakdown */}
      {(() => {
        const types = ['Custom', 'Duplicate', 'Hybrid'];
        const byType = types.map(t => {
          const rs = rows.filter(r => r.projectType === t);
          if (rs.length === 0) return null;
          const estHrs = rs.reduce((s, r) => s + (r.estEngHrs || 0) + (r.estMfgHrs || 0), 0);
          const actHrs = rs.reduce((s, r) => s + (r.actEngHrs || 0) + (r.actMfgHrs || 0), 0);
          const actMgn = rs.filter(r => r.actualMargin != null && r.salesPrice > 0);
          const avgMgn = actMgn.length > 0
            ? actMgn.reduce((s, r) => s + r.actualMargin, 0) / actMgn.length : null;
          return { type: t, count: rs.length, estHrs, actHrs, avgMgn };
        }).filter(Boolean);

        if (byType.length < 2) return null;
        return (
          <div style={{ marginTop: 16 }}>
            <Card title="By Project Type" sub="Custom vs Duplicate vs Hybrid — hours and margin comparison">
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${byType.length}, 1fr)`, gap: 16 }}>
                {byType.map(bt => (
                  <div key={bt.type} style={{ padding: '16px 20px', borderRadius: 10,
                    border: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13,
                      letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8,
                      color: bt.type === 'Duplicate' ? '#2B6EA8' : bt.type === 'Hybrid' ? '#8a6700' : 'var(--sdc-blue)' }}>
                      {bt.type}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginBottom: 4 }}>{bt.count} project{bt.count !== 1 ? 's' : ''}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
                      <div>Est hrs: <strong>{bt.estHrs.toLocaleString(undefined,{maximumFractionDigits:0})}</strong></div>
                      <div>Act hrs: <strong style={{ color: bt.actHrs > bt.estHrs * 1.1 ? 'var(--danger)' : undefined }}>
                        {bt.actHrs.toLocaleString(undefined,{maximumFractionDigits:0})}</strong>
                      </div>
                      {bt.avgMgn != null && (
                        <div>Avg margin: {marginPill(bt.avgMgn)}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        );
      })()}
    </>
  );
};

window.HoursCostAnalysis = HoursCostAnalysis;
