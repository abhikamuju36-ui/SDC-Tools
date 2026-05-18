import { useState, useEffect, useCallback } from 'react';

import API_BASE from '../utils/apiBase';

export default function SyncStatus() {
  const [status, setStatus]         = useState(null);
  const [syncing, setSyncing]       = useState(false);
  const [fetchError, setFetchError] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/sync/status`);
      if (res.ok) {
        setStatus(await res.json());
        setFetchError(false);
      } else {
        setFetchError(true);
      }
    } catch {
      setFetchError(true);
    }
  }, []);

  const handleSync = useCallback(async () => {
    if (syncing || status?.isScanning) return;
    setSyncing(true);
    try {
      const res = await fetch(`${API_BASE}/api/sync/start`, { method: 'POST' });
      if (!res.ok) setSyncing(false);
      else await fetchStatus();
    } catch {
      setSyncing(false);
    }
  }, [syncing, status?.isScanning, fetchStatus]);


  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Once server confirms scanning, clear our local 'syncing' flag
  useEffect(() => {
    if (status?.isScanning && syncing) setSyncing(false);
  }, [status?.isScanning, syncing]);

  const isScanning   = status?.isScanning || syncing;
  const lastScanTime = status?.lastScan
    ? new Date(status.lastScan).toLocaleString([], {
        month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
      })
    : 'Never';

  // Subtitle shown under the status label — shows real progress during sync
  const buildSubtitle = () => {
    if (!isScanning) return `Updated ${lastScanTime}`;
    if (!status)     return 'Starting…';
    const { progress, total, percent, currentJob } = status;
    if (total > 0 && progress > 0) {
      return `${progress.toLocaleString()} / ${total.toLocaleString()} — ${percent ?? 0}%`;
    }
    return currentJob || 'Processing…';
  };

  // ── Server offline ─────────────────────────────────────────────────────────
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

  // ── Normal / scanning ──────────────────────────────────────────────────────
  return (
    <div className="sync-pill" style={{ position: 'relative' }} title={`Library index — last scan ${lastScanTime}`}>
      <div className="sync-status">
        <span className="dot" style={{ background: isScanning ? 'var(--amber)' : 'var(--green)' }} />
        <div>
          <div className="lbl">{isScanning ? 'SYNCING...' : 'LIBRARY READY'}</div>
          <div className="sub">{buildSubtitle()}</div>
        </div>
      </div>

      {/* Animated progress bar during active sync */}
      {isScanning && status?.total > 0 && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          height: 3, background: 'rgba(255,255,255,0.12)',
          borderRadius: '0 0 10px 10px', overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            width: `${Math.max(2, status.percent ?? 0)}%`,
            background: 'var(--amber)',
            transition: 'width 0.6s ease',
          }} />
        </div>
      )}

      {status?.lastError && !isScanning && (
        <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 2, maxWidth: 200, wordBreak: 'break-word' }}>
          {status.lastError}
        </div>
      )}
      {status?.summary && !isScanning && (
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', marginTop: 2, display: 'flex', gap: 8 }}>
          {status.summary.newRecords > 0 && <span style={{ color: 'var(--green)' }}>+{status.summary.newRecords} new</span>}
          {status.summary.extracted  > 0 && <span>🖼 {status.summary.extracted}</span>}
          {status.summary.stale      > 0 && <span style={{ color: 'var(--amber)' }}>⚠ {status.summary.stale} stale</span>}
          {status.summary.failed     > 0 && <span style={{ color: 'var(--red)' }}>✗ {status.summary.failed} failed</span>}
        </div>
      )}

      <button
        className="sync-btn"
        onClick={handleSync}
        disabled={isScanning}
        style={{ cursor: isScanning ? 'default' : 'pointer' }}
      >
        <SyncIcon spinning={isScanning} />
        <span>{isScanning ? 'Syncing…' : 'Sync Now'}</span>
      </button>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}} />
    </div>
  );
}

function SyncIcon({ spinning }) {
  return (
    <svg
      width="13" height="13" fill="none" stroke="currentColor"
      viewBox="0 0 24 24" strokeWidth={2.5}
      style={{ animation: spinning ? 'spin 2s linear infinite' : 'none', flexShrink: 0 }}
    >
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5M3 21v-5h5" />
    </svg>
  );
}
