import { useState, useEffect, useRef, useCallback } from 'react'

const api = window.shellAPI ?? {}

function timeAgo(ts) {
  const diff = Date.now() - ts
  if (diff < 60000)  return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return `${Math.floor(diff / 86400000)}d ago`
}

const SOURCE_LABEL = { calendar: 'Calendar', scheduler: 'Scheduler', shell: 'SDC Tools' }

export default function NotificationCenter() {
  const [open, setOpen]       = useState(false)
  const [notifs, setNotifs]   = useState([])
  const panelRef              = useRef(null)

  // Load on mount and subscribe to live updates
  useEffect(() => {
    api.getNotifications?.().then(n => setNotifs(n ?? []))

    const unsub = api.onNotificationsUpdated?.(n => setNotifs(n ?? []))
    return () => unsub?.()
  }, [])

  // Close panel on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const unread = notifs.filter(n => !n.read).length

  const handleOpen = useCallback(() => {
    setOpen(o => {
      if (!o) {
        api.markNotificationsRead?.().then(() => {
          setNotifs(prev => prev.map(n => ({ ...n, read: true })))
        })
      }
      return !o
    })
  }, [])

  const dismiss = useCallback((id) => {
    api.dismissNotification?.(id)
    setNotifs(prev => prev.filter(n => n.id !== id))
  }, [])

  const clearAll = useCallback(() => {
    api.clearNotifications?.()
    setNotifs([])
    setOpen(false)
  }, [])

  return (
    <div className="notif-center" ref={panelRef}>
      <button
        className={`btn btn-header notif-bell${unread > 0 ? ' notif-bell--active' : ''}`}
        onClick={handleOpen}
        title="Notifications"
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        {unread > 0 && (
          <span className="notif-badge">{unread > 99 ? '99+' : unread}</span>
        )}
      </button>

      {open && (
        <div className="notif-panel">
          <div className="notif-panel-header">
            <span className="notif-panel-title">Notifications</span>
            {notifs.length > 0 && (
              <button className="notif-clear-btn" onClick={clearAll}>Clear all</button>
            )}
          </div>

          <div className="notif-list">
            {notifs.length === 0 ? (
              <div className="notif-empty">
                <span style={{ fontSize: 28 }}>🔔</span>
                <p>No notifications</p>
              </div>
            ) : (
              notifs.map(n => (
                <div key={n.id} className={`notif-item notif-item--${n.type}${n.read ? '' : ' notif-item--unread'}`}>
                  <span className="notif-icon">{n.icon}</span>
                  <div className="notif-content">
                    <div className="notif-title">{n.title}</div>
                    <div className="notif-body">{n.body}</div>
                    <div className="notif-meta">
                      <span className="notif-source">{SOURCE_LABEL[n.source] ?? n.source}</span>
                      <span className="notif-time">{timeAgo(n.timestamp)}</span>
                    </div>
                  </div>
                  <button className="notif-dismiss" onClick={() => dismiss(n.id)} title="Dismiss">×</button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
