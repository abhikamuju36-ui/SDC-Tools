// App shell — top bar, left rail sidebar, and main content routing
const { useState, useEffect, useRef } = React;

// ─── Error Boundary ──────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null, info: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    console.error('Render error:', error, info);
    this.setState({ info });
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, maxWidth: 800, margin: '40px auto' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#dc2626', marginBottom: 8, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            Rendering Error
          </div>
          <pre style={{
            background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8,
            padding: '16px 20px', fontSize: 12, color: '#991b1b',
            whiteSpace: 'pre-wrap', wordBreak: 'break-all', marginBottom: 12,
          }}>{this.state.error.message}</pre>
          <pre style={{
            background: 'var(--bg-sunken)', border: '1px solid var(--border)', borderRadius: 8,
            padding: '16px 20px', fontSize: 11, color: 'var(--ink-3)',
            whiteSpace: 'pre-wrap', wordBreak: 'break-all', marginBottom: 20,
          }}>{this.state.error.stack}</pre>
          {this.state.info?.componentStack && (
            <pre style={{
              background: 'var(--bg-sunken)', border: '1px solid var(--border)', borderRadius: 8,
              padding: '16px 20px', fontSize: 11, color: 'var(--ink-4)',
              whiteSpace: 'pre-wrap', wordBreak: 'break-all', marginBottom: 20,
            }}>{this.state.info.componentStack}</pre>
          )}
          <button
            className="btn btn-primary"
            onClick={() => this.setState({ error: null, info: null })}
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Recent Jobs helpers ────────────────────────────────────────────────────
function getRecentJobs() {
  try { return JSON.parse(localStorage.getItem('sdc_recent_jobs') || '[]'); }
  catch(e) { return []; }
}
function saveRecentJob(id, name) {
  try {
    const list = getRecentJobs().filter(j => j.id !== id);
    list.unshift({ id, name });
    localStorage.setItem('sdc_recent_jobs', JSON.stringify(list.slice(0, 5)));
  } catch(e) {}
}

// ─── Landing Screen ─────────────────────────────────────────────────────────

// Single system status row used in the check card
function SystemRow({ badge, badgeBg, name, subtitle, status, detail }) {
  // status: 'loading' | 'found' | 'missing' | 'na'
  const isLoading = status === 'loading';
  const isFound   = status === 'found';
  const isMissing = status === 'missing';

  const stColor = isFound ? '#16a34a' : isMissing ? '#dc2626' : status === 'na' ? '#ca8a04' : 'var(--ink-4)';
  const rowBg   = isFound ? 'rgba(22,163,74,0.05)' : isMissing ? 'rgba(220,38,38,0.04)' : status === 'na' ? 'rgba(202,138,4,0.04)' : 'var(--bg-sunken)';
  const border  = isFound ? 'rgba(22,163,74,0.22)' : isMissing ? 'rgba(220,38,38,0.22)' : status === 'na' ? 'rgba(202,138,4,0.22)' : 'var(--border)';

  const statusIcon = isLoading ? null : isFound ? '✓' : isMissing ? '✕' : '—';
  const statusText = isLoading ? 'Checking…'
    : isFound   ? (detail || 'Connected')
    : isMissing ? 'Not found'
    : 'No schedule linked';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', background: rowBg, border: `1px solid ${border}`, borderRadius: 8, transition: 'all 0.2s' }}>
      {/* System badge */}
      <div style={{ width: 34, height: 34, borderRadius: 8, background: badgeBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: '#fff', letterSpacing: '0.02em', flexShrink: 0 }}>
        {badge}
      </div>
      {/* Name + subtitle */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{name}</div>
        <div style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 1 }}>{subtitle}</div>
      </div>
      {/* Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, maxWidth: 200 }}>
        {isLoading
          ? <div className="spinner" style={{ width: 14, height: 14, border: '2px solid var(--border)', borderTopColor: 'var(--sdc-blue)', borderRadius: '50%', flexShrink: 0 }} />
          : <span style={{ fontSize: 13, fontWeight: 800, color: stColor, flexShrink: 0 }}>{statusIcon}</span>
        }
        <span style={{ fontSize: 11, fontWeight: isLoading ? 400 : 600, color: stColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {statusText}
        </span>
      </div>
    </div>
  );
}

function JobLandingScreen({ onLoad }) {
  const [input, setInput]         = useState('');
  const [recentJobs, setRecentJobs] = useState(getRecentJobs);
  const [phase, setPhase]         = useState('idle'); // 'idle'|'checking'|'found'|'notfound'
  const [pendingId, setPendingId] = useState('');
  const [checkData, setCheckData] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => { if (phase === 'idle') setTimeout(() => inputRef.current?.focus(), 50); }, [phase]);

  const runCheck = async (rawId) => {
    const id = String(rawId).trim();
    if (!id) return;
    setPendingId(id);
    setPhase('checking');
    setCheckData(null);
    try {
      const res  = await fetch(`/api/check/${id}`);
      const data = await res.json();
      setCheckData(data);
      if (data.totalEto?.found) {
        setPhase('found');
        setTimeout(() => onLoad(id), 1300);   // brief pause so user sees the result
      } else {
        setPhase('notfound');
      }
    } catch {
      setCheckData({ totalEto: { found: false }, smartsheet: { found: false } });
      setPhase('notfound');
    }
  };

  // ── shared page wrapper ──
  const Page = ({ children }) => (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(160deg, var(--bg) 0%, var(--bg-sunken) 100%)' }}>
      {children}
      <div style={{ marginTop: 24, fontSize: 11, color: 'var(--ink-4)' }}>
        Live data from TotalETO · SDC Automation
      </div>
    </div>
  );

  // ── shared brand header ──
  const Brand = ({ subtitle }) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <img src="assets/sdc-logo-blue.png" style={{ height: 34 }} onError={e => e.target.style.display = 'none'} />
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.02em' }}>SDC Command</div>
        <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 3 }}>{subtitle || 'Build Readiness · PO Tracker · Project Costs'}</div>
      </div>
    </div>
  );

  // ─────────────────────────────────────────────────────────────────
  // PHASE: checking / found / notfound — show system status card
  // ─────────────────────────────────────────────────────────────────
  if (phase !== 'idle') {
    const etoStatus = phase === 'checking' ? 'loading' : checkData?.totalEto?.found ? 'found' : 'missing';
    const ssStatus  = phase === 'checking' ? 'loading'
      : !checkData?.totalEto?.found ? 'na'           // don't report SS if ETO already failed
      : checkData?.smartsheet?.found ? 'found' : 'na';

    return (
      <Page>
        <div style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 16, boxShadow: 'var(--shadow-lg)', padding: '36px 44px', width: 500, display: 'flex', flexDirection: 'column', gap: 24 }}>

          <Brand subtitle={
            phase === 'checking' ? `Searching connected systems for job #${pendingId}…`
            : phase === 'found'   ? `Job #${pendingId} found — loading project…`
            : `Job #${pendingId} · not found`
          } />

          {/* Job number chip */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 700, letterSpacing: '0.04em', color: phase === 'notfound' ? '#dc2626' : 'var(--sdc-blue)' }}>
              #{pendingId}
            </span>
            {phase === 'found' && (
              <span style={{ fontSize: 12, fontWeight: 600, color: '#16a34a', background: 'rgba(22,163,74,0.1)', border: '1px solid rgba(22,163,74,0.25)', padding: '3px 10px', borderRadius: 999 }}>
                {checkData?.totalEto?.projectName || 'Project found'}
              </span>
            )}
          </div>

          {/* System rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <SystemRow
              badge="ETO" badgeBg="var(--sdc-blue)"
              name="TotalETO"
              subtitle="ERP — jobs, specs, BOM & purchase orders"
              status={etoStatus}
              detail={checkData?.totalEto?.projectName}
            />
            <SystemRow
              badge="SS" badgeBg="#1a7040"
              name="Smartsheets"
              subtitle="Project schedule, milestones & Gantt"
              status={ssStatus}
              detail={checkData?.smartsheet?.sheetName}
            />
          </div>

          {/* Auto-loading progress bar */}
          {phase === 'found' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: '100%', background: 'linear-gradient(90deg, var(--sdc-blue), #16a34a)', borderRadius: 2, animation: 'progressBar 1.3s linear forwards' }} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-4)', textAlign: 'center' }}>Loading project data…</div>
            </div>
          )}

          {/* Not found error + actions */}
          {phase === 'notfound' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#991b1b', marginBottom: 4 }}>
                  Job #{pendingId} not found in TotalETO
                </div>
                <div style={{ fontSize: 11, color: '#b91c1c', lineHeight: 1.5 }}>
                  Verify the job number and try again. If this is a new project it may not be set up in TotalETO yet.
                </div>
              </div>
              <button
                onClick={() => { setPhase('idle'); setCheckData(null); setInput(pendingId); }}
                style={{ height: 40, padding: '0 18px', background: 'var(--bg-sunken)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                ← Try a different number
              </button>
            </div>
          )}

          {/* Cancel while checking */}
          {phase === 'checking' && (
            <button
              onClick={() => { setPhase('idle'); setCheckData(null); }}
              style={{ background: 'none', border: 'none', fontSize: 12, color: 'var(--ink-4)', cursor: 'pointer', textAlign: 'center' }}
            >
              Cancel
            </button>
          )}
        </div>
      </Page>
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // PHASE: idle — job number entry form
  // ─────────────────────────────────────────────────────────────────
  return (
    <Page>
      <div style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 16, boxShadow: 'var(--shadow-lg)', padding: '44px 52px', width: 500, display: 'flex', flexDirection: 'column', gap: 28 }}>

        <Brand />

        {/* Input */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Job Number</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && runCheck(input)}
              placeholder="e.g. 1129"
              style={{ flex: 1, height: 44, padding: '0 14px', fontSize: 20, fontWeight: 600, fontFamily: 'var(--font-mono)', background: 'var(--bg-sunken)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--ink)', outline: 'none', letterSpacing: '0.04em', transition: 'border-color 0.15s, box-shadow 0.15s' }}
              onFocus={e => { e.target.style.borderColor = 'var(--sdc-blue)'; e.target.style.boxShadow = '0 0 0 3px var(--sdc-blue-soft)'; }}
              onBlur={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.boxShadow = 'none'; }}
            />
            <button
              onClick={() => runCheck(input)}
              disabled={!input.trim()}
              style={{ height: 44, padding: '0 22px', background: input.trim() ? 'var(--sdc-blue)' : 'var(--bg-sunken)', color: input.trim() ? 'white' : 'var(--ink-4)', border: '1px solid ' + (input.trim() ? 'var(--sdc-blue)' : 'var(--border)'), borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: input.trim() ? 'pointer' : 'not-allowed', transition: 'all 0.15s' }}
            >
              Check →
            </button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>
            Press <span style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-sunken)', padding: '1px 5px', borderRadius: 3, border: '1px solid var(--border)' }}>Enter</span> to check · verifies TotalETO &amp; Smartsheets
          </div>
        </div>

        {/* Recent Jobs */}
        {recentJobs.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Recent Projects</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {recentJobs.map(job => (
                <button
                  key={job.id}
                  onClick={() => runCheck(job.id)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 8, background: 'var(--bg-sunken)', border: '1px solid var(--border)', cursor: 'pointer', textAlign: 'left', transition: 'all 0.12s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.borderColor = 'var(--border-strong)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-sunken)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--sdc-blue)' }}>#{job.id}</span>
                    <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{job.name || 'Project ' + job.id}</span>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>Open →</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Page>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────
function App() {
  const [jobId, setJobId] = useState(() => localStorage.getItem('sdc_active_job'));
  const [tab, setTab] = useState(() => localStorage.getItem('sdc_active_tab') || 'readiness');

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fetchKey, setFetchKey] = useState(0);
  const [highlightPoIds, setHighlightPoIds] = useState([]);

  useEffect(() => { localStorage.setItem('sdc_active_tab', tab); }, [tab]);
  useEffect(() => { 
    if (jobId) localStorage.setItem('sdc_active_job', jobId);
    else localStorage.removeItem('sdc_active_job');
  }, [jobId]);

  useEffect(() => {
    if (!jobId) return;

    setLoading(true);
    setError(null);
    setData(null);

    Promise.all([
      fetch(`/api/readiness/${jobId}`).then(async res => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Server error ${res.status} — check the job number and try again.`);
        }
        return res.json();
      }),
      fetch(`/api/emails/${jobId}`).then(res => res.ok ? res.json() : { emails: [] })
    ])
      .then(([raw, rawEmails]) => {
        const mapped = {
          job: {
            id: raw.project.ProjectID,
            name: raw.project.ProjectName,
            buildStart: raw.buildDates?.buildStart || null,
            shipDate: raw.buildDates?.buildComplete || null,
            kpis: { assemblies: 0, ready: 0, close: 0, blocked: 0, noPO: 0 },
            actMat: raw.projectCosting?.ActMaterials || 0,
            // treat $0/$1000 or missing as "no budget" — ETO project may lack budget data
            estMat: (raw.projectCosting?.EstMaterials > 1000) ? raw.projectCosting.EstMaterials : null,
            actLabor: ((raw.projectCosting?.ActEngLabor || 0) + (raw.projectCosting?.ActMfgLabor || 0)) || null,
            estLabor: ((raw.projectCosting?.EstEngLabor || 0) + (raw.projectCosting?.EstMfgLabor || 0)) || null,
            actEngHrs: raw.projectCosting?.ActEngHrs || 0,
            actMfgHrs: raw.projectCosting?.ActMfgHrs || 0,
            estEngHrs: raw.projectCosting?.EstEngHrs || 0,
            estMfgHrs: raw.projectCosting?.EstMfgHrs || 0,
            marginActual: raw.projectCosting?.ActualMargin != null ? raw.projectCosting.ActualMargin / 100 : null,
            marginTarget: (raw.projectCosting?.BudgetMargin > 0) ? raw.projectCosting.BudgetMargin / 100 : null,
          },
          readiness: raw.specs.map(s => ({
            spec: s.specId,
            title: s.specName,
            lines: s.totalParts,
            assemblies: (s.machines || []).map(machine => ({
              ...machine,
              code: machine.pn,
              name: machine.pn,
              desc: machine.desc,
              pct: machine.stats?.pct || 0,
              ready: machine.stats?.received || 0,
              total: machine.stats?.total || 0,
              noPo: machine.stats?.noPO || 0,
              status: (machine.stats?.pct >= 85) ? 'ready' : (machine.stats?.pct >= 60) ? 'close' : 'blocked',
              children: [],
            }))
          })),
          costing: (raw.specCosting || []).map(s => ({
            spec: String(s.SectionID),
            name: s.SectionName,
            laborHrs: (s.EngHours || 0) + (s.MfgHours || 0),
            labor: (s.EngLabor || 0) + (s.MfgLabor || 0),
            materials: s.TotalMaterials || 0,
            total: s.TotalCost || 0,
            margin: s.Margin || 0,
          })),
          poActions: raw.poActions,
          emails: (rawEmails.emails || []).map(e => ({
            vendor: e.supplier,
            overdue: e.isOverdue,
            pos: e.poCount,
            contacts: [e.email].filter(Boolean),
            subject: e.subject,
            body: e.body
          })),
          nopo: raw.specs.flatMap(s => (s.noPoParts || []).map(p => ({
            ...p,
            parent: (p.parentPN ? `${p.parentPN} ` : '') + (p.parentDesc || p.parentPN || 'Loose Parts'),
          }))),
          buildDates: raw.buildDates,
        };

        mapped.readiness.forEach(s => {
          s.assemblies.forEach(a => {
            mapped.job.kpis.assemblies++;
            if (a.status === 'ready') mapped.job.kpis.ready++;
            else if (a.status === 'close') mapped.job.kpis.close++;
            else mapped.job.kpis.blocked++;
          });
        });
        // Use globally-deduplicated noPo count — machine stats double-count shared parts
        mapped.job.kpis.noPO = mapped.nopo.length;

        setData(mapped);
        saveRecentJob(String(jobId), mapped.job.name);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setError(err.message);
        setLoading(false);
      });
  }, [jobId, fetchKey]);

  // ── No job selected yet — show landing screen ──
  if (!jobId) {
    return <JobLandingScreen onLoad={id => { setError(null); setData(null); setJobId(id); setTab('readiness'); }} />;
  }

  // ── Error ──
  if (error) {
    return (
      <div style={{ height: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)' }}>
        <div style={{ textAlign: 'center', maxWidth: 420 }}>
          <div style={{ fontSize: 36, marginBottom: 16 }}>⚠️</div>
          <div className="eyebrow" style={{ color: 'var(--threat)' }}>Could Not Load Job #{jobId}</div>
          <p style={{ color: 'var(--ink-3)', margin: '12px 0 24px', fontSize: 14 }}>{error}</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button className="btn btn-primary" onClick={() => { setError(null); setData(null); setFetchKey(k => k + 1); }}>
              Retry
            </button>
            <button className="btn" onClick={() => { setJobId(null); setError(null); setData(null); }}>
              ← Back to Search
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Loading (also covers the one-tick gap before useEffect sets loading=true) ──
  if (loading || !data) {
    return (
      <div style={{
        height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(135deg, var(--bg) 0%, var(--bg-sunken) 100%)', color: 'var(--ink-3)',
      }}>
        <div style={{ position: 'relative', width: 72, height: 72, marginBottom: 28 }}>
          <div className="spinner" style={{ width: '100%', height: '100%', border: '3px solid var(--bg-sunken)', borderTopColor: 'var(--sdc-blue)', borderRadius: '50%' }} />
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}>
            <img src="assets/sdc-logo-blue.png" style={{ height: 22, opacity: 0.7 }} onError={e => e.target.style.display = 'none'} />
          </div>
        </div>
        <div className="mono" style={{ fontSize: 11, letterSpacing: '0.18em', fontWeight: 600, color: 'var(--ink)' }}>LOADING PROJECT</div>
        <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 6 }}>Retrieving live data for Job #{jobId}…</div>
      </div>
    );
  }

  // ── Dashboard ──
  const navItems = [
    { id: 'readiness', label: 'Build Readiness', icon: <window.IconLayers size={14}/> },
    { id: 'po',        label: 'Procurement',      icon: <window.IconTruck size={14}/>, count: data.poActions?.critical?.length || 0, countAccent: 'threat' },
    { id: 'cost',      label: 'Financials',       icon: <window.IconDollar size={14}/> },
  ];

  return (
    <div className="app">
      <window.TopBar jobId={jobId} setJobId={id => { setData(null); setJobId(id); }} job={data.job} setActiveTab={setTab} loading={loading}/>

      <aside className="rail">
        <div className="rail-section">
          <div className="rail-h">Project</div>
          {navItems.map(item => (
            <button key={item.id} className={`rail-item ${tab === item.id ? 'active' : ''}`} onClick={() => setTab(item.id)}>
              <span style={{ display: 'flex', alignItems: 'center' }}>
                <span className="ico">{item.icon}</span>
                {item.label}
              </span>
              {item.count > 0 && (
                <span className={`badge badge-${item.countAccent === 'threat' ? 'threat' : 'pending'}`} style={{ height: 16, fontSize: 9.5 }}>
                  {item.count}
                </span>
              )}
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        <div className="rail-section">
          <div className="rail-h">Recent Projects</div>
          {getRecentJobs().map(job => (
            <button key={job.id} className="rail-item" onClick={() => { setData(null); setJobId(job.id); setTab('readiness'); }}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontSize: 11, color: 'var(--ink-4)', fontWeight: 600 }}>#{job.id}</span>
                <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{job.name || 'Project ' + job.id}</span>
              </span>
            </button>
          ))}
          <button
            className="rail-item"
            onClick={() => { setJobId(null); setData(null); setError(null); }}
            style={{ marginTop: 4, color: 'var(--sdc-blue)', fontWeight: 500 }}
          >
            <span style={{ display: 'flex', alignItems: 'center' }}>
              <span className="ico"><window.IconSearch size={12}/></span>
              Open Different Job…
            </span>
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="main-inner">
          <ErrorBoundary>
            {tab === 'readiness' && <window.ReadinessTab data={data} onDrillDown={ids => setHighlightPoIds(ids)} highlightPoIds={highlightPoIds} onClearHighlight={() => setHighlightPoIds([])}/>}
            {tab === 'po' && <window.PoTab data={data} highlightPoIds={highlightPoIds} onClearHighlight={() => setHighlightPoIds([])}/>}
            {tab === 'cost' && <window.CostTab data={data}/>}
          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
