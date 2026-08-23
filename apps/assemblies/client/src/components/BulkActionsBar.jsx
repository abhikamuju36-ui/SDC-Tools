export default function BulkActionsBar({
  selectedPartnos,
  setSelectedPartnos,
  setShowBulkDelete,
  showBulkDelete,
  bulkPassword,
  setBulkPassword,
  handleBulkDelete,
  bulkAction,
  setBulkAction,
  handleBulkUpdate,
  bulkLoading = false,
}) {
  if (!selectedPartnos || selectedPartnos.size === 0) return null;

  const handleClear = () => {
    setSelectedPartnos(new Set());
    setShowBulkDelete(false);
    setBulkPassword('');
    setBulkAction(null);
  };

  return (
    <div className="bulk-bar">
      <span className="bulk-count">
        <b>{selectedPartnos.size}</b> SELECTED
      </span>

      <button className="btn btn-sm btn-ghost" style={{ color: 'rgba(255,255,255,0.6)', padding: '0 8px' }} onClick={handleClear}>
        CLEAR
      </button>

      <div className="bulk-divider" />

      {/* Bulk Preference */}
      {bulkAction === 'pref' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.04em' }}>SET PREFERENCE:</span>
          {['Yes', 'No'].map(v => (
            <button key={v} className="btn btn-sm btn-primary" style={{ height: 28 }} disabled={bulkLoading} onClick={() => handleBulkUpdate('preference', v)}>{bulkLoading ? '…' : v}</button>
          ))}
          <button className="btn btn-sm btn-ghost" style={{ color: 'rgba(255,255,255,0.5)' }} disabled={bulkLoading} onClick={() => setBulkAction(null)}>CANCEL</button>
        </div>
      ) : bulkAction !== 'sdc' && !showBulkDelete && (
        <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', height: 32 }} onClick={() => { setBulkAction('pref'); setShowBulkDelete(false); }}>
          SET PREFERENCE
        </button>
      )}

      {/* Bulk SDC Standard */}
      {bulkAction === 'sdc' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.04em' }}>SET SDC STD:</span>
          {['Yes', 'No'].map(v => (
            <button key={v} className="btn btn-sm btn-primary" style={{ height: 28 }} disabled={bulkLoading} onClick={() => handleBulkUpdate('sdc_standard', v)}>{bulkLoading ? '…' : v}</button>
          ))}
          <button className="btn btn-sm btn-ghost" style={{ color: 'rgba(255,255,255,0.5)' }} disabled={bulkLoading} onClick={() => setBulkAction(null)}>CANCEL</button>
        </div>
      ) : bulkAction !== 'pref' && !showBulkDelete && (
        <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', height: 32 }} onClick={() => { setBulkAction('sdc'); setShowBulkDelete(false); }}>
          SET SDC STANDARD
        </button>
      )}

      <div className="bulk-divider" />

      {/* Bulk Delete */}
      {!showBulkDelete && bulkAction === null ? (
        <button className="btn btn-sm" style={{ background: 'var(--red)', color: '#fff', border: 'none', height: 32, fontWeight: 700 }} onClick={() => setShowBulkDelete(true)}>
          DELETE RECORDS
        </button>
      ) : showBulkDelete && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            type="password"
            placeholder="Admin password..."
            autoFocus
            value={bulkPassword}
            onChange={e => setBulkPassword(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && bulkPassword) handleBulkDelete();
              if (e.key === 'Escape') { setShowBulkDelete(false); setBulkPassword(''); }
            }}
            style={{ 
              width: 160, height: 32, padding: '0 12px', 
              background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,0,0,0.5)', 
              borderRadius: 6, color: '#fff', fontSize: 13, outline: 'none'
            }}
          />
          <button
            className="btn btn-sm"
            style={{ background: 'var(--red)', color: '#fff', border: 'none', height: 32, fontWeight: 700 }}
            onClick={handleBulkDelete}
            disabled={!bulkPassword || bulkLoading}
          >
            {bulkLoading ? 'DELETING…' : 'CONFIRM DELETE'}
          </button>
          <button className="btn btn-sm btn-ghost" style={{ color: 'rgba(255,255,255,0.5)' }} onClick={() => { setShowBulkDelete(false); setBulkPassword(''); }}>CANCEL</button>
        </div>
      )}
    </div>
  );
}
