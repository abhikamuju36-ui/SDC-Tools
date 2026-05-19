export default function StatusBar({ apps, runningCount, email, serverHost, version }) {
  const total = apps.length
  const allUp = runningCount === total && total > 0

  return (
    <footer className="status-bar">
      <div className="status-bar-left">
        <div className="status-bar-dots">
          {apps.map(a => (
            <span
              key={a.id}
              className={`sb-dot status-${a.status}`}
              title={`${a.name}: ${a.status}`}
            />
          ))}
        </div>
        <span className="status-bar-text">
          {total === 0
            ? 'No services configured'
            : allUp
            ? `${total} / ${total} running`
            : `${runningCount} / ${total} running`}
        </span>
      </div>

      <div className="status-bar-right">
        {serverHost && <span className="sb-host">{serverHost}</span>}
        {email && (
          <>
            <span className="sb-sep">·</span>
            <span className="sb-host">{email}</span>
          </>
        )}
        {version && (
          <>
            <span className="sb-sep">·</span>
            <span className="sb-build">v{version}</span>
          </>
        )}
      </div>
    </footer>
  )
}
