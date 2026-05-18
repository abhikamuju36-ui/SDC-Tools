// SDC Tools — main launcher app
// Renders inside the 960×680 Electron window. Owns the state machine for the
// four child apps (Starting | Running | Error | Stopped), the log panel,
// the update banner, and the global controls (auto-start, restart all, stop all).

const { useState, useEffect, useRef, useMemo, useCallback } = React;

const APPS = [
  {
    id: 'assemblies',
    name: 'Assemblies Library',
    description: 'Find, preview, and check out SolidWorks CAD assemblies from the SDC vault — fast.',
    port: 4001,
    accent: '#1574C4',   // SDC Primary Blue — exact brand color
    shortcut: '1',
  },
  {
    id: 'readiness',
    name: 'Build Readiness Report',
    description: 'Live build status for every active project — parts, prints, and sign-offs at a glance.',
    port: 4002,
    accent: '#74C415',   // SDC Green — exact brand color
    shortcut: '2',
  },
  {
    id: 'scheduler',
    name: 'SDC Scheduler',
    description: 'Gantt views, resource loading, and two-way Smartsheet sync — always in step with the project.',
    port: 4003,
    accent: '#7C3AED',   // Professional violet — consistent with SDC palette depth
    shortcut: '3',
  },
  {
    id: 'statelogic',
    name: 'State Logic Builder',
    description: 'Build PLC state machines visually and export Allen-Bradley L5X — no manual coding.',
    port: 4004,
    accent: '#D97706',   // Warm amber — close to SDC Yellow but distinct enough for error states
    shortcut: '4',
  },
];

// Realistic log seed per app
const LOG_SEEDS = {
  assemblies: [
    { t: '06:41:01', l: 'info', msg: 'Database: N:\\_Assembilies_Library_Application\\assemblies.db' },
    { t: '06:41:02', l: 'info', msg: 'Vault index loaded — 25,238 assemblies, 187,504 parts' },
    { t: '06:41:02', l: 'info', msg: 'Listening on http://127.0.0.1:4001' },
    { t: '06:41:14', l: 'info', msg: 'GET /api/search?q=cam-follower → 32 hits (84ms)' },
    { t: '06:41:31', l: 'info', msg: 'Thumbnail cache warm (3,108 entries) · next backup in 10h' },
  ],
  readiness: [
    { t: '06:41:03', l: 'info', msg: 'Connected to ETO_PROD on srv-eng-02' },
    { t: '06:41:03', l: 'info', msg: 'Listening on http://127.0.0.1:4002' },
    { t: '06:41:18', l: 'info', msg: '14 active projects polled · next sync in 60s' },
    { t: '06:41:45', l: 'info', msg: 'GET /api/readiness/8843 → 200 (12ms)' },
  ],
  scheduler: [
    { t: '06:41:04', l: 'info', msg: 'Smartsheet OAuth token valid (expires 2026-06-12)' },
    { t: '06:41:04', l: 'info', msg: 'Listening on http://127.0.0.1:4003' },
    { t: '06:41:22', l: 'warn', msg: 'Sheet 8843-Concord-Tray load >2.4s · paging enabled' },
    { t: '06:41:58', l: 'info', msg: 'Digest email queued for 08:00 send' },
  ],
  statelogic: [
    { t: '06:41:05', l: 'info', msg: 'AB tag schema 33.0 loaded' },
    { t: '06:41:05', l: 'info', msg: 'Standards: N:\\AI Folder\\State Logic Diagrams\\standards' },
    { t: '06:41:05', l: 'info', msg: 'Listening on http://127.0.0.1:4004' },
    { t: '06:41:09', l: 'err',  msg: 'ENOENT: \\\\sdc-fs\\eng\\templates\\L5X_v3.json' },
    { t: '06:41:09', l: 'err',  msg: 'startup aborted — missing required template' },
  ],
};

// Use TWEAK_DEFAULTS marker block for direct-edit persistence
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark",
  "logoVariant": "circuit",
  "showUpdateBanner": true,
  "showLogPanel": false,
  "autoStart": true
}/*EDITMODE-END*/;

// ─────────────────────────────────────────────────────────────────────────────
// Status dot
function StatusDot({ status, size = 7, glow = true }) {
  const map = {
    running:  { color: '#74C415', label: 'running' },
    starting: { color: '#FFDE51', label: 'starting' },
    error:    { color: '#F25C5C', label: 'error' },
    stopped:  { color: '#5B6678', label: 'stopped' },
  };
  const s = map[status] || map.stopped;
  return (
    <span
      aria-label={s.label}
      className={status === 'starting' ? 'dot dot-pulse' : 'dot'}
      style={{
        width: size, height: size, borderRadius: '50%',
        background: s.color,
        boxShadow: glow && status === 'running' ? `0 0 8px ${s.color}aa` : 'none',
        display: 'inline-block', flexShrink: 0,
      }}
    />
  );
}

function StatusPill({ status }) {
  const meta = {
    running:  { color: '#74C415', text: 'Ready' },
    starting: { color: '#FFDE51', text: 'Starting…' },
    error:    { color: '#F25C5C', text: 'Error' },
    stopped:  { color: '#7A8699', text: 'Stopped' },
  }[status];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 7,
      padding: '4px 9px 4px 8px',
      borderRadius: 999,
      background: `${meta.color}1a`,
      border: `1px solid ${meta.color}40`,
      color: meta.color,
      fontSize: 11,
      letterSpacing: '0.04em',
      fontWeight: 600,
      textTransform: 'uppercase',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <StatusDot status={status} size={6} />
      {meta.text}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// App Card
function AppCard({ app, status, onOpen, onLogs, onRetry, focused }) {
  const running = status === 'running';
  const error   = status === 'error';
  return (
    <div
      tabIndex={0}
      data-status={status}
      data-focused={focused ? '1' : '0'}
      className="card"
      style={{ '--accent': app.accent }}
      onKeyDown={(e) => { if (e.key === 'Enter' && running) onOpen(app); }}
    >
      <div className="card-accent" />
      <div className="card-body">
        <div className="card-head">
          <AppIcon id={app.id} tint={app.accent} />
          <div className="card-title-wrap">
            <div className="card-title">{app.name}</div>
            <div className="card-desc">{app.description}</div>
          </div>
        </div>
        <div className="card-meta">
          <span className="port">localhost:{app.port}</span>
          <span className="shortcut">Ctrl + {app.shortcut}</span>
        </div>
      </div>
      <div className="card-rule" />
      <div className="card-foot">
        <StatusPill status={status} />
        <div className="card-actions">
          <button className="ghost-btn" onClick={() => onLogs(app)}>Logs</button>
          {error && <button className="ghost-btn warn" onClick={() => onRetry(app)}>Retry</button>}
          <button
            className="open-btn"
            disabled={!running}
            onClick={() => running && onOpen(app)}
            style={{ background: app.accent }}
          >
            Open <span style={{ marginLeft: 4 }}>→</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Log Panel — floating bottom-right
function LogPanel({ app, lines, onClose }) {
  const scrollerRef = useRef(null);
  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [lines]);
  if (!app) return null;
  return (
    <div className="logpanel">
      <div className="logpanel-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="logdot" style={{ background: app.accent }} />
          <span className="logtitle">{app.name}</span>
          <span className="logsub">— localhost:{app.port}</span>
        </div>
        <button className="iconbtn" onClick={onClose} aria-label="Close logs">×</button>
      </div>
      <div className="logpanel-body" ref={scrollerRef}>
        {lines.length === 0 && <div className="logline muted">No log lines yet.</div>}
        {lines.map((ln, i) => (
          <div key={i} className={`logline ${ln.l}`}>
            <span className="logt">{ln.t}</span>
            <span className="loglvl">{ln.l === 'err' ? 'ERR' : ln.l === 'warn' ? 'WRN' : 'INF'}</span>
            <span className="logmsg">{ln.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Update banner
function UpdateBanner({ onDismiss, onDownload }) {
  return (
    <div className="banner">
      <div className="banner-accent" />
      <div className="banner-body">
        <span className="banner-dot" />
        <div>
          <span className="banner-title">SDC Tools v2.4.1 is available</span>
          <span className="banner-sub"> · Smartsheet sync reliability + L5X export fix · ~5 min install</span>
        </div>
      </div>
      <div className="banner-actions">
        <button className="primary-btn small" onClick={onDownload}>Download Update</button>
        <button className="iconbtn" onClick={onDismiss} aria-label="Dismiss">×</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Toast — confirmation for "Open" action
function Toast({ msg, onDone }) {
  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(onDone, 2400);
    return () => clearTimeout(id);
  }, [msg, onDone]);
  if (!msg) return null;
  return <div className="toast">{msg}</div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// The Electron window — title bar + header + main + status bar
function ElectronChrome({ theme, children }) {
  return (
    <div className="stage">
      <div className="electron-window" data-theme={theme}>
        {children}
      </div>
    </div>
  );
}

function WindowControls() {
  return (
    <div className="win-controls" data-nodrag="1">
      <button className="wc" aria-label="Minimize">
        <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0" y="4.5" width="10" height="1" fill="currentColor" /></svg>
      </button>
      <button className="wc" aria-label="Maximize">
        <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" /></svg>
      </button>
      <button className="wc close" aria-label="Close">
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0 L10 10 M10 0 L0 10" stroke="currentColor" /></svg>
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main App
function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [statuses, setStatuses] = useState({
    assemblies: 'running',
    readiness:  'running',
    scheduler:  'starting',
    statelogic: 'error',
  });
  const [logs, setLogs] = useState(() => ({ ...LOG_SEEDS }));
  const [openLogsFor, setOpenLogsFor] = useState(null); // app id
  const [bannerOpen, setBannerOpen] = useState(true);
  const [toast, setToast] = useState('');
  const [focusedIdx, setFocusedIdx] = useState(0);

  // sync banner state with tweaks
  useEffect(() => { setBannerOpen(t.showUpdateBanner); }, [t.showUpdateBanner]);
  useEffect(() => {
    if (t.showLogPanel && !openLogsFor) setOpenLogsFor('assemblies');
    if (!t.showLogPanel && openLogsFor) setOpenLogsFor(null);
    // eslint-disable-next-line
  }, [t.showLogPanel]);
  // sync body data-theme for the page-background gradient
  useEffect(() => {
    document.body.setAttribute('data-theme', t.theme || 'dark');
  }, [t.theme]);

  // ── ticker: drive starting → running, and occasional log lines
  useEffect(() => {
    const interval = setInterval(() => {
      setStatuses(prev => {
        const next = { ...prev };
        // promote any "starting" with ~40% chance each tick
        for (const k of Object.keys(next)) {
          if (next[k] === 'starting' && Math.random() < 0.45) {
            next[k] = 'running';
            setLogs(logs => ({
              ...logs,
              [k]: [...logs[k], { t: nowStr(), l: 'info', msg: `Ready · listening on http://127.0.0.1:${APPS.find(a => a.id === k).port}` }]
            }));
          }
        }
        return next;
      });
    }, 1400);
    return () => clearInterval(interval);
  }, []);

  const appById = useMemo(() => Object.fromEntries(APPS.map(a => [a.id, a])), []);

  const runningCount = Object.values(statuses).filter(s => s === 'running').length;

  const openApp = useCallback((app) => {
    setToast(`Opened ${app.name} — localhost:${app.port}`);
    setLogs(prev => ({
      ...prev,
      [app.id]: [...prev[app.id], { t: nowStr(), l: 'info', msg: `Window opened by user` }],
    }));
  }, []);

  const retryApp = useCallback((app) => {
    setStatuses(prev => ({ ...prev, [app.id]: 'starting' }));
    setLogs(prev => ({
      ...prev,
      [app.id]: [...prev[app.id], { t: nowStr(), l: 'info', msg: 'Restart requested · spawning child process' }],
    }));
  }, []);

  const showLogs = useCallback((app) => {
    setOpenLogsFor(app.id);
    setTweak('showLogPanel', true);
  }, [setTweak]);

  const restartAll = () => {
    setStatuses({ assemblies: 'starting', readiness: 'starting', scheduler: 'starting', statelogic: 'starting' });
    setLogs(prev => {
      const out = { ...prev };
      for (const a of APPS) {
        out[a.id] = [...prev[a.id], { t: nowStr(), l: 'info', msg: 'Global restart triggered' }];
      }
      return out;
    });
  };

  const stopAll = () => {
    setStatuses({ assemblies: 'stopped', readiness: 'stopped', scheduler: 'stopped', statelogic: 'stopped' });
  };

  // Ctrl+1..4
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && ['1','2','3','4'].includes(e.key)) {
        e.preventDefault();
        const idx = parseInt(e.key, 10) - 1;
        const app = APPS[idx];
        if (statuses[app.id] === 'running') openApp(app);
        setFocusedIdx(idx);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [statuses, openApp]);

  const currentLogApp = openLogsFor ? appById[openLogsFor] : null;

  return (
    <>
      <ElectronChrome theme={t.theme}>
        {/* HEADER */}
        <header className="header">
          <div className="header-left">
            <Logo variant={t.logoVariant} size={32} />
            <div className="wordmark">
              <div className="wordmark-name">SDC TOOLS</div>
              <div className="wordmark-sub">Engineering Excellence. Trusted Partnerships.</div>
            </div>
          </div>
          <div className="header-right" data-nodrag="1">
            <span className="version-badge">v2.4.0</span>
            <button
              className="header-btn icon-only"
              onClick={() => setTweak('theme', t.theme === 'dark' ? 'light' : 'dark')}
              title={t.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              aria-label="Toggle theme"
            >
              {t.theme === 'dark' ? (
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M11.5 7.8 A 5 5 0 1 1 6.2 2.5 A 4 4 0 0 0 11.5 7.8 Z"
                        fill="currentColor" />
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <circle cx="7" cy="7" r="2.6" fill="currentColor" />
                  <g stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                    <line x1="7" y1="1.2" x2="7" y2="2.6" />
                    <line x1="7" y1="11.4" x2="7" y2="12.8" />
                    <line x1="1.2" y1="7" x2="2.6" y2="7" />
                    <line x1="11.4" y1="7" x2="12.8" y2="7" />
                    <line x1="2.9" y1="2.9" x2="3.9" y2="3.9" />
                    <line x1="10.1" y1="10.1" x2="11.1" y2="11.1" />
                    <line x1="2.9" y1="11.1" x2="3.9" y2="10.1" />
                    <line x1="10.1" y1="3.9" x2="11.1" y2="2.9" />
                  </g>
                </svg>
              )}
            </button>
            <button
              className={`pill-toggle ${t.autoStart ? 'on' : ''}`}
              onClick={() => setTweak('autoStart', !t.autoStart)}
              title="Launch SDC Tools when Windows starts"
            >
              <span className="pill-dot" />
              Auto-start
            </button>
            <button className="header-btn" onClick={restartAll} title="Restart all services">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 6 a4 4 0 1 1 1.3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                <path d="M2 2 L2 5 L5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Restart All
            </button>
            <button className="header-btn danger" onClick={stopAll} title="Stop all services">
              <svg width="10" height="10" viewBox="0 0 10 10"><rect width="10" height="10" rx="1.5" fill="currentColor" /></svg>
              Stop All
            </button>
            <WindowControls />
          </div>
        </header>

        {/* MAIN */}
        <main className="main">
          {bannerOpen && (
            <UpdateBanner
              onDismiss={() => { setBannerOpen(false); setTweak('showUpdateBanner', false); }}
              onDownload={() => setToast('Downloading v2.4.1 in the background…')}
            />
          )}
          <div className="card-grid">
            {APPS.map((app, i) => (
              <AppCard
                key={app.id}
                app={app}
                status={statuses[app.id]}
                onOpen={openApp}
                onLogs={showLogs}
                onRetry={retryApp}
                focused={i === focusedIdx}
              />
            ))}
          </div>
        </main>

        {/* STATUS BAR */}
        <footer className="statusbar">
          <div className="statusbar-left">
            {APPS.map(a => (
              <span key={a.id} className="sb-dot-wrap" title={`${a.name}: ${statuses[a.id]}`}>
                <StatusDot status={statuses[a.id]} size={7} />
              </span>
            ))}
            <span className="sb-summary">{runningCount} / 4 running</span>
          </div>
          <div className="statusbar-right" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="sb-host">SDC-ENG-01</span>
            <span style={{ color: 'rgba(170,206,232,0.2)' }}>·</span>
            <span className="sb-brand">Steven Douglas Corp.</span>
          </div>
        </footer>

        {currentLogApp && (
          <LogPanel
            app={currentLogApp}
            lines={logs[currentLogApp.id]}
            onClose={() => { setOpenLogsFor(null); setTweak('showLogPanel', false); }}
          />
        )}
        <Toast msg={toast} onDone={() => setToast('')} />
      </ElectronChrome>

      <TweaksPanel title="Tweaks">
        <TweakSection label="Appearance" />
        <TweakRadio
          label="Theme"
          value={t.theme}
          options={[
            { value: 'dark',  label: 'Dark' },
            { value: 'light', label: 'Light' },
          ]}
          onChange={(v) => setTweak('theme', v)}
        />
        <TweakSection label="Logo variant" />
        <TweakRadio
          label="Mark"
          value={t.logoVariant}
          options={[
            { value: 'gear',    label: 'Gear' },
            { value: 'circuit', label: 'Circuit' },
            { value: 'stacked', label: 'S Mark' },
          ]}
          onChange={(v) => setTweak('logoVariant', v)}
        />
        <LogoPreviewRow current={t.logoVariant} onPick={(v) => setTweak('logoVariant', v)} />
        <TweakSection label="State" />
        <TweakToggle label="Update banner" value={t.showUpdateBanner} onChange={(v) => setTweak('showUpdateBanner', v)} />
        <TweakToggle label="Log panel"     value={t.showLogPanel}     onChange={(v) => setTweak('showLogPanel', v)} />
        <TweakToggle label="Auto-start at boot" value={t.autoStart}   onChange={(v) => setTweak('autoStart', v)} />
        <TweakSection label="Simulate" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 12px 12px' }}>
          {APPS.map(a => (
            <div key={a.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11.5, color: '#29261b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {a.name}
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                {['running','starting','error','stopped'].map(s => (
                  <button
                    key={s}
                    onClick={() => setStatuses(prev => ({ ...prev, [a.id]: s }))}
                    title={s}
                    style={{
                      width: 16, height: 16, borderRadius: '50%',
                      border: statuses[a.id] === s ? '1.5px solid #29261b' : '1px solid rgba(0,0,0,0.15)',
                      background: { running:'#74C415', starting:'#FFDE51', error:'#F25C5C', stopped:'#9aa3b2' }[s],
                      cursor: 'pointer', padding: 0,
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </TweaksPanel>
    </>
  );
}

// Mini logo previews inside Tweaks
function LogoPreviewRow({ current, onPick }) {
  const variants = [
    { key: 'gear',    label: 'Gear + Nodes' },
    { key: 'circuit', label: 'Circuit Hub' },
    { key: 'stacked', label: 'S Mark' },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, padding: '4px 12px 8px' }}>
      {variants.map(v => (
        <button
          key={v.key}
          onClick={() => onPick(v.key)}
          title={v.label}
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            padding: 6, background: 'transparent',
            border: current === v.key ? '1.5px solid #1574C4' : '1px solid rgba(0,0,0,0.12)',
            borderRadius: 8, cursor: 'pointer',
          }}
        >
          <Logo variant={v.key} size={36} />
          <span style={{ fontSize: 9.5, color: '#5a5447', letterSpacing: '0.04em', textTransform: 'uppercase' }}>{v.label}</span>
        </button>
      ))}
    </div>
  );
}

function nowStr() {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
