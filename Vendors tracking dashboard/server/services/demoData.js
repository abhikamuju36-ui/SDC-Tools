/**
 * Demo/cached data provider — used when ETO DB credentials are not configured.
 * Serves pre-fetched data from server/cache/ so the app can be previewed immediately.
 * Supports any project that has cached JSON files (bom_{id}_{spec}.json, po_{id}.json).
 */
const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', 'cache');

function loadJson(filename) {
  const fp = path.join(CACHE_DIR, filename);
  if (!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

// Static project info
const projectInfoMap = {
  1083: { ProjectID: 1083, ProjectName: 'SDC Show Room', DisplayName: '1083 - SDC Show Room' },
  1118: { ProjectID: 1118, ProjectName: 'AIR Loop Assembly', DisplayName: '1118 - AIR Loop Assembly' },
  1129: { ProjectID: 1129, ProjectName: 'Molex Duplex', DisplayName: '1129 - Molex Duplex' },
};

// Spec definitions per project
const specsMap = {
  1083: [
    { SpecAutoID: 610, SpecID: 10, SDescription: 'Mechanical Design and Build', SQuantity: 1 },
    { SpecAutoID: 611, SpecID: 30, SDescription: 'Controls Design', SQuantity: 1 },
  ],
  1118: [
    { SpecAutoID: 700, SpecID: 10, SDescription: 'Complete Design and Build', SQuantity: 1 },
    { SpecAutoID: 701, SpecID: 30, SDescription: 'Controls Design', SQuantity: 1 },
    { SpecAutoID: 702, SpecID: 40, SDescription: 'Machine Testing', SQuantity: 1 },
    { SpecAutoID: 703, SpecID: 90, SDescription: 'Spare Parts', SQuantity: 1 },
  ],
  1129: [
    { SpecAutoID: 894, SpecID: 10, SDescription: 'Mechanical Design and Build', SQuantity: 1 },
    { SpecAutoID: 888, SpecID: 30, SDescription: 'Controls Design', SQuantity: 1 },
    { SpecAutoID: 895, SpecID: 40, SDescription: 'Machine Testing', SQuantity: 1 },
    { SpecAutoID: 896, SpecID: 90, SDescription: 'Spare Parts', SQuantity: 1 },
  ],
};

const projectCostingMap = {
  1118: {
    EstEngHrs: 0,    ActEngHrs: null,
    EstMfgHrs: 0,    ActMfgHrs: null,
    EstEngLabor: 0,  ActEngLabor: null,
    EstMfgLabor: 0,  ActMfgLabor: null,
    EstMaterials: 1000,
    ActMaterials: 504986.49,
    TotalEstimate: 1000,
    TotalActualCost: 504986.49,
    SalesPrice: 1000,
    BudgetMargin: 0,
    ActualMargin: -503.99,
  },
  1129: {
    EstEngHrs: 0,    ActEngHrs: null,
    EstMfgHrs: 0,    ActMfgHrs: null,
    EstEngLabor: 0,  ActEngLabor: null,
    EstMfgLabor: 0,  ActMfgLabor: null,
    EstMaterials: 1000,
    ActMaterials: 157616.49,
    TotalEstimate: 1000,
    TotalActualCost: 157616.49,
    SalesPrice: 1000,
    BudgetMargin: 0,
    ActualMargin: -156.62,
  },
};

const specCostingMap = {
  1118: [
    {
      SectionID: 10, SectionName: 'Complete Design and Build',
      EngHours: null, MfgHours: null, TotalHours: 0,
      EngLabor: null, MfgLabor: null, TotalLabor: 0,
      PurchasedMaterials: 264191.78, InventoryPulls: 3355.34, ExtraCosts: 5323.02,
      TotalMaterials: 272870.14, TotalCost: 272870.14, Margin: null,
    },
    {
      SectionID: 30, SectionName: 'Controls Design',
      EngHours: null, MfgHours: null, TotalHours: 0,
      EngLabor: null, MfgLabor: null, TotalLabor: 0,
      PurchasedMaterials: 223095.47, InventoryPulls: -2269.97, ExtraCosts: 0,
      TotalMaterials: 220825.50, TotalCost: 220825.50, Margin: null,
    },
    {
      SectionID: 40, SectionName: 'Machine Testing',
      EngHours: null, MfgHours: null, TotalHours: 0,
      EngLabor: null, MfgLabor: null, TotalLabor: 0,
      PurchasedMaterials: 8430.71, InventoryPulls: 26.90, ExtraCosts: 0,
      TotalMaterials: 8457.61, TotalCost: 8457.61, Margin: null,
    },
    {
      SectionID: 90, SectionName: 'Spare Parts',
      EngHours: null, MfgHours: null, TotalHours: 0,
      EngLabor: null, MfgLabor: null, TotalLabor: 0,
      PurchasedMaterials: 2636.06, InventoryPulls: 197.18, ExtraCosts: 0,
      TotalMaterials: 2833.24, TotalCost: 2833.24, Margin: null,
    },
  ],
  1129: [
    {
      SectionID: 10, SectionName: 'Mechanical Design and Build',
      EngHours: null, MfgHours: null, TotalHours: 0,
      EngLabor: null, MfgLabor: null, TotalLabor: 0,
      PurchasedMaterials: 126535.05, InventoryPulls: 756.90, ExtraCosts: 1374.46,
      TotalMaterials: 128666.41, TotalCost: 128666.41, Margin: null,
    },
    {
      SectionID: 30, SectionName: 'Controls Design',
      EngHours: null, MfgHours: null, TotalHours: 0,
      EngLabor: null, MfgLabor: null, TotalLabor: 0,
      PurchasedMaterials: 25907.81, InventoryPulls: 1074.14, ExtraCosts: 0,
      TotalMaterials: 26981.95, TotalCost: 26981.95, Margin: null,
    },
    {
      SectionID: 90, SectionName: 'Spare Parts',
      EngHours: null, MfgHours: null, TotalHours: 0,
      EngLabor: null, MfgLabor: null, TotalLabor: 0,
      PurchasedMaterials: 1297.71, InventoryPulls: -11.16, ExtraCosts: 0,
      TotalMaterials: 1286.55, TotalCost: 1286.55, Margin: null,
    },
    {
      SectionID: 40, SectionName: 'Machine Testing',
      EngHours: null, MfgHours: null, TotalHours: 0,
      EngLabor: null, MfgLabor: null, TotalLabor: 0,
      PurchasedMaterials: 681.59, InventoryPulls: 0, ExtraCosts: 0,
      TotalMaterials: 681.59, TotalCost: 681.59, Margin: null,
    },
  ],
};

module.exports = {
  isDemoMode() {
    return !process.env.ETO_HOST || process.env.ETO_HOST === 'your-server-here';
  },

  getCachedProjects() {
    try {
      const files = fs.readdirSync(CACHE_DIR).filter(f => f.startsWith('bom_'));
      const ids = new Set(files.map(f => parseInt(f.split('_')[1])));
      return [...ids];
    } catch {
      return [1083, 1118, 1129];
    }
  },

  async getAllProjects() {
    return [
      { ProjectID: 1083, ProjectName: 'SDC Show Room',      Budget: 185000,  ActualMaterials: 35000,      Status: 'Active',   ProjectType: 'Custom'    },
      { ProjectID: 1118, ProjectName: 'AIR Loop Assembly',  Budget: 600000,  ActualMaterials: 504986.49,  Status: 'Active',   ProjectType: 'Custom'    },
      { ProjectID: 1129, ProjectName: 'Molex Duplex',       Budget: 250000,  ActualMaterials: 157616.49,  Status: 'Active',   ProjectType: 'Duplicate' },
    ];
  },

  async getAllProjectsCosting() {
    return Object.entries(projectCostingMap).map(([id, row]) => ({
      JobID:          parseInt(id),
      Description:    projectInfoMap[id]?.ProjectName || `Job ${id}`,
      EstEngHrs:      row.EstEngHrs,
      ActEngHrs:      row.ActEngHrs,
      EstMfgHrs:      row.EstMfgHrs,
      ActMfgHrs:      row.ActMfgHrs,
      EstEngLabor:    row.EstEngLabor,
      ActEngLabor:    row.ActEngLabor,
      EstMfgLabor:    row.EstMfgLabor,
      ActMfgLabor:    row.ActMfgLabor,
      EstMaterials:   row.EstMaterials,
      ActMaterials:   row.ActMaterials,
      TotalEstimate:  row.TotalEstimate,
      TotalActualCost:row.TotalActualCost,
      SalesPrice:     row.SalesPrice,
      BudgetMargin:   row.BudgetMargin,
      ActualMargin:   row.ActualMargin,
    }));
  },

  async getPoDetailsMulti(projectIds) {
    let all = [];
    for (const pid of projectIds) {
      const rows = loadJson(`po_${pid}.json`) || [];
      const mapped = rows.map(r => ({
        ProjectID: pid,
        ...r,
        LastReceivedDate: (r.ReceivedQty >= r.PurchaseQty && r.ReceivedQty > 0)
          ? new Date(new Date(r.PurchaseDate || Date.now()).getTime() + 172800000).toISOString()
          : null,
      }));
      all.push(...mapped);
    }
    return all;
  },

  async getProjectInfo(projectId) {
    return projectInfoMap[projectId] || { ProjectID: projectId, ProjectName: `Job ${projectId}`, DisplayName: `${projectId}` };
  },

  async getSpecs(projectId) {
    if (specsMap[projectId]) return specsMap[projectId];
    try {
      const files = fs.readdirSync(CACHE_DIR).filter(f => f.startsWith(`bom_${projectId}_`));
      return files.map((f, i) => {
        const specId = parseInt(f.replace(`bom_${projectId}_`, '').replace('.json', ''));
        return { SpecAutoID: 900 + i, SpecID: specId, SDescription: `Spec ${specId}`, SQuantity: 1 };
      });
    } catch {
      return [];
    }
  },

  async getTopNode(projectId, specId) {
    const data = loadJson(`bom_${projectId}_${specId}.json`);
    if (!data || data.length === 0) return null;
    const childIds = new Set(data.map(r => r.ChildID));
    const topParentIds = [...new Set(data.map(r => r.ParentID))].filter(p => !childIds.has(p));
    if (topParentIds.length === 0) return null;
    const topId = topParentIds[0];
    const ref = data.find(r => r.ParentID === topId);
    return {
      TopItemID: topId,
      TopPN: ref ? ref.ParentPN : `TOP ${projectId}-${specId}`,
      TopDesc: ref ? ref.ParentDesc : `Project:${projectId} and Section:${specId}`,
    };
  },

  async getBomRows(projectId, specId) {
    const rows = loadJson(`bom_${projectId}_${specId}.json`) || [];
    return rows.map(r => ({
      ...r,
      LastReceivedDate: (r.ReceivedQty >= r.ItemQty && r.ReceivedQty > 0)
        ? new Date(new Date(r.RequiredDate || Date.now()).getTime() - 172800000).toISOString()
        : null
    }));
  },

  async getPoDetails(projectId) {
    const rows = loadJson(`po_${projectId}.json`) || [];
    return rows.map(r => ({
      ...r,
      LastReceivedDate: (r.ReceivedQty >= r.PurchaseQty && r.ReceivedQty > 0)
        ? new Date(new Date(r.PurchaseDate || Date.now()).getTime() + 172800000).toISOString()
        : null
    }));
  },

  async getAllPoDetails() {
    const projects = [1083, 1118, 1129];
    let all = [];
    for (const pid of projects) {
      const rows = loadJson(`po_${pid}.json`) || [];
      const mapped = rows.map(r => ({
        ProjectID: pid,
        ...r,
        LastReceivedDate: (r.ReceivedQty >= r.PurchaseQty && r.ReceivedQty > 0)
          ? new Date(new Date(r.PurchaseDate || Date.now()).getTime() + 172800000).toISOString()
          : null
      }));
      all.push(...mapped);
    }
    return all;
  },

  async getProjectCosting(projectId) {
    const row = projectCostingMap[projectId];
    if (!row) return null;
    return { JobID: projectId, Description: projectInfoMap[projectId]?.ProjectName || `Job ${projectId}`, CustomerCity: '', ...row };
  },

  async getSpecCosting(projectId) {
    const rows = specCostingMap[projectId];
    if (!rows) return [];
    return rows.map(r => ({ JobID: projectId, ...r }));
  },
};
