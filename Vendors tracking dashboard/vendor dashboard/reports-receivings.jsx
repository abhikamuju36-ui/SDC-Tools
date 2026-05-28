/* Receivings Log Report */

const ReceivingsLogReport = () => {
  const orders = (window.ORDERS || []).filter(o => o.status === 'Received' || o.status === 'received');

  const fmt     = v => '$' + (v >= 1_000_000 ? (v / 1_000_000).toFixed(1) + 'M' : v >= 1_000 ? (v / 1_000).toFixed(0) + 'K' : v.toFixed(0));
  const today   = new Date();

  const withDays = orders.map(o => {
    const due     = o.dueDate   ? new Date(o.dueDate)   : null;
    const ordered = o.orderDate ? new Date(o.orderDate) : null;
    const daysDue = due ? Math.round((today - due)   / 86400000) : null;
    const leadDays= (due && ordered) ? Math.round((due - ordered) / 86400000) : null;
    const urgency = daysDue === null ? 'unknown' : daysDue > 7 ? 'overdue' : daysDue >= 0 ? 'recent' : 'upcoming';
    return { ...o, daysDue, leadDays, urgency };
  }).sort((a, b) => (b.daysDue || 0) - (a.daysDue || 0));

  const groups = { overdue: [], recent: [], upcoming: [], unknown: [] };
  withDays.forEach(o => groups[o.urgency].push(o));

  const totalReceived  = orders.length;
  const totalValue     = orders.reduce((s, o) => s + (o.amount || 0), 0);
  const overdueCount   = groups.overdue.length;

  const URGENCY_LABEL  = { overdue: 'Overdue', recent: 'Recent (≤7 days)', upcoming: 'Upcoming', unknown: 'No date' };
  const URGENCY_COLOR  = { overdue: '#ef4444', recent: '#22c55e', upcoming: '#1574C4', unknown: '#7a9ab8' };

  const Row = ({ o }) => (
    <tr style={{ borderBottom: '1px solid var(--border, rgba(255,255,255,0.05))' }}>
      <td style={{ padding: '10px 16px', color: 'var(--text-primary, #fff)', fontFamily: 'monospace', fontSize: 12 }}>{o.id}</td>
      <td style={{ padding: '10px 16px', color: 'var(--text-secondary, #aacee8)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.vendorName}</td>
      <td style={{ padding: '10px 16px', color: 'var(--text-secondary, #aacee8)', textAlign: 'right' }}>{fmt(o.amount || 0)}</td>
      <td style={{ padding: '10px 16px', color: 'var(--text-secondary, #aacee8)', textAlign: 'center', fontSize: 12 }}>{o.dueDate || '—'}</td>
      <td style={{ padding: '10px 16px', textAlign: 'center', fontSize: 12, color: 'var(--text-secondary, #aacee8)' }}>{o.leadDays != null ? `${o.leadDays}d` : '—'}</td>
    </tr>
  );

  const Section = ({ key: k, items, label, color }) => items.length === 0 ? null : (
    <div style={{
      background: 'var(--surface-2, #0d2a4a)',
      border: '1px solid var(--border, rgba(255,255,255,0.08))',
      borderRadius: 12, overflow: 'hidden',
    }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border, rgba(255,255,255,0.08))', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary, #fff)' }}>{label}</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-tertiary, #7a9ab8)' }}>{items.length} PO{items.length !== 1 ? 's' : ''}</span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border, rgba(255,255,255,0.06))' }}>
            {['PO #', 'Vendor', 'Amount', 'Due Date', 'Lead Time'].map(h => (
              <th key={h} style={{ padding: '8px 16px', textAlign: h === 'Amount' ? 'right' : h === 'Due Date' || h === 'Lead Time' ? 'center' : 'left', color: 'var(--text-tertiary, #7a9ab8)', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((o, i) => <Row key={i} o={o} />)}
        </tbody>
      </table>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {[
          { label: 'Total Received',   value: totalReceived,    sub: 'completed POs' },
          { label: 'Total Value',      value: fmt(totalValue),  sub: 'received goods' },
          { label: 'Late Deliveries',  value: overdueCount,     sub: 'past due date' },
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

      {orders.length === 0 ? (
        <div style={{
          background: 'var(--surface-2, #0d2a4a)',
          border: '1px solid var(--border, rgba(255,255,255,0.08))',
          borderRadius: 12, padding: 48, textAlign: 'center', color: 'var(--text-tertiary, #7a9ab8)',
        }}>
          No received POs found.
        </div>
      ) : (
        <>
          {['overdue','recent','upcoming','unknown'].map(key => (
            <Section key={key} items={groups[key]} label={URGENCY_LABEL[key]} color={URGENCY_COLOR[key]} />
          ))}
        </>
      )}
    </div>
  );
};
