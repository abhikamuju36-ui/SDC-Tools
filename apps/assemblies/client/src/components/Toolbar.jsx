import ColumnPicker from './ColumnPicker';

export default function Toolbar({
  viewMode,
  setViewMode,
  showFilterPanel,
  setShowFilterPanel,
  setPreviewAssembly,
  total,
  lastScan,
  colsOpen,
  setColsOpen,
  visibleCols,
  setVisibleCols,
}) {
  const lastScanText = lastScan 
    ? `last scan ${new Date(lastScan).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : 'never scanned';

  return (
    <div className="toolbar">
      <div className="zone-left" style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)' }}>All assemblies</span>
        <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>
          {total.toLocaleString()} indexed · {lastScanText}
        </span>
      </div>

      <div className="right">
        <div className="seg">
          <button 
            className={viewMode === 'table' ? 'on' : ''} 
            onClick={() => { setViewMode('table'); setPreviewAssembly(null); }}
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>
            </svg>
            List
          </button>
          <button 
            className={viewMode === 'split' ? 'on' : ''} 
            onClick={() => setViewMode('split')}
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <rect x="3" y="4" width="8" height="16"/><rect x="13" y="4" width="8" height="16"/>
            </svg>
            Split
          </button>
          <button 
            className={viewMode === 'grid' ? 'on' : ''} 
            onClick={() => { setViewMode('grid'); setPreviewAssembly(null); }}
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
            </svg>
            Gallery
          </button>
        </div>

        <div className="divider" style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />

        <button 
          className={`btn btn-sm ${showFilterPanel ? 'on' : ''}`} 
          onClick={() => setShowFilterPanel(!showFilterPanel)}
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path d="M3 5h18l-7 9v6l-4-2v-4Z"/>
          </svg>
          Filters
        </button>

        <div style={{ position: 'relative' }}>
          <button className={`btn btn-sm cols-trigger ${colsOpen ? 'on' : ''}`} onClick={() => setColsOpen(o => !o)}>
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <rect x="3" y="4" width="18" height="16"/><path d="M9 4v16M15 4v16"/>
            </svg>
            Columns
          </button>
          {colsOpen && <ColumnPicker visible={visibleCols} setVisible={setVisibleCols} />}
        </div>

      </div>
    </div>
  );
}
