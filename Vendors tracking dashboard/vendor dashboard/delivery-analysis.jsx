/* delivery-analysis.jsx
   Delivery Analysis sub-tab — shows Required Date vs Order Date vs Revised Date vs Received Date
   per PO line. Highlights date revisions and overdue items. */

const DeliveryAnalysis = ({ projectIds }) => {
  const allRaw = window.PURCHASE_ORDERS_RAW || window.PURCHASE_ORDERS || [];

  // Filter to selected projects
  const ids = (projectIds || []).map(id => id.startsWith('P-') ? id : 'P-' + id);
  const rows = ids.length > 0
    ? allRaw.filter(po => ids.includes(po.project) || ids.includes('P-' + po.project))
    : allRaw;

  const today = new Date().toISOString().split('T')[0];

  function fmtD(d) {
    if (!d) return <span style={{ color: 'var(--text-tertiary)' }}>—</span>;
    const dt = new Date(d);
    if (isNaN(dt)) return <span style={{ color: 'var(--text-tertiary)' }}>—</span>;
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  }

  function dateChip(d, baseDate, isReceived) {
    if (!d) return <span style={{ color: 'var(--text-tertiary)' }}>—</span>;
    if (isReceived) {
      // Compare to required: green if on time, red if late
      const late = baseDate && d > baseDate;
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '2px 8px', borderRadius: 4, fontSize: 11.5, fontWeight: 600,
          background: late ? 'rgba(180,35,24,0.1)' : 'rgba(116,196,21,0.13)',
          color: late ? 'var(--danger)' : 'var(--positive)' }}>
          {fmtD(d)}
          {late && <span title="Received after required date">⚠</span>}
        </span>
      );
    }
    return fmtD(d);
  }

  // Stats
  const total     = rows.length;
  const revised   = rows.filter(r => r._revisedDate && r._revisedDate !== r._requiredDate).length;
  const late      = rows.filter(r => r._receivedDate && r._requiredDate && r._receivedDate > r._requiredDate).length;
  const pending   = rows.filter(r => !r._receivedDate && r._requiredDate && r._requiredDate < today).length;
  const onTime    = rows.filter(r => r._receivedDate && r._requiredDate && r._receivedDate <= r._requiredDate).length;

  return (
    <>
      {/* KPI strip */}
      <div className="kpis" style={{ marginBottom: 16 }}>
        <KPI label="PO Lines" value={total.toLocaleString()} glyph={Icon.file} caption="in selection" />
        <KPI label="Date Revisions" value={revised} glyph={Icon.calendar}
          caption="required date changed" trendDir={revised > 0 ? 'down' : 'up'} />
        <KPI label="Received On-Time" value={onTime} glyph={Icon.check}
          caption={`of ${rows.filter(r=>r._receivedDate).length} delivered`} trendDir="up" />
        <KPI label="Overdue Pending" value={pending} glyph={Icon.clock}
          caption="not yet received" trendDir={pending > 0 ? 'down' : 'up'} />
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 12, color: 'var(--text-tertiary)', alignItems: 'center' }}>
        <span>Legend:</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(180,35,24,0.15)', display:'inline-block' }}></span>
          Received late
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(116,196,21,0.2)', display:'inline-block' }}></span>
          Received on time
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(255,222,81,0.3)', display:'inline-block' }}></span>
          Date was revised
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(180,35,24,0.1)', display:'inline-block' }}></span>
          Overdue &amp; pending
        </span>
      </div>

      <Card title="Date Tracking — Order · Required · Revised · Received"
        sub={`${total.toLocaleString()} lines · ${revised} with revised dates · ${late} delivered late`}
        bodyClass="flush">
        <div className="table-wrap">
          <table className="data" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th>PO #</th>
                <th>Project</th>
                <th>Vendor</th>
                <th>Part</th>
                <th style={{ textAlign: 'right' }}>Qty</th>
                <th>Order Date</th>
                <th>Required Date</th>
                <th>Revised Date</th>
                <th>Received Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 500).map((po, i) => {
                const hasRevision  = po._revisedDate && po._revisedDate !== po._requiredDate;
                const isLate       = po._receivedDate && po._requiredDate && po._receivedDate > po._requiredDate;
                const isOverduePending = !po._receivedDate && po._requiredDate && po._requiredDate < today;
                const rowBg = isLate
                  ? 'rgba(180,35,24,0.04)'
                  : isOverduePending
                    ? 'rgba(255,100,0,0.04)'
                    : hasRevision
                      ? 'rgba(255,222,81,0.07)'
                      : undefined;
                return (
                  <tr key={i} style={{ background: rowBg }}>
                    <td className="strong" style={{ fontFamily: 'monospace', fontSize: 11.5 }}>
                      {po.po}
                    </td>
                    <td className="muted">{po.project}</td>
                    <td>{po.vendor}</td>
                    <td className="muted" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={po.partDesc}>{po.partDesc || po.partNumber || '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <span style={{ fontWeight: 600 }}>{po.receivedQty || 0}</span>
                      <span style={{ color: 'var(--text-tertiary)' }}>/{po.purchaseQty || 1}</span>
                    </td>
                    <td className="muted">{fmtD(po._orderDate)}</td>
                    <td>{po._requiredDate ? fmtD(po._requiredDate) : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}</td>
                    <td>
                      {hasRevision ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '2px 7px', borderRadius: 4,
                          background: 'rgba(255,222,81,0.2)', color: '#8a6700', fontSize: 11.5, fontWeight: 600 }}>
                          {fmtD(po._revisedDate)}
                          <span title="Date was revised from original required date" style={{ fontSize: 10 }}>▲</span>
                        </span>
                      ) : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                    </td>
                    <td>{dateChip(po._receivedDate, po._revisedDate || po._requiredDate, true)}</td>
                    <td><StatusPill s={po.status} /></td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan="10" style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 32 }}>
                  No PO lines for selected projects.
                </td></tr>
              )}
              {rows.length > 500 && (
                <tr><td colSpan="10" style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: '10px 16px', fontSize: 12 }}>
                  Showing 500 of {rows.length.toLocaleString()} rows — filter by project to narrow down.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
};

window.DeliveryAnalysis = DeliveryAnalysis;
