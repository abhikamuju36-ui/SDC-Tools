import { useState, useEffect, useCallback, useRef } from 'react'
import sdcLogo from './assets/sdc-logo.png'
import AppGrid from './components/AppGrid'
import StatusBar from './components/StatusBar'
import LogPanel from './components/LogPanel'
import UpdateBanner from './components/UpdateBanner'
import NotificationCenter from './components/NotificationCenter'
import RecentActivity from './components/RecentActivity'
import WindowChrome from './components/WindowChrome'
import LoginScreen from './screens/LoginScreen'

const SKELETON_APPS = ['assemblies', 'readiness', 'scheduler', 'statelogic', 'calendar'].map(id => ({
  id,
  name: {
    assemblies: 'Assemblies Library',
    readiness:  'Build Readiness Report',
    scheduler:  'SDC Scheduler',
    statelogic: 'State Logic Builder',
    calendar:   'SDC Calendar',
  }[id],
  description: {
    assemblies: 'SolidWorks CAD assembly search and check-out — 18,442 assemblies in the vault.',
    readiness:  'Live ETO project build status across the floor — parts, prints, sign-offs.',
    scheduler:  'Gantt views, resource load, and two-way Smartsheet sync for active projects.',
    statelogic: 'Author PLC state machines and export Allen-Bradley L5X for ControlLogix.',
    calendar:   'Company-wide calendar — events, birthdays, paydays, Scheduler sync.',
  }[id],
  status: 'starting',
  color: {
    assemblies: '#1574C4',
    readiness:  '#16a34a',
    scheduler:  '#FFDE51',
    statelogic: '#ea580c',
    calendar:   '#74C415',
  }[id],
  url: '',
}))

const api = window.shellAPI ?? {
  getStatus: () => Promise.resolve({}),
  getLogs: () => Promise.resolve([]),
  openApp: () => Promise.resolve({}),
  retryApp: () => Promise.resolve({}),
  stopAll: () => Promise.resolve(),
  restartAll: () => Promise.resolve(),
  stopApp: () => Promise.resolve(),
  restartApp: () => Promise.resolve(),
  onStatusChange: () => () => {},
  onAppLog: () => () => {},
  getAppVersion: () => Promise.resolve('dev'),
  updateDownload: () => Promise.resolve(),
  updateInstall: () => Promise.resolve(),
  onUpdateStatus: () => () => {},
  getLaunchOnStartup: () => Promise.resolve(false),
  setLaunchOnStartup: () => Promise.resolve(false),
  syncStatus: () => Promise.resolve(),
  authGetStatus: () => Promise.resolve({ isAuthenticated: false, configured: false, user: null }),
  authLogin: () => Promise.resolve({ success: false, error: 'No API' }),
  authLogout: () => Promise.resolve({ success: true }),
  checkForUpdates: () => Promise.resolve(),
  triggerUpdate: () => Promise.resolve({ ok: false }),
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

function formatHeaderDate(date) {
  const days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December']
  const h = date.getHours(), m = date.getMinutes()
  const period = h >= 12 ? 'PM' : 'AM'
  const hour12 = h % 12 || 12
  const min = String(m).padStart(2, '0')
  return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()} · ${hour12}:${min} ${period}`
}

function getGreeting(date) {
  const h = date.getHours()
  if (h < 5)  return 'Working late'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  if (h < 21) return 'Good evening'
  return 'Working late'
}

function stringToColor(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffffffff
  return `oklch(0.55 0.12 ${Math.abs(h) % 360})`
}

export default function App() {
  const [authUser, setAuthUser]   = useState(null)
  const [authReady, setAuthReady] = useState(false)

  const [apps, setApps]           = useState(SKELETON_APPS)
  const [logPanelApp, setLogPanelApp] = useState(null)
  const [logs, setLogs]           = useState({})
  const [busy, setBusy]           = useState(false)
  const [updateStatus, setUpdateStatus] = useState(null)
  const [appVersion, setAppVersion]     = useState('')
  const [serverHost, setServerHost]     = useState('')
  const [launchOnStartup, setLaunchOnStartup] = useState(false)
  const [theme, setTheme]         = useState(() => localStorage.getItem('sdc-theme') || 'light')
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchRef = useRef(null)

  // Live clock (updates every 30 seconds)
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  // Last-opened timestamps (persisted in localStorage)
  const [lastOpened, setLastOpened] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sdc-last-opened') || '{}') }
    catch { return {} }
  })

  // Last time all services were running
  const [lastSync, setLastSync] = useState(null)
  const prevRunning = useRef(0)
  useEffect(() => {
    const running = apps.filter(a => a.status === 'running').length
    if (running === apps.length && apps.length > 0 && running !== prevRunning.current) {
      setLastSync(Date.now())
    }
    prevRunning.current = running
  }, [apps])

  // Recent activity log (persisted)
  const [activity, setActivity] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sdc-activity') || '[]') }
    catch { return [] }
  })

  // ── Auth check ────────────────────────────────────────────────────────────
  useEffect(() => {
    api.authGetStatus().then(status => {
      if (status.isAuthenticated) {
        setAuthUser(status.user)
      } else if (!status.configured) {
        setAuthUser({ name: 'Dev Mode', email: 'dev@sdcautomation.com' })
      } else {
        setAuthUser(false)
      }
      setAuthReady(true)
    }).catch(() => {
      setAuthUser({ name: 'Dev Mode', email: 'dev@sdcautomation.com' })
      setAuthReady(true)
    })
  }, [])

  const handleSignOut = useCallback(async () => {
    await api.authLogout()
    setAuthUser(false)
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('sdc-theme', theme)
  }, [theme])

  useEffect(() => {
    if (!authUser) return
    api.getStatus().then(status => {
      if (Object.keys(status).length) setApps(Object.values(status))
    })
    api.getAppVersion().then(v => setAppVersion(v))
    api.getServerHost().then(h => setServerHost(h))
    api.getLaunchOnStartup().then(v => setLaunchOnStartup(v))

    const unsubStatus = api.onStatusChange(status => setApps(Object.values(status)))
    const unsubLog = api.onAppLog(({ id, line }) => {
      setLogs(prev => {
        const cur = prev[id] || []
        const next = [...cur, line]
        return { ...prev, [id]: next.length > 200 ? next.slice(-200) : next }
      })
    })
    const syncInterval = setInterval(() => api.syncStatus(), 8000)
    const unsubUpdate = api.onUpdateStatus(setUpdateStatus)

    return () => { unsubStatus(); unsubLog(); unsubUpdate(); clearInterval(syncInterval) }
  }, [authUser])

  // ── Keyboard shortcut: Ctrl+K focuses search ─────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
      // Ctrl+1–5 opens apps
      if (e.ctrlKey && e.key >= '1' && e.key <= '5') {
        const idx = Number(e.key) - 1
        const app = apps[idx]
        if (app?.status === 'running') handleOpen(app.id)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [apps])

  const handleCheckForUpdates = useCallback(async () => {
    setCheckingUpdate(true)
    await api.checkForUpdates()
    setTimeout(() => setCheckingUpdate(false), 3000)
  }, [])

  const handleToggleStartup = useCallback(async () => {
    const next = await api.setLaunchOnStartup(!launchOnStartup)
    setLaunchOnStartup(next)
  }, [launchOnStartup])

  const handleOpen = useCallback(async (appId) => {
    await api.openApp(appId)
    const ts = Date.now()
    // Track last-opened
    setLastOpened(prev => {
      const next = { ...prev, [appId]: ts }
      localStorage.setItem('sdc-last-opened', JSON.stringify(next))
      return next
    })
    // Track activity
    setActivity(prev => {
      const appName = apps.find(a => a.id === appId)?.name || appId
      const entry = { id: ts, type: 'open', appId, appName, label: `Opened ${appName}`, ts }
      const next = [entry, ...prev].slice(0, 20)
      localStorage.setItem('sdc-activity', JSON.stringify(next))
      return next
    })
  }, [apps])

  const handleRetry        = useCallback((appId) => api.retryApp(appId), [])
  const handleTriggerUpdate = useCallback((appId) => api.triggerUpdate?.(appId), [])
  const handleStopAll    = useCallback(async () => { setBusy(true); await api.stopAll();    setBusy(false) }, [])
  const handleRestartAll = useCallback(async () => { setBusy(true); await api.restartAll(); setBusy(false) }, [])
  const handleShowLogs   = useCallback(async (appId) => {
    const existing = await api.getLogs(appId)
    setLogs(prev => ({ ...prev, [appId]: existing }))
    setLogPanelApp(appId)
  }, [])

  const runningCount = apps.filter(a => a.status === 'running').length
  const allOnline    = runningCount === apps.length && apps.length > 0

  if (!authReady) return <div className="auth-loading">Checking credentials…</div>
  if (!authUser)  return <LoginScreen onLogin={user => setAuthUser(user)} />

  const initials  = authUser.name
    ? authUser.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : authUser.email[0].toUpperCase()
  const firstName = authUser.name?.split(' ')[0] || authUser.email?.split('@')[0] || 'there'

  // Filter apps by search
  const filteredApps = searchQuery.trim()
    ? apps.filter(a =>
        a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        a.description?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : apps

  return (
    <div className="app">
      <WindowChrome />

      {/* ── Header ───────────────────────────────────────────────────── */}
      <header className="app-header">
        <div className="header-brand">
          <div className="header-logo">
            <img src={sdcLogo} alt="SDC" style={{ height: 44, width: 'auto', display: 'block', mixBlendMode: 'screen' }} />
          </div>
          <div className="header-wordmark">
            <div className="header-title">SDC TOOLS</div>
            <div className="header-subtitle">Steven Douglas Corp. · Engineering Applications Suite</div>
          </div>
        </div>

        <div className="header-search-wrap">
          <div className="header-search">
            <svg className="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input
              ref={searchRef}
              className="search-input"
              type="text"
              placeholder="Search applications, logs, recent activity..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Escape' && setSearchQuery('')}
            />
            <span className="search-hint">Ctrl+K</span>
          </div>
        </div>

        <div className="header-controls">
          <NotificationCenter />
          <button
            className="btn-header-icon"
            onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
            title={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
            aria-label="Toggle theme"
          >
            {theme === 'light'
              ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
              : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            }
          </button>

          <div className="header-user" title={authUser.email}>
            <span className="header-user-avatar" style={{ background: authUser.name ? stringToColor(authUser.name) : undefined }}>{initials}</span>
            <div className="header-user-info">
              <span className="header-user-name">{authUser.name || authUser.email}</span>
              <span className="header-user-email">{authUser.email}</span>
            </div>
            {appVersion && <span className="header-version">v{appVersion}</span>}
          </div>

          <button
            className="btn btn-header btn-signout-labeled"
            onClick={handleSignOut}
            title={`Sign out ${authUser.email}`}
          >
            ⏻ Sign out
          </button>
        </div>
      </header>

      {/* ── Update banner ──────────────────────────────────────────── */}
      <UpdateBanner
        status={updateStatus}
        onDownload={() => api.updateDownload()}
        onInstall={() => api.updateInstall()}
        onDismiss={() => setUpdateStatus(null)}
      />

      {/* ── Main ───────────────────────────────────────────────────── */}
      <main className="app-main">
        <div className="main-content">

          {/* Greeting + status row */}
          <div className="greeting-row">
            <div className="greeting-left">
              <h1 className="greeting-text">
                {getGreeting(now)}, <span className="greeting-name">{firstName}</span>
              </h1>
              <p className="greeting-date">{formatHeaderDate(now)}</p>
            </div>

            <div className={`greeting-status${allOnline ? ' greeting-status--ok' : ''}`}>
              <span className={`gsb-dot status-${allOnline ? 'running' : runningCount > 0 ? 'starting' : 'stopped'}`} />
              <div className="gsb-text">
                <span className="gsb-title">
                  {allOnline
                    ? `All ${apps.length} services online`
                    : `${runningCount} / ${apps.length} running`}
                </span>
                {lastSync && (
                  <span className="gsb-sub">Last sync {timeAgo(lastSync)}</span>
                )}
              </div>
            </div>

            <div className="greeting-actions">
              <button
                className={`btn btn-action${launchOnStartup ? ' btn-action--active' : ''}`}
                onClick={handleToggleStartup}
                title={launchOnStartup ? 'Disable launch on Windows startup' : 'Enable launch on Windows startup'}
              >
                <span className="btn-action-dot" />
                Auto-start
              </button>
              <button
                className="btn btn-action"
                onClick={handleCheckForUpdates}
                disabled={checkingUpdate}
                title="Check for SDC Tools app updates now"
              >
                {checkingUpdate ? '↑ Checking…' : '↑ Check Updates'}
              </button>
              <button className="btn btn-action" onClick={handleRestartAll} disabled={busy} title="Restart all servers">
                ↺ Restart All
              </button>
              <button className="btn btn-action btn-action--stop" onClick={handleStopAll} disabled={busy} title="Stop all servers">
                ■ Stop All
              </button>
            </div>
          </div>

          {/* Two-column content grid: apps + activity sidebar */}
          <div className="content-grid">
            <section className="apps-section">
              <div className="section-header">
                <span className="section-title">ENGINEERING APPLICATIONS</span>
                <span className="section-count">{runningCount} of {apps.length}</span>
              </div>

              <AppGrid
                apps={filteredApps}
                lastOpened={lastOpened}
                onOpen={handleOpen}
                onRetry={handleRetry}
                onShowLogs={handleShowLogs}
                onTriggerUpdate={handleTriggerUpdate}
              />
            </section>

            <aside className="activity-sidebar">
              <div className="section-header">
                <span className="section-title">RECENT ACTIVITY</span>
                {activity.length > 5 && (
                  <button className="section-link" onClick={() => {}}>View all</button>
                )}
              </div>
              <RecentActivity activity={activity} apps={apps} />
            </aside>
          </div>
        </div>
      </main>

      {logPanelApp && (
        <LogPanel
          appId={logPanelApp}
          appName={apps.find(a => a.id === logPanelApp)?.name ?? logPanelApp}
          lines={logs[logPanelApp] || []}
          onClose={() => setLogPanelApp(null)}
        />
      )}

      <StatusBar apps={apps} runningCount={runningCount} email={authUser.email} serverHost={serverHost} version={appVersion} />
    </div>
  )
}
