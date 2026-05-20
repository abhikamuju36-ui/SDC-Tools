const sql = require('mssql');

let pool = null;

const config = {
  server: process.env.ETO_HOST,
  database: process.env.ETO_DATABASE,
  user: process.env.ETO_USER,
  password: process.env.ETO_PASSWORD,
  domain: process.env.ETO_DOMAIN,
  port: process.env.ETO_PORT ? parseInt(process.env.ETO_PORT) : 1433,
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

async function getPool() {
  if (!config.server) {
    throw new Error('ETO database not configured. Fill in .env with ETO_HOST, ETO_DATABASE, ETO_USER, ETO_PASSWORD.');
  }
  if (!pool) {
    pool = await sql.connect(config);
  }
  return pool;
}

// ---------- Queries ----------

async function getSpecs(projectId) {
  const db = await getPool();
  const result = await db.request()
    .input('projectId', sql.Int, projectId)
    .query(`
      SELECT SpecAutoID, SpecID, SDescription, SQuantity
      FROM tblSpec
      WHERE ProjectID = @projectId
      ORDER BY SpecID
    `);
  return result.recordset;
}

async function getTopNode(projectId, specId) {
  const db = await getPool();
  const result = await db.request()
    .input('projectId', sql.Int, projectId)
    .input('specId', sql.Int, specId)
    .query(`
      SELECT et.ItemID as TopItemID, eim.ItemCompanyID as TopPN, eim.ItemDescription as TopDesc
      FROM tblEngTop et
      JOIN tblEngItemMaster eim ON et.ItemID = eim.ItemID
      WHERE et.ProjectID = @projectId AND et.SpecID = @specId
    `);
  return result.recordset[0] || null;
}

async function getBomRows(projectId, specId) {
  const db = await getPool();
  const result = await db.request()
    .input('projectId', sql.Int, projectId)
    .input('specId', sql.Int, specId)
    .query(`
      SELECT
        eps.ChildID,
        child.ItemCompanyID  AS ChildPN,
        child.ItemDescription AS ChildDesc,
        child.Manufacturer AS Manufacturer,
        eps.ParentID,
        parent.ItemCompanyID AS ParentPN,
        parent.ItemDescription AS ParentDesc,
        eps.ItemQty,
        eps.SpecID,
        eps.RequiredDate,
        eps.ItemHold,
        ISNULL((
          SELECT SUM(pod.PurchaseQty)
          FROM tblPurchaseOrderDetails pod
          WHERE pod.ProjectID = @projectId AND pod.ItemID = eps.ChildID
        ), 0) AS POQty,
        ISNULL((
          SELECT SUM(rl.QtyReceived)
          FROM tblReceiverLog rl
          JOIN tblPurchaseOrderDetails pod2 ON rl.PurchaseDetailID = pod2.PurchaseDetailID
          WHERE pod2.ProjectID = @projectId AND pod2.ItemID = eps.ChildID
        ), 0) AS ReceivedQty,
        ISNULL((
          SELECT TOP 1 pod3.PurchasePrice
          FROM tblPurchaseOrderDetails pod3
          WHERE pod3.ProjectID = @projectId AND pod3.ItemID = eps.ChildID AND pod3.PurchasePrice > 0
          ORDER BY pod3.PurchaseDetailID DESC
        ), 0) AS UnitPrice,
        (
          SELECT TOP 1 rl3.[Date]
          FROM tblReceiverLog rl3
          JOIN tblPurchaseOrderDetails pod5 ON rl3.PurchaseDetailID = pod5.PurchaseDetailID
          WHERE pod5.ProjectID = @projectId AND pod5.ItemID = eps.ChildID
          ORDER BY rl3.[Date] DESC
        ) AS LastReceivedDate
      FROM tblEngProductStructure eps
      JOIN tblEngItemMaster child  ON eps.ChildID  = child.ItemID
      JOIN tblEngItemMaster parent ON eps.ParentID = parent.ItemID
      WHERE eps.ProjectID = @projectId AND eps.SpecID = @specId
      ORDER BY parent.ItemCompanyID, child.ItemCompanyID
    `);
  return result.recordset;
}

async function getPoDetails(projectId) {
  const db = await getPool();
  const result = await db.request()
    .input('projectId', sql.Int, projectId)
    .query(`
      SELECT
        poh.PurchaseOrderID,
        poh.PurchaseDate,
        poh.PurchaseDateRequired,
        c.CName           AS Supplier,
        c.DefaultEmailAddress AS SupplierEmail,
        c.CPhone           AS SupplierPhone,
        pod.PurchaseDetailID,
        pod.SpecID,
        pod.ItemID,
        eim.ItemCompanyID  AS PartNumber,
        eim.ItemDescription AS PartDesc,
        pod.PurchaseQty,
        pod.PurchasePrice,
        pod.DateRequired,
        ISNULL((
          SELECT SUM(rl.QtyReceived)
          FROM tblReceiverLog rl
          WHERE rl.PurchaseDetailID = pod.PurchaseDetailID
        ), 0) AS ReceivedQty,
        (
          SELECT TOP 1 rl2.[Date]
          FROM tblReceiverLog rl2
          WHERE rl2.PurchaseDetailID = pod.PurchaseDetailID
          ORDER BY rl2.[Date] DESC
        ) AS LastReceivedDate
      FROM tblPurchaseOrderDetails pod
      JOIN tblPurchaseOrderHeader poh ON pod.PurchaseOrderID = poh.PurchaseOrderID
      JOIN tblCompany c              ON poh.PurchaseSupplierID = c.CompanyID
      JOIN tblEngItemMaster eim      ON pod.ItemID = eim.ItemID
      WHERE pod.ProjectID = @projectId
        AND eim.ItemCompanyID NOT IN ('Shipping', 'FEE', 'TARIFF')
      ORDER BY c.CName, pod.DateRequired
    `);
  return result.recordset;
}

async function getProjectInfo(projectId) {
  const db = await getPool();
  const result = await db.request()
    .input('projectId', sql.Int, projectId)
    .query(`
      SELECT TOP 1 ProjectID, PDescription AS ProjectName
      FROM vwProjects
      WHERE ProjectID = @projectId
    `);
  return result.recordset[0] || null;
}

async function getProjectCosting(projectId) {
  const db = await getPool();
  const result = await db.request()
    .input('projectId', sql.Int, projectId)
    .query(`
      SELECT
        C.ProjectID AS [JobID],
        C.PDescription AS [Description],
        C.CompanyCity AS [CustomerCity],
        C.EstEngHours AS [EstEngHrs],
        C.ActEngHours AS [ActEngHrs],
        C.EstMfgHours AS [EstMfgHrs],
        C.ActMfgHours AS [ActMfgHrs],
        C.EngEstimateExtended AS [EstEngLabor],
        C.ActEngLabor AS [ActEngLabor],
        C.MfgEstimateExtended AS [EstMfgLabor],
        C.ActMfgLabor AS [ActMfgLabor],
        C.EstTotalMaterials AS [EstMaterials],
        C.ActTotalMaterials AS [ActMaterials],
        C.ExtendedEstimate AS [TotalEstimate],
        C.ActTotalCost AS [TotalActualCost],
        C.SalesPrice AS [SalesPrice],
        C.BudgetMargin AS [BudgetMargin],
        C.ActualMargin AS [ActualMargin]
      FROM vwProjectActualsVSEstimates C WITH(NOLOCK)
      WHERE C.ProjectID = @projectId
    `);
  return result.recordset[0] || null;
}

async function getSpecCosting(projectId) {
  const db = await getPool();
  const result = await db.request()
    .input('projectId', sql.Int, projectId)
    .query(`
      SELECT
        C.ProjectID AS [JobID],
        C.SpecID AS [SectionID],
        S.SDescription AS [SectionName],
        C.EngHours AS [EngHours],
        C.MFGHours AS [MfgHours],
        C.TotalHours AS [TotalHours],
        C.EngLabor AS [EngLabor],
        C.MFGLabor AS [MfgLabor],
        C.TotalLabor AS [TotalLabor],
        C.TotalPurchasedMaterials AS [PurchasedMaterials],
        C.TotalInventoryPulls AS [InventoryPulls],
        C.TotalExtraCosts AS [ExtraCosts],
        C.TotalMaterials AS [TotalMaterials],
        C.TotalCost AS [TotalCost],
        C.Margin AS [Margin]
      FROM vwCostingSummed_BySpecID C WITH(NOLOCK)
      LEFT JOIN vwSpec S WITH(NOLOCK) ON S.ProjectID = C.ProjectID AND S.SpecID = C.SpecID
      WHERE C.ProjectID = @projectId
      ORDER BY C.TotalCost DESC
    `);
  return result.recordset;
}

module.exports = {
  getSpecs,
  getTopNode,
  getBomRows,
  getPoDetails,
  getProjectInfo,
  getProjectCosting,
  getSpecCosting,
};
