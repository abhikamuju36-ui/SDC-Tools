/**
 * seedAzure.js — Seeds Azure SQL with the pre-cached demo data.
 * Runs once on startup if any of the demo projects are missing from Azure SQL.
 * Idempotent — uses MERGE / INSERT OR IGNORE patterns.
 */
'use strict';
const fs   = require('fs');
const path = require('path');
const azure = require('../azureDb');

const CACHE_DIR = path.join(__dirname, '..', 'cache');

function loadJson(filename) {
  const fp = path.join(CACHE_DIR, filename);
  if (!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

// Static data mirroring demoData.js
const SEED_PROJECTS = [
  { ProjectID: 1083, ProjectName: 'SDC Show Room',    CustomerCity: '' },
  { ProjectID: 1118, ProjectName: 'AIR Loop Assembly', CustomerCity: '' },
  { ProjectID: 1129, ProjectName: 'Molex Duplex',      CustomerCity: '' },
];

const SEED_SPECS = {
  1083: [
    { SpecAutoID: 610, SpecID: 10, SDescription: 'Mechanical Design and Build', SQuantity: 1 },
    { SpecAutoID: 611, SpecID: 30, SDescription: 'Controls Design',             SQuantity: 1 },
  ],
  1118: [
    { SpecAutoID: 700, SpecID: 10, SDescription: 'Complete Design and Build', SQuantity: 1 },
    { SpecAutoID: 701, SpecID: 30, SDescription: 'Controls Design',           SQuantity: 1 },
    { SpecAutoID: 702, SpecID: 40, SDescription: 'Machine Testing',           SQuantity: 1 },
    { SpecAutoID: 703, SpecID: 90, SDescription: 'Spare Parts',               SQuantity: 1 },
  ],
  1129: [
    { SpecAutoID: 894, SpecID: 10, SDescription: 'Mechanical Design and Build', SQuantity: 1 },
    { SpecAutoID: 888, SpecID: 30, SDescription: 'Controls Design',             SQuantity: 1 },
    { SpecAutoID: 895, SpecID: 40, SDescription: 'Machine Testing',             SQuantity: 1 },
    { SpecAutoID: 896, SpecID: 90, SDescription: 'Spare Parts',                 SQuantity: 1 },
  ],
};

const SEED_COSTING_PROJECT = {
  1118: { EstEngHrs:0, ActEngHrs:null, EstMfgHrs:0, ActMfgHrs:null, EstEngLabor:0, ActEngLabor:null, EstMfgLabor:0, ActMfgLabor:null, EstMaterials:1000, ActMaterials:504986.49, TotalEstimate:1000, TotalActualCost:504986.49, SalesPrice:1000, BudgetMargin:0, ActualMargin:-503.99 },
  1129: { EstEngHrs:0, ActEngHrs:null, EstMfgHrs:0, ActMfgHrs:null, EstEngLabor:0, ActEngLabor:null, EstMfgLabor:0, ActMfgLabor:null, EstMaterials:1000, ActMaterials:157616.49, TotalEstimate:1000, TotalActualCost:157616.49, SalesPrice:1000, BudgetMargin:0, ActualMargin:-156.62 },
};

const SEED_COSTING_SPEC = {
  1118: [
    { SectionID:10, SectionName:'Complete Design and Build', EngHours:null, MfgHours:null, TotalHours:0, EngLabor:null, MfgLabor:null, TotalLabor:0, PurchasedMaterials:264191.78, InventoryPulls:3355.34,  ExtraCosts:5323.02, TotalMaterials:272870.14, TotalCost:272870.14, Margin:null },
    { SectionID:30, SectionName:'Controls Design',           EngHours:null, MfgHours:null, TotalHours:0, EngLabor:null, MfgLabor:null, TotalLabor:0, PurchasedMaterials:223095.47, InventoryPulls:-2269.97, ExtraCosts:0,       TotalMaterials:220825.50, TotalCost:220825.50, Margin:null },
    { SectionID:40, SectionName:'Machine Testing',           EngHours:null, MfgHours:null, TotalHours:0, EngLabor:null, MfgLabor:null, TotalLabor:0, PurchasedMaterials:8430.71,   InventoryPulls:26.90,    ExtraCosts:0,       TotalMaterials:8457.61,   TotalCost:8457.61,   Margin:null },
    { SectionID:90, SectionName:'Spare Parts',               EngHours:null, MfgHours:null, TotalHours:0, EngLabor:null, MfgLabor:null, TotalLabor:0, PurchasedMaterials:2636.06,   InventoryPulls:197.18,   ExtraCosts:0,       TotalMaterials:2833.24,   TotalCost:2833.24,   Margin:null },
  ],
  1129: [
    { SectionID:10, SectionName:'Mechanical Design and Build', EngHours:null, MfgHours:null, TotalHours:0, EngLabor:null, MfgLabor:null, TotalLabor:0, PurchasedMaterials:126535.05, InventoryPulls:756.90,  ExtraCosts:1374.46, TotalMaterials:128666.41, TotalCost:128666.41, Margin:null },
    { SectionID:30, SectionName:'Controls Design',             EngHours:null, MfgHours:null, TotalHours:0, EngLabor:null, MfgLabor:null, TotalLabor:0, PurchasedMaterials:25907.81,  InventoryPulls:1074.14, ExtraCosts:0,       TotalMaterials:26981.95,  TotalCost:26981.95,  Margin:null },
    { SectionID:90, SectionName:'Spare Parts',                 EngHours:null, MfgHours:null, TotalHours:0, EngLabor:null, MfgLabor:null, TotalLabor:0, PurchasedMaterials:1297.71,   InventoryPulls:-11.16,  ExtraCosts:0,       TotalMaterials:1286.55,   TotalCost:1286.55,   Margin:null },
    { SectionID:40, SectionName:'Machine Testing',             EngHours:null, MfgHours:null, TotalHours:0, EngLabor:null, MfgLabor:null, TotalLabor:0, PurchasedMaterials:681.59,    InventoryPulls:0,       ExtraCosts:0,       TotalMaterials:681.59,    TotalCost:681.59,    Margin:null },
  ],
};

async function seedIfNeeded() {
  try {
    // Check if any of the seed projects already exist
    const r = await azure.request();
    const check = await r.query(`SELECT COUNT(*) AS n FROM [readiness].[projects]`);
    if (check.recordset[0].n > 0) {
      console.log('[readiness] Azure SQL already seeded — skipping seed.');
      return;
    }

    console.log('[readiness] Seeding Azure SQL with demo data …');

    // ── Projects ──────────────────────────────────────────────────────────────
    for (const p of SEED_PROJECTS) {
      const req = await azure.request();
      req.input('pid', azure.sql.Int,         p.ProjectID);
      req.input('pn',  azure.sql.NVarChar(500), p.ProjectName);
      req.input('cc',  azure.sql.NVarChar(255), p.CustomerCity);
      await req.query(`
        IF NOT EXISTS (SELECT 1 FROM [readiness].[projects] WHERE ProjectID = @pid)
          INSERT INTO [readiness].[projects] (ProjectID, ProjectName, CustomerCity)
          VALUES (@pid, @pn, @cc)
      `);
    }

    // ── Specs ─────────────────────────────────────────────────────────────────
    for (const [pid, specs] of Object.entries(SEED_SPECS)) {
      for (const s of specs) {
        const req = await azure.request();
        req.input('said', azure.sql.Int,         s.SpecAutoID);
        req.input('pid',  azure.sql.Int,         parseInt(pid));
        req.input('sid',  azure.sql.Int,         s.SpecID);
        req.input('desc', azure.sql.NVarChar(500), s.SDescription);
        req.input('qty',  azure.sql.Int,         s.SQuantity);
        await req.query(`
          IF NOT EXISTS (SELECT 1 FROM [readiness].[specs] WHERE SpecAutoID = @said)
            INSERT INTO [readiness].[specs] (SpecAutoID, ProjectID, SpecID, SDescription, SQuantity)
            VALUES (@said, @pid, @sid, @desc, @qty)
        `);
      }
    }

    // ── BOM items (from cache files) ──────────────────────────────────────────
    for (const p of SEED_PROJECTS) {
      const specs = SEED_SPECS[p.ProjectID] || [];
      for (const spec of specs) {
        const rows = loadJson(`bom_${p.ProjectID}_${spec.SpecID}.json`);
        if (!rows) continue;
        for (const row of rows) {
          const req = await azure.request();
          req.input('pid',  azure.sql.Int,          p.ProjectID);
          req.input('sid',  azure.sql.Int,          spec.SpecID);
          req.input('cid',  azure.sql.Int,          row.ChildID  || null);
          req.input('cpn',  azure.sql.NVarChar(200), row.ChildPN  || '');
          req.input('cds',  azure.sql.NVarChar(500), row.ChildDesc || '');
          req.input('ppid', azure.sql.Int,          row.ParentID || null);
          req.input('ppn',  azure.sql.NVarChar(200), row.ParentPN || '');
          req.input('pds',  azure.sql.NVarChar(500), row.ParentDesc || '');
          req.input('iq',   azure.sql.Int,          row.ItemQty     || 1);
          req.input('pq',   azure.sql.Int,          row.POQty       || 0);
          req.input('rq',   azure.sql.Int,          row.ReceivedQty || 0);
          req.input('rd',   azure.sql.NVarChar(50),  row.RequiredDate ? String(row.RequiredDate).slice(0,30) : null);
          await req.query(`
            INSERT INTO [readiness].[bom_items]
              (ProjectID,SpecID,ChildID,ChildPN,ChildDesc,ParentID,ParentPN,ParentDesc,ItemQty,POQty,ReceivedQty,RequiredDate)
            VALUES (@pid,@sid,@cid,@cpn,@cds,@ppid,@ppn,@pds,@iq,@pq,@rq,@rd)
          `);
        }
      }
    }

    // ── PO items (from cache files) ───────────────────────────────────────────
    for (const p of SEED_PROJECTS) {
      const rows = loadJson(`po_${p.ProjectID}.json`);
      if (!rows) continue;
      for (const row of rows) {
        const req = await azure.request();
        req.input('pid',  azure.sql.Int,          p.ProjectID);
        req.input('poid', azure.sql.Int,          row.PurchaseOrderID  || null);
        req.input('pd',   azure.sql.NVarChar(50),  row.PurchaseDate ? String(row.PurchaseDate).slice(0,30)   : null);
        req.input('pdr',  azure.sql.NVarChar(50),  row.PurchaseDateRequired ? String(row.PurchaseDateRequired).slice(0,30) : null);
        req.input('sup',  azure.sql.NVarChar(500), row.Supplier      || '');
        req.input('sem',  azure.sql.NVarChar(1000),row.SupplierEmail || '');
        req.input('sph',  azure.sql.NVarChar(100), row.SupplierPhone || '');
        req.input('pdid', azure.sql.Int,          row.PurchaseDetailID || null);
        req.input('sid',  azure.sql.Int,          row.SpecID           || null);
        req.input('iid',  azure.sql.Int,          row.ItemID           || null);
        req.input('pn',   azure.sql.NVarChar(200), row.PartNumber || '');
        req.input('pds',  azure.sql.NVarChar(500), row.PartDesc   || '');
        req.input('pq',   azure.sql.Int,          row.PurchaseQty   || 0);
        req.input('pp',   azure.sql.Float,        row.PurchasePrice || 0);
        req.input('dr',   azure.sql.NVarChar(50),  row.DateRequired ? String(row.DateRequired).slice(0,30) : null);
        req.input('rq',   azure.sql.Int,          row.ReceivedQty || 0);
        await req.query(`
          INSERT INTO [readiness].[po_items]
            (ProjectID,PurchaseOrderID,PurchaseDate,PurchaseDateRequired,Supplier,SupplierEmail,SupplierPhone,
             PurchaseDetailID,SpecID,ItemID,PartNumber,PartDesc,PurchaseQty,PurchasePrice,DateRequired,ReceivedQty)
          VALUES (@pid,@poid,@pd,@pdr,@sup,@sem,@sph,@pdid,@sid,@iid,@pn,@pds,@pq,@pp,@dr,@rq)
        `);
      }
    }

    // ── Project costing ───────────────────────────────────────────────────────
    for (const [pid, c] of Object.entries(SEED_COSTING_PROJECT)) {
      const proj = SEED_PROJECTS.find(p => p.ProjectID === parseInt(pid));
      const req = await azure.request();
      req.input('pid', azure.sql.Int,          parseInt(pid));
      req.input('desc',azure.sql.NVarChar(500), proj?.ProjectName || '');
      req.input('cc',  azure.sql.NVarChar(255), '');
      req.input('eeh', azure.sql.Float, c.EstEngHrs);       req.input('aeh', azure.sql.Float, c.ActEngHrs);
      req.input('emh', azure.sql.Float, c.EstMfgHrs);       req.input('amh', azure.sql.Float, c.ActMfgHrs);
      req.input('eel', azure.sql.Float, c.EstEngLabor);     req.input('ael', azure.sql.Float, c.ActEngLabor);
      req.input('eml', azure.sql.Float, c.EstMfgLabor);     req.input('aml', azure.sql.Float, c.ActMfgLabor);
      req.input('em',  azure.sql.Float, c.EstMaterials);    req.input('am',  azure.sql.Float, c.ActMaterials);
      req.input('te',  azure.sql.Float, c.TotalEstimate);   req.input('tac', azure.sql.Float, c.TotalActualCost);
      req.input('sp',  azure.sql.Float, c.SalesPrice);      req.input('bm',  azure.sql.Float, c.BudgetMargin);
      req.input('acm', azure.sql.Float, c.ActualMargin);
      await req.query(`
        IF NOT EXISTS (SELECT 1 FROM [readiness].[project_costing] WHERE ProjectID = @pid)
          INSERT INTO [readiness].[project_costing]
            (ProjectID,Description,CustomerCity,EstEngHrs,ActEngHrs,EstMfgHrs,ActMfgHrs,
             EstEngLabor,ActEngLabor,EstMfgLabor,ActMfgLabor,EstMaterials,ActMaterials,
             TotalEstimate,TotalActualCost,SalesPrice,BudgetMargin,ActualMargin)
          VALUES (@pid,@desc,@cc,@eeh,@aeh,@emh,@amh,@eel,@ael,@eml,@aml,@em,@am,@te,@tac,@sp,@bm,@acm)
      `);
    }

    // ── Spec costing ──────────────────────────────────────────────────────────
    for (const [pid, sections] of Object.entries(SEED_COSTING_SPEC)) {
      for (const s of sections) {
        const req = await azure.request();
        req.input('pid',  azure.sql.Int,          parseInt(pid));
        req.input('sid',  azure.sql.Int,          s.SectionID);
        req.input('sn',   azure.sql.NVarChar(500), s.SectionName);
        req.input('eh',   azure.sql.Float, s.EngHours);    req.input('mh',  azure.sql.Float, s.MfgHours);
        req.input('th',   azure.sql.Float, s.TotalHours);  req.input('el',  azure.sql.Float, s.EngLabor);
        req.input('ml',   azure.sql.Float, s.MfgLabor);    req.input('tl',  azure.sql.Float, s.TotalLabor);
        req.input('pm',   azure.sql.Float, s.PurchasedMaterials); req.input('ip', azure.sql.Float, s.InventoryPulls);
        req.input('ec',   azure.sql.Float, s.ExtraCosts);  req.input('tm',  azure.sql.Float, s.TotalMaterials);
        req.input('tc',   azure.sql.Float, s.TotalCost);   req.input('mg',  azure.sql.Float, s.Margin);
        await req.query(`
          INSERT INTO [readiness].[spec_costing]
            (ProjectID,SectionID,SectionName,EngHours,MfgHours,TotalHours,EngLabor,MfgLabor,TotalLabor,
             PurchasedMaterials,InventoryPulls,ExtraCosts,TotalMaterials,TotalCost,Margin)
          VALUES (@pid,@sid,@sn,@eh,@mh,@th,@el,@ml,@tl,@pm,@ip,@ec,@tm,@tc,@mg)
        `);
      }
    }

    console.log('[readiness] Azure SQL seeded with 3 demo projects (1083, 1118, 1129).');
  } catch (err) {
    console.error('[readiness] Seed error (non-fatal):', err.message);
  }
}

module.exports = { seedIfNeeded };
