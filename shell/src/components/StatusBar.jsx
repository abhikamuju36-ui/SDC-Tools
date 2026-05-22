export default function StatusBar({ apps, runningCount, email, serverHost, version }) {
  const total = apps.length
  const allUp = runningCount === total && total > 0

  return (
    <footer className="status-bar">
      {/* Group 1: LED dots + running count */}
      <div className="sb-group">
        <div className="status-bar-dots">
          {apps.map(a => (
            <span
              key={a.id}
              className={`sb-dot status-${a.status}`}
              title={`${a.name}: ${a.status}`}
            />
          ))}
        </div>
        <span style={{ color: '#fff', fontSize: 11, fontWeight: 600 }}>
          {total === 0
            ? 'No services'
            : allUp
            ? `${total}/${total} running`
            : `${runningCount}/${total} running`}
        </span>
      </div>

      {/* Group 2: CPU */}
      <div className="sb-group">
        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>CPU</span>
        <span style={{ color: '#fff', fontWeight: 600, fontSize: 11 }}>14%</span>
      </div>

      {/* Group 3: Memory */}
      <div className="sb-group">
        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>MEM</span>
        <span style={{ color: '#fff', fontWeight: 600, fontSize: 11 }}>3.8 / 16 GB</span>
      </div>

      {/* Group 4: Server host */}
      {serverHost && (
        <div className="sb-group">
          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10.5 }}>{serverHost}</span>
        </div>
      )}

      {/* Group last: email · version · tagline (right-aligned via margin-left:auto) */}
      <div className="sb-group">
        {email && (
          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10.5 }}>{email}</span>
        )}
        {email && version && (
          <span style={{ color: 'rgba(255,255,255,0.15)', fontSize: 10.5 }}>·</span>
        )}
        {version && (
          <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10.5, fontFamily: 'Consolas,monospace' }}>
            v{version}
          </span>
        )}
        {(email || version) && (
          <span style={{ color: 'rgba(255,255,255,0.15)', fontSize: 10.5 }}>·</span>
        )}
        <span className="sb-tagline">Engineering Excellence · Trusted Partnerships</span>
      </div>
    </footer>
  )
}
