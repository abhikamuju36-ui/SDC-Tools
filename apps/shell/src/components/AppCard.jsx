import AppLogo from './AppLogos'

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

// ── App card, redesigned 2026-08-24 ─────────────────────────────────────────
//
// Was a stripe + body + sunken footer stack: three horizontal bands and four
// rules per card, six cards each with a different accent colour. That structure
// is what made them both tall and busy. Now one surface, one internal rule, and
// the accent colour appears in exactly two quiet places — a tint behind the icon
// and a hairline on hover, which tells you which app you are about to open.
//
// The status pill moved out of the footer and onto the bottom row beside "last
// opened", which removed a whole band without losing any information.
export default function AppCard({ app, lastOpened, onOpen }) {
  // `description` is deliberately NOT destructured: it is no longer shown on
  // the card (2026-08-24, by request), but the field itself stays on the app
  // object because App.jsx filters the header search on it.
  const { id, name, status, color } = app
  const openedAgo = timeAgo(lastOpened?.[id])
  const canOpen = status === 'running'

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
      style={{ '--card-accent': color, cursor: canOpen ? 'pointer' : 'default' }}
      tabIndex={0}
      role="button"
      // Reflects the guard the handlers already enforced but the markup never
      // announced: until the app is running, a click does nothing. Now assistive
      // tech is told, and the CSS holds the card still on hover so it does not
      // invite a click that will be ignored.
      aria-disabled={!canOpen}
      aria-label={`${name} — ${statusLabels[status] ?? status}`}
      onClick={() => canOpen && onOpen(id)}
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && canOpen && onOpen(id)}
    >
      <div className="card-head">
        <div className="card-logo" aria-hidden="true">
          <AppLogo appId={id} size={30} />
        </div>
        <h2 className="card-name">{name}</h2>
      </div>

      <div className="card-status">
        <div className={`status-pill status-${status}`}>
          <span className="status-dot" aria-hidden="true" />
          <span className="status-label">{statusLabels[status] ?? status}</span>
        </div>
        {openedAgo && <span className="card-last-opened">{openedAgo}</span>}
      </div>
    </div>
  )
}
