/**
 * ========================================================================
 * VENDORS TRACKING DASHBOARD - SERVER ENTRY (server.js)
 * Fullstack API server with live MS SQL ETO DB & Smartsheet API integration.
 * Includes automated fallback to cached JSON dumps if offline.
 * ========================================================================
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const eto = require('./services/eto');
const smartsheet = require('./services/smartsheet');
const demoData = require('./services/demoData');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Global controller settings
let useDemoMode = false;

// Initialize Database connection and verify if ETO DB is reachable
async function verifyDatabaseConnection() {
  if (!process.env.ETO_HOST || process.env.ETO_HOST.includes('your-server')) {
    console.log('⚠️  ETO_HOST not configured in .env. Running in Offline Demo Mode.');
    useDemoMode = true;
    return;
  }

  try {
    console.log(`Connecting to ETO Database at ${process.env.ETO_HOST}...`);
    // Try to run a simple query to confirm connection
    await eto.getAllProjects();
    console.log('✅ Connected to ETO Database successfully!');
    useDemoMode = false;
  } catch (err) {
    console.error('❌ ETO Database connection failed:', err.message);
    console.log('⚠️  Defaulting to Offline Demo Mode using server/cache JSON dumps.');
    useDemoMode = true;
  }
}

// Helper to select active service
function getService() {
  return useDemoMode ? demoData : eto;
}

// ========================================================================
// API ROUTES
// ========================================================================

// 1. Get all projects
app.get('/api/projects', async (req, res) => {
  try {
    const service = getService();
    const dbProjects = await service.getAllProjects();

    // Map to unified layout format
    const projects = dbProjects.map(p => ({
      id: p.ProjectID.toString(),
      name: p.ProjectName || `Project ${p.ProjectID}`,
      budget: p.Budget || 0,
      materialsBudget: p.MaterialsBudget || 0,
      actualMaterials: p.ActualMaterials || 0,
      status: p.Status || 'Active',
      projectType: p.ProjectType || null,   // Custom | Duplicate | Hybrid (if available in ETO)
    }));

    res.json(projects);
  } catch (err) {
    console.error('Error fetching projects:', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

// 1b. Costing for all projects (hours + labor + margins)
app.get('/api/projects/costing', async (req, res) => {
  try {
    const service = getService();
    const rows = await service.getAllProjectsCosting();
    const costing = rows.map(c => ({
      projectId:      c.JobID.toString(),
      description:    c.Description || '',
      estEngHrs:      c.EstEngHrs   || 0,
      actEngHrs:      c.ActEngHrs   || 0,
      estMfgHrs:      c.EstMfgHrs   || 0,
      actMfgHrs:      c.ActMfgHrs   || 0,
      estEngLabor:    c.EstEngLabor  || 0,
      actEngLabor:    c.ActEngLabor  || 0,
      estMfgLabor:    c.EstMfgLabor  || 0,
      actMfgLabor:    c.ActMfgLabor  || 0,
      estMaterials:   c.EstMaterials || 0,
      actMaterials:   c.ActMaterials || 0,
      totalEstimate:  c.TotalEstimate    || 0,
      totalActualCost:c.TotalActualCost  || 0,
      salesPrice:     c.SalesPrice   || 0,
      budgetMargin:   c.BudgetMargin || 0,
      actualMargin:   c.ActualMargin || 0,
    }));
    res.json(costing);
  } catch (err) {
    console.error('Error fetching project costing:', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

// Helper to safely format dates from SQL Server (Date objects) and cache (Strings)
function formatDate(dateVal) {
  if (!dateVal) return '';
  if (dateVal instanceof Date) {
    try {
      return dateVal.toISOString().split('T')[0];
    } catch (e) {
      return '';
    }
  }
  if (typeof dateVal === 'string') {
    return dateVal.split('T')[0];
  }
  return '';
}

// 2. Get purchase orders
//    ?projectId=1118           — single project (legacy)
//    ?projectIds=1118,1129     — multi-project (new)
//    ?dateFrom=2025-01-01&dateTo=2025-12-31  — filter by order date range
app.get('/api/orders', async (req, res) => {
  try {
    const service = getService();
    let poDetails = [];

    // Resolve project IDs — supports both ?projectId and ?projectIds
    const projectIdsParam = req.query.projectIds || req.query.projectId || '';
    const projectIds = projectIdsParam
      ? projectIdsParam.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n))
      : [];

    if (projectIds.length > 0) {
      if (projectIds.length === 1) {
        console.log(`Fetching POs for project ID: ${projectIds[0]}...`);
        poDetails = await service.getPoDetails(projectIds[0]);
      } else {
        console.log(`Fetching POs for projects: ${projectIds.join(', ')}...`);
        if (service.getPoDetailsMulti) {
          poDetails = await service.getPoDetailsMulti(projectIds);
        } else {
          for (const pid of projectIds) {
            const rows = await service.getPoDetails(pid);
            poDetails.push(...rows);
          }
        }
      }
    } else {
      console.log('Fetching all POs globally...');
      poDetails = await service.getAllPoDetails();
    }

    // Date range filter applied on orderDate (PurchaseDate)
    const dateFrom = req.query.dateFrom || '';
    const dateTo   = req.query.dateTo   || '';

    const orders = [];
    if (poDetails && poDetails.length > 0) {
      poDetails.forEach(po => {
        const orderDateStr = formatDate(po.PurchaseDate) || formatDate(po.DateRequired) || '';

        // Apply date range filter if provided
        if (dateFrom && orderDateStr && orderDateStr < dateFrom) return;
        if (dateTo   && orderDateStr && orderDateStr > dateTo)   return;

        // Determine order status
        let status = 'Delivered';
        if (!po.ReceivedQty || po.ReceivedQty < po.PurchaseQty) {
          status = po.LastReceivedDate ? 'Shipped' : 'Pending';
        }

        const projId = po.ProjectID ? po.ProjectID.toString() : (projectIds[0] || '').toString();

        orders.push({
          id:            `PO-${po.PurchaseOrderID}-${po.PurchaseDetailID}`,
          projectId:     projId,
          vendorName:    po.Supplier     ? po.Supplier.trim()      : 'Unknown Vendor',
          vendorContact: po.SupplierEmail ? po.SupplierEmail.trim() : '',
          vendorPhone:   po.SupplierPhone ? po.SupplierPhone.trim() : '',
          partNumber:    po.PartNumber,
          partDesc:      po.PartDesc,
          purchaseQty:   po.PurchaseQty  || 1,
          receivedQty:   po.ReceivedQty  || 0,
          unitPrice:     po.PurchasePrice || 0,
          amount:        (po.PurchaseQty || 1) * (po.PurchasePrice || 0),
          // Dates — explicit & distinct
          orderDate:          orderDateStr,                        // blank when both PurchaseDate and DateRequired are null
          issuedFromFallback: !po.PurchaseDate && !!orderDateStr,  // true = PurchaseDate was null, showing DateRequired as issued
          requiredDate:  formatDate(po.DateRequired)         || '',   // line-level required date
          revisedDate:   formatDate(po.PurchaseDateRequired) || '',   // header-level revised date
          receivedDate:  formatDate(po.LastReceivedDate)     || '',   // actual received date (NOT ship date)
          // Legacy aliases kept for backward compat
          dueDate:       formatDate(po.DateRequired)         || formatDate(po.PurchaseDateRequired) || '',
          shipDate:      formatDate(po.LastReceivedDate)     || '',
          status,
        });
      });
    }

    console.log(`Returned ${orders.length} orders successfully.`);
    res.json(orders);
  } catch (err) {
    console.error('Error fetching purchase orders:', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

// 3. Get Smartsheet milestones & schedules for a specific project
app.get('/api/projects/:id/schedule', async (req, res) => {
  const projectId = req.params.id;
  try {
    if (!process.env.SMARTSHEET_API_KEY) {
      return res.json({ buildStart: null, buildComplete: null, milestones: [], tasks: [], isMock: true });
    }

    console.log(`Fetching Smartsheet milestones for project ${projectId}...`);
    const scheduleData = await smartsheet.getBuildDates(projectId);
    res.json({
      ...scheduleData,
      isMock: false
    });
  } catch (err) {
    console.error(`Error fetching schedule for project ${projectId}:`, err);
    res.json({ buildStart: null, buildComplete: null, milestones: [], tasks: [], isMock: true, error: err.message });
  }
});

// ========================================================================
// HEALTH CHECK (required by SDC Tools shell for status monitoring)
// ========================================================================
app.get('/health', (req, res) => res.json({ status: 'ok', mode: useDemoMode ? 'demo' : 'live' }));

// ========================================================================
// STATIC SITE SERVING
// ========================================================================
// Serve static client assets directly from the premium React app folder
app.use(express.static(path.join(__dirname, '..', 'vendor dashboard')));

// Route fallback: send all other traffic to Vendor Tracker.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'vendor dashboard', 'Vendor Tracker.html'));
});

// ========================================================================
// STARTUP BOOT
// ========================================================================
app.listen(PORT, async () => {
  console.log(`====================================================================`);
  console.log(`   Vendor Tracker Fullstack Server running on http://localhost:${PORT}`);
  console.log(`====================================================================`);
  await verifyDatabaseConnection();
});
