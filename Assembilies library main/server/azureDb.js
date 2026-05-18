/**
 * azureDb.js — Azure SQL connection pool for Assemblies Library.
 * Uses the [assemblies] schema. Call ensureSchema() once to create tables.
 */
'use strict';
const sql = require('mssql');
const path = require('path');

// Load .env from project root (one level up from server/)
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const config = {
  server:   process.env.AZURE_SQL_SERVER   || 'sdc-automation.database.windows.net',
  database: process.env.AZURE_SQL_DATABASE || 'free-sql-db-7038618',
  user:     process.env.AZURE_SQL_USER     || 'sdcadmin',
  password: process.env.AZURE_SQL_PASSWORD || '',
  options: {
    encrypt: true,
    trustServerCertificate: false,
    connectTimeout: 30000,
    requestTimeout: 120000,   // longer — bulk inserts can take a moment
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
    IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'assemblies')
      EXEC('CREATE SCHEMA [assemblies]');
  `);

  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES
                   WHERE TABLE_SCHEMA = 'assemblies' AND TABLE_NAME = 'assemblies')
    CREATE TABLE [assemblies].[assemblies] (
      id            INT IDENTITY PRIMARY KEY,
      job_id        NVARCHAR(200),
      job_name      NVARCHAR(500),
      file_name     NVARCHAR(500),
      partno        NVARCHAR(200),
      description   NVARCHAR(MAX),
      category      NVARCHAR(200),
      comments      NVARCHAR(MAX),
      updated_by    NVARCHAR(200),
      created_at    NVARCHAR(50),
      updated_at    NVARCHAR(50),
      model_link    NVARCHAR(MAX),
      picture_link  NVARCHAR(MAX),
      preference    NVARCHAR(200),
      sdc_standard  NVARCHAR(200),
      library       NVARCHAR(200),
      status        NVARCHAR(50)  DEFAULT 'Active',
      deleted_at    NVARCHAR(50),
      thumbnail     NVARCHAR(500),
      path          NVARCHAR(MAX),
      last_modified NVARCHAR(50),
      size          BIGINT
    );
  `);

  // Add filesystem columns to existing tables that were created without them (idempotent)
  for (const col of [
    "IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='assemblies' AND TABLE_NAME='assemblies' AND COLUMN_NAME='thumbnail') ALTER TABLE [assemblies].[assemblies] ADD thumbnail NVARCHAR(500)",
    "IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='assemblies' AND TABLE_NAME='assemblies' AND COLUMN_NAME='path') ALTER TABLE [assemblies].[assemblies] ADD path NVARCHAR(MAX)",
    "IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='assemblies' AND TABLE_NAME='assemblies' AND COLUMN_NAME='last_modified') ALTER TABLE [assemblies].[assemblies] ADD last_modified NVARCHAR(50)",
    "IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='assemblies' AND TABLE_NAME='assemblies' AND COLUMN_NAME='size') ALTER TABLE [assemblies].[assemblies] ADD size BIGINT",
  ]) {
    await pool.request().query(col);
  }

  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES
                   WHERE TABLE_SCHEMA = 'assemblies' AND TABLE_NAME = 'audit_log')
    CREATE TABLE [assemblies].[audit_log] (
      id         INT IDENTITY PRIMARY KEY,
      partno     NVARCHAR(200) NOT NULL,
      action     NVARCHAR(100) NOT NULL,
      field      NVARCHAR(200),
      old_value  NVARCHAR(MAX),
      new_value  NVARCHAR(MAX),
      changed_by NVARCHAR(200),
      changed_at NVARCHAR(50)
    );
  `);

  console.log('[AzureDB:assemblies] Schema ready.');
}

module.exports = { getPool, request, ensureSchema, sql };
