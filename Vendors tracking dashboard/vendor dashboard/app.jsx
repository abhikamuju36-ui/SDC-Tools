/* Root app — sidebar nav + tab switching + tweaks */

const TWEAKS_DEFAULTS = /*EDITMODE-BEGIN*/{
  "density": "comfortable",
  "accent": "blue",
  "showActivity": true,
  "showCallouts": true
}/*EDITMODE-END*/;

const App = () => {
  const [tab, setTab] = React.useState("overview");
  const [tweaks, setTweak] = useTweaks(TWEAKS_DEFAULTS);
  const [loading, setLoading] = React.useState(true);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [dateFilter, setDateFilter] = React.useState('YTD');
  const [filterKey, setFilterKey] = React.useState(0);
  // Keep-alive: tracks which tabs have been mounted at least once
  const [mounted, setMounted] = React.useState({ overview: true });
  // For analyzer tabs that need fresh params on each navigation, bump their key to force remount
  const [tabNavKey, setTabNavKey] = React.useState({});
  const [showVendorModal, setShowVendorModal] = React.useState(false);
  const [showOrderModal, setShowOrderModal] = React.useState(false);

  // Global navigation — components call window.navigateTo(tab, params)
  React.useEffect(() => {
    window.navigateTo = (targetTab, params) => {
      if (params) {
        window.__navParams = params;
        // Force remount of analyzer tabs when navigated with new params
        setTabNavKey(k => ({ ...k, [targetTab]: (k[targetTab] || 0) + 1 }));
      }
      setTab(targetTab);
    };
    return () => { window.navigateTo = null; };
  }, []);

  // Lazy mount: first time a tab is visited, mark it as mounted
  React.useEffect(() => {
    setMounted(m => m[tab] ? m : { ...m, [tab]: true });
  }, [tab]);

  const reloadAllData = () => {
    window.fetchFullstackData().then(() => {
      setLoading(false);
      setRefreshKey(prev => prev + 1);
    });
  };

  React.useEffect(() => { reloadAllData(); }, []);

  React.useEffect(() => {
    document.documentElement.setAttribute("data-density", tweaks.density);
    document.documentElement.setAttribute("data-accent", tweaks.accent);
  }, [tweaks.density, tweaks.accent]);

  const handleAddVendorSubmit = (e) => {
    e.preventDefault();
    const name     = e.target['vendor-name'].value.trim();
    const category = e.target['vendor-category'].value;
    const contact  = e.target['vendor-contact'].value.trim();
    if (!name || !contact) return;
    const localVendors = JSON.parse(localStorage.getItem('vtd_local_vendors') || '[]');
    localVendors.push({ name, category, contact });
    localStorage.setItem('vtd_local_vendors', JSON.stringify(localVendors));
    setShowVendorModal(false);
    reloadAllData();
  };

  const handleCreatePOSubmit = (e) => {
    e.preventDefault();
    const projectId  = e.target['order-project'].value;
    const vendorName = e.target['order-vendor'].value;
    const amount     = parseFloat(e.target['order-amount'].value) || 0;
    const orderDate  = e.target['order-date'].value;
    const dueDate    = e.target['order-duedate'].value;
    const status     = e.target['order-status'].value;
    if (!projectId || !vendorName || !amount) return;
    const localOrders = JSON.parse(localStorage.getItem('vtd_local_orders') || '[]');
    const nextId = 10242 + localOrders.length;
    localOrders.push({ id: `PO-${nextId}`, projectId, vendorName, amount, orderDate, dueDate, status });
    localStorage.setItem('vtd_local_orders', JSON.stringify(localOrders));
    setShowOrderModal(false);
    reloadAllData();
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#061D39', color: '#FFFFFF', fontFamily: "'Montserrat', sans-serif" }}>
        <div style={{ width: 64, height: 64, border: '6px solid rgba(255,255,255,0.1)', borderTop: '6px solid #1574C4', borderRadius: '50%', animation: 'spin 1s linear infinite', marginBottom: 25 }}></div>
        <h2 style={{ letterSpacing: '3px', fontWeight: 700, margin: 0, textTransform: 'uppercase' }}>SDC Pipeline</h2>
        <p style={{ color: '#AACEE8', fontSize: 12, letterSpacing: '1.5px', marginTop: 10 }}>Synchronizing Live ETO Database & Smartsheet Milestones…</p>
        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // Tab config — workspace + reports
  const workspaceTabs = [
    { id: "overview",        label: "Overview",          icon: Icon.layers,   badge: window.PROJECTS.length, Component: Overview },
    { id: "project",         label: "Project Analyzer",  icon: Icon.sliders,                                 Component: ProjectAnalyzer },
    { id: "vendor",          label: "Vendor Analyzer",   icon: Icon.users,                                   Component: VendorAnalyzer },
  ];
  const reportTabs = [
    { id: "forecast",        label: "Spend Forecast",    icon: Icon.trend,    Component: SpendForecastReport },
    { id: "receivings",      label: "Receivings Log",    icon: Icon.package,  Component: ReceivingsLogReport },
    { id: "supplier-risk",   label: "Supplier Risk",     icon: Icon.shield,   Component: SupplierRiskReport },
    { id: "delivery-cal",    label: "Delivery Calendar", icon: Icon.calendar, Component: DeliveryCalendarReport },
  ];
  const ALL_TABS = [...workspaceTabs, ...reportTabs];

  const TAB_META = {
    overview:       { title: "Procurement Overview",    sub: "All projects, suppliers and POs at a glance" },
    project:        { title: "Project Analyzer",         sub: "Spend, vendors and schedule for selected engagements" },
    vendor:         { title: "Vendor Analyzer",          sub: "Performance and relationship history for one supplier" },
    forecast:       { title: "Spend Forecast",           sub: "Budget runway, burn rate, and at-risk projects" },
    receivings:     { title: "Receivings Log",           sub: "Incoming deliveries grouped by urgency" },
    "supplier-risk":{ title: "Supplier Risk",            sub: "Performance scatter, risk matrix, and dependency analysis" },
    "delivery-cal": { title: "Delivery Calendar",        sub: "Month-by-month view of expected PO deliveries" },
  };

  const tabMeta = TAB_META[tab] || TAB_META.overview;

  return (
    <div className="app" key={refreshKey}>
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-logo">SDC</div>
          <div className="sidebar-name">Vendor Tracker<span>Steven Douglas Corp.</span></div>
        </div>

        <div className="sidebar-section-label">Workspace</div>
        <nav className="nav">
          {workspaceTabs.map(t => (
            <button key={t.id}
              className={"nav-item " + (tab === t.id ? "active" : "")}
              onClick={() => setTab(t.id)}
              data-screen-label={t.label}>
              {t.icon}
              <span>{t.label}</span>
              {t.badge ? <span className="nav-item-badge">{t.badge}</span> : null}
            </button>
          ))}
        </nav>

        <div className="sidebar-section-label">Reports</div>
        <nav className="nav">
          {reportTabs.map(t => (
            <button key={t.id}
              className={"nav-item " + (tab === t.id ? "active" : "")}
              onClick={() => setTab(t.id)}
              data-screen-label={t.label}>
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="user-chip">
            <div className="user-avatar">SD</div>
            <div>
              <div className="user-name">SDC Team</div>
              <div className="user-role">Procurement Lead</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="main">
        <header className="topbar">
          <div className="crumbs">
            <span>Procurement</span>
            <span>›</span>
            <strong>{tabMeta.title}</strong>
          </div>
          <div className="search">
            {Icon.search}
            <input placeholder="Search POs, projects, vendors…" />
          </div>
          <div className="topbar-actions">
            <button className="icon-btn" title="Notifications">{Icon.bell}</button>
            <button className="icon-btn" title="Settings">{Icon.settings}</button>
            <button className="btn btn-secondary" onClick={() => setShowVendorModal(true)}>{Icon.plus} Add Vendor</button>
            <button className="btn btn-primary" onClick={() => setShowOrderModal(true)}>{Icon.file} Create PO</button>
          </div>
        </header>

        <div className="page" data-screen-label={tabMeta.title}>
          <div className="page-header">
            <div>
              <h1 className="page-title">{tabMeta.title}</h1>
              <p className="page-subtitle">{tabMeta.sub}</p>
            </div>
            <div className="page-controls">
              <select className="select" value={dateFilter} onChange={e => {
                const p = e.target.value;
                window._ACTIVE_PERIOD = p;
                window.applyDateFilter(p);
                setDateFilter(p);
                setFilterKey(k => k + 1);
              }}>
                <option>Today</option>
                <option>This Week</option>
                <option>This Month</option>
                <option>This Quarter</option>
                <option>YTD</option>
                <option>Last 12 Months</option>
              </select>
              <button className="btn btn-secondary">{Icon.download} Export</button>
            </div>
          </div>

          {ALL_TABS.map(({ id, Component }) =>
            mounted[id] ? (
              <div key={id} style={{ display: tab === id ? undefined : 'none' }}>
                <Component key={(tabNavKey[id] || 0) + '-f' + filterKey} />
              </div>
            ) : null
          )}

          <footer style={{ marginTop: 40, paddingTop: 20, borderTop: "1px solid var(--border)", textAlign: "center", fontSize: 12, color: "var(--text-tertiary)", fontFamily: "var(--font-display)", letterSpacing: 1.5 }}>
            STEVEN DOUGLAS CORP. · ENGINEERING EXCELLENCE. TRUSTED PARTNERSHIPS.
          </footer>
        </div>
      </main>

      {/* Tweaks panel */}
      <TweaksPanel title="Tweaks">
        <TweakSection label="Layout density">
          <TweakRadio label="Density" value={tweaks.density} onChange={v => setTweak("density", v)}
            options={[{ value: "comfortable", label: "Comfort" }, { value: "compact", label: "Compact" }]} />
        </TweakSection>
        <TweakSection label="Brand accent">
          <TweakColor label="Accent" value={tweaks.accent} onChange={v => setTweak("accent", v)}
            options={[{ value: "blue", color: "#1574C4" }, { value: "navy", color: "#061D39" }, { value: "green", color: "#74C415" }]} />
        </TweakSection>
      </TweaksPanel>

      {/* MODAL 1: ADD NEW VENDOR */}
      {showVendorModal && (
        <div className="modal-overlay active" style={{ display: 'flex' }}>
          <div className="modal-window">
            <div className="modal-header">
              <h3>Create New Supplier Profile</h3>
              <button className="modal-close-btn" onClick={() => setShowVendorModal(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleAddVendorSubmit}>
                <div className="form-group">
                  <label className="form-label" htmlFor="vendor-name">Vendor Company Name</label>
                  <input type="text" id="vendor-name" className="form-input" placeholder="e.g. Atlas Foundry" required autoComplete="off" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="vendor-category">Supplier Category</label>
                  <select id="vendor-category" className="form-select" style={{ width: '100%' }} required>
                    <option value="" disabled>Select Category</option>
                    <option value="Raw Materials">Raw Materials</option>
                    <option value="Shipping & Freight">Shipping & Freight</option>
                    <option value="Electronics & Chips">Electronics & Chips</option>
                    <option value="Precision Engineering">Precision Engineering</option>
                    <option value="Support Services">Support Services</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="vendor-contact">Contact Email Address</label>
                  <input type="email" id="vendor-contact" className="form-input" placeholder="e.g. delivery@atlas.com" required autoComplete="off" />
                </div>
                <div className="form-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowVendorModal(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Register Vendor</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: CREATE PURCHASE ORDER */}
      {showOrderModal && (
        <div className="modal-overlay active" style={{ display: 'flex' }}>
          <div className="modal-window">
            <div className="modal-header">
              <h3>Create Purchase Requisition</h3>
              <button className="modal-close-btn" onClick={() => setShowOrderModal(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleCreatePOSubmit}>
                <div className="form-group">
                  <label className="form-label" htmlFor="order-project">Associated Project</label>
                  <select id="order-project" className="form-select" style={{ width: '100%' }} required>
                    <option value="" disabled>Select Project</option>
                    {window.PROJECTS.map(p => (
                      <option key={p.id} value={p.id.replace('P-', '')}>{p.id} — {p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="order-vendor">Assigned Supplier</label>
                  <select id="order-vendor" className="form-select" style={{ width: '100%' }} required>
                    <option value="" disabled>Select Vendor</option>
                    {window.VENDORS.map(v => (
                      <option key={v.name} value={v.name}>{v.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="order-amount">Requisition Amount ($)</label>
                  <input type="number" id="order-amount" className="form-input" min="1" placeholder="e.g. 15000" required autoComplete="off" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="order-date">Requisition Order Date</label>
                  <input type="date" id="order-date" className="form-input" required />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="order-duedate">Target Delivery Date</label>
                  <input type="date" id="order-duedate" className="form-input" required />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="order-status">Initial Order Status</label>
                  <select id="order-status" className="form-select" style={{ width: '100%' }} required>
                    <option value="Open">Pending</option>
                    <option value="In Transit">Shipped</option>
                    <option value="Received">Delivered (Completed)</option>
                  </select>
                </div>
                <div className="form-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowOrderModal(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Generate PO</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
