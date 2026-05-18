// TopBar Component — SDC Premium Design
const { useState, useEffect } = React;

function TopBar({ jobId, setJobId, job, setActiveTab, loading }) {
  const [draft, setDraft] = useState(jobId);
  useEffect(() => setDraft(jobId), [jobId]);

  const onLoad = () => {
    if (draft.trim()) setJobId(draft.trim());
  };

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => setActiveTab?.('readiness')}>
          <img src="assets/sdc-logo-blue.png" alt="SDC" style={{ height: 32 }}/>
          <div className="topbar-brand-text">
            <span className="t1">Build Readiness</span>
            <span className="t2">Designed to Outperform</span>
          </div>
        </div>
      </div>
      
      <div className="topbar-center">
        <div className="job-picker">
          <label>Job #</label>
          <input 
            value={draft} 
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !loading && onLoad()}
          />
          <button className="load-btn" onClick={onLoad}>Load</button>
        </div>
        <div style={{ width: 1, height: 22, background: "var(--border)" }}/>
        <button className="btn btn-ghost" style={{ height: 34, gap: 8 }}>
          <window.IconSearch size={13}/>
          <span style={{ color: "var(--ink-4)" }}>Search anywhere…</span>
          <span className="kbd">⌘K</span>
        </button>
      </div>

      <div className="topbar-right">
        <div className="job-meta">
          <span className="l1">Active Job · {job.id}</span>
          <span className="l2">{job.name}</span>
        </div>
        <div className="avatar">{job.name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || 'JB'}</div>
      </div>
    </header>
  );
}

window.TopBar = TopBar;
