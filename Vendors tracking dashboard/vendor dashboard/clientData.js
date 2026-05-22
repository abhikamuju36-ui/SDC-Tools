/* clientData.js — Bridge between the Express API and the React app globals.
   Called via window.fetchFullstackData() from app.jsx on mount.
   Falls back to the static data.js values if the API is unreachable. */

(function () {

  // ----------------------------------------------------------------
  // CONSTANTS
  // ----------------------------------------------------------------

  const CATEGORY_COLORS = {
    'Assemblies':  '#1574C4',
    'Controls':    '#061D39',
    'Tooling':     '#AACEE8',
    'Pneumatics':  '#74C415',
    'Machined':    '#FFDE51',
    'Sensors':     '#5A8FBE',
    'Spare Parts': '#9FB4C9',
    'Electrical':  '#B97A0E',
    'Structural':  '#4A5567',
    'Other':       '#D0D6DF',
  };

  // ----------------------------------------------------------------
  // HELPERS
  // ----------------------------------------------------------------

  function inferCategory(vendorName, partDesc) {
    const s = ((vendorName || '') + ' ' + (partDesc || '')).toLowerCase();
    if (/pneum|cylinder|valve|actuator|air\s|compressor/.test(s)) return 'Pneumatics';
    if (/sensor|transducer|detector|proximity|photo/.test(s))     return 'Sensors';
    if (/plc|hmi|control|panel|relay|drive|vfd|servo|encoder/.test(s)) return 'Controls';
    if (/tool|fixture|jig|die|mold/.test(s))                      return 'Tooling';
    if (/machine|weld|fabricat|sheet.?metal|structur|steel|alum/.test(s)) return 'Machined';
    if (/spare|repair|replac|consumable/.test(s))                 return 'Spare Parts';
    if (/wire|cable|harness|conduit|electric/.test(s))            return 'Electrical';
    return 'Assemblies';
  }

  function fmtShortDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function fmtEta(dateStr) {
    if (!dateStr) return 'TBD';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'TBD';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  const STATUS_MAP = { 'Delivered': 'Received', 'Shipped': 'In Transit', 'Pending': 'Open', 'Delayed': 'Delayed' };

  function mapPoStatus(raw, dueDate) {
    let s = STATUS_MAP[raw] || raw || 'Open';
    // Auto-flag overdue open/in-transit orders
    if (s !== 'Received' && dueDate) {
      const today = new Date().toISOString().split('T')[0];
      if (dueDate < today) s = 'Delayed';
    }
    return s;
  }

  function mapProjectStatus(s) {
    if (!s) return 'On Track';
    const l = s.toLowerCase();
    if (l.includes('risk'))             return 'At Risk';
    if (l.includes('clos'))             return 'Closing';
    if (l === 'active' || l === 'open') return 'On Track';
    return s;
  }

  function computeHealth(budget, spent, status) {
    if (status === 'Closing') return 5;
    const pct = spent / (budget || 1);
    if (pct > 0.95) return 1;
    if (pct > 0.85) return 2;
    if (pct > 0.70) return 3;
    return 4;
  }

  function computeVendorScore(onTime, leadDays) {
    const leadScore = Math.max(0, Math.min(100, ((40 - leadDays) / 20) * 100));
    return Math.min(100, Math.round((onTime / 100) * 70 + (leadScore / 100) * 30));
  }

  function vendorStatusFromScore(score) {
    if (score >= 88) return 'Preferred';
    if (score >= 75) return 'Approved';
    if (score >= 60) return 'Watch';
    return 'Probation';
  }

  function daysAgo(dateStr) {
    if (!dateStr) return 0;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 0;
    return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
  }

  function relativeTime(dateStr) {
    const days = daysAgo(dateStr);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7)   return days + ' days ago';
    return fmtShortDate(dateStr);
  }

  function toPrefixedId(rawId) {
    const s = String(rawId || '');
    return s.startsWith('P-') ? s : 'P-' + s;
  }

  // ----------------------------------------------------------------
  // TRANSFORM: PURCHASE ORDERS (done first; used by all other builders)
  // ----------------------------------------------------------------

  function buildPurchaseOrders(allOrders) {
    return allOrders
      .map(o => {
        const od = o.orderDate ? new Date(o.orderDate) : null;
        return {
          po:           o.id || ('PO-' + Math.random().toString(36).slice(2, 8)),
          project:      o.projectId ? toPrefixedId(o.projectId) : '',
          vendor:       ((o.vendorName || 'Unknown').trim()),
          partNumber:   o.partNumber || '',
          partDesc:     o.partDesc   || '',
          purchaseQty:  o.purchaseQty || 1,
          receivedQty:  o.receivedQty || 0,
          unitPrice:    o.unitPrice   || 0,
          amount:       o.amount || 0,
          category:     inferCategory(o.vendorName, o.partDesc || o.partNumber || ''),
          status:       mapPoStatus(o.status, o.requiredDate || o.dueDate),
          issued:       fmtShortDate(o.orderDate),
          expected:     fmtShortDate(o.requiredDate || o.dueDate),
          orderMonth:   od ? od.toLocaleDateString('en-US', { month: 'short' }) : '',
          orderYear:    od ? od.getFullYear() : 0,
          // Keep raw dates for downstream calcs
          _orderDate:    o.orderDate    || '',
          _requiredDate: o.requiredDate || o.dueDate || '',  // line-level required
          _revisedDate:  o.revisedDate  || '',               // header-level revised
          _receivedDate: o.receivedDate || o.shipDate || '',  // actual received
          // Legacy
          _shipDate:  o.shipDate || o.receivedDate || '',
          _dueDate:   o.dueDate  || o.requiredDate || '',
        };
      })
      .sort((a, b) => {
        const na = parseInt((a.po).replace(/\D/g, '')) || 0;
        const nb = parseInt((b.po).replace(/\D/g, '')) || 0;
        return nb - na;
      });
  }

  // ----------------------------------------------------------------
  // TRANSFORM: PROJECTS
  // ----------------------------------------------------------------

  function buildProjects(rawProjects, pos) {
    return rawProjects.map(p => {
      const pid    = toPrefixedId(p.id);
      const rawId  = String(p.id).replace(/^P-/, '');
      const projPos = pos.filter(o => o.project === pid || o.project === 'P-' + rawId);

      // Sum order amounts as procurement spend
      const poSpent   = projPos.reduce((s, o) => s + o.amount, 0);
      // Fall back to ETO actuals when no POs in current window
      const spent     = poSpent > 0 ? poSpent : (p.actualMaterials || 0);

      const uniqueVendors = new Set(projPos.map(o => o.vendor).filter(Boolean));

      // ETA: latest due date on any open order for this project
      const dueDates = projPos
        .filter(o => o._dueDate && o.status !== 'Received')
        .map(o => o._dueDate)
        .sort();
      const latestDue = dueDates[dueDates.length - 1] || null;

      // Use materials budget (EstTotalMaterials) when available; else total project estimate
      const matBudget  = p.materialsBudget > 0 ? p.materialsBudget : p.budget;
      // Guard against fake $150K server defaults — use actualMaterials as sanity floor
      const budget     = matBudget > 0 ? matBudget : Math.max(p.actualMaterials * 1.15, spent * 1.15, 10000);

      // Compute status from spend ratio against materials budget
      const spendRatio = budget > 0 ? spent / budget : 0;
      const status = spendRatio > 0.95 ? 'At Risk'
        : spendRatio > 0.85            ? 'At Risk'
        : mapProjectStatus(p.status);

      // Normalise projectType — accept "Duplicate","duplicate","dup" → "Duplicate" etc.
      const rawType = (p.projectType || '').trim().toLowerCase();
      const projectType = rawType.includes('dup')    ? 'Duplicate'
        : rawType.includes('hybrid')                 ? 'Hybrid'
        : rawType.includes('custom') || rawType === 'c' ? 'Custom'
        : rawType ? p.projectType                    : null;

      const isActive = !['closed', 'complete', 'done', 'inactive'].includes(
        (p.status || '').toLowerCase()
      );

      return {
        id:          pid,
        name:        p.name || ('Project ' + pid),
        budget,
        spent,
        vendors:     uniqueVendors.size,
        status,
        health:      computeHealth(budget, spent, status),
        eta:         latestDue ? fmtEta(latestDue) : 'TBD',
        projectType: projectType || 'Custom',
        isActive,
      };
    });
  }

  // ----------------------------------------------------------------
  // TRANSFORM: VENDORS
  // ----------------------------------------------------------------

  function buildVendors(allOrders, pos) {
    const map = {};

    pos.forEach((po, idx) => {
      const raw = allOrders[idx] || {};
      const name = po.vendor;
      if (!map[name]) {
        map[name] = {
          name,
          contact:         raw.vendorContact || '',
          city:            '',
          spend:           0,
          orders:          0,
          deliveredOnTime: 0,
          totalDelivered:  0,
          leadDaysTotal:   0,
          leadDaysCount:   0,
        };
      }
      const vm = map[name];
      vm.spend  += po.amount;
      vm.orders += 1;

      if (po.status === 'Received') {
        vm.totalDelivered += 1;
        const onTime = !po._shipDate || !po._dueDate || po._shipDate <= po._dueDate;
        if (onTime) vm.deliveredOnTime += 1;
      }

      if (po._orderDate && po._shipDate) {
        const lead = Math.round((new Date(po._shipDate) - new Date(po._orderDate)) / 86400000);
        if (lead > 0 && lead < 365) {
          vm.leadDaysTotal += lead;
          vm.leadDaysCount += 1;
        }
      }
    });

    return Object.values(map)
      .filter(vm => vm.orders > 0)
      .map(vm => {
        const onTime   = vm.totalDelivered > 0
          ? Math.round((vm.deliveredOnTime / vm.totalDelivered) * 1000) / 10
          : 90.0;
        const leadDays = vm.leadDaysCount > 0
          ? Math.round(vm.leadDaysTotal / vm.leadDaysCount)
          : 21;
        const score    = computeVendorScore(onTime, leadDays);
        return {
          name:     vm.name,
          contact:  vm.contact,
          city:     vm.city,
          spend:    vm.spend,
          orders:   vm.orders,
          onTime,
          leadDays,
          defect:   parseFloat((0.3 + (100 - score) / 50).toFixed(1)),
          score,
          status:   vendorStatusFromScore(score),
        };
      })
      .sort((a, b) => b.spend - a.spend);
  }

  // ----------------------------------------------------------------
  // TRANSFORM: SPEND BY CATEGORY
  // ----------------------------------------------------------------

  function buildSpendByCategory(pos) {
    const cats = {};
    pos.forEach(po => { cats[po.category] = (cats[po.category] || 0) + po.amount; });
    return Object.entries(cats)
      .map(([name, value]) => ({ name, value, color: CATEGORY_COLORS[name] || '#9FB4C9' }))
      .sort((a, b) => b.value - a.value);
  }

  // ----------------------------------------------------------------
  // TRANSFORM: SPEND TIMELINE (last 7 calendar months)
  // ----------------------------------------------------------------

  function buildSpendTimeline(pos) {
    const now = new Date();
    const slots = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      slots.push({ month: d.toLocaleDateString('en-US', { month: 'short' }), year: d.getFullYear(), mon: d.getMonth(), value: 0 });
    }
    pos.forEach(po => {
      if (!po._orderDate) return;
      const d = new Date(po._orderDate);
      if (isNaN(d.getTime())) return;
      const slot = slots.find(s => s.year === d.getFullYear() && s.mon === d.getMonth());
      if (slot) slot.value += po.amount;
    });
    return slots.map(s => ({ month: s.month, value: s.value }));
  }

  // ----------------------------------------------------------------
  // TRANSFORM: ACTIVITY FEED
  // ----------------------------------------------------------------

  function buildActivity(pos) {
    return pos
      .filter(po => po._shipDate || po._orderDate)
      .sort((a, b) => {
        const da = new Date(a._shipDate || a._orderDate);
        const db = new Date(b._shipDate || b._orderDate);
        return db - da;
      })
      .slice(0, 6)
      .map(po => {
        let kind, text;
        if (po.status === 'Received') {
          kind = 'ship';
          text = po.vendor + ' delivered ' + po.po;
        } else if (po.status === 'In Transit') {
          kind = 'ship';
          text = po.vendor + ' shipped ' + po.po;
        } else if (po.status === 'Delayed') {
          const days = daysAgo(po._dueDate);
          kind = 'late';
          text = po.po + ' from ' + po.vendor + ' is ' + days + ' day' + (days !== 1 ? 's' : '') + ' past due';
        } else {
          const amtK = po.amount ? ' ($' + Math.round(po.amount / 1000) + 'K)' : '';
          kind = 'po';
          text = 'Procurement issued ' + po.po + ' to ' + po.vendor + amtK;
        }
        return { kind, text, time: relativeTime(po._shipDate || po._orderDate) };
      });
  }

  // ----------------------------------------------------------------
  // TRANSFORM: PO AGING (real age buckets)
  // ----------------------------------------------------------------

  function buildPoAging(pos) {
    const open = pos.filter(po => po.status === 'Open' || po.status === 'In Transit' || po.status === 'Delayed');
    const buckets = [
      { label: '0–14 days',  min: 0,  max: 14,      color: 'var(--positive)' },
      { label: '15–30 days', min: 15, max: 30,       color: 'var(--sdc-blue)' },
      { label: '31–60 days', min: 31, max: 60,       color: 'var(--warning)'  },
      { label: '60+ days',   min: 61, max: Infinity,  color: 'var(--danger)'   },
    ];
    const counts = buckets.map(b => ({
      ...b,
      count: open.filter(po => { const age = daysAgo(po._orderDate); return age >= b.min && age <= b.max; }).length,
    }));
    const total = counts.reduce((s, b) => s + b.count, 0) || 1;
    return counts.map(b => ({ label: b.label, count: b.count, pct: b.count / total, color: b.color }));
  }

  // ----------------------------------------------------------------
  // TRANSFORM: QUARTERLY SPEND (real PO spend grouped by calendar quarter)
  // ----------------------------------------------------------------

  function buildQuarterlySpend(pos) {
    // Group real PO spend by calendar quarter for the last 8 quarters
    const now = new Date();
    const ordered = {};
    for (let i = 7; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i * 3, 1);
      const label = 'Q' + (Math.floor(d.getMonth() / 3) + 1) + " '" + String(d.getFullYear()).slice(2);
      if (!ordered[label]) ordered[label] = { quarter: label, actual: 0 };
    }
    pos.forEach(po => {
      if (!po._orderDate) return;
      const d = new Date(po._orderDate);
      if (isNaN(d.getTime())) return;
      const label = 'Q' + (Math.floor(d.getMonth() / 3) + 1) + " '" + String(d.getFullYear()).slice(2);
      if (ordered[label]) ordered[label].actual += po.amount / 1000; // store in $K
    });
    const rows = Object.values(ordered).filter(q => q.actual > 0);
    const avg  = rows.length ? rows.reduce((s, q) => s + q.actual, 0) / rows.length : 0;
    return rows.map(q => ({ ...q, actual: Math.round(q.actual), target: Math.round(avg * 1.05) }));
  }

  // ----------------------------------------------------------------
  // MAIN — window.fetchFullstackData
  // ----------------------------------------------------------------

  window.fetchFullstackData = async function () {
    const t0 = Date.now();
    console.group('[SDC Vendor Tracker] Data sync');
    try {
      console.log('Fetching /api/projects, /api/orders and /api/projects/costing …');
      const [rawProjects, rawOrders, rawCosting] = await Promise.all([
        fetch('/api/projects', { cache: 'no-cache' }).then(r => {
          if (!r.ok) throw new Error('Projects API ' + r.status);
          return r.json();
        }),
        fetch('/api/orders', { cache: 'no-cache' }).then(r => {
          if (!r.ok) throw new Error('Orders API ' + r.status);
          return r.json();
        }),
        fetch('/api/projects/costing', { cache: 'no-cache' }).then(r => r.ok ? r.json() : []).catch(() => []),
      ]);
      console.log('API response: ' + rawProjects.length + ' projects, ' + rawOrders.length + ' orders (' + (Date.now()-t0) + 'ms)');

      if (!Array.isArray(rawProjects) || rawProjects.length === 0) {
        throw new Error('No projects returned from API');
      }

      const localOrders  = JSON.parse(localStorage.getItem('vtd_local_orders')  || '[]');
      const localVendors = JSON.parse(localStorage.getItem('vtd_local_vendors') || '[]');
      const allOrders    = [...rawOrders, ...localOrders];

      console.log('Building POs …');
      const pos      = buildPurchaseOrders(allOrders);
      console.log('Building projects …');
      const projects = buildProjects(rawProjects, pos);
      console.log('Building vendors …');
      const vendors  = buildVendors(allOrders, pos);

      localVendors.forEach(lv => {
        if (!vendors.find(v => v.name === lv.name)) {
          vendors.push({ name: lv.name, contact: lv.contact || '', city: '', spend: 0, orders: 0,
            onTime: 90.0, leadDays: 21, defect: 0.5, score: 75, status: 'Approved' });
        }
      });

      const spendByCategory = buildSpendByCategory(pos);
      const spendTimeline   = buildSpendTimeline(pos);
      const activity        = buildActivity(pos);
      const poAging         = buildPoAging(pos);
      const quarterlySpend  = buildQuarterlySpend(pos);

      // Strip internal underscore fields before exposing to React
      const cleanPos = pos.map(({ _orderDate, _shipDate, _dueDate, ...rest }) => rest);

      // Index costing by projectId string for fast lookup
      const costingMap = {};
      (rawCosting || []).forEach(c => { costingMap[c.projectId] = c; });

      Object.assign(window, {
        PROJECTS:            projects,
        VENDORS:             vendors,
        PURCHASE_ORDERS:     cleanPos,
        PURCHASE_ORDERS_RAW: pos,
        SPEND_BY_CATEGORY:   spendByCategory,
        SPEND_TIMELINE:      spendTimeline,
        ACTIVITY:            activity,
        PO_AGING:            poAging,
        QUARTERLY_SPEND:     quarterlySpend,
        COSTING_MAP:         costingMap,
      });

      console.log('✅ Loaded: ' + projects.length + ' projects · ' + vendors.length + ' vendors · ' + cleanPos.length + ' POs — total ' + (Date.now()-t0) + 'ms');
      console.log('Top vendors:', vendors.slice(0,3).map(v=>v.name));
    } catch (err) {
      console.error('❌ fetchFullstackData failed — using static fallback. Reason:', err.message, err);
    } finally {
      console.groupEnd();
    }
  };

})();
