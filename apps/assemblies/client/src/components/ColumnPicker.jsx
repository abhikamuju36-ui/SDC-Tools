/**
 * ColumnPicker.jsx
 * Dropdown component to toggle table column visibility.
 */
import { saveVisibleCols } from '../utils/storage';

const TOGGLEABLE_COLS = [
  { key: 'file_name',  label: 'File Name' },
  { key: 'job_name',   label: 'Job Name' },
  { key: 'category',   label: 'Category' },
  { key: 'comments',   label: 'Comments' },
  { key: 'updated_at', label: 'Updated' },
  { key: 'updated_by', label: 'Owner' },
];

const FIXED_COLS = [
  { label: 'Part Number' },
  { label: 'Job ID' },
  { label: 'Description' },
  { label: 'Model' },
  { label: 'Image' },
  { label: 'SDC Standard' },
];

export default function ColumnPicker({ visible, setVisible }) {
  const toggleColumn = (key, checked) => {
    const next = new Set(visible);
    if (checked) next.add(key); else next.delete(key);
    setVisible(next);
    saveVisibleCols(next);
  };

  return (
    <div className="dropdown-menu column-picker" onClick={e => e.stopPropagation()}>
      <div className="dropdown-section">TOGGLE COLUMNS</div>
      {TOGGLEABLE_COLS.map(c => (
        <label key={c.key} className="dropdown-item">
          <input
            type="checkbox"
            checked={visible.has(c.key)}
            onChange={e => toggleColumn(c.key, e.target.checked)}
          />
          <span className="item-label">{c.label}</span>
        </label>
      ))}

      <div className="dropdown-divider" />
      <div className="dropdown-section">FIXED COLUMNS</div>
      <div className="fixed-cols-list">
        {FIXED_COLS.map(c => (
          <div key={c.label} className="dropdown-item is-locked">
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} style={{ opacity: 0.4 }}>
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <span className="item-label">{c.label}</span>
            <span className="locked-tag">LOCKED</span>
          </div>
        ))}
      </div>
    </div>
  );
}
