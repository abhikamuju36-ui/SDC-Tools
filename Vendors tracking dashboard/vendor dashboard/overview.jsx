/* Overview tab — fleet-wide view */

const Overview = () => {
  const totalSpend  = PROJECTS.length > 0 ? PROJECTS.reduce((a,b) => a + b.spent, 0) : 0;
  const totalBudget = PROJECTS.length > 0 ? PROJECTS.reduce((a,b) => a + b.budget, 0) : 0;
  const avgOrder = PURCHASE_ORDERS.length > 0
    ? Math.round(PURCHASE_ORDERS.reduce((a,b) => a + b.amount, 0) / PURCHASE_ORDERS.length)
    : 0;
  const onTimeAvg = VENDORS.length > 0
    ? VENDORS.reduce((a,b) => a + b.onTime, 0) / VENDORS.length
    : 0;
  const avgLead = VENDORS.length > 0
    ? VENDORS.reduce((a,b) => a + b.leadDays, 0) / VENDORS.length
    : 0;

  // Top 15 projects by spend for bar chart (343 total projects is too dense)
  const projectBarData = PROJECTS.length > 0
    ? [...PROJECTS].filter(p => p.spent > 0).sort((a, b) => b.spent - a.spent).slice(0, 15).map(p => ({ label: p.id, value: p.spent }))
    : [];

  const concentration = VENDORS.length > 0
    ? VENDORS.slice(0, 5).map((v, i) => ({
        name: v.name,
        value: v.spend,
        color: ["#1574C4", "#061D39", "#74C415", "#AACEE8", "#FFDE51"][i],
      }))
    : [];
  const totalVendorSpend = VENDORS.length > 0 ? VENDORS.reduce((a,b)=>a+b.spend,0) : 0;
  const top1Pct = concentration.length > 0 && totalVendorSpend > 0
    ? (concentration[0].value / totalVendorSpend) * 100
    : 0;

  return (
    <>
      {/* KPI row */}
      <div className="kpis">
        <KPI label="Total Spend YTD"
             value={fmtUSD(totalSpend, true)}
             glyph={Icon.dollar}
             caption={PROJECTS.filter(p => p.spent > 0).length + " active projects"}/>
        <KPI label="Avg Order Size"
             value={"$" + (avgOrder >= 1000 ? (avgOrder/1000).toFixed(1) + "K" : avgOrder)}
             glyph={Icon.card}
             caption={"across " + PURCHASE_ORDERS.length.toLocaleString() + " POs"}/>
        <KPI label="On-Time Delivery"
             value={fmtPct(onTimeAvg, 1)}
             glyph={Icon.truck}
             trendDir={onTimeAvg >= 90 ? "up" : "down"}
             trend={onTimeAvg >= 90 ? "Above target" : "Below target"}
             caption="vs 90% threshold"/>
        <KPI label="Avg Lead Time"
             value={avgLead.toFixed(1)}
             unit="days"
             glyph={Icon.clock}
             caption={VENDORS.length + " active suppliers"}/>
      </div>

      {/* Budget consumption + Concentration */}
      <div className="grid-2">
        <Card title="Spend by Project"
              sub="Live spend across all active engagements"
              actions={
                <div className="segment">
                  <button className="active">$ Spend</button>
                  <button>% Budget</button>
                </div>
              }>
          <BarChart data={projectBarData} valueFmt={v => fmtUSD(v, true)} color="#1574C4"/>
        </Card>

        <Card title="Vendor Concentration"
              sub={concentration.length > 0 ? `Top supplier holds ${top1Pct.toFixed(0)}% of total spend` : 'Loading vendor data…'}>
          {concentration.length > 0 ? (
            <div className="donut-wrap">
              <Donut data={concentration} size={170} thickness={24}
                     centerValue={fmtUSD(totalVendorSpend, true)}
                     centerLabel="TOTAL SPEND"/>
              <div className="donut-legend">
                {concentration.map((c,i) => (
                  <div className="legend-row" key={i}>
                    <span className="legend-swatch" style={{ background: c.color }}></span>
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

      {/* PO aging — full width minimal strip */}
      <Card title="Purchase Order Aging"
            sub="How long open POs have been outstanding"
            actions={<button className="btn btn-ghost">{Icon.external} View ledger</button>}
            bodyClass="flush">
        <div className="aging-grid">
          {PO_AGING.map((a, i) => (
            <div className="aging-cell" key={i}>
              <div className="label">{a.label}</div>
              <div className="value">{a.count} <span style={{fontSize:12, color:"var(--text-tertiary)", fontWeight:500}}>POs</span></div>
              <div className="bar"><span style={{ width: `${a.pct*100}%`, background: a.color }}></span></div>
            </div>
          ))}
        </div>
      </Card>

      <div style={{ height: 16 }}></div>

      {/* Spend trend + Activity */}
      <div className="grid-2">
        <Card title="Spend Trend"
              sub="Monthly outflow against rolling forecast"
              actions={
                <div className="segment">
                  <button>3M</button>
                  <button className="active">6M</button>
                  <button>1Y</button>
                </div>
              }>
          <LineChart data={SPEND_TIMELINE} yFmt={v => "$" + (v/1e6).toFixed(1) + "M"}/>
        </Card>

        <Card title="Recent Activity"
              sub="POs, deliveries, and risk events"
              bodyClass="flush">
          <div className="activity">
            {ACTIVITY.map((a, i) => (
              <div className="activity-row" key={i}>
                <div className={"activity-dot " + a.kind}>
                  {a.kind === "ship"  ? Icon.truck :
                   a.kind === "po"    ? Icon.file :
                   a.kind === "risk"  ? Icon.alert :
                   a.kind === "late"  ? Icon.clock : Icon.check}
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

      {/* Scorecards + Spend by category */}
      <div className="grid-1-2">
        <Card title="Spend by Category"
              sub="Across all open POs">
          <div style={{ marginBottom: 16 }}>
            <StackBar segments={SPEND_BY_CATEGORY} height={10}/>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {SPEND_BY_CATEGORY.map((c, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "12px 1fr auto", gap: 10, alignItems: "center", fontSize: 12.5 }}>
                <span className="legend-swatch" style={{ background: c.color }}></span>
                <span>{c.name}</span>
                <span className="legend-value">{fmtUSD(c.value, true)}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Vendor Scorecards"
              sub="Composite rating based on delivery, lead time, and defect rate"
              actions={<button className="btn btn-ghost">{Icon.external} See all</button>}
              bodyClass="flush">
          <div className="score-list">
            {VENDORS.length === 0 && (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-tertiary)' }}>No vendor data loaded yet.</div>
            )}
            {VENDORS.slice(0, 6).map((v, i) => (
              <div className="score-row" key={i}>
                <span className="score-rank">0{i+1}</span>
                <div>
                  <div className="score-name">{v.name}</div>
                  <div className="score-meta">{v.orders} orders · {fmtUSD(v.spend, true)} · {fmtPct(v.onTime)} on time</div>
                  <div className="score-bar"><span style={{ width: `${v.score}%`, background: v.score >= 90 ? "var(--positive)" : v.score >= 80 ? "var(--sdc-blue)" : v.score >= 75 ? "var(--warning)" : "var(--danger)" }}/></div>
                </div>
                <span className="score-value">{v.score}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* PO ledger */}
      <Card title="Purchase Order Ledger"
            sub="Real-time tracker across every active project"
            actions={
              <>
                <button className="btn btn-ghost">{Icon.filter} Filter</button>
                <button className="btn btn-secondary">{Icon.download} Export</button>
              </>
            }
            bodyClass="flush">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>PO #</th>
                <th>Project</th>
                <th>Vendor</th>
                <th>Category</th>
                <th className="num">Amount</th>
                <th>Issued</th>
                <th>Expected</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {PURCHASE_ORDERS.length === 0 && (
                <tr><td colSpan="8" style={{ textAlign: 'center', padding: 32, color: 'var(--text-tertiary)' }}>No purchase orders loaded yet.</td></tr>
              )}
              {PURCHASE_ORDERS.map((p, i) => (
                <tr key={i}>
                  <td className="strong">{p.po}</td>
                  <td className="muted">{p.project}</td>
                  <td>{p.vendor}</td>
                  <td className="muted">{p.category}</td>
                  <td className="num strong">{fmtUSD(p.amount)}</td>
                  <td className="muted">{p.issued}</td>
                  <td className="muted">{p.expected}</td>
                  <td><StatusPill s={p.status}/></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
};

window.Overview = Overview;
