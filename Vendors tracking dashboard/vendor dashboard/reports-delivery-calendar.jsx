/* Delivery Calendar — month grid view of all expected POs */

const DeliveryCalendarReport = () => {
  const rawPos = window.PURCHASE_ORDERS_RAW || [];
  const now    = new Date();

  const [year,        setYear]        = React.useState(now.getFullYear());
  const [month,       setMonth]       = React.useState(now.getMonth());
  const [selectedDay, setSelectedDay] = React.useState(null);
  const todayStr = now.toISOString().split('T')[0];

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else             setMonth(m => m - 1);
    setSelectedDay(null);
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else              setMonth(m => m + 1);
    setSelectedDay(null);
  }

  const monthName   = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Build a map: dateStr → POs expected
  const poByDay = {};
  rawPos.forEach(po => {
    const due = po._revisedDate || po._requiredDate;
    if (!due) return;
    const d = new Date(due);
    if (isNaN(d.getTime())) return;
    if (d.getFullYear() === year && d.getMonth() === month) {
      if (!poByDay[due]) poByDay[due] = [];
      poByDay[due].push(po);
    }
  });

  function dayStr(day) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function dayStatus(ds, pos) {
    if (!pos || pos.length === 0) return 'empty';
    if (ds < todayStr) {
      const openPos = pos.filter(p => p.status !== 'Received');
      return openPos.length > 0 ? 'overdue' : 'delivered';
    }
    if (ds === todayStr) return 'today';
    const diff = Math.round((new Date(ds) - now) / 86400000);
    if (diff <= 3) return 'soon';
    return 'normal';
  }

  const STATUS_STYLE = {
    empty:     { bg: 'transparent', border: 'var(--border)', text: 'var(--text-tertiary)', badge: null },
    delivered: { bg: 'rgba(116,196,21,0.05)', border: 'rgba(116,196,21,0.18)', text: 'var(--text-tertiary)', badge: '#74C415' },
    overdue:   { bg: 'rgba(180,35,24,0.07)', border: 'rgba(180,35,24,0.25)', text: 'var(--danger)', badge: '#B42318' },
    today:     { bg: 'rgba(21,116,196,0.08)', border: 'var(--sdc-blue)', text: 'var(--sdc-blue)', badge: '#1574C4' },
    soon:      { bg: 'rgba(232,160,32,0.07)', border: 'rgba(232,160,32,0.3)', text: '#B87D10', badge: '#E8A020' },
    normal:    { bg: 'rgba(116,196,21,0.05)', border: 'rgba(116,196,21,0.2)', text: 'var(--positive)', badge: '#74C415' },
  };

  // KPIs for this month
  const monthPos    = Object.values(poByDay).flat();
  const overduePos  = monthPos.filter(po => (po._revisedDate || po._requiredDate) < todayStr && po.status !== 'Received');
  const todayPos    = poByDay[todayStr] || [];
  const upcomingPos = monthPos.filter(po => {
    const d = po._revisedDate || po._requiredDate;
    return d >= todayStr && d <= (() => { const x = new Date(now); x.setDate(x.getDate() + 7); return x.toISOString().split('T')[0]; })();
  });

  const selectedPos = selectedDay ? (poByDay[selectedDay] || []) : [];

  // Upcoming 14-day list (outside calendar)
  const upcoming14 = rawPos.filter(po => {
    const due = po._revisedDate || po._requiredDate;
    if (!due) return false;
    const plus14 = new Date(now); plus14.setDate(plus14.getDate() + 14);
    return due >= todayStr && due <= plus14.toISOString().split('T')[0];
  }).sort((a, b) => (a._revisedDate || a._requiredDate).localeCompare(b._revisedDate || b._requiredDate));

  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <>
      <div className="kpis">
        <KPI label="Overdue This Month" value={overduePos.length} glyph={Icon.alert}
          trendDir={overduePos.length > 0 ? 'down' : 'up'} caption="past due, not received" />
        <KPI label="Due Today" value={todayPos.length} glyph={Icon.calendar}
          trendDir="flat" caption="expected deliveries" />
        <KPI label="Due Next 7 Days" value={upcomingPos.length} glyph={Icon.truck}
          caption="upcoming this week" />
        <KPI label="Total This Month" value={monthPos.length} glyph={Icon.package}
          caption={fmtUSD(monthPos.reduce((s, p) => s + (p.amount || 0), 0), true) + ' value'} />
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 12, fontSize: 12, color: 'var(--text-tertiary)', alignItems: 'center', flexWrap: 'wrap' }}>
        <span>Legend:</span>
        {[['Overdue (open)','#B42318'], ['Due Today','#1574C4'], ['Due Soon (≤3d)','#E8A020'], ['Scheduled','#74C415'], ['Delivered','#74C415']].map(([l, c]) => (
          <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: 'inline-block', opacity: 0.8 }} />
            {l}
          </span>
        ))}
      </div>

      {/* Calendar card */}
      <Card bodyClass="flush">
        {/* Month header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
          <button onClick={prevMonth} style={{ background: 'none', border: '1px solid var(--border)',
            borderRadius: 7, padding: '5px 10px', cursor: 'pointer', color: 'var(--text)', display: 'flex', alignItems: 'center' }}>
            {Icon.chevLeft}
          </button>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, letterSpacing: 0.5 }}>
            {monthName}
          </span>
          <button onClick={nextMonth} style={{ background: 'none', border: '1px solid var(--border)',
            borderRadius: 7, padding: '5px 10px', cursor: 'pointer', color: 'var(--text)', display: 'flex', alignItems: 'center' }}>
            {Icon.chevRight}
          </button>
        </div>

        <div style={{ padding: '0 16px 16px' }}>
          {/* Day-of-week headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4, marginTop: 12 }}>
            {DOW.map(d => (
              <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700,
                color: 'var(--text-tertiary)', fontFamily: 'var(--font-display)', letterSpacing: 0.5, padding: '4px 0' }}>
                {d}
              </div>
            ))}
          </div>

          {/* Calendar cells */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {/* Leading empty cells */}
            {Array(firstDay).fill(null).map((_, i) => <div key={'e' + i} />)}

            {Array(daysInMonth).fill(null).map((_, i) => {
              const day = i + 1;
              const ds  = dayStr(day);
              const pos = poByDay[ds] || [];
              const st  = dayStatus(ds, pos);
              const style = STATUS_STYLE[st];
              const isSelected = selectedDay === ds;
              return (
                <div key={day} onClick={() => setSelectedDay(isSelected ? null : ds)}
                  style={{
                    minHeight: 64, borderRadius: 8, padding: '6px 8px',
                    background: isSelected ? 'rgba(21,116,196,0.12)' : style.bg,
                    border: `1px solid ${isSelected ? 'var(--sdc-blue)' : style.border}`,
                    cursor: pos.length > 0 ? 'pointer' : 'default',
                    transition: 'all 0.12s',
                    boxShadow: isSelected ? '0 0 0 2px rgba(21,116,196,0.25)' : undefined,
                  }}>
                  <div style={{ fontSize: 12, fontWeight: ds === todayStr ? 800 : 500,
                    color: ds === todayStr ? 'var(--sdc-blue)' : 'var(--text)',
                    marginBottom: 4 }}>
                    {day}
                    {ds === todayStr && <span style={{ fontSize: 9, marginLeft: 3, color: 'var(--sdc-blue)', fontWeight: 700 }}>TODAY</span>}
                  </div>
                  {pos.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '2px 6px', borderRadius: 4, fontSize: 10.5, fontWeight: 700,
                        background: style.badge, color: '#fff', alignSelf: 'flex-start' }}>
                        {pos.length} PO{pos.length !== 1 ? 's' : ''}
                      </span>
                      {pos.slice(0, 2).map((po, j) => (
                        <div key={j} style={{ fontSize: 9.5, color: 'var(--text-tertiary)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={po.vendor}>
                          {po.vendor?.split(' ').slice(0, 2).join(' ')}
                        </div>
                      ))}
                      {pos.length > 2 && <div style={{ fontSize: 9.5, color: 'var(--text-tertiary)' }}>+{pos.length - 2} more</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Selected day detail */}
      {selectedDay && selectedPos.length > 0 && (
        <Card
          title={`Deliveries for ${new Date(selectedDay + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`}
          sub={`${selectedPos.length} PO${selectedPos.length !== 1 ? 's' : ''} · ${fmtUSD(selectedPos.reduce((s, p) => s + (p.amount || 0), 0), true)} total value`}
          actions={<button onClick={() => setSelectedDay(null)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, color: 'var(--text-tertiary)' }}>✕ Close</button>}
          bodyClass="flush">
          <div className="table-wrap">
            <table className="data" style={{ fontSize: 12 }}>
              <thead>
                <tr><th>PO #</th><th>Project</th><th>Vendor</th><th>Part</th><th className="num">Amount</th><th>Required</th><th>Revised</th><th>Status</th></tr>
              </thead>
              <tbody>
                {selectedPos.map((po, i) => {
                  const isLate = selectedDay < todayStr;
                  return (
                    <tr key={i} style={{ background: isLate ? 'rgba(180,35,24,0.04)' : undefined }}>
                      <td className="strong" style={{ fontFamily: 'monospace', fontSize: 11.5 }}>{po.po}</td>
                      <td className="muted">{po.project}</td>
                      <td>{po.vendor}</td>
                      <td className="muted" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={po.partDesc}>{po.partDesc || po.partNumber || '—'}</td>
                      <td className="num strong">{fmtUSD(po.amount)}</td>
                      <td className="muted">{po._requiredDate ? new Date(po._requiredDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</td>
                      <td>{po._revisedDate && po._revisedDate !== po._requiredDate
                        ? <span style={{ color: '#8a6700', fontWeight: 600, fontSize: 11 }}>{new Date(po._revisedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ▲</span>
                        : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                      </td>
                      <td><StatusPill s={po.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Upcoming 14-day list */}
      {upcoming14.length > 0 && (
        <Card title="Next 14 Days — Upcoming Deliveries"
          sub={`${upcoming14.length} POs expected · ${fmtUSD(upcoming14.reduce((s, p) => s + (p.amount || 0), 0), true)} total`}
          bodyClass="flush">
          <div className="table-wrap">
            <table className="data" style={{ fontSize: 12 }}>
              <thead>
                <tr><th>Due Date</th><th>PO #</th><th>Project</th><th>Vendor</th><th>Part</th><th className="num">Amount</th><th>Status</th></tr>
              </thead>
              <tbody>
                {upcoming14.map((po, i) => {
                  const due = po._revisedDate || po._requiredDate;
                  const diff = Math.round((new Date(due) - now) / 86400000);
                  return (
                    <tr key={i}>
                      <td>
                        <div style={{ fontWeight: 700, fontSize: 12, color: diff <= 1 ? 'var(--warning)' : 'var(--text)' }}>
                          {new Date(due + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                        </div>
                        <div style={{ fontSize: 10.5, color: diff === 0 ? 'var(--sdc-blue)' : diff <= 2 ? 'var(--warning)' : 'var(--text-tertiary)' }}>
                          {diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : `In ${diff} days`}
                        </div>
                      </td>
                      <td className="strong" style={{ fontFamily: 'monospace', fontSize: 11.5 }}>{po.po}</td>
                      <td className="muted">{po.project}</td>
                      <td>{po.vendor}</td>
                      <td className="muted" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={po.partDesc}>{po.partDesc || po.partNumber || '—'}</td>
                      <td className="num strong">{fmtUSD(po.amount)}</td>
                      <td><StatusPill s={po.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
};

window.DeliveryCalendarReport = DeliveryCalendarReport;
