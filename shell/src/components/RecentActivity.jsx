/** Recent activity panel — shows last N app-open events logged by App.jsx */

const APP_COLOR = {
  assemblies: '#1574C4',
  readiness:  '#16a34a',
  scheduler:  '#FFDE51',
  statelogic: '#ea580c',
  calendar:   '#74C415',
  vendor:     '#1574C4',
}

// Determine icon color class based on app color
function colorClass(appId) {
  if (appId === 'readiness' || appId === 'calendar') return 'green'
  if (appId === 'scheduler') return 'yellow'
  if (appId === 'statelogic') return 'red'
  return ''  // default blue tint
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
    return (
      <svg width="13" height="13" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M3 6 H9 M6.5 3.5 L9 6 L6.5 8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  if (type === 'sync')
    return (
      <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
        <path d="M2 6 a4 4 0 1 1 1.3 3" /><path d="M2 2 L2 5 L5 5" />
      </svg>
    )
  if (type === 'done')
    return (
      <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 6.5 L5 8.5 L9 4" />
      </svg>
    )
  if (type === 'export')
    return (
      <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 8 V2 M3.5 4.5 L6 2 L8.5 4.5" /><path d="M3 9 H9" />
      </svg>
    )
  if (type === 'add')
    return (
      <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
        <path d="M6 3 V9 M3 6 H9" />
      </svg>
    )
  // default: open arrow
  return (
    <svg width="13" height="13" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M3 6 H9 M6.5 3.5 L9 6 L6.5 8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Seed items shown when there is no real activity yet
const SEED_ACTIVITY = [
  { id: 's1', type: 'open',   appId: 'assemblies', appName: 'Assemblies Library',    label: 'Opened Assemblies Library',    ts: Date.now() - 5  * 60000 },
  { id: 's2', type: 'sync',   appId: 'scheduler',  appName: 'Project Scheduler',         label: 'Smartsheet sync completed',    ts: Date.now() - 22 * 60000 },
  { id: 's3', type: 'done',   appId: 'readiness',  appName: 'Build Readiness Report', label: 'Report generated — P-48291',  ts: Date.now() - 48 * 60000 },
  { id: 's4', type: 'open',   appId: 'vendor',     appName: 'Vendor Tracker',         label: 'Opened Vendor Tracker',       ts: Date.now() - 2  * 3600000 },
  { id: 's5', type: 'export', appId: 'statelogic', appName: 'State Logic Builder',    label: 'Exported L5X — PUMP_CTRL',    ts: Date.now() - 5  * 3600000 },
]

export default function RecentActivity({ activity, apps }) {
  const source  = activity.length > 0 ? activity : SEED_ACTIVITY
  const visible = source.slice(0, 8)

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
        const cls = colorClass(item.appId)
        return (
          <div key={item.id} className="activity-item">
            <div className={`activity-icon${cls ? ' ' + cls : ''}`}>
              <ActivityGlyph type={item.type || 'open'} />
            </div>
            <div className="activity-body">
              <span className="activity-label">{item.label}</span>
              <span className="activity-meta">{item.appName}</span>
            </div>
            <span className="activity-time">{timeLabel(item.ts)}</span>
          </div>
        )
      })}
    </div>
  )
}
