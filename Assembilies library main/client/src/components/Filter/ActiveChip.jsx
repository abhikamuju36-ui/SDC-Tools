/**
 * ActiveChip.jsx
 * Display an active filter as a removable chip.
 */
export default function ActiveChip({ prefix, label, onRemove, variant = 'light' }) {
  const isDark = variant === 'dark' || prefix === 'search';
  
  return (
    <span className={`chip ${isDark ? 'chip-dark' : 'chip-light'}`}>
      <span className="chip-prefix">{prefix}:</span>
      <span className="chip-value">{label}</span>
      <button className="chip-x" onClick={(e) => { e.stopPropagation(); onRemove(); }} title="Remove filter">
        <svg width="10" height="10" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3.5}>
          <path d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </span>
  );
}
