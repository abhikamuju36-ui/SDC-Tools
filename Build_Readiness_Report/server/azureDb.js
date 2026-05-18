/**
 * azureDb.js — Azure SQL connection pool for Build Readiness Report.
 * Uses the [readiness] schema.  Call ensureSchema() once on startup.
 */
'use strict';
const sql = require('mssql');
require('dotenv').config();

const config = {
  server:   process.env.AZURE_SQL_SERVER   || 'sdc-automation.database.windows.net',
  database: process.env.AZURE_SQL_DATABASE || 'free-sql-db-7038618',
  user:     process.env.AZURE_SQL_USER     || 'sdcadmin',
  password: process.env.AZURE_SQL_PASSWORD || '',
  options: {
    encrypt: true,
    trustServerCertificate: false,
    connectTimeout: 30000,
    requestTimeout: 60000,
  },
  pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
};

let _pool = null;
let _available = false;

async function getPool() {
  if (!_pool) {
    _pool = await sql.connect(config);
    _available = true;
  }
  return _pool;
}

async function request() {
  const pool = await getPool();
  return pool.request();
}

function isAvailable() { return _available; }

async function ensureSchema() {
  const pool = await getPool();

  // Create schema
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'readiness')
      EXEC('CREATE SCHEMA [readiness]');
  `);

  // projects table
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES
                   WHERE TABLE_SCHEMA = 'readiness' AND TABLE_NAME = 'projects')
    CREATE TABLE [readiness].[projects] (
      ProjectID   INT PRIMARY KEY,
      ProjectName NVARCHAR(500) NOT NULL,
      CustomerCity NVARCHAR(255),
      CreatedAt   DATETIME2 DEFAULT GETDATE()
    );
  `);

  // specs table
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES
                   WHERE TABLE_SCHEMA = 'readiness' AND TABLE_NAME = 'specs')
    CREATE TABLE [readiness].[specs] (
      SpecAutoID  INT PRIMARY KEY,
      ProjectID   INT NOT NULL,
      SpecID      INT NOT NULL,
      SDescription NVARCHAR(500),
      SQuantity   INT DEFAULT 1
    );
  `);

  // bom_items table
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES
                   WHERE TABLE_SCHEMA = 'readiness' AND TABLE_NAME = 'bom_items')
    CREATE TABLE [readiness].[bom_items] (
      id          INT IDENTITY(1,1) PRIMARY KEY,
      ProjectID   INT NOT NULL,
      SpecID      INT NOT NULL,
      ChildID     INT,
      ChildPN     NVARCHAR(200),
      ChildDesc   NVARCHAR(500),
      ParentID    INT,
      ParentPN    NVARCHAR(200),
      ParentDesc  NVARCHAR(500),
      ItemQty     INT DEFAULT 1,
      POQty       INT DEFAULT 0,
      ReceivedQty INT DEFAULT 0,
      RequiredDate NVARCHAR(50)
    );
  `);

  // po_items table
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES
                   WHERE TABLE_SCHEMA = 'readiness' AND TABLE_NAME = 'po_items')
    CREATE TABLE [readiness].[po_items] (
      id               INT IDENTITY(1,1) PRIMARY KEY,
      ProjectID        INT NOT NULL,
      PurchaseOrderID  INT,
      PurchaseDate     NVARCHAR(50),
      PurchaseDateRequired NVARCHAR(50),
      Supplier         NVARCHAR(500),
      SupplierEmail    NVARCHAR(1000),
      SupplierPhone    NVARCHAR(100),
      PurchaseDetailID INT,
      SpecID           INT,
      ItemID           INT,
      PartNumber       NVARCHAR(200),
      PartDesc         NVARCHAR(500),
      PurchaseQty      INT DEFAULT 0,
      PurchasePrice    FLOAT DEFAULT 0,
      DateRequired     NVARCHAR(50),
      ReceivedQty      INT DEFAULT 0
    );
  `);

  // project_costing table
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES
                   WHERE TABLE_SCHEMA = 'readiness' AND TABLE_NAME = 'project_costing')
    CREATE TABLE [readiness].[project_costing] (
      ProjectID       INT PRIMARY KEY,
      Description     NVARCHAR(500),
      CustomerCity    NVARCHAR(255),
      EstEngHrs       FLOAT,   ActEngHrs    FLOAT,
      EstMfgHrs       FLOAT,   ActMfgHrs    FLOAT,
      EstEngLabor     FLOAT,   ActEngLabor  FLOAT,
      EstMfgLabor     FLOAT,   ActMfgLabor  FLOAT,
      EstMaterials    FLOAT,   ActMaterials FLOAT,
      TotalEstimate   FLOAT,   TotalActualCost FLOAT,
      SalesPrice      FLOAT,   BudgetMargin FLOAT,
      ActualMargin    FLOAT
    );
  `);

  // spec_costing table
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES
                   WHERE TABLE_SCHEMA = 'readiness' AND TABLE_NAME = 'spec_costing')
    CREATE TABLE [readiness].[spec_costing] (
      id                 INT IDENTITY(1,1) PRIMARY KEY,
      ProjectID          INT NOT NULL,
      SectionID          INT NOT NULL,
      SectionName        NVARCHAR(500),
      EngHours           FLOAT,  MfgHours    FLOAT,  TotalHours   FLOAT,
      EngLabor           FLOAT,  MfgLabor    FLOAT,  TotalLabor   FLOAT,
      PurchasedMaterials FLOAT,  InventoryPulls FLOAT, ExtraCosts FLOAT,
      TotalMaterials     FLOAT,  TotalCost   FLOAT,  Margin       FLOAT
    );
  `);

  console.log('[AzureDB:readiness] Schema ready.');
}

module.exports = { getPool, request, isAvailable, ensureSchema, sql };
