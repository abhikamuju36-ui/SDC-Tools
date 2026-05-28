/* vendor-analyzer.jsx — fully real-time, zero static data */

// ── Searchable picker ─────────────────────────────────────────────────────────
const VendorPicker = ({ vendors, selected, onChange }) => {
  const [query,   setQuery]   = React.useState('');
  const [open,    setOpen]    = React.useState(false);
  const [dropPos, setDropPos] = React.useState({ top: 0, right: 0 });
  const wrapRef    = React.useRef(null);
  const triggerRef = React.useRef(null);

  // Close on outside click — wrapRef covers both trigger and the fixed dropdown
  // because the fixed div is still a DOM child of wrapRef even though CSS-positioned at viewport level
  React.useEffect(() => {
    const h = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const handleOpen = () => {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      // Anchor to right edge of trigger; clamp so it never goes off-screen left
      setDropPos({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) });
    }
    setOpen(o => !o);
  };

  const filtered = vendors.filter(v => !query || v.name.toLowerCase().includes(query.toLowerCase()));
  const select   = name => { onChange(name); setQuery(''); setOpen(false); };

  return (
    <div ref={wrapRef} style={{ position: 'relative', marginLeft: 'auto', minWidth: 260 }}>
      {/* Trigger button */}
      <div ref={triggerRef} onClick={handleOpen}
        style={{ display: 'flex', gap: 6, alignItems: 'center', border: '1px solid var(--border)',
          borderRadius: 8, padding: '7px 12px', background: 'var(--bg-elevated)', cursor: 'pointer',
          boxShadow: open ? '0 0 0 2px rgba(21,116,196,0.25)' : undefined,
          borderColor: open ? 'var(--sdc-blue)' : undefined, transition: 'all 0.12s' }}>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected}</span>
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', background: 'var(--bg-subtle)',
          borderRadius: 4, padding: '1px 6px' }}>{vendors.length}</span>
        <span style={{ fontSize: 10, color: 'var(--text-tertiary)', transition: 'transform 0.15s',
          display: 'inline-block', transform: open ? 'rotate(180deg)' : 'none' }}>▼</span>
      </div>

      {/* Dropdown — fixed to viewport so it never overlaps page content */}
      {open && (
        <div style={{
          position: 'fixed', top: dropPos.top, right: dropPos.right,
          zIndex: 1000, width: 340, maxHeight: 440,
          background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10,
          boxShadow: '0 12px 40px rgba(0,0,0,0.22)', display: 'flex', flexDirection: 'column',
        }}>
          {/* Search header */}
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: 6 }}>
            {Icon.search}
            <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
              placeholder={`Search ${vendors.length} vendors…`}
              style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 13, outline: 'none', color: 'var(--text)' }} />
            {query
              ? <button onClick={() => setQuery('')}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 14 }}>✕</button>
              : <button onClick={() => setOpen(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 14, lineHeight: 1 }}>✕</button>
            }
          </div>
          {/* Results */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filtered.length === 0 && (
              <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
                No match for "{query}"
              </div>
            )}
            {filtered.map(v => (
              <div key={v.name} onClick={() => select(v.name)}
                style={{ padding: '8px 14px', cursor: 'pointer', display: 'flex',
                  justifyContent: 'space-between', alignItems: 'center',
                  background: v.name === selected ? 'rgba(21,116,196,0.07)' : undefined,
                  borderBottom: '1px solid var(--border)', transition: 'background 0.1s' }}>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: v.name === selected ? 700 : 500 }}>{v.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    {v.orders} PO{v.orders !== 1 ? 's' : ''} · {fmtUSD(v.spend, true)}
                  </div>
                </div>
                <span style={{ padding: '2px 7px', borderRadius: 4, fontSize: 10.5, fontWeight: 600,
                  background: v.score >= 88 ? 'rgba(116,196,21,0.13)' : v.score >= 75 ? 'rgba(21,116,196,0.1)' : 'rgba(180,35,24,0.08)',
                  color: v.score >= 88 ? 'var(--positive)' : v.score >= 75 ? 'var(--sdc-blue)' : 'var(--danger)' }}>
                  {v.score}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Main ──────────────────────────────────────────────────────────────────────
const VendorAnalyzer = () => {
  const vendors = window.VENDORS || [];

  // Consume navigation param (set by window.navigateTo('vendor', vendorName))
  const _navName = window.__navParams;
  const initialVendor = (_navName && vendors.some(v => v.name === _navName))
    ? _navName
    : (vendors.length > 0 ? vendors[0].name : '');

  const [selectedName, setSelectedName] = React.useState(initialVendor);

  // Clear nav params after consuming so stale params don't affect future mounts
  React.useEffect(() => { window.__navParams = null; }, []);

  React.useEffect(() => {
    if (!selectedName && vendors.length > 0) setSelectedName(vendors[0].name);
  }, [vendors.length]);

  if (vendors.length === 0) {
    return <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-tertiary)' }}>
      Loading vendor data from ETO…
    </div>;
  }

  const v         = vendors.find(x => x.name === selectedName) || vendors[0];
  const allRaw    = window.PURCHASE_ORDERS_RAW || [];
  const vendorRaw = allRaw.filter(p => p.vendor === v.name);
  const vendorPOs = (window.PURCHASE_ORDERS || []).filter(p => p.vendor === v.name);
  const today     = new Date().toISOString().split('T')[0];
  const now       = new Date();

  // ── Real monthly on-time performance (last 7 months) ──
  const monthlyPerf = (() => {
    const months = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ month: d.toLocaleDateString('en-US', { month: 'short' }), year: d.getFullYear(), mon: d.getMonth(), delivered: 0, onTime: 0 });
    }
    vendorRaw.forEach(po => {
      if (!po._receivedDate) return;
      const d = new Date(po._receivedDate.length === 10 ? po._receivedDate + 'T12:00:00' : po._receivedDate);
      if (isNaN(d.getTime())) return;
      const slot = months.find(s => s.year === d.getFullYear() && s.mon === d.getMonth());
      if (!slot) return;
      slot.delivered++;
      const effD = po._revisedDate || po._requiredDate;
      if (!effD || po._receivedDate <= effD) slot.onTime++;
    });
    return months.filter(s => s.delivered > 0).map(s => ({
      month: s.month,
      value: Math.round(s.onTime / s.delivered * 100),
    }));
  })();

  // ── Real quarterly spend (last 8 quarters) ──
  const quarterlySpend = (() => {
    const qtrs = {};
    for (let i = 7; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i * 3, 1);
      const lbl = 'Q' + (Math.floor(d.getMonth() / 3) + 1) + " '" + String(d.getFullYear()).slice(2);
      if (!qtrs[lbl]) qtrs[lbl] = { quarter: lbl, actual: 0 };
    }
    vendorRaw.forEach(po => {
      if (!po._orderDate) return;
      const d = new Date(po._orderDate.length === 10 ? po._orderDate + 'T12:00:00' : po._orderDate);
      if (isNaN(d.getTime())) return;
      const lbl = 'Q' + (Math.floor(d.getMonth() / 3) + 1) + " '" + String(d.getFullYear()).slice(2);
      if (qtrs[lbl]) qtrs[lbl].actual += po.amount / 1000;
    });
    const rows = Object.values(qtrs).filter(q => q.actual > 0);
    const avg  = rows.length ? rows.reduce((s, q) => s + q.actual, 0) / rows.length : 0;
    return rows.map(q => ({ ...q, actual: Math.round(q.actual), target: Math.round(avg * 1.05) }));
  })();

  // ── Real performance metrics ──
  const totalPOs     = vendorRaw.length;
  const delivered    = vendorRaw.filter(p => p.receivedQty >= p.purchaseQty && p.purchaseQty > 0);
  const onTimeCount  = vendorRaw.filter(p => { const e = p._revisedDate || p._requiredDate; return p._receivedDate && e && p._receivedDate <= e; }).length;
  const overdueOpen  = vendorRaw.filter(p => { const e = p._revisedDate || p._requiredDate; return !p._receivedDate && e && e < today; }).length;
  const revisedCount = vendorRaw.filter(p => p._revisedDate && p._revisedDate !== p._requiredDate).length;
  const leadTimes    = vendorRaw
    .filter(p => p._orderDate && p._receivedDate)
    .map(p => Math.round((new Date(p._receivedDate + 'T12:00:00') - new Date(p._orderDate + 'T12:00:00')) / 86400000))
    .filter(d => d > 0 && d < 365);
  const avgLead      = leadTimes.length ? Math.round(leadTimes.reduce((s, d) => s + d, 0) / leadTimes.length) : v.leadDays;
  const fullFillRate = totalPOs > 0 ? Math.round(delivered.length / totalPOs * 100) : 0;

  // ── Project breakdown ──
  const projectBreakdown = (() => {
    const m = {};
    vendorPOs.forEach(p => { m[p.project] = (m[p.project] || 0) + p.amount; });
    return Object.entries(m).map(([pid, sum], i) => {
      const proj = (window.PROJECTS || []).find(p => p.id === pid);
      return { label: pid, name: proj?.name || pid, value: sum, color: ["#1574C4","#061D39","#74C415","#AACEE8","#FFDE51"][i % 5] };
    }).sort((a, b) => b.value - a.value);
  })();

  const initials     = v.name.split(/\s+/).map(s => s[0]).join('').slice(0, 2).toUpperCase();
  const hasEmail     = v.contact && v.contact.includes('@');
  const displayEmail = hasEmail ? v.contact : null;

  return (
    <>
      {/* ── Header ── */}
      <div className="project-tile" style={{ flexWrap: 'wrap', gap: 16 }}>
        <div className="user-avatar" style={{ width: 44, height: 44, fontSize: 14, flexShrink: 0 }}>{initials}</div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div className="project-tile-id">SUPPLIER · {(v.status || 'Vendor').toUpperCase()}</div>
          <div className="project-tile-name">{v.name}</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', marginTop: 4, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {v.city && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>{Icon.pin} {v.city}</span>}
            {displayEmail && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                {Icon.mail} <a href={'mailto:' + displayEmail} style={{ color: 'inherit', textDecoration: 'none' }}>{displayEmail}</a>
              </span>
            )}
          </div>
        </div>
        <VendorPicker vendors={vendors} selected={v.name} onChange={setSelectedName} />
      </div>

      {/* ── KPIs ── */}
      <div className="kpis">
        <KPI label="Total Spend" value={fmtUSD(v.spend, true)} glyph={Icon.dollar}
          caption={v.orders + ' purchase order' + (v.orders !== 1 ? 's' : '')} />
        <KPI label="Reliability Score" value={v.score} glyph={Icon.shield}
          trend={v.score >= 88 ? 'Preferred' : v.score >= 75 ? 'Approved' : v.score >= 60 ? 'Watch' : 'Probation'}
          trendDir={v.score >= 75 ? 'up' : 'down'} caption="out of 100" />
        <KPI label="On-Time Rate" value={fmtPct(v.onTime, 1)} glyph={Icon.truck}
          trend={v.onTime >= 90 ? 'Above target' : 'Below 90%'}
          trendDir={v.onTime >= 90 ? 'up' : 'down'} caption="rolling delivered POs" />
        <KPI label="Avg Lead Time" value={avgLead} unit="days" glyph={Icon.clock}
          caption={'from ' + leadTimes.length + ' delivered PO' + (leadTimes.length !== 1 ? 's' : '')} />
      </div>

      {/* ── On-time trend + Project breakdown ── */}
      <div className="grid-2">
        <Card title="On-Time Delivery Trend"
          sub={monthlyPerf.length >= 2 ? 'Monthly % of POs received on or before required date' : 'Delivery performance from ETO received dates'}
          actions={<span className="pill info"><span className="dot"></span>90% target</span>}>
          {monthlyPerf.length >= 2 ? (
            <LineChart data={monthlyPerf} yFmt={v => v.toFixed(0) + '%'} color="#1574C4" />
          ) : (
            <div style={{ padding: '20px 0' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {[
                  { label: 'Delivered On-Time', value: onTimeCount + ' POs', sub: 'received ≤ required date', good: true },
                  { label: 'Full-Fill Rate',     value: fullFillRate + '%',    sub: 'qty received ≥ qty ordered', good: fullFillRate >= 90 },
                  { label: 'Overdue Open',       value: overdueOpen + ' POs',  sub: 'past required, not received', good: overdueOpen === 0 },
                  { label: 'Date Revisions',     value: revisedCount + ' POs', sub: 'required date was changed', good: revisedCount === 0 },
                ].map((m, i) => (
                  <div key={i} style={{ padding: '12px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-subtle)' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>{m.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-display)',
                      color: m.good ? 'var(--positive)' : 'var(--danger)' }}>{m.value}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{m.sub}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card title="Spend by Project" sub="Where this supplier's spend is concentrated">
          {projectBreakdown.length > 0 ? (
            <>
              <div style={{ marginBottom: 14 }}><StackBar segments={projectBreakdown} height={12}/></div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 200, overflowY: 'auto' }}>
                {projectBreakdown.map((p, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '12px 1fr auto', gap: 10, alignItems: 'center', fontSize: 12.5 }}>
                    <span className="legend-swatch" style={{ background: p.color }}></span>
                    <div>
                      <div style={{ fontWeight: 500 }} title={p.name}>{p.name.length > 30 ? p.name.slice(0, 30) + '…' : p.name}</div>
                      <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{p.label}</div>
                    </div>
                    <span className="legend-value">{fmtUSD(p.value, true)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>No project spend recorded.</div>
          )}
        </Card>
      </div>

      {/* ── Quarterly spend + Performance metrics ── */}
      <div className="grid-2">
        <Card title="Quarterly Procurement Spend"
          sub="Actual spend vs rolling-avg target ($K)"
          actions={
            <div className="row" style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
              <span className="row" style={{ gap: 4 }}><span className="legend-swatch" style={{ background: '#AACEE8' }}/> Avg target</span>
              <span className="row" style={{ gap: 4 }}><span className="legend-swatch" style={{ background: '#1574C4' }}/> Actual</span>
            </div>
          }>
          {quarterlySpend.length >= 2 ? (
            <DualBars data={quarterlySpend} />
          ) : (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>
              {v.spend > 0 ? 'Spend is concentrated in fewer than 2 quarters — see Order History below.' : 'No order history for this vendor.'}
            </div>
          )}
        </Card>

        <Card title="Vendor Performance Metrics" sub="Computed from ETO purchase order history">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {[
              { label: 'Total Purchase Orders',   value: totalPOs,           unit: 'POs',          good: null },
              { label: 'Fully Delivered POs',      value: delivered.length,   unit: 'of ' + totalPOs, good: delivered.length === totalPOs },
              { label: 'On-Time Deliveries',        value: onTimeCount,        unit: 'POs',          good: v.onTime >= 90 },
              { label: 'On-Time Rate',              value: fmtPct(v.onTime, 1), unit: '',            good: v.onTime >= 90 },
              { label: 'Overdue Open POs',          value: overdueOpen,        unit: 'POs',          good: overdueOpen === 0 },
              { label: 'Date Revisions',            value: revisedCount,       unit: 'POs',          good: revisedCount === 0 },
              { label: 'Avg Lead Time',             value: avgLead,            unit: 'days',         good: avgLead <= 30 },
              { label: 'Full-Fill Rate',            value: fullFillRate + '%', unit: '',             good: fullFillRate >= 90 },
            ].map((r, i, arr) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center',
                padding: '10px 0', borderBottom: i < arr.length - 1 ? '1px solid var(--divider)' : 'none' }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{r.label}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15,
                    color: r.good === null ? 'var(--text)' : r.good ? 'var(--positive)' : 'var(--danger)' }}>
                    {r.value}
                  </span>
                  {r.unit && <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{r.unit}</span>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* ── Order history ── */}
      <Card title="Order History"
        sub={'All POs · ' + v.name + ' · ' + vendorPOs.length.toLocaleString() + ' orders · ' + fmtUSD(v.spend, true) + ' total'}
        actions={<button className="btn btn-secondary" onClick={() => {
          const esc = val => { const s = String(val ?? ''); return (s.includes(',') || s.includes('"')) ? '"' + s.replace(/"/g, '""') + '"' : s; };
          const hdrs = ['PO#','Detail ID','Project','Part','Category','Qty Ordered','Qty Received','Amount','Issued','Expected','Status'];
          const csv  = [hdrs.join(','), ...vendorPOs.map(p => {
            const pts = (p.po || '').split('-');
            const base = pts.slice(0, 2).join('-');
            const det  = pts[pts.length - 1] || p.po;
            return [base, det, p.project, p.partDesc || p.partNumber || '', p.category, p.purchaseQty || '', p.receivedQty || 0, p.amount, p.issued || '', p.expected || '', p.status].map(esc).join(',');
          })].join('\n');
          const a = document.createElement('a'); a.href = 'data:text/csv,' + encodeURIComponent(csv);
          a.download = (v.name.replace(/\s+/g,'-') + '-orders.csv').toLowerCase(); a.click();
        }}>{Icon.download} Export</button>}
        bodyClass="flush">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>PO #</th>
                <th>Detail ID</th>
                <th>Project</th>
                <th>Part</th>
                <th>Category</th>
                <th className="num">Qty</th>
                <th className="num">Amount</th>
                <th>Issued</th>
                <th>Required</th>
                <th>Received</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {vendorPOs.length === 0 && (
                <tr><td colSpan="11" style={{ textAlign: 'center', padding: 32, color: 'var(--text-tertiary)' }}>No purchase orders for this vendor.</td></tr>
              )}
              {vendorPOs.slice(0, 300).map((p, i) => {
                const poParts  = (p.po || '').split('-');
                const poBase   = poParts.slice(0, 2).join('-');
                const detailId = poParts[poParts.length - 1] || p.po;
                const raw    = (window.PURCHASE_ORDERS_RAW || []).find(r => r.po === p.po) || {};
                const effDue = raw._revisedDate || raw._requiredDate;
                const isLate = raw._receivedDate && effDue && raw._receivedDate > effDue;
                return (
                  <tr key={i} style={{ background: isLate ? 'rgba(180,35,24,0.03)' : undefined }}>
                    <td className="strong" style={{ fontFamily: 'monospace', fontSize: 11.5 }}>{poBase}</td>
                    <td className="muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{detailId}</td>
                    <td className="muted" style={{ fontSize: 11.5 }}>{p.project}</td>
                    <td className="muted" style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}
                      title={p.partDesc}>{p.partDesc || p.partNumber || '—'}</td>
                    <td className="muted">{p.category}</td>
                    <td className="num" style={{ fontSize: 12 }}>
                      <span style={{ fontWeight: 600 }}>{p.receivedQty || 0}</span>
                      <span style={{ color: 'var(--text-tertiary)' }}>/{p.purchaseQty || 1}</span>
                    </td>
                    <td className="num strong">{fmtUSD(p.amount)}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{p.issued}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{p.expected || '—'}</td>
                    <td style={{ fontSize: 12 }}>
                      {raw._receivedDate
                        ? <span style={{ color: isLate ? 'var(--danger)' : 'var(--positive)', fontWeight: 600 }}>
                            {new Date(raw._receivedDate.length === 10 ? raw._receivedDate + 'T12:00:00' : raw._receivedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            {isLate && ' ⚠'}
                          </span>
                        : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                    </td>
                    <td><StatusPill s={p.status}/></td>
                  </tr>
                );
              })}
              {vendorPOs.length > 300 && (
                <tr><td colSpan="11" style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: '10px', fontSize: 12 }}>
                  Showing 300 of {vendorPOs.length.toLocaleString()} POs
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
};

window.VendorAnalyzer = VendorAnalyzer;
