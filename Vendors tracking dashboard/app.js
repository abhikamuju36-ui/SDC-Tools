/**
 * ========================================================================
 * VENDORS TRACKING DASHBOARD - FRONTEND ENGINE (app.js)
 * Interacts with Node Express backend API endpoints to query ETO DB and
 * Smartsheet schedule data dynamically.
 * Features localStorage overlays for non-disruptive PO registration.
 * ========================================================================
 */

// Global State Object
let state = {
  projects: [],
  vendors: [],
  orders: [],
  activeTab: 'overview', // 'overview', 'analyzer', or 'vendor'
  selectedProjectId: '',
  selectedVendorId: '',
  theme: 'dark',
  
  // Local overlays (persistent mock data added via forms)
  localVendors: [],
  localOrders: []
};

// References to DOM Elements
const elements = {
  themeToggleBtn: document.getElementById('theme-toggle-btn'),
  themeIcon: document.getElementById('theme-icon'),
  
  // Tabs
  tabOverview: document.getElementById('tab-overview'),
  tabAnalyzer: document.getElementById('tab-analyzer'),
  tabVendor: document.getElementById('tab-vendor'),
  panelOverview: document.getElementById('panel-overview'),
  panelAnalyzer: document.getElementById('panel-analyzer'),
  panelVendor: document.getElementById('panel-vendor'),
  
  // KPI Metrics
  kpiTotalSpend: document.querySelectorAll('.kpi-total-spend'),
  kpiAvgSpend: document.querySelectorAll('.kpi-avg-spend'),
  kpiShipping: document.querySelectorAll('.kpi-shipping'),
  kpiOnTime: document.querySelectorAll('.kpi-on-time'),
  kpiTotalSpendTrend: document.getElementById('kpi-spend-trend'),
  kpiAvgSpendTrend: document.getElementById('kpi-avg-trend'),
  kpiShippingTrend: document.getElementById('kpi-ship-trend'),
  kpiOnTimeTrend: document.getElementById('kpi-ontime-trend'),
  
  // Overview Tab Specifics
  vendorsList: document.getElementById('vendors-ranking-list'),
  recentOrdersTable: document.getElementById('recent-orders-body'),
  searchOverview: document.getElementById('search-overview'),
  filterStatusOverview: document.getElementById('filter-status-overview'),
  
  // Project Analyzer Tab Specifics
  projectSelector: document.getElementById('project-selector'),
  projectPillBudget: document.getElementById('proj-pill-budget'),
  projectPillStatus: document.getElementById('proj-pill-status'),
  projectPillVendorCount: document.getElementById('proj-pill-vendor-count'),
  analyzerOrdersTable: document.getElementById('analyzer-orders-body'),
  searchAnalyzer: document.getElementById('search-analyzer'),
  filterStatusAnalyzer: document.getElementById('filter-status-analyzer'),
  
  // Vendor Analyzer Tab Specifics
  vendorSelector: document.getElementById('vendor-selector'),
  vendorContactEmail: document.getElementById('vendor-contact-email'),
  vendorContactPhone: document.getElementById('vendor-contact-phone'),
  vendorKpiSpend: document.getElementById('vendor-kpi-spend'),
  vendorKpiOntime: document.getElementById('vendor-kpi-ontime'),
  vendorKpiShipping: document.getElementById('vendor-kpi-shipping'),
  vendorKpiVolume: document.getElementById('vendor-kpi-volume'),
  vendorOrdersTable: document.getElementById('vendor-orders-body'),
  searchVendorPo: document.getElementById('search-vendor-po'),
  filterStatusVendor: document.getElementById('filter-status-vendor'),
  
  // Smartsheet elements
  smartsheetCard: document.getElementById('smartsheet-milestones-card'),
  smartsheetList: document.getElementById('smartsheet-milestones-list'),
  smartsheetMeta: document.getElementById('smartsheet-meta-info'),
  smartsheetSource: document.getElementById('smartsheet-source-pill'),
  
  // Modals
  modalVendor: document.getElementById('modal-vendor'),
  modalOrder: document.getElementById('modal-order'),
  openModalVendorBtn: document.getElementById('btn-new-vendor'),
  openModalOrderBtn: document.getElementById('btn-new-order'),
  closeModalBtns: document.querySelectorAll('.modal-close-btn, .btn-close-modal'),
  
  // Forms
  formVendor: document.getElementById('form-vendor'),
  formOrder: document.getElementById('form-order'),
  formOrderProject: document.getElementById('order-project'),
  formOrderVendor: document.getElementById('order-vendor'),
};

// Global Chart Instances
let spendChartInstance = null;
let performanceChartInstance = null;
let vendorSpendChartInstance = null;
let vendorStatusChartInstance = null;

// API Base URL (Relative path since frontend is hosted on same Express port)
const API_BASE = '';

// ========================================================================
// DATA LOADING & FETCH OPERATIONS
// ========================================================================

async function fetchFromApi(endpoint) {
  try {
    const res = await fetch(`${API_BASE}${endpoint}`);
    if (!res.ok) throw new Error(`API Error: ${res.status} ${res.statusText}`);
    return await res.json();
  } catch (err) {
    console.error(`Failed to fetch from ${endpoint}:`, err);
    return null;
  }
}

// Inferred category engine from ETO descriptions
function inferVendorCategory(vendorName, partDesc = '') {
  const name = vendorName.toLowerCase();
  const desc = partDesc.toLowerCase();
  
  if (name.includes('metal') || name.includes('foundry') || name.includes('steel') || name.includes('iron') || name.includes('sheet') || name.includes('anodiz')) {
    return 'Raw Materials';
  }
  if (name.includes('logistic') || name.includes('freight') || name.includes('ship') || name.includes('truck') || name.includes('express') || name.includes('ups') || name.includes('fedex')) {
    return 'Shipping & Freight';
  }
  if (name.includes('tech') || name.includes('electro') || name.includes('chip') || name.includes('circuit') || name.includes('control') || name.includes('adcon')) {
    return 'Electronics & Chips';
  }
  if (name.includes('part') || name.includes('machin') || name.includes('precision') || name.includes('spring') || name.includes('linear') || name.includes('bdi') || name.includes('bearing')) {
    return 'Precision Engineering';
  }
  return 'Support Services';
}

// Automatically extract unique suppliers from DB purchase orders
function extractVendorsFromOrders(dbOrders) {
  const vendorMap = new Map();
  
  // Seed with default profiles to ensure contact listings remain premium
  const defaultProfiles = [
    { id: 'vend-1', name: 'Apex Industrial', category: 'Raw Materials', contact: 'contact@apex.com' },
    { id: 'vend-2', name: 'Vortex Logistics', category: 'Shipping & Freight', contact: 'ops@vortex.com' },
    { id: 'vend-3', name: 'Nova Tech Labs', category: 'Electronics & Chips', contact: 'sales@novatech.com' },
    { id: 'vend-4', name: 'Quantum Parts', category: 'Precision Engineering', contact: 'info@quantum.com' },
    { id: 'vend-5', name: 'Aegis Security', category: 'Support Services', contact: 'service@aegis.com' }
  ];
  
  defaultProfiles.forEach(v => {
    vendorMap.set(v.name.toLowerCase().trim(), v);
  });

  // Pull from ETO PO rows
  dbOrders.forEach(o => {
    if (!o.vendorName) return;
    const key = o.vendorName.trim().toLowerCase();
    if (!vendorMap.has(key)) {
      vendorMap.set(key, {
        id: `vend-${vendorMap.size + 1}`,
        name: o.vendorName.trim(),
        category: inferVendorCategory(o.vendorName, o.partDesc),
        contact: o.vendorContact || 'procurement@vendor.com',
        phone: o.vendorPhone || ''
      });
    }
  });

  return Array.from(vendorMap.values());
}

async function initializeData() {
  // Load Theme
  state.theme = localStorage.getItem('vtd_theme') || 'light';

  // Load custom local planning overlays
  state.localVendors = JSON.parse(localStorage.getItem('vtd_local_vendors') || '[]');
  state.localOrders = JSON.parse(localStorage.getItem('vtd_local_orders') || '[]');

  // Show visual loading states
  elements.recentOrdersTable.innerHTML = `<tr><td colspan="7" class="empty-state">Loading ETO database ledger...</td></tr>`;

  // Parallel fetch projects and orders
  const [dbProjects, dbOrders] = await Promise.all([
    fetchFromApi('/api/projects'),
    fetchFromApi('/api/orders')
  ]);

  if (dbProjects) state.projects = dbProjects;
  
  const fetchedOrders = dbOrders || [];
  const fetchedVendors = extractVendorsFromOrders(fetchedOrders);

  // Merge database items with local planning overlays
  state.orders = [...fetchedOrders, ...state.localOrders];
  state.vendors = [...fetchedVendors, ...state.localVendors];

  // Set default selected project
  if (state.projects.length > 0) {
    // If state has an active selection, keep it, otherwise set first
    if (!state.selectedProjectId || !state.projects.some(p => p.id === state.selectedProjectId)) {
      state.selectedProjectId = state.projects[0].id;
    }
  }

  // Set default selected vendor (highest spend vendor)
  if (state.vendors.length > 0) {
    if (!state.selectedVendorId || !state.vendors.some(v => v.id === state.selectedVendorId)) {
      let highestSpend = -1;
      let defaultVendorId = state.vendors[0].id;
      
      state.vendors.forEach(v => {
        const vOrders = state.orders.filter(o => o.vendorName.trim().toLowerCase() === v.name.trim().toLowerCase());
        const totalSpend = vOrders.reduce((sum, o) => sum + o.amount, 0);
        if (totalSpend > highestSpend) {
          highestSpend = totalSpend;
          defaultVendorId = v.id;
        }
      });
      state.selectedVendorId = defaultVendorId;
    }
  }
}

// ========================================================================
// CORE METRICS ENGINE
// ========================================================================
function computeDashboardMetrics(filteredOrders) {
  // 1. Total Spend
  const totalSpend = filteredOrders.reduce((sum, o) => sum + o.amount, 0);

  // 2. Avg Order Size
  const avgOrderSize = filteredOrders.length > 0 ? (totalSpend / filteredOrders.length) : 0;

  // 3. Avg Shipping Duration & On-Time Rate
  let totalShipDays = 0;
  let shippedOrdersCount = 0;
  let onTimeCount = 0;
  let closedOrdersCount = 0;

  const todayStr = new Date().toISOString().split('T')[0];

  filteredOrders.forEach(o => {
    // Calc shipping speed
    if (o.shipDate) {
      const orderD = new Date(o.orderDate);
      const shipD = new Date(o.shipDate);
      const timeDiff = shipD - orderD;
      const daysDiff = Math.max(0, Math.ceil(timeDiff / (1000 * 60 * 60 * 24)));
      totalShipDays += daysDiff;
      shippedOrdersCount++;

      // Check due date threshold
      if (o.dueDate) {
        const dueD = new Date(o.dueDate);
        if (shipD <= dueD) {
          onTimeCount++;
        }
        closedOrdersCount++;
      }
    } else {
      // Pending item: check if past due date
      if (o.dueDate && o.dueDate < todayStr) {
        closedOrdersCount++; // Deliberately factored as delayed (closes with late status)
      }
    }
  });

  const avgShippingTime = shippedOrdersCount > 0 ? (totalShipDays / shippedOrdersCount) : 0;
  const onTimeRate = closedOrdersCount > 0 ? (onTimeCount / closedOrdersCount) * 100 : 100;

  return {
    totalSpend,
    avgOrderSize,
    avgShippingTime,
    onTimeRate
  };
}

function getDummyTrends(selectedProjectId) {
  if (selectedProjectId) {
    return {
      spendTrend: { value: '+2.8%', isUp: true, text: 'vs last project' },
      avgTrend: { value: '-4.1%', isUp: false, text: 'vs project target' },
      shipTrend: { value: '-1.2d', isUp: true, text: 'vs company baseline' },
      ontimeTrend: { value: '+0.5%', isUp: true, text: 'above threshold' }
    };
  } else {
    return {
      spendTrend: { value: '+14.2%', isUp: true, text: 'vs live ETO budget' },
      avgTrend: { value: '+1.7%', isUp: true, text: 'vs last quarter' },
      shipTrend: { value: '-0.6d', isUp: true, text: 'delivery speed' },
      ontimeTrend: { value: '+2.4%', isUp: true, text: 'vs benchmark' }
    };
  }
}

function updateKPIWidgets(metrics, trends) {
  const formattedSpend = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(metrics.totalSpend);

  const formattedAvg = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(metrics.avgOrderSize);

  const formattedShipping = metrics.avgShippingTime > 0 ? (metrics.avgShippingTime.toFixed(1) + ' Days') : '—';
  const formattedOnTime = metrics.onTimeRate.toFixed(1) + '%';

  elements.kpiTotalSpend.forEach(el => el.textContent = formattedSpend);
  elements.kpiAvgSpend.forEach(el => el.textContent = formattedAvg);
  elements.kpiShipping.forEach(el => el.textContent = formattedShipping);
  elements.kpiOnTime.forEach(el => el.textContent = formattedOnTime);

  applyTrendBadge(elements.kpiTotalSpendTrend, trends.spendTrend);
  applyTrendBadge(elements.kpiAvgSpendTrend, trends.avgTrend);
  applyTrendBadge(elements.kpiShippingTrend, trends.shipTrend);
  applyTrendBadge(elements.kpiOnTimeTrend, trends.ontimeTrend);
}

function applyTrendBadge(element, trendData) {
  if (!element) return;
  element.innerHTML = `
    <span class="trend-badge ${trendData.isUp ? 'up' : 'down'}">
      <i class="lucide-icon" data-lucide="${trendData.isUp ? 'arrow-up-right' : 'arrow-down-right'}"></i>
      ${trendData.value}
    </span>
    <span class="text">${trendData.text}</span>
  `;
}

// ========================================================================
// RENDER COMPONENT PANELS
// ========================================================================

function renderVendorsRankings() {
  elements.vendorsList.innerHTML = '';
  
  if (state.vendors.length === 0) {
    elements.vendorsList.innerHTML = '<div class="empty-state">No active vendors found.</div>';
    return;
  }

  // Calculate scorecards based on live PO histories
  const vendorStats = state.vendors.map(v => {
    const vOrders = state.orders.filter(o => o.vendorName.trim().toLowerCase() === v.name.trim().toLowerCase());
    const totalSpend = vOrders.reduce((sum, o) => sum + o.amount, 0);
    
    let onTimeCount = 0;
    let closedCount = 0;
    const todayStr = new Date().toISOString().split('T')[0];

    vOrders.forEach(o => {
      if (o.shipDate) {
        if (new Date(o.shipDate) <= new Date(o.dueDate)) onTimeCount++;
        closedCount++;
      } else if (o.dueDate && o.dueDate < todayStr) {
        closedCount++;
      }
    });

    const onTimeRate = closedCount > 0 ? (onTimeCount / closedCount) * 100 : 100;
    
    // Balanced Performance Rating (70% on-time reliability + 30% volume)
    const normalizedSpendScore = Math.min(30, (totalSpend / 250000) * 30);
    const reliabilityScore = (onTimeRate / 100) * 70;
    const score = Math.min(100, Math.max(0, Math.round(normalizedSpendScore + reliabilityScore)));

    return {
      ...v,
      totalSpend,
      orderCount: vOrders.length,
      onTimeRate,
      score
    };
  });

  // Sort highest score first
  vendorStats.sort((a, b) => b.score - a.score);

  // Take top 8 active vendors
  vendorStats.slice(0, 8).forEach(v => {
    let scoreClass = 'high';
    if (v.score < 80) scoreClass = 'med';
    if (v.score < 60) scoreClass = 'low';

    const formattedSpend = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(v.totalSpend);

    const li = document.createElement('div');
    li.className = 'vendor-list-item';
    li.innerHTML = `
      <div class="vendor-info">
        <span class="vendor-name">${v.name}</span>
        <span class="vendor-meta">${v.category} • ${v.orderCount} Orders • ${formattedSpend} Spend</span>
      </div>
      <div class="vendor-score">
        <span class="score-num ${scoreClass}">${v.score}</span>
        <div class="score-label">Score</div>
      </div>
    `;
    elements.vendorsList.appendChild(li);
  });
}

function renderRecentOrdersTable(searchQuery = '', filterStatus = '') {
  elements.recentOrdersTable.innerHTML = '';

  let filtered = [...state.orders];
  
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(o => 
      o.id.toLowerCase().includes(q) || 
      o.vendorName.toLowerCase().includes(q) || 
      (o.partNumber && o.partNumber.toLowerCase().includes(q))
    );
  }

  if (filterStatus) {
    filtered = filtered.filter(o => o.status.toLowerCase() === filterStatus.toLowerCase());
  }

  filtered.sort((a, b) => new Date(b.orderDate) - new Date(a.orderDate));

  if (filtered.length === 0) {
    elements.recentOrdersTable.innerHTML = `
      <tr>
        <td colspan="7" class="empty-state" style="text-align: center;">No purchase orders matching filters</td>
      </tr>
    `;
    return;
  }

  filtered.forEach(o => {
    const tr = document.createElement('tr');
    const formattedAmount = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(o.amount);

    let statusClass = o.status.toLowerCase();
    const todayStr = new Date().toISOString().split('T')[0];
    if (o.status !== 'Delivered' && o.dueDate && o.dueDate < todayStr) {
      statusClass = 'delayed';
    }

    const proj = state.projects.find(p => p.id === o.projectId);
    const projName = proj ? proj.name : `Job ${o.projectId}`;

    tr.innerHTML = `
      <td><strong>${o.id}</strong></td>
      <td>${projName}</td>
      <td>${o.vendorName}</td>
      <td>${o.orderDate}</td>
      <td>${o.dueDate || '—'}</td>
      <td><strong>${formattedAmount}</strong></td>
      <td><span class="badge ${statusClass}">${o.status}</span></td>
    `;
    elements.recentOrdersTable.appendChild(tr);
  });
}

function renderAnalyzerOrdersTable(searchQuery = '', filterStatus = '') {
  elements.analyzerOrdersTable.innerHTML = '';
  
  if (!state.selectedProjectId) {
    elements.analyzerOrdersTable.innerHTML = `<tr><td colspan="6" class="empty-state">Select a project</td></tr>`;
    return;
  }

  let filtered = state.orders.filter(o => o.projectId === state.selectedProjectId);

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(o => 
      o.id.toLowerCase().includes(q) || 
      o.vendorName.toLowerCase().includes(q) ||
      (o.partNumber && o.partNumber.toLowerCase().includes(q))
    );
  }

  if (filterStatus) {
    filtered = filtered.filter(o => o.status.toLowerCase() === filterStatus.toLowerCase());
  }

  filtered.sort((a, b) => new Date(b.orderDate) - new Date(a.orderDate));

  if (filtered.length === 0) {
    elements.analyzerOrdersTable.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state" style="text-align: center;">No project purchase orders found</td>
      </tr>
    `;
    return;
  }

  filtered.forEach(o => {
    const tr = document.createElement('tr');
    const formattedAmount = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(o.amount);

    let statusClass = o.status.toLowerCase();
    const todayStr = new Date().toISOString().split('T')[0];
    if (o.status !== 'Delivered' && o.dueDate && o.dueDate < todayStr) {
      statusClass = 'delayed';
    }

    tr.innerHTML = `
      <td><strong>${o.id}</strong></td>
      <td>${o.vendorName}</td>
      <td>${o.orderDate}</td>
      <td>${o.shipDate || '—'}</td>
      <td><strong>${formattedAmount}</strong></td>
      <td><span class="badge ${statusClass}">${o.status}</span></td>
    `;
    elements.analyzerOrdersTable.appendChild(tr);
  });
}

function updateVendorHeaderDetails() {
  const v = state.vendors.find(item => item.id === state.selectedVendorId);
  if (!v) return;

  // Update contact cards
  elements.vendorContactEmail.textContent = v.contact || 'procurement@vendor.com';
  elements.vendorContactPhone.textContent = v.phone || '—';

  // Filter POs for this vendor
  const vOrders = state.orders.filter(o => o.vendorName.trim().toLowerCase() === v.name.trim().toLowerCase());
  const metrics = computeDashboardMetrics(vOrders);

  // Update KPI Numbers
  elements.vendorKpiSpend.textContent = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(metrics.totalSpend);

  elements.vendorKpiOntime.textContent = metrics.onTimeRate.toFixed(1) + '%';
  elements.vendorKpiShipping.textContent = metrics.avgShippingTime > 0 
    ? (metrics.avgShippingTime.toFixed(1) + ' Days') 
    : '—';
  elements.vendorKpiVolume.textContent = vOrders.length + (vOrders.length === 1 ? ' Order' : ' Orders');
}

function renderVendorOrdersTable(searchQuery = '', filterStatus = '') {
  elements.vendorOrdersTable.innerHTML = '';
  
  if (!state.selectedVendorId) {
    elements.vendorOrdersTable.innerHTML = `<tr><td colspan="6" class="empty-state">Select a supplier</td></tr>`;
    return;
  }

  const v = state.vendors.find(item => item.id === state.selectedVendorId);
  if (!v) return;

  let filtered = state.orders.filter(o => o.vendorName.trim().toLowerCase() === v.name.trim().toLowerCase());

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(o => 
      o.id.toLowerCase().includes(q) || 
      (o.partNumber && o.partNumber.toLowerCase().includes(q)) ||
      (o.partDesc && o.partDesc.toLowerCase().includes(q))
    );
  }

  if (filterStatus) {
    filtered = filtered.filter(o => o.status.toLowerCase() === filterStatus.toLowerCase());
  }

  filtered.sort((a, b) => new Date(b.orderDate) - new Date(a.orderDate));

  if (filtered.length === 0) {
    elements.vendorOrdersTable.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state" style="text-align: center;">No supplier purchase orders found</td>
      </tr>
    `;
    return;
  }

  filtered.forEach(o => {
    const tr = document.createElement('tr');
    const formattedAmount = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(o.amount);

    let statusClass = o.status.toLowerCase();
    const todayStr = new Date().toISOString().split('T')[0];
    if (o.status !== 'Delivered' && o.dueDate && o.dueDate < todayStr) {
      statusClass = 'delayed';
    }

    const proj = state.projects.find(p => p.id === o.projectId);
    const projName = proj ? proj.name : `Job ${o.projectId}`;

    tr.innerHTML = `
      <td><strong>${o.id}</strong></td>
      <td>${projName}</td>
      <td>${o.orderDate}</td>
      <td>${o.dueDate || '—'}</td>
      <td><strong>${formattedAmount}</strong></td>
      <td><span class="badge ${statusClass}">${o.status}</span></td>
    `;
    elements.vendorOrdersTable.appendChild(tr);
  });
}

// Fetch and display Smartsheet Timeline Milestones dynamically
async function loadSmartsheetTimeline() {
  elements.smartsheetCard.style.display = 'none';
  elements.smartsheetList.innerHTML = '';
  
  if (!state.selectedProjectId) return;
  
  const schedule = await fetchFromApi(`/api/projects/${state.selectedProjectId}/schedule`);
  
  if (!schedule || (!schedule.buildStart && schedule.milestones.length === 0)) {
    // Graceful hide if no schedule exists or Smartsheet returns empty
    return;
  }

  elements.smartsheetCard.style.display = 'block';
  
  if (schedule.source) {
    elements.smartsheetSource.textContent = `Sheet: ${schedule.source}`;
    if (schedule.permalink) {
      elements.smartsheetSource.innerHTML = `<a href="${schedule.permalink}" target="_blank" style="color: inherit; text-decoration: underline;">Sheet: ${schedule.source} <i data-lucide="external-link" style="width:12px;height:12px;display:inline;"></i></a>`;
    }
  }

  let textMeta = '';
  if (schedule.buildStart) textMeta += `Build Start: <strong>${schedule.buildStart}</strong>`;
  if (schedule.buildComplete) textMeta += `${textMeta ? '  |  ' : ''}Build Target Complete: <strong>${schedule.buildComplete}</strong>`;
  elements.smartsheetMeta.innerHTML = textMeta || 'Sourced from live Smartsheet tracker';

  if (schedule.milestones.length === 0) {
    elements.smartsheetList.innerHTML = '<div class="empty-state">No milestones defined on sheet.</div>';
    return;
  }

  schedule.milestones.forEach(m => {
    const node = document.createElement('div');
    
    let isCompleted = m.percent >= 1;
    let nodeClass = isCompleted ? 'completed' : '';
    
    let healthColor = '#10b981'; // green
    if (m.health === 'Red' || m.health === 'Delayed') {
      healthColor = '#f43f5e';
      nodeClass += ' at-risk';
    } else if (m.health === 'Yellow') {
      healthColor = '#f59e0b';
    }

    const pctText = Math.round(m.percent * 100) + '%';
    const finalDate = m.finish || m.start || '—';

    node.className = `timeline-node ${nodeClass}`;
    node.innerHTML = `
      <div class="timeline-node-header">
        <span class="timeline-node-status" style="color: ${healthColor};">${m.health || 'Active'}</span>
        <i data-lucide="${isCompleted ? 'check-circle' : 'circle-ellipsis'}" style="width: 16px; height: 16px; color: ${healthColor};"></i>
      </div>
      <div class="timeline-node-title">${m.name}</div>
      <div class="timeline-node-date">${finalDate}</div>
      <div class="timeline-node-progress">
        <div class="timeline-progress-bar">
          <div class="timeline-progress-fill" style="width: ${m.percent * 100}%"></div>
        </div>
        <span>${pctText}</span>
      </div>
    `;
    elements.smartsheetList.appendChild(node);
  });

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function updateProjectSelectors() {
  const currentSelected = state.selectedProjectId;
  
  elements.projectSelector.innerHTML = '';
  elements.formOrderProject.innerHTML = '<option value="" disabled selected>Select Project</option>';

  if (state.projects.length === 0) return;

  state.projects.forEach(p => {
    const option = document.createElement('option');
    option.value = p.id;
    option.textContent = `${p.id} - ${p.name}`;
    if (p.id === currentSelected) {
      option.selected = true;
    }
    elements.projectSelector.appendChild(option);

    const formOpt = document.createElement('option');
    formOpt.value = p.id;
    formOpt.textContent = p.name;
    elements.formOrderProject.appendChild(formOpt);
  });
}

function updateVendorSelectors() {
  elements.formOrderVendor.innerHTML = '<option value="" disabled selected>Select Vendor</option>';
  elements.vendorSelector.innerHTML = '';
  
  const currentSelected = state.selectedVendorId;

  state.vendors.forEach(v => {
    // Requisition form selector
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = v.name;
    elements.formOrderVendor.appendChild(opt);

    // Vendor Analyzer tab selector
    const analyzerOpt = document.createElement('option');
    analyzerOpt.value = v.id;
    analyzerOpt.textContent = v.name;
    if (v.id === currentSelected) {
      analyzerOpt.selected = true;
    }
    elements.vendorSelector.appendChild(analyzerOpt);
  });
}

function updateProjectHeaderDetails() {
  const p = state.projects.find(item => item.id === state.selectedProjectId);
  if (!p) return;

  const formattedBudget = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(p.budget);

  const pOrders = state.orders.filter(o => o.projectId === p.id);
  const uniqueVendors = new Set(pOrders.map(o => o.vendorName.trim().toLowerCase()));

  elements.projectPillBudget.innerHTML = `Budget: <strong>${formattedBudget}</strong>`;
  elements.projectPillStatus.innerHTML = `Status: <strong>${p.status}</strong>`;
  elements.projectPillVendorCount.innerHTML = `Vendors: <strong>${uniqueVendors.size}</strong>`;

  // Compute Primary Vendor Performance on this Project
  // 1. Group project orders by vendor
  const vendorSpendMap = {};
  pOrders.forEach(o => {
    const vName = o.vendorName.trim();
    if (!vendorSpendMap[vName]) {
      vendorSpendMap[vName] = {
        name: vName,
        spend: 0,
        orders: []
      };
    }
    vendorSpendMap[vName].spend += o.amount;
    vendorSpendMap[vName].orders.push(o);
  });

  // Sort vendors by spend descending to find the top vendor
  const sortedProjectVendors = Object.values(vendorSpendMap).sort((a, b) => b.spend - a.spend);

  const topVendor = sortedProjectVendors[0];
  const totalProjSpend = pOrders.reduce((sum, o) => sum + o.amount, 0);

  const topNameEl = document.getElementById('analyzer-vendor-top-name');
  const topSpendEl = document.getElementById('analyzer-vendor-top-spend');
  const topOntimeEl = document.getElementById('analyzer-vendor-ontime');
  const topShippingEl = document.getElementById('analyzer-vendor-shipping');
  const topVolumeEl = document.getElementById('analyzer-vendor-volume');

  if (topVendor) {
    // 2. Compute metrics for this top vendor specifically inside this project
    const topVendorMetrics = computeDashboardMetrics(topVendor.orders);
    
    // Format spend and percentage
    const spendPercentage = totalProjSpend > 0 ? ((topVendor.spend / totalProjSpend) * 100).toFixed(1) : '0.0';
    const formattedTopSpend = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(topVendor.spend);

    if (topNameEl) topNameEl.innerText = topVendor.name;
    if (topSpendEl) topSpendEl.innerText = `${formattedTopSpend} (${spendPercentage}% of project spend)`;
    if (topOntimeEl) topOntimeEl.innerText = `${topVendorMetrics.onTimeRate.toFixed(1)}%`;
    if (topShippingEl) topShippingEl.innerText = `${topVendorMetrics.avgShippingTime.toFixed(1)} Days`;
    if (topVolumeEl) topVolumeEl.innerText = `${topVendor.orders.length} ${topVendor.orders.length === 1 ? 'Order' : 'Orders'}`;
  } else {
    // Graceful empty states handling
    if (topNameEl) topNameEl.innerText = 'No suppliers assigned';
    if (topSpendEl) topSpendEl.innerText = '$0 spend';
    if (topOntimeEl) topOntimeEl.innerText = '—';
    if (topShippingEl) topShippingEl.innerText = '—';
    if (topVolumeEl) topVolumeEl.innerText = '0 Orders';
  }
}

// ========================================================================
// CHART GENERATION ENGINE (CHART.JS CONFIG)
// ========================================================================
function initCharts() {
  Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
  Chart.defaults.color = state.theme === 'dark' ? '#8b949e' : '#4A5567';
  Chart.defaults.borderColor = state.theme === 'dark' ? 'rgba(240,246,252,0.08)' : 'rgba(6,29,57,0.06)';
}

function updateDashboardCharts() {
  const isDark = state.theme === 'dark';
  const labelColor = isDark ? '#9ca3af' : '#475569';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';

  if (state.activeTab === 'overview') {
    // 1. Spend Allocation by Project
    const projectLabels = state.projects.map(p => p.name);
    const projectData = state.projects.map(p => {
      return state.orders
        .filter(o => o.projectId === p.id)
        .reduce((sum, o) => sum + o.amount, 0);
    });

    const spendCtx = document.getElementById('spendChart').getContext('2d');
    if (spendChartInstance) spendChartInstance.destroy();
    
    const gradient = spendCtx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, '#1574C4');
    gradient.addColorStop(1, '#1265AC');

    spendChartInstance = new Chart(spendCtx, {
      type: 'bar',
      data: {
        labels: projectLabels,
        datasets: [{
          label: 'Spend ($)',
          data: projectData,
          backgroundColor: gradient,
          borderRadius: 8,
          borderWidth: 0,
          barThickness: 30
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            padding: 12,
            backgroundColor: isDark ? 'rgba(17, 24, 39, 0.95)' : 'rgba(255, 255, 255, 0.95)',
            titleColor: isDark ? '#ffffff' : '#0f172a',
            bodyColor: isDark ? '#e5e7eb' : '#334155',
            borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)',
            borderWidth: 1,
            callbacks: {
              label: (ctx) => `Spend: $${ctx.raw.toLocaleString()}`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: labelColor }
          },
          y: {
            grid: { color: gridColor },
            ticks: {
              color: labelColor,
              callback: (val) => `$${val >= 1000 ? (val / 1000) + 'k' : val}`
            }
          }
        }
      }
    });

    // 2. Vendor Reliability Polar Chart (Top 5 Vendors)
    const topVendors = state.vendors.slice(0, 5);
    const vendorLabels = topVendors.map(v => v.name);
    const vendorPerformanceData = topVendors.map(v => {
      const vOrders = state.orders.filter(o => o.vendorName.trim().toLowerCase() === v.name.trim().toLowerCase());
      let onTime = 0;
      let closed = 0;
      const todayStr = new Date().toISOString().split('T')[0];

      vOrders.forEach(o => {
        if (o.shipDate) {
          if (new Date(o.shipDate) <= new Date(o.dueDate)) onTime++;
          closed++;
        } else if (o.dueDate && o.dueDate < todayStr) {
          closed++;
        }
      });
      return closed > 0 ? Math.round((onTime / closed) * 100) : 100;
    });

    const perfCtx = document.getElementById('performanceChart').getContext('2d');
    if (performanceChartInstance) performanceChartInstance.destroy();

    performanceChartInstance = new Chart(perfCtx, {
      type: 'polarArea',
      data: {
        labels: vendorLabels,
        datasets: [{
          data: vendorPerformanceData,
          backgroundColor: [
            'rgba(21, 116, 196, 0.75)',
            'rgba(116, 196, 21, 0.75)',
            'rgba(255, 222, 81, 0.85)',
            'rgba(6, 29, 57,  0.65)',
            'rgba(180, 35, 24, 0.70)'
          ],
          borderWidth: 1,
          borderColor: isDark ? '#1f2937' : '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          r: {
            grid: { color: gridColor },
            ticks: {
              backdropColor: 'transparent',
              color: labelColor,
              stepSize: 20
            },
            angleLines: { color: gridColor }
          }
        },
        plugins: {
          legend: {
            position: 'bottom',
            labels: { boxWidth: 10, padding: 8, color: labelColor }
          },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.label}: ${ctx.raw}% On-Time`
            }
          }
        }
      }
    });

  } else if (state.activeTab === 'analyzer') {
    // 3. Project Spend Doughnut Share
    const pOrders = state.orders.filter(o => o.projectId === state.selectedProjectId);
    const vendorSpendMap = {};
    
    pOrders.forEach(o => {
      vendorSpendMap[o.vendorName] = (vendorSpendMap[o.vendorName] || 0) + o.amount;
    });

    const sortedVendors = Object.entries(vendorSpendMap).sort((a, b) => b[1] - a[1]);
    const pLabels = sortedVendors.slice(0, 5).map(v => v[0]);
    const pData = sortedVendors.slice(0, 5).map(v => v[1]);
    
    // Sum the remaining vendors as "Others"
    if (sortedVendors.length > 5) {
      pLabels.push('Other Suppliers');
      const otherSum = sortedVendors.slice(5).reduce((sum, v) => sum + v[1], 0);
      pData.push(otherSum);
    }

    const spendCtx = document.getElementById('projectSpendChart').getContext('2d');
    if (spendChartInstance) spendChartInstance.destroy();

    spendChartInstance = new Chart(spendCtx, {
      type: 'doughnut',
      data: {
        labels: pLabels.length > 0 ? pLabels : ['No Spend'],
        datasets: [{
          data: pData.length > 0 ? pData : [0],
          backgroundColor: [
            '#1574C4', '#74C415', '#FFDE51', '#0E548E', '#B42318', '#768093'
          ],
          borderWidth: 2,
          borderColor: isDark ? '#111827' : '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { boxWidth: 10, padding: 10, color: labelColor }
          },
          tooltip: {
            callbacks: {
              label: (ctx) => `Spend Share: $${ctx.raw.toLocaleString()}`
            }
          }
        },
        cutout: '60%'
      }
    });

    // 4. Project Cumulative Spending line
    const sortedPOrders = [...pOrders].sort((a, b) => new Date(a.orderDate) - new Date(b.orderDate));
    let cumulativeSum = 0;
    const trendLabels = [];
    const trendData = [];

    sortedPOrders.forEach(o => {
      cumulativeSum += o.amount;
      trendLabels.push(o.orderDate);
      trendData.push(cumulativeSum);
    });

    const trendCtx = document.getElementById('projectTrendChart').getContext('2d');
    if (performanceChartInstance) performanceChartInstance.destroy();

    const lineGradient = trendCtx.createLinearGradient(0, 0, 0, 200);
    lineGradient.addColorStop(0, 'rgba(21, 116, 196, 0.18)');
    lineGradient.addColorStop(1, 'rgba(21, 116, 196, 0.00)');

    performanceChartInstance = new Chart(trendCtx, {
      type: 'line',
      data: {
        labels: trendLabels.length > 0 ? trendLabels : ['No Orders'],
        datasets: [{
          label: 'Budget Depletion ($)',
          data: trendData.length > 0 ? trendData : [0],
          borderColor: '#1574C4',
          borderWidth: 2,
          backgroundColor: lineGradient,
          fill: true,
          tension: 0.3,
          pointBackgroundColor: '#1574C4',
          pointHoverRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `Exhausted: $${ctx.raw.toLocaleString()}`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: labelColor }
          },
          y: {
            grid: { color: gridColor },
            ticks: {
              color: labelColor,
              callback: (val) => `$${val >= 1000 ? (val / 1000) + 'k' : val}`
            }
          }
        }
      }
    });
  } else if (state.activeTab === 'vendor') {
    // 5. Vendor Spend Distribution by Project
    const v = state.vendors.find(item => item.id === state.selectedVendorId);
    const vOrders = v ? state.orders.filter(o => o.vendorName.trim().toLowerCase() === v.name.trim().toLowerCase()) : [];
    
    const projectSpendMap = {};
    vOrders.forEach(o => {
      const proj = state.projects.find(p => p.id === o.projectId);
      const projName = proj ? proj.name : `Job ${o.projectId}`;
      projectSpendMap[projName] = (projectSpendMap[projName] || 0) + o.amount;
    });

    const sortedProjects = Object.entries(projectSpendMap).sort((a, b) => b[1] - a[1]);
    const pLabels = sortedProjects.map(p => p[0]);
    const pData = sortedProjects.map(p => p[1]);

    const spendCtx = document.getElementById('vendorSpendChart').getContext('2d');
    if (vendorSpendChartInstance) vendorSpendChartInstance.destroy();

    const gradient = spendCtx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, '#1574C4');
    gradient.addColorStop(1, '#74C415');

    vendorSpendChartInstance = new Chart(spendCtx, {
      type: 'bar',
      data: {
        labels: pLabels.length > 0 ? pLabels : ['No Spend'],
        datasets: [{
          label: 'Spend ($)',
          data: pData.length > 0 ? pData : [0],
          backgroundColor: gradient,
          borderRadius: 8,
          borderWidth: 0,
          barThickness: 30
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            padding: 12,
            backgroundColor: isDark ? 'rgba(17, 24, 39, 0.95)' : 'rgba(255, 255, 255, 0.95)',
            titleColor: isDark ? '#ffffff' : '#0f172a',
            bodyColor: isDark ? '#e5e7eb' : '#334155',
            borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)',
            borderWidth: 1,
            callbacks: {
              label: (ctx) => `Spend: $${ctx.raw.toLocaleString()}`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: labelColor }
          },
          y: {
            grid: { color: gridColor },
            ticks: {
              color: labelColor,
              callback: (val) => `$${val >= 1000 ? (val / 1000) + 'k' : val}`
            }
          }
        }
      }
    });

    // 6. Vendor Order Status Breakdown
    const statusCounts = {
      'Delivered': 0,
      'Shipped': 0,
      'Pending': 0,
      'Delayed': 0
    };

    const todayStr = new Date().toISOString().split('T')[0];
    vOrders.forEach(o => {
      let status = o.status;
      if (status !== 'Delivered' && o.dueDate && o.dueDate < todayStr) {
        status = 'Delayed';
      }
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });

    const sLabels = Object.keys(statusCounts);
    const sData = Object.values(statusCounts);

    const statusCtx = document.getElementById('vendorStatusChart').getContext('2d');
    if (vendorStatusChartInstance) vendorStatusChartInstance.destroy();

    vendorStatusChartInstance = new Chart(statusCtx, {
      type: 'doughnut',
      data: {
        labels: sLabels,
        datasets: [{
          data: sData,
          backgroundColor: [
            '#2F7D33', // Delivered — SDC positive
            '#1574C4', // Shipped   — SDC blue
            '#B97A0E', // Pending   — SDC warning
            '#B42318'  // Delayed   — SDC danger
          ],
          borderWidth: 2,
          borderColor: isDark ? '#111827' : '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { boxWidth: 10, padding: 10, color: labelColor }
          },
          tooltip: {
            callbacks: {
              label: (ctx) => `Orders: ${ctx.raw}`
            }
          }
        },
        cutout: '60%'
      }
    });
  }
}

// ========================================================================
// CORE VIEW CONTROLLER & ROUTER
// ========================================================================
function renderDashboard() {
  // Update topbar breadcrumb
  const crumbEl = document.getElementById('topbar-crumb-active');
  if (crumbEl) {
    const crumbNames = { overview: 'Overview', analyzer: 'Project Analyzer', vendor: 'Vendor Analyzer' };
    crumbEl.textContent = crumbNames[state.activeTab] || 'Overview';
  }

  if (state.activeTab === 'overview') {
    elements.panelOverview.classList.add('active');
    elements.panelAnalyzer.classList.remove('active');
    elements.panelVendor.classList.remove('active');
    elements.tabOverview.classList.add('active');
    elements.tabAnalyzer.classList.remove('active');
    elements.tabVendor.classList.remove('active');

    const metrics = computeDashboardMetrics(state.orders);
    const trends = getDummyTrends(null);
    updateKPIWidgets(metrics, trends);

    renderVendorsRankings();
    renderRecentOrdersTable(
      elements.searchOverview.value,
      elements.filterStatusOverview.value
    );

  } else if (state.activeTab === 'analyzer') {
    elements.panelAnalyzer.classList.add('active');
    elements.panelOverview.classList.remove('active');
    elements.panelVendor.classList.remove('active');
    elements.tabAnalyzer.classList.add('active');
    elements.tabOverview.classList.remove('active');
    elements.tabVendor.classList.remove('active');

    const projectOrders = state.orders.filter(o => o.projectId === state.selectedProjectId);
    const metrics = computeDashboardMetrics(projectOrders);
    const trends = getDummyTrends(state.selectedProjectId);
    
    updateKPIWidgets(metrics, trends);
    updateProjectHeaderDetails();
    renderAnalyzerOrdersTable(
      elements.searchAnalyzer.value,
      elements.filterStatusAnalyzer.value
    );
    
    // Load Smartsheet milestones dynamically
    loadSmartsheetTimeline();

  } else if (state.activeTab === 'vendor') {
    elements.panelVendor.classList.add('active');
    elements.panelOverview.classList.remove('active');
    elements.panelAnalyzer.classList.remove('active');
    elements.tabVendor.classList.add('active');
    elements.tabOverview.classList.remove('active');
    elements.tabAnalyzer.classList.remove('active');

    const v = state.vendors.find(item => item.id === state.selectedVendorId);
    if (v) {
      const vOrders = state.orders.filter(o => o.vendorName.trim().toLowerCase() === v.name.trim().toLowerCase());
      const metrics = computeDashboardMetrics(vOrders);
      const trends = {
        spendTrend: { value: '+3.5%', isUp: true, text: 'vs category avg' },
        avgTrend: { value: '+1.2%', isUp: true, text: 'vs supplier history' },
        shipTrend: { value: '-0.4d', isUp: true, text: 'improvement' },
        ontimeTrend: { value: '+2.1%', isUp: true, text: 'above SLA limit' }
      };
      updateKPIWidgets(metrics, trends);
    }
    
    updateVendorHeaderDetails();
    renderVendorOrdersTable(
      elements.searchVendorPo.value,
      elements.filterStatusVendor.value
    );
  }

  if (window.lucide) {
    window.lucide.createIcons();
  }

  updateDashboardCharts();
}

// ========================================================================
// THEME MANIPULATOR (DARK & LIGHT THEMES)
// ========================================================================
function initTheme() {
  document.documentElement.setAttribute('data-theme', state.theme);
  updateThemeIcon();
}

function updateThemeIcon() {
  if (state.theme === 'dark') {
    elements.themeIcon.setAttribute('data-lucide', 'sun');
    elements.themeIcon.style.color = '#f59e0b';
  } else {
    elements.themeIcon.setAttribute('data-lucide', 'moon');
    elements.themeIcon.style.color = '#1574C4';
  }
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('vtd_theme', state.theme);
  
  document.documentElement.setAttribute('data-theme', state.theme);
  updateThemeIcon();

  initCharts();
  updateDashboardCharts();
}

// ========================================================================
// MODAL CONTROLLER & DIALOGS
// ========================================================================
function openModal(modal) {
  modal.classList.add('open');
}

function closeModal(modal) {
  modal.classList.remove('open');
}

// ========================================================================
// APPLICATION EVENT BINDINGS
// ========================================================================
function bindEventHandlers() {
  elements.themeToggleBtn.addEventListener('click', toggleTheme);

  elements.tabOverview.addEventListener('click', () => {
    state.activeTab = 'overview';
    renderDashboard();
  });

  elements.tabAnalyzer.addEventListener('click', () => {
    state.activeTab = 'analyzer';
    renderDashboard();
  });

  elements.tabVendor.addEventListener('click', () => {
    state.activeTab = 'vendor';
    renderDashboard();
  });

  elements.projectSelector.addEventListener('change', (e) => {
    state.selectedProjectId = e.target.value;
    renderDashboard();
  });

  elements.vendorSelector.addEventListener('change', (e) => {
    state.selectedVendorId = e.target.value;
    renderDashboard();
  });

  elements.searchOverview.addEventListener('input', (e) => {
    renderRecentOrdersTable(e.target.value, elements.filterStatusOverview.value);
  });

  elements.filterStatusOverview.addEventListener('change', (e) => {
    renderRecentOrdersTable(elements.searchOverview.value, e.target.value);
  });

  elements.searchAnalyzer.addEventListener('input', (e) => {
    renderAnalyzerOrdersTable(e.target.value, elements.filterStatusAnalyzer.value);
  });

  elements.filterStatusAnalyzer.addEventListener('change', (e) => {
    renderAnalyzerOrdersTable(elements.searchAnalyzer.value, e.target.value);
  });

  elements.searchVendorPo.addEventListener('input', (e) => {
    renderVendorOrdersTable(e.target.value, elements.filterStatusVendor.value);
  });

  elements.filterStatusVendor.addEventListener('change', (e) => {
    renderVendorOrdersTable(elements.searchVendorPo.value, e.target.value);
  });

  elements.openModalVendorBtn.addEventListener('click', () => openModal(elements.modalVendor));
  elements.openModalOrderBtn.addEventListener('click', () => openModal(elements.modalOrder));

  elements.closeModalBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      closeModal(elements.modalVendor);
      closeModal(elements.modalOrder);
    });
  });

  // Modal form processing (Stored as persistent planning overlays in localStorage)
  elements.formVendor.addEventListener('submit', (e) => {
    e.preventDefault();

    const nameInput = document.getElementById('vendor-name');
    const catInput = document.getElementById('vendor-category');
    const contactInput = document.getElementById('vendor-contact');

    const newVendor = {
      id: `local-vend-${state.localVendors.length + 1}`,
      name: nameInput.value.trim(),
      category: catInput.value,
      contact: contactInput.value.trim(),
      phone: ''
    };

    // Add to state and overlay storage
    state.localVendors.push(newVendor);
    localStorage.setItem('vtd_local_vendors', JSON.stringify(state.localVendors));
    
    // Merge again
    state.vendors.push(newVendor);
    
    updateVendorSelectors();
    closeModal(elements.modalVendor);
    renderDashboard();

    elements.formVendor.reset();
  });

  elements.formOrder.addEventListener('submit', (e) => {
    e.preventDefault();

    const projId = elements.formOrderProject.value;
    const vendId = elements.formOrderVendor.value;
    const amountVal = parseFloat(document.getElementById('order-amount').value);
    const orderDVal = document.getElementById('order-date').value;
    const dueDVal = document.getElementById('order-duedate').value;
    const statusVal = document.getElementById('order-status').value;

    const chosenVendorObj = state.vendors.find(v => v.id === vendId);
    const vendorName = chosenVendorObj ? chosenVendorObj.name : 'Custom Vendor';

    const newOrder = {
      id: `LOCAL-PO-${1000 + state.localOrders.length + 1}`,
      projectId: projId,
      vendorName: vendorName,
      vendorContact: chosenVendorObj ? chosenVendorObj.contact : '',
      vendorPhone: chosenVendorObj ? chosenVendorObj.phone : '',
      partNumber: 'LOCAL-REQ',
      partDesc: 'In-app local PO overlay',
      amount: amountVal,
      orderDate: orderDVal,
      dueDate: dueDVal,
      shipDate: statusVal === 'Delivered' ? orderDVal : '',
      status: statusVal
    };

    // Add to state and overlay storage
    state.localOrders.push(newOrder);
    localStorage.setItem('vtd_local_orders', JSON.stringify(state.localOrders));

    // Merge again
    state.orders.push(newOrder);

    closeModal(elements.modalOrder);
    renderDashboard();

    elements.formOrder.reset();
  });

  window.addEventListener('click', (e) => {
    if (e.target === elements.modalVendor) closeModal(elements.modalVendor);
    if (e.target === elements.modalOrder) closeModal(elements.modalOrder);
  });
}

// ========================================================================
// INITIALIZATION ON WINDOW LOAD
// ========================================================================
window.addEventListener('DOMContentLoaded', async () => {
  // 1. Core visual boots
  initTheme();
  initCharts();
  
  // 2. Fetch and load database schemas
  await initializeData();
  
  // 3. Bind selections
  updateProjectSelectors();
  updateVendorSelectors();
  
  // 4. Trigger dashboard updates
  bindEventHandlers();
  renderDashboard();
});
