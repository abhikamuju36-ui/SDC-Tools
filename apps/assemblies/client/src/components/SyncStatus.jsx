import { useState, useEffect, useCallback, useRef } from 'react';
import API_BASE from '../utils/apiBase';

export default function SyncStatus() {
  const [status,      setStatus]      = useState(null);
  const [syncing,     setSyncing]     = useState(false);
  const [fetchError,  setFetchError]  = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history,     setHistory]     = useState([]);
  const [popoverPos,  setPopoverPos]  = useState({ top: 0, right: 0 });
  const pillRef    = useRef(null);
  const historyBtnRef = useRef(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/sync/status`);
      if (res.ok) { setStatus(await res.json()); setFetchError(false); }
      else          setFetchError(true);
    } catch { setFetchError(true); }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/sync/history?limit=20`);
      if (res.ok) setHistory(await res.json());
    } catch { /* non-fatal */ }
  }, []);

  const handleSync = useCallback(async () => {
    if (syncing || status?.isScanning) return;
    setSyncing(true);
    try {
      const res = await fetch(`${API_BASE}/api/sync/start`, { method: 'POST' });
      if (!res.ok) setSyncing(false);
      else await fetchStatus();
    } catch { setSyncing(false); }
  }, [syncing, status?.isScanning, fetchStatus]);

  const toggleHistory = useCallback(async () => {
    if (!showHistory) {
      await fetchHistory();
      if (historyBtnRef.current) {
        const r = historyBtnRef.current.getBoundingClientRect();
        setPopoverPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
      }
    }
    setShowHistory(v => !v);
  }, [showHistory, fetchHistory]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Clear local syncing flag once server confirms it started
  useEffect(() => {
    if (status?.isScanning && syncing) setSyncing(false);
  }, [status?.isScanning, syncing]);

  // Close history popover on outside click
  useEffect(() => {
    if (!showHistory) return;
    const handler = (e) => { if (pillRef.current && !pillRef.current.contains(e.target)) setShowHistory(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showHistory]);

  const isScanning   = status?.isScanning || syncing;
  const lastScanTime = status?.lastScan
    ? new Date(status.lastScan).toLocaleString([], { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null;

  const buildSubtitle = () => {
    if (!isScanning) return lastScanTime ? `Updated ${lastScanTime}` : 'Never synced';
    if (!status)     return 'Starting…';
    const { progress, total, percent, currentJob } = status;
    if (total > 0 && progress > 0) return `${progress.toLocaleString()} / ${total.toLocaleString()} — ${percent ?? 0}%`;
    return currentJob || 'Processing…';
  };

  // ── Server offline ──────────────────────────────────────────────────────────
  if (fetchError) {
    return (
      <div className="sync-pill" title="Cannot reach the library server">
        <div className="sync-status">
          <span className="dot" style={{ background: 'var(--red)' }} />
          <div>
            <div className="lbl">SERVER OFFLINE</div>
            <div className="sub">Cannot reach API</div>
          </div>
        </div>
        <button className="sync-btn" onClick={fetchStatus}>
          <SyncIcon spinning={false} />
          <span>Retry</span>
        </button>
      </div>
    );
  }

  // ── Normal / scanning ───────────────────────────────────────────────────────
  return (
    <div className="sync-pill" style={{ position: 'relative' }} ref={pillRef}
         title={`Library index — last scan ${lastScanTime ?? 'never'}`}>
      <div className="sync-status">
        <span className="dot" style={{ background: isScanning ? 'var(--amber)' : 'var(--green)' }} />
        <div>
          <div className="lbl">{isScanning ? 'SYNCING...' : 'LIBRARY READY'}</div>
          <div className="sub">{buildSubtitle()}</div>
          {/* Summary badges — show last run results even while a new sync is in progress */}
          {status?.summary && (
            <div className="sync-summary">
              {status.summary.newRecords > 0 && <span className="sync-new">+{status.summary.newRecords} new</span>}
              {status.summary.extracted  > 0 && <span>🖼 {status.summary.extracted}</span>}
              {status.summary.stale      > 0 && <span className="sync-stale">⚠ {status.summary.stale} stale</span>}
              {status.summary.failed     > 0 && <span className="sync-failed">✗ {status.summary.failed} failed</span>}
            </div>
          )}
        </div>
      </div>

      {/* Animated progress bar during active sync */}
      {isScanning && status?.total > 0 && (
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0,
          height: 3, background: 'rgba(255,255,255,0.12)',
          borderRadius: '0 0 10px 10px', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.max(2, status.percent ?? 0)}%`,
            background: 'var(--amber)', transition: 'width 0.6s ease' }} />
        </div>
      )}

      {status?.lastError && !isScanning && (
        <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 2, maxWidth: 200, wordBreak: 'break-word' }}>
          {status.lastError}
        </div>
      )}

      {/* History button */}
      <button
        ref={historyBtnRef}
        className="sync-btn sync-history-btn"
        onClick={toggleHistory}
        title="Sync history"
        style={{ borderRight: '1px solid var(--border)', padding: '0 12px' }}
      >
        <HistoryIcon />
      </button>

      {/* Sync Now button */}
      <button
        className="sync-btn"
        onClick={handleSync}
        disabled={isScanning}
        style={{ cursor: isScanning ? 'default' : 'pointer' }}
      >
        <SyncIcon spinning={isScanning} />
        <span>{isScanning ? 'Syncing…' : 'Sync Now'}</span>
      </button>

      {/* History popover — fixed so it escapes any overflow:hidden parent */}
      {showHistory && (
        <div className="sync-history-popover"
          style={{ position: 'fixed', top: popoverPos.top, right: popoverPos.right, left: 'auto' }}
        >
          <div className="sync-history-header">Sync History</div>
          {history.length === 0 ? (
            <div className="sync-history-empty">No sync runs recorded yet.</div>
          ) : (
            <table className="sync-history-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>New</th>
                  <th>Imgs</th>
                  <th>Stale</th>
                  <th>Fail</th>
                  <th>Total</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {history.map(row => (
                  <tr key={row.id} className={row.error ? 'sync-row-error' : ''}>
                    <td>{new Date(row.ran_at).toLocaleString([], { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                    <td className="sync-new">{row.new_records > 0 ? `+${row.new_records}` : '—'}</td>
                    <td>{row.extracted > 0 ? row.extracted : '—'}</td>
                    <td className={row.stale > 0 ? 'sync-stale' : ''}>{row.stale > 0 ? row.stale : '—'}</td>
                    <td className={row.failed > 0 ? 'sync-failed' : ''}>{row.failed > 0 ? row.failed : '—'}</td>
                    <td>{row.total.toLocaleString()}</td>
                    <td>{row.duration_s != null ? `${row.duration_s}s` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }` }} />
    </div>
  );
}

function SyncIcon({ spinning }) {
  return (
    <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}
      style={{ animation: spinning ? 'spin 2s linear infinite' : 'none', flexShrink: 0 }}>
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5M3 21v-5h5" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5} style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}
