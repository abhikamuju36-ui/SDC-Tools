import { useState, useEffect, useRef } from 'react';
import ActiveChip from './Filter/ActiveChip';
import ColumnPicker from './ColumnPicker';
import { formatNumber } from '../utils/formatters';
import { STORAGE_KEYS } from '../utils/storage';

const SORT_OPTIONS = [
  { value: 'job_id', label: 'Job ID' },
  { value: 'updated_at', label: 'Recent' },
  { value: 'partno', label: 'Part No' },
  { value: 'category', label: 'Category' },
];

export default function FilterBar({
  search, onSearchClear,
  selectedCategories, onCategoriesChange,
  selectedJobIds, onJobIdsChange,
  selectedSdcStandards, onSdcStandardsChange,
  selectedImageFilter, onImageFilterChange,
  selectedModelFilter, onModelFilterChange,
  searchFields, onSearchFieldsChange,
  selectedLibraries, onLibrariesChange,
  sortBy, onSortByChange,
  sortOrder, onSortOrderToggle,
  total, onClearAll,
  onAddFilter,
  searchTime = 0,
  colsOpen, setColsOpen,
  visibleCols, setVisibleCols,
  filterState = null,
  onApplyPreset = null,
}) {
  const [sortOpen, setSortOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const sortRef = useRef(null);
  const presetsRef = useRef(null);

  const loadPresets = () => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.FILTER_PRESETS) || '[]'); } catch { return []; }
  };
  const [presets, setPresets] = useState(loadPresets);

  const savePreset = () => {
    const name = window.prompt('Name this filter preset:');
    if (!name || !name.trim()) return;
    const preset = {
      name: name.trim(),
      filters: filterState || {
        selectedCategories, selectedJobIds, selectedSdcStandards,
        selectedModelFilter, selectedImageFilter, searchFields,
      },
    };
    const updated = [...loadPresets(), preset];
    localStorage.setItem(STORAGE_KEYS.FILTER_PRESETS, JSON.stringify(updated));
    setPresets(updated);
  };

  const deletePreset = (idx) => {
    const updated = loadPresets().filter((_, i) => i !== idx);
    localStorage.setItem(STORAGE_KEYS.FILTER_PRESETS, JSON.stringify(updated));
    setPresets(updated);
  };

  const applyPreset = (preset) => {
    if (onApplyPreset) {
      onApplyPreset(preset.filters);
    } else {
      const f = preset.filters;
      if (f.selectedCategories)   onCategoriesChange(f.selectedCategories);
      if (f.selectedJobIds)       onJobIdsChange(f.selectedJobIds);
      if (f.selectedSdcStandards) onSdcStandardsChange(f.selectedSdcStandards);
      if (f.selectedModelFilter)  onModelFilterChange(f.selectedModelFilter);
      if (f.selectedImageFilter)  onImageFilterChange(f.selectedImageFilter);
      if (f.searchFields)         onSearchFieldsChange(f.searchFields);
    }
    setPresetsOpen(false);
  };

  useEffect(() => {
    const handler = (e) => {
      if (sortOpen && sortRef.current && !sortRef.current.contains(e.target)) {
        setSortOpen(false);
      }
      if (presetsOpen && presetsRef.current && !presetsRef.current.contains(e.target)) {
        setPresetsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [sortOpen, presetsOpen]);
  const hasActiveFilters =
    search ||
    (selectedCategories || []).length > 0 ||
    (selectedJobIds || []).length > 0 ||
    (selectedSdcStandards || []).length > 0 ||
    (selectedImageFilter || []).length > 0 ||
    (selectedModelFilter || []).length > 0 ||
    (selectedLibraries || []).length > 0;

  const safeFilter = (list, val, setter) => {
    setter((list || []).filter(x => x !== val));
  };

  return (
    <div className="subbar custom-scrollbar">
      <div className="zone-left">
        <span className="count"><b>{formatNumber(total)}</b> results</span>
        <span style={{ fontSize: 11, color: 'var(--ink-4)', marginLeft: 8 }}>· searched in {searchTime} ms</span>
      </div>

      <div className="divider" style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 12px' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {search && (
          <ActiveChip prefix="search" label={`"${search}"`} onRemove={onSearchClear} />
        )}
        {(selectedCategories || []).map(c => (
          <ActiveChip key={String(c)} prefix="category" label={c} onRemove={() => safeFilter(selectedCategories, c, onCategoriesChange)} />
        ))}
        {(selectedSdcStandards || []).map(s => (
          <ActiveChip key={String(s)} prefix="SDC Standard" label={s} onRemove={() => safeFilter(selectedSdcStandards, s, onSdcStandardsChange)} />
        ))}
        {(selectedJobIds || []).map(j => (
          <ActiveChip key={String(j)} prefix="job" label={j} onRemove={() => safeFilter(selectedJobIds, j, onJobIdsChange)} />
        ))}
        {(selectedLibraries || []).map(l => (
          <ActiveChip key={String(l)} prefix="lib" label={l} onRemove={() => safeFilter(selectedLibraries, l, onLibrariesChange)} />
        ))}
        {(selectedImageFilter || []).map(v => (
          <ActiveChip key={String(v)} prefix="img" label={v} onRemove={() => safeFilter(selectedImageFilter, v, onImageFilterChange)} />
        ))}
        {(selectedModelFilter || []).map(v => (
          <ActiveChip key={String(v)} prefix="mod" label={v} onRemove={() => safeFilter(selectedModelFilter, v, onModelFilterChange)} />
        ))}

        <button className="btn btn-ghost btn-sm" onClick={onAddFilter} style={{ color: 'var(--ink-2)', fontWeight: 600 }}>
          <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
            <path d="M12 4v16m8-8H4" />
          </svg>
          Add filter
        </button>

        {hasActiveFilters && (
          <button
            className="btn btn-ghost btn-sm"
            style={{ color: 'var(--ink-4)', fontWeight: 600 }}
            onClick={onClearAll}
          >
            Clear all
          </button>
        )}

        {hasActiveFilters && (
          <button
            className="btn btn-ghost btn-sm"
            style={{ color: 'var(--sdc-blue)', fontWeight: 600 }}
            onClick={savePreset}
            title="Save current filters as a preset"
          >
            Save filter
          </button>
        )}

        <div style={{ position: 'relative' }} ref={presetsRef}>
          <button
            className="btn btn-ghost btn-sm"
            style={{ color: 'var(--ink-2)', fontWeight: 600 }}
            onClick={() => setPresetsOpen(o => !o)}
            title="Saved filter presets"
          >
            Presets
          </button>
          {presetsOpen && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 1000,
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 10, boxShadow: 'var(--shadow-lg)', padding: 8, minWidth: 200,
            }}>
              {presets.length === 0 ? (
                <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--ink-4)' }}>No saved presets</div>
              ) : presets.map((p, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', borderRadius: 6, cursor: 'pointer' }}
                  className="sort-option"
                  onClick={() => applyPreset(p)}
                >
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-2)' }}>{p.name}</span>
                  <button
                    onClick={e => { e.stopPropagation(); deletePreset(i); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', fontSize: 14, lineHeight: 1, padding: '0 2px' }}
                    title="Delete preset"
                  >×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className="sort-trigger-container" style={{ position: 'relative' }} ref={sortRef}>
          <div
            onClick={() => setSortOpen(!sortOpen)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, color: 'var(--ink-2)',
              fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 10,
              cursor: 'pointer', background: sortOpen ? 'var(--bg-alt)' : 'var(--bg-card)',
              transition: 'all 0.2s ease', border: '1px solid var(--border)',
              boxShadow: 'var(--shadow-sm)'
            }}
            className="hover-shadow"
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5} style={{ opacity: 0.5 }}>
                <path d="M7 10l5-5 5 5M7 14l5 5 5-5" />
              </svg>
              <span style={{ opacity: 0.6 }}>Sort:</span>
              <span style={{ color: 'var(--ink-1)' }}>{SORT_OPTIONS.find(o => o.value === sortBy)?.label}</span>
            </div>

            <svg width="10" height="10" fill="currentColor" viewBox="0 0 20 20" style={{ opacity: 0.4, transform: sortOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', marginTop: 1 }}>
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </div>

          {sortOpen && (
            <div
              style={{
                position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 1000,
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 12, boxShadow: 'var(--shadow-lg)', padding: '8px',
                minWidth: 180, animation: 'fadeIn 0.15s ease'
              }}
            >
              {SORT_OPTIONS.map(o => (
                <div
                  key={o.value}
                  onClick={() => { onSortByChange(o.value); setSortOpen(false); }}
                  style={{
                    padding: '10px 14px', borderRadius: 8, fontSize: 13,
                    fontWeight: sortBy === o.value ? 700 : 500,
                    color: sortBy === o.value ? 'var(--sdc-blue)' : 'var(--ink-2)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between', background: sortBy === o.value ? 'var(--sdc-blue-tint)' : 'transparent',
                    marginBottom: 2
                  }}
                  className="sort-option"
                >
                  {o.label}
                  {sortBy === o.value && <svg width="14" height="14" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                </div>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={onSortOrderToggle}
          className="btn-icon"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 32, height: 32, borderRadius: 8,
            background: 'var(--bg-alt)', border: '1px solid var(--border)', cursor: 'pointer',
            color: 'var(--sdc-blue)', fontWeight: 800, fontSize: 16, transition: 'all 0.2s'
          }}
          title={sortOrder === 'DESC' ? 'Sort High to Low' : 'Sort Low to High'}
        >
          {sortOrder === 'DESC' ? '↓' : '↑'}
        </button>
      </div>
    </div>
  );
}
