import NavItem from './Sidebar/NavItem';
import CategoryList from './Sidebar/CategoryList';
import { useState, useEffect } from 'react';

export default function Sidebar({ 
  categories, 
  selectedCategories, 
  onCategoryClick, 
  total, 
  sdcStandardCount,
  preferredCount,
  onAllClick, 
  onSdcStandardClick, 
  onPreferredClick, 
  sdcStandardActive, 
  preferredActive 
}) {
  const [version, setVersion] = useState('1.0.0');
  const [checking, setChecking] = useState(false);
  const isAllActive = selectedCategories.length === 0 && !sdcStandardActive && !preferredActive;

  useEffect(() => {
    if (window.electron) {
      window.electron.getAppVersion().then(v => setVersion(v));
    }
  }, []);

  const handleUpdateCheck = async () => {
    if (window.electron && !checking) {
      setChecking(true);
      const res = await window.electron.checkForUpdates();
      if (!res.success) {
        alert(res.message);
      }
      setChecking(false);
    }
  };

  return (
    <nav className="sidebar custom-scrollbar">
      <div className="nav-group">
        <span className="nav-label">Library</span>
        
        <NavItem
          label="All assemblies"
          active={isAllActive}
          onClick={onAllClick}
          count={total}
          icon={(props) => (
            <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7 12 2l9 5v10l-9 5-9-5Z"/><path d="M3 7l9 5 9-5M12 12v10"/>
            </svg>
          )}
        />

        <NavItem
          label="SDC Standard"
          active={sdcStandardActive}
          onClick={onSdcStandardClick}
          count={sdcStandardCount}
          icon={(props) => (
            <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="m12 3 2.6 6 6.4.6-4.8 4.3 1.4 6.4L12 17l-5.6 3.3 1.4-6.4L3 9.6 9.4 9Z"/>
            </svg>
          )}
        />

        <NavItem
          label="Preferred"
          active={preferredActive}
          onClick={onPreferredClick}
          count={preferredCount}
          icon={(props) => (
            <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 12 5 5L20 7"/>
            </svg>
          )}
        />
      </div>

      <CategoryList
        categories={categories}
        selectedCategories={selectedCategories}
        onCategoryClick={onCategoryClick}
      />

      <div style={{ marginTop: 'auto', paddingTop: 20, borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, padding: '0 4px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-4)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            Version {version}
          </div>
          <button 
            onClick={handleUpdateCheck}
            disabled={checking}
            style={{ fontSize: 10, fontWeight: 700, color: checking ? 'var(--ink-4)' : 'var(--sdc-blue)', background: 'none', border: 'none', cursor: checking ? 'default' : 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em' }}
          >
            {checking ? 'Checking...' : 'Check for Updates'}
          </button>
        </div>
      </div>
    </nav>
  );
}

