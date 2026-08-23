import { useEffect, useRef } from 'react'

export default function LogPanel({ appId, appName, lines, onClose }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  return (
    <div className="log-panel" role="dialog" aria-label={`Logs for ${appName}`}>
      <div className="log-panel-header">
        <span className="log-panel-title">Logs — {appName}</span>
        <button className="log-panel-close" onClick={onClose} aria-label="Close log panel">✕</button>
      </div>
      <div className="log-panel-body">
        {lines.length === 0
          ? <span className="log-empty">No log output yet.</span>
          : lines.map((line, i) => (
            <div key={i} className={`log-line${line.includes('[ERR]') ? ' log-error' : ''}`}>
              {line}
            </div>
          ))
        }
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
