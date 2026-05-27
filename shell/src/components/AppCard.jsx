import AppLogo from './AppLogos'

// Apps that have dedicated upstream updaters with a manual trigger
const UPDATABLE_APPS = { readiness: true, scheduler: true, statelogic: true }

function timeAgo(ts) {
  if (!ts) return null
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  if (h < 24) return `${h}h ago`
  if (d === 1) return 'Yesterday'
  return `${d}d ago`
}

export default function AppCard({ app, lastOpened }) {
  const { id, name, description, status, color } = app
  const openedAgo = timeAgo(lastOpened?.[id])

  const statusLabels = {
    starting: 'Starting…',
    running:  'Running',
    error:    'Error',
    stopped:  'Stopped',
    update:   'Update ready',
  }

  return (
    <div
      className="app-card"
      style={{ '--card-accent': color }}
      tabIndex={0}
      role="article"
      aria-label={`${name} — ${statusLabels[status] ?? status}`}
    >
      {/* Colored top stripe */}
      <div className="card-accent" />

      <div className="card-body">

        {/* Icon + name + shortcut */}
        <div className="card-top">
          <div className="card-logo" aria-hidden="true">
            <AppLogo appId={id} size={44} />
          </div>
          <div className="card-info">
            <div className="card-name-row">
              <h2 className="card-name">{name}</h2>
              {UPDATABLE_APPS[id] && (
                <span className="card-update-flag">UPDATE</span>
              )}
            </div>
          </div>
        </div>

        {/* Description */}
        {description && <p className="card-desc">{description}</p>}

        {/* Last opened — sits above footer with dashed top border */}
        <div className="card-meta">
          {openedAgo && <span className="card-last-opened">Last opened {openedAgo}</span>}
        </div>

      </div>

      {/* Sunken footer */}
      <div className="card-footer">
        <div className={`status-pill status-${status}`}>
          <span className="status-dot" aria-hidden="true" />
          <span className="status-label">{statusLabels[status] ?? status}</span>
        </div>

      </div>
    </div>
  )
}
