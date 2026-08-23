/**
 * NavItem.jsx
 * Individual navigation item for the sidebar.
 */
export default function NavItem({ 
  icon: Icon, 
  label, 
  active, 
  onClick, 
  count,
  title
}) {
  return (
    <button 
      className={`nav-item${active ? ' active' : ''}`} 
      onClick={onClick}
      title={title || label}
    >
      {Icon && <Icon style={{ width: 14, height: 14 }} />}
      <span>{label}</span>
      {count !== undefined && count !== null && (
        <span className="nav-count">{count.toLocaleString()}</span>
      )}
    </button>
  );
}
