import { useRef, useEffect } from 'react';
import AssemblyRow from './Table/AssemblyRow';

export default function AssemblyTable({
  assemblies, onEdit, selectedPartnos = new Set(), onToggle,
  search = '', onLoadMore, hasMore, loading, highlightPartno,
  visibleCols = new Set(),
  sortBy = 'job_id', sortOrder = 'ASC', onSort
}) {
  const containerRef = useRef(null);
  const sentinelRef  = useRef(null);
  const show = (key) => visibleCols.has(key);

  useEffect(() => {
    if (!hasMore || loading || !sentinelRef.current || !containerRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) onLoadMore?.(); },
      { root: containerRef.current, threshold: 0.1 }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, loading, onLoadMore]);

  const allSelected = assemblies.length > 0 && assemblies.every(a => selectedPartnos.has(a.partno));
  function handleSelectAll() { assemblies.forEach(a => onToggle(a.partno, !allSelected)); }

  // Helper for sortable headers
  const SortHeader = ({ field, label, align = 'left', width }) => {
    const isCurrent = sortBy === field;
    return (
      <th 
        style={{ 
          textAlign: align, 
          width, 
          cursor: 'pointer',
          userSelect: 'none',
          position: 'relative',
        }}
        onClick={() => onSort?.(field)}
        className={isCurrent ? 'active-sort' : ''}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: align === 'center' ? 'center' : 'flex-start', gap: 6 }}>
          {label}
          <span style={{ fontSize: 10, opacity: isCurrent ? 1 : 0.2, transition: 'all 0.2s' }}>
            {isCurrent ? (sortOrder === 'ASC' ? '▲' : '▼') : '↕'}
          </span>
        </div>
      </th>
    );
  };

  if (assemblies.length === 0) {
    return (
      <div className="empty" style={{ flex: 1 }}>
        <div className="muted" style={{ fontSize: 13 }}>No assemblies found matching your criteria.</div>
      </div>
    );
  }

  return (
    <div className="table-area custom-scrollbar" ref={containerRef}>
      <table className="assembly-table">
        <thead>
          <tr>
            <th style={{ width: 40 }}>
              <input type="checkbox" checked={allSelected} onChange={handleSelectAll} style={{ accentColor: 'var(--sdc-blue)', cursor: 'pointer', width: 14, height: 14 }} />
            </th>
            <SortHeader field="partno" label="Part Number" />
            {show('file_name')  && <SortHeader field="file_name" label="File Name" />}
            <SortHeader field="job_id" label="Job ID" align="center" width={90} />
            {show('job_name')   && <SortHeader field="job_name" label="Job Name" />}
            <SortHeader field="description" label="Description" />
            <SortHeader field="category" label="Category" align="center" width={140} />
            <th style={{ textAlign: 'center', width: 100 }}>Model</th>
            <th style={{ textAlign: 'center', width: 80 }}>Image</th>
            {show('comments')   && <SortHeader field="comments" label="Comments" />}
            {show('updated_at') && <SortHeader field="updated_at" label="Updated" />}
            {show('updated_by') && <SortHeader field="updated_by" label="Owner" />}
            <SortHeader field="sdc_standard" label="SDC Standard" align="center" width={130} />
          </tr>
        </thead>
        <tbody>
          {assemblies.map(a => (
            <AssemblyRow
              key={a.id || a.partno}
              assembly={a}
              onEdit={onEdit}
              selected={selectedPartnos.has(a.partno)}
              onToggle={onToggle}
              highlighted={a.partno === highlightPartno}
              search={search}
              showCol={show}
            />
          ))}
        </tbody>
      </table>
      <div ref={sentinelRef} style={{ height: 20 }} />
    </div>
  );
}
