import AppLogo from './AppLogos'

const SHORTCUT_INDEX = { assemblies: 1, readiness: 2, scheduler: 3, statelogic: 4, calendar: 5 }

/** Returns true if a hex color is light enough to need dark text */
function isLight(hex) {
  if (!hex || hex[0] !== '#') return false
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62
}

function timeAgo(ts) {
  if (!ts) return null
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  if (h < 24) return `${h} h ago`
  if (d === 1) return 'Yesterday'
  return `${d} d ago`
}

export default function AppCard({ app, lastOpened, onOpen, onRetry, onShowLogs }) {
  const { id, name, description, status, color, port } = app
  const shortcut  = SHORTCUT_INDEX[id]
  const openedAgo = timeAgo(lastOpened?.[id])

  const statusLabels = { starting: 'Starting…', running: 'Running', error: 'Error', stopped: 'Stopped' }

  const btnStyle = color
    ? { background: color, color: isLight(color) ? '#1a1a1a' : '#ffffff', borderColor: 'transparent' }
    : {}

  const handleKeyDown = (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && status === 'running') {
      e.preventDefault()
      onOpen(id)
    }
  }

  return (
    <div
      className="app-card"
      style={{ '--card-accent': color }}
      tabIndex={0}
      role="article"
      aria-label={`${name} — ${statusLabels[status] ?? status}`}
      onKeyDown={handleKeyDown}
    >
      <div className="card-accent" />
      <div className="card-body">

        {/* Icon + name + shortcut row */}
        <div className="card-top">
          <div className="card-logo" aria-hidden="true">
            <AppLogo appId={id} size={44} />
          </div>
          <div className="card-info">
            <h2 className="card-name">{name}</h2>
            {shortcut && (
              <span className="card-shortcut">Ctrl + {shortcut}</span>
            )}
          </div>
        </div>

        {/* Description */}
        {description && <p className="card-desc">{description}</p>}

        {/* Port + last opened */}
        <div className="card-meta">
          {port && <span className="card-port">localhost:{port}</span>}
          {port && openedAgo && <span className="card-meta-sep">·</span>}
          {openedAgo && <span className="card-last-opened">Last opened {openedAgo}</span>}
        </div>

        {/* Footer */}
        <div className="card-footer">
          <div className={`status-pill status-${status}`}>
            <span className="status-dot" aria-hidden="true" />
            <span className="status-label">{statusLabels[status] ?? status}</span>
          </div>

          <div className="btn-row">
            <button
              className="btn btn-logs"
              onClick={() => onShowLogs(id)}
              aria-label={`Show logs for ${name}`}
              title="View server logs"
            >
              Logs
            </button>
            {status === 'error' && (
              <button
                className="btn btn-retry"
                onClick={() => onRetry(id)}
                aria-label={`Retry starting ${name}`}
              >
                Retry
              </button>
            )}
            <button
              className="btn btn-open"
              style={status === 'running' ? btnStyle : {}}
              disabled={status !== 'running'}
              onClick={() => onOpen(id)}
              aria-label={status === 'running' ? `Open ${name}` : `${name} is not ready`}
            >
              Open →
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
