/* Receivings Log Report */

const ReceivingsLogReport = () => {
  const rawPos = window.PURCHASE_ORDERS_RAW || [];
  const today  = new Date();

  // Only show received POs
  const received = rawPos.filter(o => o.status === 'Received');

  const fmtD = dateStr => {
    if (!dateStr) return '—';
    const d = new Date(dateStr.length === 10 ? dateStr + 'T12:00:00' : dateStr);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const fmt = v => '$' + (v >= 1_000_000 ? (v / 1_000_000).toFixed(1) + 'M'
    : v >= 1_000 ? (v / 1_000).toFixed(0) + 'K' : v.toFixed(0));

  const withMeta = received.map(o => {
    // Use revised date when set — supersedes original required date
    const effDue   = o._revisedDate || o._requiredDate;
    const dueD     = effDue        ? new Date(effDue        + 'T12:00:00') : null;
    const recvD    = o._receivedDate ? new Date(o._receivedDate + 'T12:00:00') : null;
    const orderD   = o._orderDate   ? new Date(o._orderDate   + 'T12:00:00') : null;

    // daysDelta > 0 = received N days LATE; < 0 = received N days EARLY
    const daysDelta = (dueD && recvD) ? Math.round((recvD - dueD) / 86400000) : null;
    // Lead time = order → receipt
    const leadDays  = (orderD && recvD) ? Math.round((recvD - orderD) / 86400000) : null;

    const urgency = daysDelta === null ? 'unknown'
      : daysDelta > 0 ? 'late'
      : 'ontime';

    return { ...o, effDue, daysDelta, leadDays, urgency };
  }).sort((a, b) => (b.daysDelta || 0) - (a.daysDelta || 0));

  const groups = { late: [], ontime: [], unknown: [] };
  withMeta.forEach(o => groups[o.urgency].push(o));

  const lateCount   = groups.late.length;
  const onTimeCount = groups.ontime.length;
  const totalValue  = received.reduce((s, o) => s + (o.amount || 0), 0);

  const LABEL = { late: 'Received Late', ontime: 'Received On-Time / Early', unknown: 'No Date Info' };
  const COLOR = { late: 'var(--danger)', ontime: 'var(--positive)', unknown: 'var(--text-tertiary)' };

  const Row = ({ o }) => (
    <tr>
      <td style={{ fontFamily: 'monospace', fontSize: 11.5 }}>{o.po}</td>
      <td className="muted" style={{ fontSize: 12 }}>{o.project}</td>
      <td>{o.vendor}</td>
      <td className="muted" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}
        title={o.partDesc}>{o.partDesc || o.partNumber || '—'}</td>
      <td className="num strong">{fmt(o.amount || 0)}</td>
      <td className="muted">{fmtD(o._orderDate)}</td>
      <td className="muted">
        {fmtD(o.effDue)}
        {o._revisedDate && o._revisedDate !== o._requiredDate && (
          <span style={{ marginLeft: 4, fontSize: 10, color: 'var(--warning)', fontWeight: 600 }} title="Date was revised">▲</span>
        )}
      </td>
      <td className="muted">{fmtD(o._receivedDate)}</td>
      <td style={{ textAlign: 'center' }}>
        {o.daysDelta === null ? (
          <span style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>—</span>
        ) : o.daysDelta > 0 ? (
          <span style={{ color: 'var(--danger)', fontWeight: 700, fontSize: 12 }}>+{o.daysDelta}d late</span>
        ) : o.daysDelta === 0 ? (
          <span style={{ color: 'var(--positive)', fontWeight: 600, fontSize: 12 }}>On time</span>
        ) : (
          <span style={{ color: 'var(--positive)', fontWeight: 600, fontSize: 12 }}>{Math.abs(o.daysDelta)}d early</span>
        )}
      </td>
      <td className="muted" style={{ textAlign: 'center' }}>{o.leadDays != null ? `${o.leadDays}d` : '—'}</td>
    </tr>
  );

  const Section = ({ urgency, items }) => {
    if (items.length === 0) return null;
    return (
      <Card title={LABEL[urgency]}
        sub={`${items.length} PO${items.length !== 1 ? 's' : ''}`}
        bodyClass="flush"
        actions={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: COLOR[urgency], display: 'inline-block' }} />
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{LABEL[urgency]}</span>
          </span>
        }>
        <div className="table-wrap">
          <table className="data" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th>PO #</th>
                <th>Project</th>
                <th>Vendor</th>
                <th>Part</th>
                <th className="num">Amount</th>
                <th>Ordered</th>
                <th>Due Date</th>
                <th>Received</th>
                <th style={{ textAlign: 'center' }}>Variance</th>
                <th style={{ textAlign: 'center' }}>Lead Time</th>
              </tr>
            </thead>
            <tbody>
              {items.slice(0, 200).map((o, i) => <Row key={i} o={o} />)}
              {items.length > 200 && (
                <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: '10px', fontSize: 12 }}>
                  Showing 200 of {items.length.toLocaleString()} POs
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    );
  };

  return (
    <>
      {/* KPI row */}
      <div className="kpis">
        <KPI label="Total Received" value={received.length.toLocaleString()} glyph={Icon.check}
          caption="completed POs" />
        <KPI label="Total Value" value={fmt(totalValue)} glyph={Icon.dollar}
          caption="goods received" />
        <KPI label="Received On-Time" value={onTimeCount} glyph={Icon.truck}
          trendDir={received.length > 0 && onTimeCount / received.length >= 0.9 ? 'up' : 'down'}
          caption={received.length > 0 ? `${Math.round(onTimeCount / received.length * 100)}% fill rate` : 'no data'} />
        <KPI label="Received Late" value={lateCount} glyph={Icon.alert}
          trendDir={lateCount > 0 ? 'down' : 'up'}
          caption="past effective due date" />
      </div>

      {received.length === 0 ? (
        <Card title="Receivings Log" sub="No received POs in current period">
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
            No received POs found. Try changing the date filter.
          </div>
        </Card>
      ) : (
        <>
          <Section urgency="late"    items={groups.late}    />
          <Section urgency="ontime"  items={groups.ontime}  />
          <Section urgency="unknown" items={groups.unknown} />
        </>
      )}
    </>
  );
};

window.ReceivingsLogReport = ReceivingsLogReport;
