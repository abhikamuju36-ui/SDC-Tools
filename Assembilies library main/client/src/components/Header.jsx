import SyncStatus from './SyncStatus';

export default function Header({
  search,
  setSearch,
  searchRef,
  setShowAddModal,
  toggleTheme,
  theme,
}) {
  return (
    <div className="topbar">
      {/* zone-mid: search fills remaining space */}
      <div className="zone-mid">
        <div className="search-container">
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5} style={{ opacity: 0.5 }}>
            <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={searchRef}
            type="text"
            placeholder="Search assemblies — part number, job ID, description…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { setSearch(''); e.currentTarget.blur(); } }}
          />
          {search ? (
            <button
              onClick={() => setSearch('')}
              style={{ display: 'flex', alignItems: 'center', color: 'var(--ink-4)', cursor: 'pointer' }}
              title="Clear search"
            >
              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          ) : (
            <span className="kbd">⌘K</span>
          )}
        </div>
      </div>

      {/* zone-right: sync + add + theme + avatar */}
      <div className="zone-right">
        <SyncStatus />
        
        <div className="divider" />

        <button
          className="btn btn-ghost btn-icon"
          onClick={() => window.location.reload()}
          title="Refresh Application"
        >
          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>

        <button
          className="btn btn-ghost btn-icon"
          onClick={() => setShowAddModal(true)}
          title="Add assembly record"
        >
          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path d="M12 4v16m8-8H4" />
          </svg>
        </button>

        <button
          className="btn btn-ghost btn-icon"
          onClick={toggleTheme}
          title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
        >
          {theme === 'light' ? (
            <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          ) : (
            <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path d="M12 3v1m0 16v1m9-9h-1M4 9H3m3.343-5.657l-.707.707m12.728 12.728l-.707.707M6.343 17.657l-.707-.707M17.657 6.343l-.707-.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          )}
        </button>

        <div className="avatar" style={{ width: 32, height: 32, borderRadius: '999px', background: 'var(--sdc-blue-tint)', color: 'var(--sdc-blue-ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>
          MC
        </div>
      </div>
    </div>
  );
}
