import FilterDropdown from './Filter/FilterDropdown';

export default function AdvancedFilterPanel({
  categories = [],
  selectedCategories = [],
  onCategoriesChange,
  selectedSdcStandards = [],
  onSdcStandardsChange,
  jobs = [],
  selectedJobIds = [],
  onJobIdsChange,
  selectedModelFilter = [],
  onModelFilterChange,
  selectedImageFilter = [],
  onImageFilterChange,
  searchFields = [],
  onSearchFieldsChange,
  selectedStatusFilter = '',
  onStatusFilterChange = null,
  updatedAfter = '',
  onUpdatedAfterChange = null,
  updatedBefore = '',
  onUpdatedBeforeChange = null,
  onReset,
  onClose,
}) {
  // Convert job IDs to integers and sort ASC
  const sortedJobs = [...jobs]
    .map(j => {
      const val = typeof j === 'object' ? j.value : j;
      const num = parseInt(val, 10);
      return { 
        value: String(val), 
        label: isNaN(num) ? String(val) : num.toLocaleString(),
        sortVal: isNaN(num) ? 999999 : num
      };
    })
    .sort((a, b) => a.sortVal - b.sortVal);

  return (
    <div className="advanced-filter-panel custom-scrollbar">
      <div className="panel-header">
        <span className="panel-title">Filter by</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="reset-btn" onClick={onReset}>Clear all</button>
          <button
            onClick={onClose}
            title="Close filters"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: 4, border: 'none', background: 'none', color: 'var(--ink-3)', cursor: 'pointer', transition: 'all 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-alt)'; e.currentTarget.style.color = 'var(--ink)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--ink-3)'; }}
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="panel-body">
        <div className="filter-group">
          <FilterDropdown 
            label="SDC Standards" 
            options={[
              { value: 'Yes', label: 'SDC Standard' },
              { value: 'No', label: 'Unclassified' }
            ]} 
            selected={selectedSdcStandards} 
            onChange={onSdcStandardsChange} 
          />
        </div>

        <div className="filter-group">
          <FilterDropdown
            label="Search Scope"
            options={[
              { value: 'partno', label: 'Part Number' },
              { value: 'description', label: 'Description' },
              { value: 'comments', label: 'Comments' },
              { value: 'job_name', label: 'Job Name' },
              { value: 'category', label: 'Category' },
              { value: 'updated_by', label: 'Updated By' },
            ]}
            selected={searchFields}
            onChange={onSearchFieldsChange}
          />
        </div>

        <div className="filter-group">
          <FilterDropdown 
            label="Categories" 
            options={categories.map(cat => ({
              value: cat?.value || cat,
              label: cat?.value || cat,
              count: cat?.count
            }))} 
            selected={selectedCategories} 
            onChange={onCategoriesChange} 
            searchable 
          />
        </div>

        <div className="filter-group">
          <FilterDropdown 
            label="Job Identifiers" 
            options={sortedJobs} 
            selected={selectedJobIds} 
            onChange={onJobIdsChange} 
            searchable 
          />
        </div>

        <div className="filter-group">
          <FilterDropdown 
            label="CAD Model" 
            options={[
              { value: 'Yes', label: 'Has CAD Model' },
              { value: 'No', label: 'No CAD Model' }
            ]} 
            selected={selectedModelFilter} 
            onChange={onModelFilterChange} 
          />
        </div>

        <div className="filter-group">
          <FilterDropdown
            label="Image"
            options={[
              { value: 'Yes', label: 'Yes' },
              { value: 'No', label: 'No' }
            ]}
            selected={selectedImageFilter}
            onChange={onImageFilterChange}
          />
        </div>

        {onStatusFilterChange && (
          <div className="filter-group">
            <FilterDropdown
              label="Status"
              options={[
                { value: 'Active', label: 'Active' },
                { value: 'Obsolete', label: 'Obsolete' },
                { value: 'Draft', label: 'Draft' },
                { value: 'Under Review', label: 'Under Review' },
              ]}
              selected={selectedStatusFilter ? [selectedStatusFilter] : []}
              onChange={vals => onStatusFilterChange(vals[vals.length - 1] || '')}
            />
          </div>
        )}

        {(onUpdatedAfterChange || onUpdatedBeforeChange) && (
          <div className="filter-group">
            <div className="panel-label">Date Updated</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="date"
                className="field-input"
                value={updatedAfter}
                onChange={e => onUpdatedAfterChange && onUpdatedAfterChange(e.target.value)}
                placeholder="From"
                style={{ flex: 1, fontSize: 12 }}
              />
              <input
                type="date"
                className="field-input"
                value={updatedBefore}
                onChange={e => onUpdatedBeforeChange && onUpdatedBeforeChange(e.target.value)}
                placeholder="To"
                style={{ flex: 1, fontSize: 12 }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
