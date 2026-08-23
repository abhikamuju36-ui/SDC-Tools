/**
 * FilterButton.jsx
 * Popover button for multi-select filtering.
 */
import { useState, useRef, useEffect } from 'react';

export default function FilterButton({ 
  label, 
  options, 
  selected, 
  onChange, 
  searchable = false, 
  radio = false 
}) {
  const [open, setOpen]     = useState(false);
  const [q, setQ]           = useState('');
  const ref                 = useRef(null);
  const isActive            = (selected || []).length > 0;

  useEffect(() => {
    const handleClick = e => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setQ(''); } };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const toggle = (val) => {
    const strVal = String(val);
    const selectedStrings = (selected || []).map(String);
    if (radio) {
      onChange(selectedStrings.includes(strVal) ? [] : [strVal]);
    } else {
      const next = selectedStrings.includes(strVal) 
        ? selectedStrings.filter(s => s !== strVal) 
        : [...selectedStrings, strVal];
      onChange(next);
    }
  };

  const filtered = searchable 
    ? (options || []).filter(o => String(o).toLowerCase().includes(q.toLowerCase())) 
    : (options || []);

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button
        className={`btn btn-sm${isActive ? ' btn-primary' : ''}`}
        onClick={() => setOpen(v => !v)}
      >
        {label}
        {isActive && (
          <span style={{ 
            background: 'rgba(255,255,255,0.25)', 
            borderRadius: 4, 
            padding: '1px 5px', 
            fontSize: 10, 
            fontWeight: 800,
            color: '#fff'
          }}>
            {selected.length === 1 ? String(selected[0]) : selected.length}
          </span>
        )}
        <svg 
          width="10" height="10" fill="none" stroke="currentColor" viewBox="0 0 24 24" 
          style={{ 
            opacity: 0.6, 
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease'
          }}
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="m6 9 6 6 6-6"/>
        </svg>
      </button>

      {open && (
        <div className="filter-popover" style={{
          position: 'absolute', top: 'calc(100% + 8px)', left: 0, zIndex: 100,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: '8px', boxShadow: 'var(--shadow-lg)',
          minWidth: 220, maxHeight: 400, display: 'flex', flexDirection: 'column',
          overflow: 'hidden'
        }}>
          {searchable && (
            <div style={{ padding: '8px', borderBottom: '1px solid var(--border)', background: 'var(--bg-alt)' }}>
              <input
                autoFocus
                type="text"
                placeholder={`Filter ${label.toLowerCase()}...`}
                value={q}
                onChange={e => setQ(e.target.value)}
                style={{ 
                  width: '100%', height: 32, padding: '0 10px', 
                  border: '1px solid var(--border)', borderRadius: '6px', 
                  background: 'var(--surface)', fontSize: 13, color: 'var(--ink)', 
                  outline: 'none'
                }}
              />
            </div>
          )}
          {isActive && (
            <button
              onClick={() => onChange([])}
              style={{ 
                padding: '10px 14px', fontSize: 11, fontWeight: 700, 
                color: 'var(--sdc-blue)', background: 'var(--bg-alt)', 
                border: 0, textAlign: 'left', cursor: 'pointer', 
                borderBottom: '1px solid var(--border)', textTransform: 'uppercase',
                letterSpacing: '0.04em'
              }}
            >
              Clear selection
            </button>
          )}
          <div style={{ overflowY: 'auto', flex: 1, padding: '4px 0' }} className="custom-scrollbar">
            {filtered.length === 0 ? (
              <div style={{ padding: '20px 14px', fontSize: 12, color: 'var(--ink-4)', textAlign: 'center' }}>
                No results found
              </div>
            ) : filtered.map(opt => (
              <label key={String(opt)} className="popover-item" style={{ 
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', 
                cursor: 'pointer', fontSize: 13, color: 'var(--ink-2)'
              }}>
                <input
                  type={radio ? 'radio' : 'checkbox'}
                  checked={(selected || []).map(String).includes(String(opt))}
                  onChange={() => toggle(opt)}
                  style={{ accentColor: 'var(--sdc-blue)', cursor: 'pointer', width: 14, height: 14 }}
                />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(opt)}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
