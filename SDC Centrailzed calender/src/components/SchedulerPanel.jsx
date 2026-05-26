import React, { useState, useEffect } from 'react';
import { Icon, API_URL } from '../constants.jsx';

function SchedulerPanel({ onClose, onSync, currentEvents }) {
  const [projects, setProjects] = useState([]);
  const [selected, setSelected] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('sdc_sched_projects') || '[]')); }
    catch { return new Set(); }
  });
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const lastSync = localStorage.getItem('sdc_sched_last_sync');

  useEffect(() => {
    fetch(`${API_URL}/api/scheduler/projects`)
      .then(r => r.json())
      .then(data => { setProjects(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => { setError('Cannot load projects — check that the calendar server is running.'); setLoading(false); });
  }, []);

  const toggleProject = (name) => setSelected(prev => {
    const next = new Set(prev);
    next.has(name) ? next.delete(name) : next.add(name);
    localStorage.setItem('sdc_sched_projects', JSON.stringify([...next]));
    return next;
  });
  const selectAll  = () => { const s = new Set(projects); setSelected(s); localStorage.setItem('sdc_sched_projects', JSON.stringify([...s])); };
  const selectNone = () => { setSelected(new Set()); localStorage.setItem('sdc_sched_projects', '[]'); };

  const doSync = async () => {
    if (!selected.size) return;
    setSyncing(true); setError(null);
    try {
      const params = new URLSearchParams({ projects: [...selected].join(',') });
      const res  = await fetch(`${API_URL}/api/scheduler/tasks?${params}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      onSync(data);
      localStorage.setItem('sdc_sched_last_sync', new Date().toLocaleString());
    } catch (e) { setError(e.message); }
    finally     { setSyncing(false); }
  };

  const clearAll = () => { onSync([]); localStorage.removeItem('sdc_sched_last_sync'); };

  return (
    <div className="scrim" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(520px, calc(100vw - 32px))' }}>

        <div className="modal-head">
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ fontSize:20 }}>📅</span>
            <h2 style={{ margin:0 }}>SDC Scheduler Sync</h2>
          </div>
          <button className="iconbtn" onClick={onClose}>{Icon.x}</button>
        </div>

        <div className="modal-body" style={{ padding:'20px', display:'flex', flexDirection:'column', gap:16 }}>

          <div style={{ padding:'12px 16px', borderRadius:10, border:'1px solid var(--line)', background: loading ? 'var(--bg-tint)' : error ? '#FFF3F3' : '#EDF7ED', display:'flex', alignItems:'center', gap:12 }}>
            {loading ? (
              <><div className="login-spinner" style={{ width:18, height:18, borderWidth:2 }}/><span style={{ color:'var(--ink-3)', fontSize:13 }}>Loading projects…</span></>
            ) : error ? (
              <>
                <span style={{ fontSize:18 }}>❌</span>
                <div>
                  <div style={{ fontWeight:600, fontSize:13, color:'#B71C1C' }}>Not Connected</div>
                  <div style={{ fontSize:12, color:'#C62828' }}>{error}</div>
                </div>
              </>
            ) : (
              <>
                <span style={{ fontSize:18 }}>✅</span>
                <div>
                  <div style={{ fontWeight:600, fontSize:13, color:'#1A6B1A' }}>SDC Scheduler Connected</div>
                  <div style={{ fontSize:12, color:'#2E7D32' }}>{projects.length} project{projects.length !== 1 ? 's' : ''} available</div>
                </div>
              </>
            )}
          </div>

          {!loading && !error && (
            <div>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                <div style={{ fontSize:13, fontWeight:600, color:'var(--ink)' }}>
                  Projects <span style={{ fontWeight:400, color:'var(--ink-3)' }}>({projects.length})</span>
                </div>
                <div style={{ display:'flex', gap:6 }}>
                  <button onClick={selectAll}  style={{ fontSize:11, padding:'3px 10px', border:'1px solid var(--line-strong)', borderRadius:6, background:'transparent', cursor:'pointer', color:'var(--ink-3)' }}>All</button>
                  <button onClick={selectNone} style={{ fontSize:11, padding:'3px 10px', border:'1px solid var(--line-strong)', borderRadius:6, background:'transparent', cursor:'pointer', color:'var(--ink-3)' }}>None</button>
                </div>
              </div>
              <div style={{ maxHeight:220, overflowY:'auto', border:'1px solid var(--line)', borderRadius:8, background:'var(--bg)' }}>
                {projects.length === 0
                  ? <div style={{ padding:20, textAlign:'center', color:'var(--ink-3)', fontSize:13 }}>No projects found. Add tasks in the SDC Scheduler app first.</div>
                  : projects.map(proj => (
                      <label key={proj} className="ss-sheet-row">
                        <input type="checkbox" checked={selected.has(proj)} onChange={() => toggleProject(proj)} style={{ accentColor:'#1574C4', width:14, height:14, flexShrink:0 }}/>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontWeight:500, fontSize:13, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{proj}</div>
                        </div>
                      </label>
                    ))
                }
              </div>
              <div style={{ fontSize:11, color:'var(--ink-3)', marginTop:6 }}>
                {selected.size} project{selected.size !== 1 ? 's' : ''} selected · Tasks shown as read-only calendar events
              </div>
            </div>
          )}

          {currentEvents.length > 0 && (
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              <div style={{ padding:'8px 14px', background:'rgba(21,116,196,0.08)', borderRadius:8, fontSize:12, color:'#1574C4', fontWeight:600 }}>
                📅 {currentEvents.length} task{currentEvents.length !== 1 ? 's' : ''} loaded
              </div>
              {lastSync && <div style={{ padding:'8px 14px', background:'var(--bg-tint)', borderRadius:8, fontSize:12, color:'var(--ink-3)' }}>🕐 Last synced {lastSync}</div>}
            </div>
          )}

          {error && (
            <div style={{ padding:'10px 14px', background:'#FFF0F0', border:'1px solid #FFB3B3', borderRadius:8, fontSize:13, color:'#CC0000' }}>⚠️ {error}</div>
          )}
        </div>

        <div className="modal-foot">
          {currentEvents.length > 0 && (
            <button className="btn" onClick={clearAll} style={{ color:'#CC3333', borderColor:'#CC3333' }}>🗑 Clear Tasks</button>
          )}
          <div className="spacer"/>
          <button className="btn" onClick={onClose}>Close</button>
          {!error && !loading && (
            <button className="btn primary" onClick={doSync} disabled={syncing || selected.size === 0} style={{ display:'flex', alignItems:'center', gap:6, opacity: selected.size === 0 ? 0.5 : 1 }}>
              {syncing ? <><div className="login-spinner" style={{ width:14, height:14, borderWidth:2, borderTopColor:'#fff', borderColor:'rgba(255,255,255,0.3)' }}/> Syncing…</> : '🔄 Sync Now'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default SchedulerPanel;
