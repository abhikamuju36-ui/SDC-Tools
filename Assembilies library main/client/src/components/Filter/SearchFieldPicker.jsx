/**
 * SearchFieldPicker.jsx
 * Dropdown to select which fields to search in.
 */
import { useState, useRef, useEffect } from 'react';

const SEARCH_FIELD_OPTIONS = [
  { key: 'description', label: 'Description' },
  { key: 'comments',    label: 'Comments'    },
  { key: 'category',    label: 'Category'    },
  { key: 'partno',      label: 'Part No'     },
];

export default function SearchFieldPicker({ fields, onChange }) {
  const [open, setOpen] = useState(false);
  const ref             = useRef(null);
  const isMulti         = (fields || []).length > 1;
  const label           = isMulti
    ? `${fields.length} fields`
    : SEARCH_FIELD_OPTIONS.find(o => o.key === (fields || [])[0])?.label ?? 'Description';

  useEffect(() => {
    const handleClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function toggle(key) {
    const currentFields = fields || [];
    const next = currentFields.includes(key) 
      ? currentFields.filter(f => f !== key) 
      : [...currentFields, key];
    if (next.length === 0) return;
    onChange(next);
  }

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button
        className={`btn btn-sm${isMulti ? ' btn-primary' : ''}`}
        onClick={() => setOpen(v => !v)}
        title="Choose which fields to search"
      >
        In: {label}
        <svg width="10" height="10" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ opacity: 0.6 }}>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="filter-popover" style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 50,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)', minWidth: 160,
        }}>
          <div style={{ padding: '6px 10px 4px', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', borderBottom: '1px solid var(--border)' }}>
            Search in
          </div>
          {SEARCH_FIELD_OPTIONS.map(({ key, label: optLabel }) => {
            const active = (fields || []).includes(key);
            const isOnly = active && fields.length === 1;
            return (
              <label
                key={key}
                className="popover-item"
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', cursor: isOnly ? 'default' : 'pointer', fontSize: 12.5, color: 'var(--ink-2)' }}
              >
                <input
                  type="checkbox"
                  checked={active}
                  onChange={() => toggle(key)}
                  disabled={isOnly}
                  style={{ accentColor: 'var(--sdc-blue)', cursor: isOnly ? 'default' : 'pointer', width: 13, height: 13 }}
                />
                {optLabel}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
