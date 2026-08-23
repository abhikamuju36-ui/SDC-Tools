import { useState, useCallback, useEffect, useRef } from 'react';
import FilterBar from './components/FilterBar.jsx';
import AssemblyCard from './components/AssemblyCard.jsx';
import AssemblyTable from './components/AssemblyTable.jsx';
import AssemblyModal from './components/AssemblyModal.jsx';
import AddAssemblyModal from './components/AddAssemblyModal.jsx';
import SkeletonCard from './components/SkeletonCard.jsx';
import Toast from './components/Toast.jsx';
import Header from './components/Header.jsx';
import Sidebar from './components/Sidebar.jsx';
import BulkActionsBar from './components/BulkActionsBar.jsx';
import PreviewPane from './components/PreviewPane.jsx';
import AdvancedFilterPanel from './components/AdvancedFilterPanel.jsx';
import Toolbar from './components/Toolbar.jsx';
import Brand from './components/Brand.jsx';
import useAssemblies from './hooks/useAssemblies.js';
import ErrorBoundary from './components/ErrorBoundary.jsx';

import { loadVisibleCols, STORAGE_KEYS } from './utils/storage';
import { LIMIT } from './constants';

import API_BASE from './utils/apiBase';

export default function App() {

  const [theme, setTheme]                           = useState(() => localStorage.getItem(STORAGE_KEYS.THEME) || 'light');
  const [search, setSearch]                         = useState('');
  const [visibleCols, setVisibleCols]               = useState(loadVisibleCols);
  const [colsOpen, setColsOpen]                     = useState(false);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [selectedJobIds, setSelectedJobIds]         = useState([]);
  const [selectedPreferences,  setSelectedPreferences]  = useState([]);
  const [selectedSdcStandards, setSelectedSdcStandards] = useState([]);
  const [selectedImageFilter, setSelectedImageFilter]   = useState([]);
  const [selectedModelFilter, setSelectedModelFilter]   = useState([]);
  const [selectedLibraries, setSelectedLibraries]     = useState([]);
  const [selectedStatusFilter, setSelectedStatusFilter] = useState('');
  const [updatedAfter,  setUpdatedAfter]              = useState('');
  const [updatedBefore, setUpdatedBefore]             = useState('');
  const [sortBy, setSortBy]                         = useState('job_id');
  const [sortOrder, setSortOrder]                   = useState('ASC');

  const [page, setPage]                             = useState(1);
  const [viewMode, setViewMode]                     = useState(() => localStorage.getItem(STORAGE_KEYS.VIEW_MODE) || 'split');
  const [selectedAssembly, setSelectedAssembly]     = useState(null);
  const [previewAssembly, setPreviewAssembly]       = useState(null);
  const [toast, setToast]                           = useState(null);
  const [selectedPartnos, setSelectedPartnos]       = useState(new Set());
  const [showBulkDelete, setShowBulkDelete]         = useState(false);
  const [bulkPassword, setBulkPassword]             = useState('');
  const [bulkAction,   setBulkAction]               = useState(null);
  const [showAddModal, setShowAddModal]             = useState(false);
  const [showFilterPanel, setShowFilterPanel]       = useState(false);
  const [searchFields, setSearchFields]             = useState(['description']);

  const [bulkLoading, setBulkLoading]               = useState(false);

  const [categories, setCategories] = useState([]);
  const [jobs, setJobs]             = useState([]);
  const [libraries, setLibraries]   = useState([]);
  const [lastScan, setLastScan]     = useState(null);
  const [globalTotal, setGlobalTotal] = useState(0);
  const [sdcStandardCount, setSdcStandardCount] = useState(0);
  const [preferredCount, setPreferredCount]     = useState(0);

  const fetchMeta = useCallback(() => {
    // Single batched request for categories, jobs, libraries, status
    fetch(`${API_BASE}/api/assemblies/meta`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return;
        setCategories(Array.isArray(d.categories) ? d.categories : []);
        setJobs(Array.isArray(d.jobs) ? d.jobs : []);
        setLibraries(Array.isArray(d.libraries) ? d.libraries : []);
        setLastScan(d.status?.lastScan ?? null);
      })
      .catch(e => {
        console.error('fetch meta failed', e);
        // Fallback to individual endpoints
        fetch(`${API_BASE}/api/assemblies/categories`).then(r => r.ok ? r.json() : []).then(d => setCategories(Array.isArray(d) ? d : [])).catch(() => setCategories([]));
        fetch(`${API_BASE}/api/assemblies/jobs`).then(r => r.ok ? r.json() : []).then(d => setJobs(Array.isArray(d) ? d : [])).catch(() => setJobs([]));
        fetch(`${API_BASE}/api/assemblies/libraries`).then(r => r.ok ? r.json() : []).then(d => setLibraries(Array.isArray(d) ? d : [])).catch(() => setLibraries([]));
        fetch(`${API_BASE}/api/assemblies/status`).then(r => r.ok ? r.json() : { lastScan: null }).then(d => setLastScan(d.lastScan)).catch(() => setLastScan(null));
      });

    // Fetch counts for sidebar
    fetch(`${API_BASE}/api/assemblies/counts`).then(r => r.ok ? r.json() : { globalTotal: 0, sdcStandardCount: 0, preferredCount: 0 }).then(d => {
      setGlobalTotal(d.globalTotal || 0);
      setSdcStandardCount(d.sdcStandardCount || 0);
      setPreferredCount(d.preferredCount || 0);
    }).catch(() => {});

  }, []);


  useEffect(() => { fetchMeta(); }, [fetchMeta]);

  const { data, total, loading, error, hasMore, refetch: _refetch } = useAssemblies({
    search,
    searchFields,
    categories: selectedCategories,
    jobIds: selectedJobIds,
    preferences:  selectedPreferences,
    sdcStandards: selectedSdcStandards,
    imageFilter: selectedImageFilter,
    modelFilter: selectedModelFilter,
    libraries: selectedLibraries,
    statusFilter: selectedStatusFilter,
    updatedAfter,
    updatedBefore,
    sortBy,
    sortOrder,
    page,
    limit: LIMIT,
  });

  const refetch = useCallback(() => {
    fetchMeta();
    if (page === 1) { _refetch(); } else { setPage(1); }
  }, [page, _refetch, fetchMeta]);

  const loadMoreRef  = useRef(null);
  const searchRef    = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select();
      }
      if (e.key === 'Escape') {
        setPreviewAssembly(null);
        setColsOpen(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (viewMode !== 'grid') return;
    if (!hasMore || loading) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setPage(p => p + 1); },
      { threshold: 0.1 }
    );
    if (loadMoreRef.current) observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [hasMore, loading, viewMode]);

  useEffect(() => { 
    localStorage.setItem(STORAGE_KEYS.THEME, theme); 
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.VIEW_MODE, viewMode); }, [viewMode]);
  
  useEffect(() => {
    setPage(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, searchFields.join(','), selectedCategories, selectedJobIds, selectedPreferences, selectedSdcStandards, selectedImageFilter, selectedModelFilter, selectedLibraries, selectedStatusFilter, updatedAfter, updatedBefore, sortBy, sortOrder]);

  const toggleTheme = () => setTheme(t => t === 'light' ? 'dark' : 'light');

  const handleHomeReset = useCallback(() => {
    setSearch(''); setSearchFields(['description']);
    setSelectedCategories([]); setSelectedJobIds([]);
    setSelectedPreferences([]); setSelectedSdcStandards([]);
    setSelectedImageFilter([]); setSelectedModelFilter([]);
    setSelectedLibraries([]); setSortBy('job_id'); setSortOrder('ASC');
    setSelectedStatusFilter(''); setUpdatedAfter(''); setUpdatedBefore('');

    setPage(1); setSelectedAssembly(null); setPreviewAssembly(null);
    setShowFilterPanel(false);
  }, []);

  const showToast = useCallback((message, type = 'success') => {
    // Errors stay until the user clicks dismiss; success auto-disappears after 3.5 s
    if (type === 'error') {
      setToast({ message, type, leaving: false, persistent: true });
    } else {
      setToast({ message, type, leaving: false, persistent: false });
      setTimeout(() => setToast(prev => prev ? { ...prev, leaving: true } : null), 2800);
      setTimeout(() => setToast(null), 3500);
    }
  }, []);

  const handleSave = useCallback(async (partNumber, updates) => {
    const res = await fetch(`${API_BASE}/api/assemblies/${encodeURIComponent(partNumber)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates),
    });

    const json = res.ok ? await res.json() : { error: 'Save failed' };
    if (!res.ok) throw new Error(json.error || 'Save failed');
    showToast('Assembly saved successfully');
    refetch();
    setSelectedAssembly(prev => prev ? { ...prev, ...updates, ...(json.updated || {}) } : prev);
  }, [refetch, showToast]);

  const handleSaveWrapped = useCallback(async (partNumber, updates) => {
    try { await handleSave(partNumber, updates); } catch (e) { showToast(e.message, 'error'); throw e; }
  }, [handleSave, showToast]);

  const handleAdd = useCallback(async (fields) => {
    const res = await fetch(`${API_BASE}/api/assemblies`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields),
    });

    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || json.error || 'Create failed');
    showToast('Assembly added successfully');
    refetch(); fetchMeta();
  }, [refetch, showToast, fetchMeta]);

  const handleDelete = useCallback(async (partNumber, password) => {
    const res = await fetch(`${API_BASE}/api/assemblies/${encodeURIComponent(partNumber)}`, {
      method: 'DELETE', headers: { 'X-Delete-Password': password },
    });

    if (!res.ok) { const json = await res.json(); throw new Error(json?.detail || json?.error || 'Delete failed'); }
    showToast('Assembly removed successfully');
    refetch(); fetchMeta(); setSelectedAssembly(null);
  }, [refetch, showToast, fetchMeta]);

  const handleDeleteWrapped = useCallback(async (partNumber, password) => {
    try { await handleDelete(partNumber, password); } catch (e) { showToast(e.message, 'error'); }
  }, [handleDelete, showToast]);

  const handleArchive = useCallback(async (partNumber, restore = false) => {
    const action = restore ? 'restore' : 'archive';
    try {
      const res = await fetch(`${API_BASE}/api/assemblies/${encodeURIComponent(partNumber)}/${action}`, { method: 'PATCH' });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error || `${action} failed`); }
      showToast(restore ? 'Assembly restored' : 'Assembly archived');
      refetch(); setSelectedAssembly(null);
    } catch (e) {
      showToast(e.message, 'error');
    }
  }, [refetch, showToast]);

  const handleHeaderSort = useCallback((field) => {
    if (sortBy === field) {
      setSortOrder(prev => prev === 'ASC' ? 'DESC' : 'ASC');
    } else {
      setSortBy(field);
      setSortOrder('ASC');
    }
    setPage(1);
  }, [sortBy]);

  const handleToggleSelect = useCallback((partno, checked) => {
    setSelectedPartnos(prev => {
      const next = new Set(prev);
      if (checked) next.add(partno); else next.delete(partno);
      return next;
    });
  }, []);

  const handleBulkUpdate = useCallback(async (field, value) => {
    if (bulkLoading) return;
    setBulkLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/assemblies`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnos: [...selectedPartnos], field, value }),
      });

      const json = await res.json();
      if (!res.ok) { showToast(json?.detail || json?.error || 'Update failed', 'error'); return; }
      showToast(`${json.updated} record${json.updated !== 1 ? 's' : ''} updated`);
      setBulkAction(null); refetch();
    } catch (e) {
      showToast(e.message || 'Update failed', 'error');
    } finally {
      setBulkLoading(false);
    }
  }, [bulkLoading, selectedPartnos, showToast, refetch]);

  const handleBulkDelete = useCallback(async () => {
    if (bulkLoading) return;
    setBulkLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/assemblies`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'X-Delete-Password': bulkPassword },
        body: JSON.stringify({ partnos: [...selectedPartnos] }),
      });

      const json = await res.json();
      if (!res.ok) { showToast(json?.detail || json?.error || 'Delete failed', 'error'); return; }
      showToast(`${json.deleted} record${json.deleted !== 1 ? 's' : ''} deleted`);
      setSelectedPartnos(new Set()); setShowBulkDelete(false); setBulkPassword(''); refetch();
    } catch (e) {
      showToast(e.message || 'Delete failed', 'error');
    } finally {
      setBulkLoading(false);
    }
  }, [bulkLoading, bulkPassword, selectedPartnos, showToast, refetch]);

  const handleCategoryClick = useCallback((cat) => {
    setSelectedCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [cat]
    );
    setSelectedSdcStandards([]); setSelectedPreferences([]);
    setPage(1);
  }, []);

  const handleSdcStandardClick = useCallback(() => {
    setSelectedSdcStandards(prev => prev.length ? [] : ['Yes']);
    setSelectedPreferences([]); setSelectedCategories([]);
    setPage(1);
  }, []);

  const handlePreferredClick = useCallback(() => {
    setSelectedPreferences(prev => prev.length ? [] : ['Yes']);
    setSelectedSdcStandards([]); setSelectedCategories([]);
    setPage(1);
  }, []);

  useEffect(() => {
    if (!colsOpen) return;
    const handler = e => { 
      if (!e.target.closest('.cols-trigger') && !e.target.closest('.column-picker')) {
        setColsOpen(false); 
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [colsOpen]);

  return (
    <div className="app-container">
      <ErrorBoundary>
      <Brand theme={theme} onClick={handleHomeReset} />

      <Header
        search={search}
        setSearch={setSearch}
        searchRef={searchRef}
        setShowAddModal={setShowAddModal}
        toggleTheme={toggleTheme}
        theme={theme}
      />

      <Sidebar
        categories={categories}
        selectedCategories={selectedCategories}
        onCategoryClick={handleCategoryClick}
        total={globalTotal}
        sdcStandardCount={sdcStandardCount}
        preferredCount={preferredCount}
        onAllClick={handleHomeReset}
        onSdcStandardClick={handleSdcStandardClick}
        onPreferredClick={handlePreferredClick}
        sdcStandardActive={selectedSdcStandards.length > 0}
        preferredActive={selectedPreferences.length > 0}
      />

      <main className="main-content">
        <Toolbar
          viewMode={viewMode}
          setViewMode={setViewMode}
          showFilterPanel={showFilterPanel}
          setShowFilterPanel={setShowFilterPanel}
          setPreviewAssembly={setPreviewAssembly}
          total={globalTotal}
          lastScan={lastScan}
          colsOpen={colsOpen}
          setColsOpen={setColsOpen}
          visibleCols={visibleCols}
          setVisibleCols={setVisibleCols}
        />

        <div style={{ flex: 1, display: 'flex', flexDirection: 'row', minHeight: 0, overflow: 'hidden' }}>
          {showFilterPanel && (
            <AdvancedFilterPanel
              categories={(categories || []).filter(Boolean)}
              selectedCategories={selectedCategories}
              onCategoriesChange={setSelectedCategories}
              selectedSdcStandards={selectedSdcStandards}
              onSdcStandardsChange={setSelectedSdcStandards}
              jobs={(jobs || []).filter(Boolean)}
              selectedJobIds={selectedJobIds}
              onJobIdsChange={setSelectedJobIds}
              selectedModelFilter={selectedModelFilter}
              onModelFilterChange={setSelectedModelFilter}
              selectedImageFilter={selectedImageFilter}
              onImageFilterChange={setSelectedImageFilter}
              libraries={(libraries || []).filter(Boolean)}
              selectedLibraries={selectedLibraries}
              onLibrariesChange={setSelectedLibraries}
              searchFields={searchFields}
              onSearchFieldsChange={setSearchFields}
              selectedStatusFilter={selectedStatusFilter}
              onStatusFilterChange={setSelectedStatusFilter}
              updatedAfter={updatedAfter}
              onUpdatedAfterChange={setUpdatedAfter}
              updatedBefore={updatedBefore}
              onUpdatedBeforeChange={setUpdatedBefore}
              onReset={handleHomeReset}
              onClose={() => setShowFilterPanel(false)}
            />
          )}

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
            <FilterBar
              search={search}
              onSearchClear={() => setSearch('')}
              selectedCategories={selectedCategories} onCategoriesChange={setSelectedCategories}
              selectedJobIds={selectedJobIds} onJobIdsChange={setSelectedJobIds}
              selectedSdcStandards={selectedSdcStandards} onSdcStandardsChange={setSelectedSdcStandards}
              selectedImageFilter={selectedImageFilter} onImageFilterChange={setSelectedImageFilter}
              selectedModelFilter={selectedModelFilter} onModelFilterChange={setSelectedModelFilter}
              selectedLibraries={selectedLibraries} onLibrariesChange={setSelectedLibraries}
              searchFields={searchFields} onSearchFieldsChange={setSearchFields}
              sortBy={sortBy} onSortByChange={setSortBy}
              sortOrder={sortOrder} onSortOrderToggle={() => setSortOrder(o => o === 'ASC' ? 'DESC' : 'ASC')}
              total={total} onClearAll={handleHomeReset}
              onAddFilter={() => setShowFilterPanel(true)}
              searchTime={18}
              colsOpen={colsOpen} setColsOpen={setColsOpen}
              visibleCols={visibleCols} setVisibleCols={setVisibleCols}
              filterState={{ selectedCategories, selectedJobIds, selectedSdcStandards, selectedModelFilter, selectedImageFilter, searchFields }}
              onApplyPreset={(f) => {
                if (f.selectedCategories !== undefined)   setSelectedCategories(f.selectedCategories);
                if (f.selectedJobIds !== undefined)       setSelectedJobIds(f.selectedJobIds);
                if (f.selectedSdcStandards !== undefined) setSelectedSdcStandards(f.selectedSdcStandards);
                if (f.selectedModelFilter !== undefined)  setSelectedModelFilter(f.selectedModelFilter);
                if (f.selectedImageFilter !== undefined)  setSelectedImageFilter(f.selectedImageFilter);
                if (f.searchFields !== undefined)         setSearchFields(f.searchFields);
                setPage(1);
              }}
            />

          <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
            {error && (
              <div style={{
                position: 'absolute', top: 12, left: 12, right: 12, zIndex: 50,
                padding: '12px 16px', background: '#FEF2F2', border: '1px solid #FECACA',
                borderRadius: 'var(--radius)', fontSize: 13, color: 'var(--red)',
                display: 'flex', alignItems: 'center', gap: 10, boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
              }}>
                <svg width="18" height="18" fill="currentColor" viewBox="0 0 20 20" style={{ flexShrink: 0 }}>
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <span style={{ flex: 1 }}>{error}</span>
                <button
                  onClick={refetch}
                  style={{ background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700, flexShrink: 0 }}
                >
                  Retry
                </button>
              </div>
            )}

            {loading && page === 1 ? (
              <LoadingState viewMode={viewMode} />
            ) : data.length === 0 ? (
              <EmptyState onReset={handleHomeReset} />
            ) : viewMode === 'grid' ? (
              <GridView data={data} onClick={setSelectedAssembly} selectedPartnos={selectedPartnos} onToggle={handleToggleSelect} loadMoreRef={loadMoreRef} hasMore={hasMore} loading={loading} total={total} />
            ) : viewMode === 'split' ? (
              <div style={{ flex: 1, display: 'grid', gridTemplateColumns: `1fr ${previewAssembly ? '460px' : '0px'}`, minHeight: 0, overflow: 'hidden' }}>
                <TableView
                  data={data} onEdit={a => { setPreviewAssembly(a); }}
                  selectedPartnos={selectedPartnos} onToggle={handleToggleSelect}
                  search={search} setPage={setPage} hasMore={hasMore} loading={loading} total={total}
                  highlightPartno={previewAssembly?.partno}
                  visibleCols={visibleCols}
                  sortBy={sortBy} sortOrder={sortOrder} onSort={handleHeaderSort}
                />
                {previewAssembly && (
                  <PreviewPane
                    assembly={previewAssembly}
                    onClose={() => setPreviewAssembly(null)}
                    onEdit={a => { setSelectedAssembly(a); }}
                  />
                )}
              </div>
            ) : (
              <TableView 
                data={data} onEdit={setSelectedAssembly} selectedPartnos={selectedPartnos} 
                onToggle={handleToggleSelect} search={search} setPage={setPage} 
                hasMore={hasMore} loading={loading} total={total} visibleCols={visibleCols} 
                sortBy={sortBy} sortOrder={sortOrder} onSort={handleHeaderSort}
              />
            )}
          </div>
        </div>
      </div>
    </main>

      <AddAssemblyModal open={showAddModal} onClose={() => setShowAddModal(false)} onAdd={handleAdd} />
      <AssemblyModal assembly={selectedAssembly} onClose={() => setSelectedAssembly(null)} onSave={handleSaveWrapped} onDelete={handleDeleteWrapped} onArchive={handleArchive} allCategories={categories} />
      <BulkActionsBar selectedPartnos={selectedPartnos} setSelectedPartnos={setSelectedPartnos} setShowBulkDelete={setShowBulkDelete} showBulkDelete={showBulkDelete} bulkPassword={bulkPassword} setBulkPassword={setBulkPassword} handleBulkDelete={handleBulkDelete} bulkAction={bulkAction} setBulkAction={setBulkAction} handleBulkUpdate={handleBulkUpdate} bulkLoading={bulkLoading} />
      {toast && <Toast message={toast.message} type={toast.type} leaving={toast.leaving} persistent={toast.persistent} onDismiss={() => setToast(null)} />}
      </ErrorBoundary>
    </div>
  );
}

function LoadingState({ viewMode }) {
  if (viewMode === 'grid') {
    return (
      <div className="gallery-area">
        <div className="gallery-grid">
          {Array.from({ length: 12 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      </div>
    );
  }
  return (
    <div className="table-area">
      <table className="assembly-table">
        <thead><tr>{Array.from({ length: 8 }).map((_, i) => <th key={i}>&nbsp;</th>)}</tr></thead>
        <tbody>
          {Array.from({ length: 12 }).map((_, i) => (
            <tr key={i}>
              {Array.from({ length: 8 }).map((_, j) => (
                <td key={j}><div style={{ height: 14, width: '100%', background: 'var(--bg-alt)', borderRadius: 3, opacity: 0.5 }} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ onReset }) {
  return (
    <div className="empty" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingBottom: '10%' }}>
      <div style={{ width: 48, height: 48, background: 'var(--sdc-blue-tint)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
        <svg width="24" height="24" fill="none" stroke="var(--sdc-blue)" viewBox="0 0 24 24" strokeWidth={2}>
          <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px' }}>No assemblies found</h2>
      <p style={{ color: 'var(--ink-3)', fontSize: 13, maxWidth: 320, margin: '0 0 20px', textAlign: 'center' }}>Try adjusting your search or filters to see more results.</p>
      <button className="btn btn-primary" onClick={onReset}>Clear all filters</button>
    </div>
  );
}

function GridView({ data, onClick, selectedPartnos, onToggle, loadMoreRef, hasMore, loading, total }) {
  return (
    <div className="gallery-area custom-scrollbar">
      <div className="gallery-grid">
        {data.map(a => (
          <AssemblyCard key={a.partno} assembly={a} onClick={onClick} selected={selectedPartnos.has(a.partno)} onToggle={onToggle} />
        ))}
      </div>
      {hasMore && (
        <div ref={loadMoreRef} style={{ padding: '32px 0', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, color: 'var(--ink-4)', fontSize: 12, fontWeight: 600 }}>
          <svg style={{ animation: 'spin 1s linear infinite', width: 16, height: 16 }} fill="none" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.1" />
            <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          LOADING MORE...
        </div>
      )}
      {!hasMore && data.length > 0 && (
        <div style={{ padding: '32px 0', textAlign: 'center', fontSize: 11, color: 'var(--ink-4)', letterSpacing: '0.1em', fontWeight: 700 }}>
          {total.toLocaleString()} ASSEMBLIES TOTAL
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function TableView({ data, onEdit, selectedPartnos, onToggle, search, setPage, hasMore, loading, total, highlightPartno, visibleCols, sortBy, sortOrder, onSort }) {
  return (
    <AssemblyTable
      assemblies={data} onEdit={onEdit} selectedPartnos={selectedPartnos} onToggle={onToggle} search={search}
      onLoadMore={() => setPage(p => p + 1)} hasMore={hasMore} loading={loading} total={total}
      highlightPartno={highlightPartno} visibleCols={visibleCols}
      sortBy={sortBy} sortOrder={sortOrder} onSort={onSort}
    />
  );
}
