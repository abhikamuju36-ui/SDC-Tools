/**
 * azureData.js — Azure SQL data provider for Build Readiness Report.
 * Implements the same interface as demoData.js so routes can swap between them.
 *
 * All writes go through the admin endpoints; reads serve live data to the UI.
 */
'use strict';
const azure = require('../azureDb');

// ── Helpers ──────────────────────────────────────────────────────────────────

function toIso(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  const s = String(v);
  // already ISO-like
  if (s.match(/^\d{4}-\d{2}-\d{2}/)) return s;
  const d = new Date(s);
  return isNaN(d) ? s : d.toISOString();
}

// ── Public interface ──────────────────────────────────────────────────────────

module.exports = {
  isDemoMode() { return false; },

  async getProjectInfo(projectId) {
    const r = await azure.request();
    r.input('pid', azure.sql.Int, projectId);
    const res = await r.query(`
      SELECT ProjectID, ProjectName, CustomerCity FROM [readiness].[projects] WHERE ProjectID = @pid
    `);
    const row = res.recordset[0];
    if (!row) {
      return { ProjectID: projectId, ProjectName: `Job ${projectId}`, DisplayName: String(projectId) };
    }
    return {
      ProjectID:   row.ProjectID,
      ProjectName: row.ProjectName,
      DisplayName: `${row.ProjectID} - ${row.ProjectName}`,
      CustomerCity: row.CustomerCity,
    };
  },

  async getSpecs(projectId) {
    const r = await azure.request();
    r.input('pid', azure.sql.Int, projectId);
    const res = await r.query(`
      SELECT SpecAutoID, ProjectID, SpecID, SDescription, SQuantity
      FROM [readiness].[specs]
      WHERE ProjectID = @pid
      ORDER BY SpecID
    `);
    return res.recordset;
  },

  async getTopNode(projectId, specId) {
    const rows = await this.getBomRows(projectId, specId);
    if (!rows || rows.length === 0) return null;
    const childIds = new Set(rows.map(r => r.ChildID));
    const topParentIds = [...new Set(rows.map(r => r.ParentID))].filter(p => !childIds.has(p));
    if (topParentIds.length === 0) return null;
    const topId = topParentIds[0];
    const ref = rows.find(r => r.ParentID === topId);
    return {
      TopItemID: topId,
      TopPN:   ref ? ref.ParentPN   : `TOP ${projectId}-${specId}`,
      TopDesc: ref ? ref.ParentDesc : `Project:${projectId} Section:${specId}`,
    };
  },

  async getBomRows(projectId, specId) {
    const r = await azure.request();
    r.input('pid', azure.sql.Int, projectId);
    r.input('sid', azure.sql.Int, specId);
    const res = await r.query(`
      SELECT ChildID, ChildPN, ChildDesc, ParentID, ParentPN, ParentDesc,
             ItemQty, SpecID, RequiredDate, POQty, ReceivedQty
      FROM [readiness].[bom_items]
      WHERE ProjectID = @pid AND SpecID = @sid
    `);
    return res.recordset.map(row => ({
      ...row,
      RequiredDate: toIso(row.RequiredDate),
      LastReceivedDate: (row.ReceivedQty >= row.ItemQty && row.ReceivedQty > 0)
        ? new Date(new Date(row.RequiredDate || Date.now()).getTime() - 172800000).toISOString()
        : null,
    }));
  },

  async getPoDetails(projectId) {
    const r = await azure.request();
    r.input('pid', azure.sql.Int, projectId);
    const res = await r.query(`
      SELECT PurchaseOrderID, PurchaseDate, PurchaseDateRequired,
             Supplier, SupplierEmail, SupplierPhone,
             PurchaseDetailID, SpecID, ItemID, PartNumber, PartDesc,
             PurchaseQty, PurchasePrice, DateRequired, ReceivedQty
      FROM [readiness].[po_items]
      WHERE ProjectID = @pid
    `);
    return res.recordset.map(row => ({
      ...row,
      PurchaseDate:         toIso(row.PurchaseDate),
      PurchaseDateRequired: toIso(row.PurchaseDateRequired),
      DateRequired:         toIso(row.DateRequired),
      LastReceivedDate: (row.ReceivedQty >= row.PurchaseQty && row.ReceivedQty > 0)
        ? new Date(new Date(row.PurchaseDate || Date.now()).getTime() + 172800000).toISOString()
        : null,
    }));
  },

  async getProjectCosting(projectId) {
    const r = await azure.request();
    r.input('pid', azure.sql.Int, projectId);
    const res = await r.query(`
      SELECT * FROM [readiness].[project_costing] WHERE ProjectID = @pid
    `);
    return res.recordset[0] || null;
  },

  async getSpecCosting(projectId) {
    const r = await azure.request();
    r.input('pid', azure.sql.Int, projectId);
    const res = await r.query(`
      SELECT * FROM [readiness].[spec_costing]
      WHERE ProjectID = @pid
      ORDER BY SectionID
    `);
    return res.recordset.map(row => ({ JobID: projectId, ...row }));
  },

  // ── List all projects with any data ─────────────────────────────────────────
  async listProjects() {
    const r = await azure.request();
    const res = await r.query(`
      SELECT p.ProjectID, p.ProjectName,
             COUNT(DISTINCT s.SpecID) AS specCount
      FROM [readiness].[projects] p
      LEFT JOIN [readiness].[specs] s ON s.ProjectID = p.ProjectID
      GROUP BY p.ProjectID, p.ProjectName
      ORDER BY p.ProjectID DESC
    `);
    return res.recordset;
  },
};
