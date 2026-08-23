import { useState, useRef, useEffect } from 'react';

export default function FilterDropdown({ label, options, selected, onChange, searchable = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });
  const [dropUp, setDropUp] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const updatePos = () => {
    if (isOpen && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      
      // Calculate approximate needed space
      // Search (56px) + Padding (8px) + Item (40px each)
      const itemCount = options.length;
      const estimatedHeight = (searchable ? 56 : 0) + 8 + (Math.min(itemCount, 6) * 40);
      
      // Only drop up if space below is less than estimated height + safety margin
      const willDropUp = spaceBelow < (estimatedHeight + 20);
      
      setDropUp(willDropUp);
      setCoords({
        top: willDropUp ? rect.top : rect.bottom,
        left: rect.left,
        width: rect.width
      });
    }
  };

  useEffect(() => {
    if (isOpen) {
      updatePos();
      window.addEventListener('scroll', updatePos, true);
      window.addEventListener('resize', updatePos);
    }
    return () => {
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [isOpen]);

  const filtered = options.filter(o => {
    const label = typeof o === 'object' ? o.label || o.value : o;
    const rawVal = typeof o === 'object' ? String(o.value ?? '') : String(o);
    const q = search.toLowerCase();
    return String(label).toLowerCase().includes(q) || rawVal.toLowerCase().includes(q);
  });

  const toggle = (val) => {
    const next = selected.includes(val) ? selected.filter(x => x !== val) : [...selected, val];
    onChange(next);
  };

  return (
    <div className="filter-dropdown-wrap" ref={ref}>
      <button className={`filter-dropdown-trigger ${isOpen ? 'on' : ''}`} onClick={() => setIsOpen(!isOpen)}>
        <span className="label">{label}</span>
        <span className="value">
          {(() => {
            const validSelected = selected.filter(s =>
              options.some(o => (typeof o === 'object' ? o.value : o) === s)
            );
            return validSelected.length > 0 ? `${validSelected.length} selected` : 'All';
          })()}
        </span>
        <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5} style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {isOpen && (
        <div 
          className={`filter-dropdown-menu-fixed ${dropUp ? 'drop-up' : ''}`} 
          style={{
            top: dropUp ? 'auto' : coords.top + 4,
            bottom: dropUp ? (window.innerHeight - coords.top) + 4 : 'auto',
            left: coords.left,
            width: coords.width
          }}
        >
          {searchable && (
            <div className="dropdown-search">
              <input 
                type="text" 
                placeholder={`Search ${label.toLowerCase()}...`} 
                value={search}
                onChange={e => setSearch(e.target.value)}
                autoFocus
              />
            </div>
          )}
          <div className="dropdown-list custom-scrollbar">
            {filtered.length === 0 && <div className="dropdown-empty">No results</div>}
            {filtered.map(o => {
              const val = typeof o === 'object' ? o.value : o;
              const lbl = typeof o === 'object' ? o.label || o.value : o;
              const count = typeof o === 'object' ? o.count : null;
              const isSelected = selected.includes(val);
              
              return (
                <label key={String(val)} className={`dropdown-item ${isSelected ? 'selected' : ''}`}>
                  <input type="checkbox" checked={isSelected} onChange={() => toggle(val)} />
                  <span className="item-label">{String(lbl)}</span>
                  {count !== null && <span className="item-count">{count}</span>}
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
