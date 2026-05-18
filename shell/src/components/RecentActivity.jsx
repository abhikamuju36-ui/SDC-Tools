/** Recent activity panel — shows last N app-open events logged by App.jsx */

const APP_COLOR = {
  assemblies: '#1574C4',
  readiness:  '#74C415',
  scheduler:  '#F59E0B',
  statelogic: '#E07B39',
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

export default function RecentActivity({ activity, apps }) {
  const visible = activity.slice(0, 5)

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
            <span className="activity-dot" style={{ background: color }} />
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
