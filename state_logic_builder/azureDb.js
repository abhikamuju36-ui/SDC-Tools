/**
 * azureDb.js — Azure SQL connection pool for SDC State Logic Builder.
 * Uses the [statelogic] schema. Call ensureSchema() once on startup.
 */
'use strict';
const sql = require('mssql');
const path = require('path');

// Load .env from the project root
require('dotenv').config({ path: path.join(__dirname, '.env') });

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

async function getPool() {
  if (!_pool) {
    _pool = await sql.connect(config);
  }
  return _pool;
}

async function request() {
  const pool = await getPool();
  return pool.request();
}

async function ensureSchema() {
  const pool = await getPool();

  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'statelogic')
      EXEC('CREATE SCHEMA [statelogic]');
  `);

  // Projects: one row per project JSON file
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES
                   WHERE TABLE_SCHEMA = 'statelogic' AND TABLE_NAME = 'projects')
    CREATE TABLE [statelogic].[projects] (
      filename      NVARCHAR(200) PRIMARY KEY,
      name          NVARCHAR(500),
      data          NVARCHAR(MAX) NOT NULL,
      sm_count      INT DEFAULT 0,
      last_modified BIGINT,
      updated_at    DATETIME2 DEFAULT GETUTCDATE()
    );
  `);

  // Standards library: one row per standard entry (keyed by id)
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES
                   WHERE TABLE_SCHEMA = 'statelogic' AND TABLE_NAME = 'standards')
    CREATE TABLE [statelogic].[standards] (
      id         NVARCHAR(200) PRIMARY KEY,
      data       NVARCHAR(MAX) NOT NULL,
      updated_at DATETIME2 DEFAULT GETUTCDATE()
    );
  `);

  console.log('[AzureDB:statelogic] Schema ready.');
}

module.exports = { getPool, request, ensureSchema, sql };
