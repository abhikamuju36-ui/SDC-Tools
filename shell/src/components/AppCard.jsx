import AppLogo from './AppLogos'

const SHORTCUT_INDEX = { assemblies: 1, readiness: 2, scheduler: 3, statelogic: 4, calendar: 5 }

export default function AppCard({ app, onOpen, onRetry, onShowLogs }) {
  const { id, name, description, status, color, port } = app

  const statusLabels = {
    starting: 'Starting…',
    running:  'Ready',
    error:    'Error',
    stopped:  'Stopped',
  }

  const handleKeyDown = (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && status === 'running') {
      e.preventDefault()
      onOpen(id)
    }
  }

  const shortcut = SHORTCUT_INDEX[id]

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
        <div className="card-top">
          <div className="card-logo" aria-hidden="true">
            <AppLogo appId={id} size={48} />
          </div>
          <div className="card-info">
            <h2 className="card-name">{name}</h2>
            {description && <p className="card-desc">{description}</p>}
          </div>
        </div>

        <div className="card-meta">
          {port && (
            <span className="card-port">localhost:{port}</span>
          )}
          {shortcut && (
            <span className="card-shortcut">Ctrl + {shortcut}</span>
          )}
        </div>

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
