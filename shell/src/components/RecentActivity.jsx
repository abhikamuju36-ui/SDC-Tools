/** Recent activity panel — shows last N app-open events logged by App.jsx */

const APP_COLOR = {
  assemblies: '#1574C4',
  readiness:  '#16a34a',
  scheduler:  '#FFDE51',
  statelogic: '#ea580c',
  calendar:   '#74C415',
}

function timeLabel(ts) {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (m < 1) return 'just now'
  if (h < 1) return `${m}m ago`
  if (h < 24) {
    const date = new Date(ts)
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }
  if (d === 1) return 'Yesterday'
  return `${d}d ago`
}

function ActivityGlyph({ type }) {
  if (type === 'open')
    return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3 6 H9 M6.5 3.5 L9 6 L6.5 8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
  if (type === 'sync')
    return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true"><path d="M2 6 a4 4 0 1 1 1.3 3" /><path d="M2 2 L2 5 L5 5" /></svg>
  if (type === 'done')
    return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6.5 L5 8.5 L9 4" /></svg>
  if (type === 'export')
    return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8 V2 M3.5 4.5 L6 2 L8.5 4.5" /><path d="M3 9 H9" /></svg>
  if (type === 'add')
    return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M6 3 V9 M3 6 H9" /></svg>
  // default: open arrow
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3 6 H9 M6.5 3.5 L9 6 L6.5 8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

export default function RecentActivity({ activity, apps }) {
  const visible = activity.slice(0, 8)

  if (visible.length === 0) {
    return (
      <div className="activity-empty">
        No recent activity — open an app to get started.
      </div>
    )
  }

  return (
    <div className="activity-list">
      {visible.map(item => {
        const color = APP_COLOR[item.appId] || '#94a3b8'
        return (
          <div key={item.id} className="activity-item">
            <div className="activity-icon" style={{ background: `${color}22`, color }}>
              <ActivityGlyph type={item.type || 'open'} />
            </div>
            <div className="activity-body">
              <span className="activity-label">{item.label}</span>
              <span className="activity-meta">
                {item.appName}
                <span className="activity-time">{timeLabel(item.ts)}</span>
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
