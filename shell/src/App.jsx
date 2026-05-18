import { useState, useEffect, useCallback } from 'react'
import sdcLogo from './assets/sdc-logo.png'
import AppGrid from './components/AppGrid'
import StatusBar from './components/StatusBar'
import LogPanel from './components/LogPanel'
import UpdateBanner from './components/UpdateBanner'
import NotificationCenter from './components/NotificationCenter'
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
    assemblies: 'Find, preview, and check out SolidWorks CAD assemblies from the SDC vault — fast.',
    readiness:  'Live build status for every active project — parts, prints, and sign-offs at a glance.',
    scheduler:  'Gantt views, resource loading, and two-way Smartsheet sync — always in step with the project.',
    statelogic: 'Build PLC state machines visually and export Allen-Bradley L5X — no manual coding.',
    calendar:   'Company-wide calendar — events, holidays, birthdays, paydays, and Smartsheet sync.',
  }[id],
  status: 'starting',
  color: {
    assemblies: '#1574C4',
    readiness:  '#74C415',
    scheduler:  '#FFDE51',
    statelogic: '#AACEE8',
    calendar:   '#BEFA4F',
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
  syncStatus:    () => Promise.resolve(),
  authGetStatus: () => Promise.resolve({ isAuthenticated: false, configured: false, user: null }),
  authLogin:     () => Promise.resolve({ success: false, error: 'No API' }),
  authLogout:    () => Promise.resolve({ success: true }),
}

// SDC oval logo mark — matches the blue oval from the SDC Brand Guide 2026

export default function App() {
  // null = checking, false = unauthenticated, { name, email } = signed in
  const [authUser, setAuthUser]   = useState(null)
  const [authReady, setAuthReady] = useState(false)

  const [apps, setApps] = useState(SKELETON_APPS)
  const [logPanelApp, setLogPanelApp] = useState(null)
  const [logs, setLogs] = useState({})
  const [busy, setBusy] = useState(false)
  const [updateStatus, setUpdateStatus] = useState(null)
  const [appVersion, setAppVersion] = useState('')
  const [launchOnStartup, setLaunchOnStartup] = useState(false)
  const [theme, setTheme] = useState(() => localStorage.getItem('sdc-theme') || 'light')

  // ── Auth check on startup ─────────────────────────────────────────────────
  useEffect(() => {
    api.authGetStatus().then(status => {
      if (status.isAuthenticated) {
        setAuthUser(status.user)
      } else if (!status.configured) {
        // Azure not configured — bypass login in dev so the app still works
        setAuthUser({ name: 'Dev Mode', email: 'dev@sdcautomation.com' })
      } else {
        setAuthUser(false)
      }
      setAuthReady(true)
    }).catch(() => {
      // If auth module errors entirely, bypass (dev fallback)
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
    if (!authUser) return  // don't start services until signed in
    api.getStatus().then(status => {
      if (Object.keys(status).length) setApps(Object.values(status))
    })
    api.getAppVersion().then(v => setAppVersion(v))
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

  const handleToggleStartup = useCallback(async () => {
    const next = await api.setLaunchOnStartup(!launchOnStartup)
    setLaunchOnStartup(next)
  }, [launchOnStartup])

  const handleOpen    = useCallback(async (appId) => { await api.openApp(appId) }, [])
  const handleRetry   = useCallback((appId) => api.retryApp(appId), [])
  const handleStopAll = useCallback(async () => { setBusy(true); await api.stopAll(); setBusy(false) }, [])
  const handleRestartAll = useCallback(async () => { setBusy(true); await api.restartAll(); setBusy(false) }, [])
  const handleShowLogs = useCallback(async (appId) => {
    const existing = await api.getLogs(appId)
    setLogs(prev => ({ ...prev, [appId]: existing }))
    setLogPanelApp(appId)
  }, [])

  const runningCount = apps.filter(a => a.status === 'running').length

  // Auth loading splash
  if (!authReady) return <div className="auth-loading">Checking credentials…</div>

  // Login gate
  if (!authUser) return <LoginScreen onLogin={user => setAuthUser(user)} />

  const initials = authUser.name
    ? authUser.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : authUser.email[0].toUpperCase()

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-brand">
          <div className="header-logo">
            <img src={sdcLogo} alt="Steven Douglas Corp." style={{ height: 52, width: 'auto', display: 'block', mixBlendMode: 'screen' }} />
          </div>
          <div className="header-wordmark">
            <div className="header-subtitle">Engineering Excellence. Trusted Partnerships.</div>
          </div>
        </div>

        <div className="header-controls">
          {appVersion && (
            <span className="header-version">v{appVersion}</span>
          )}

          <NotificationCenter />

          {/* Signed-in user chip */}
          <div className="header-user" title={authUser.email}>
            <span className="header-user-avatar">{initials}</span>
            <span className="header-user-name">{authUser.name || authUser.email}</span>
          </div>
          <button
            className="btn btn-header btn-signout-labeled"
            onClick={handleSignOut}
            title={`Sign out ${authUser.email}`}
          >
            ⏻ Sign Out
          </button>
          <button
            className="btn-header-icon"
            onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
            title={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
            aria-label="Toggle theme"
          >
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
          <button
            className={`btn btn-header btn-startup${launchOnStartup ? ' btn-startup--on' : ''}`}
            onClick={handleToggleStartup}
            title={launchOnStartup ? 'Disable launch on Windows startup' : 'Enable launch on Windows startup'}
          >
            {launchOnStartup ? '● Auto-start' : '○ Auto-start'}
          </button>
          <button className="btn btn-header" onClick={handleRestartAll} disabled={busy} title="Restart all servers">
            ↺ Restart All
          </button>
          <button className="btn btn-header btn-stop" onClick={handleStopAll} disabled={busy} title="Stop all servers">
            ■ Stop All
          </button>
        </div>
      </header>

      <UpdateBanner
        status={updateStatus}
        onDownload={() => api.updateDownload()}
        onInstall={() => api.updateInstall()}
        onDismiss={() => setUpdateStatus(null)}
      />

      <main className="app-main">
        <AppGrid
          apps={apps}
          onOpen={handleOpen}
          onRetry={handleRetry}
          onShowLogs={handleShowLogs}
        />
      </main>

      {logPanelApp && (
        <LogPanel
          appId={logPanelApp}
          appName={apps.find(a => a.id === logPanelApp)?.name ?? logPanelApp}
          lines={logs[logPanelApp] || []}
          onClose={() => setLogPanelApp(null)}
        />
      )}

      <StatusBar apps={apps} runningCount={runningCount} />
    </div>
  )
}
