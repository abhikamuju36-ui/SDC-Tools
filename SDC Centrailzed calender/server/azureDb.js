/**
 * azureDb.js — Single Azure SQL connection pool for the SDC Calendar.
 *
 * All other DB modules (sqlite.js, db.js) import from here so there is
 * one pool shared across the whole server process.
 *
 * Required env vars (add to server/.env):
 *   AZURE_SQL_SERVER    e.g. myserver.database.windows.net
 *   AZURE_SQL_DATABASE  e.g. sdc-tools
 *   AZURE_SQL_USER      e.g. sdcadmin
 *   AZURE_SQL_PASSWORD  your password
 */

const sql = require('mssql');

const config = {
  server:   process.env.AZURE_SQL_SERVER,
  database: process.env.AZURE_SQL_DATABASE,
  user:     process.env.AZURE_SQL_USER,
  password: process.env.AZURE_SQL_PASSWORD,
  port:     parseInt(process.env.AZURE_SQL_PORT || '1433', 10),
  options: {
    encrypt:                true,   // required for Azure SQL
    trustServerCertificate: false,
    connectTimeout:         30000,
    requestTimeout:         30000,
  },
  pool: {
    max:              10,
    min:              0,
    idleTimeoutMillis: 30000,
  },
};

let _pool = null;
let _connecting = false;
let _connectQueue = [];

/**
 * Returns a live connection pool. Creates it on first call.
 * Safe to call concurrently — only opens one connection.
 */
async function getPool() {
  if (_pool && _pool.connected) return _pool;

  if (_connecting) {
    return new Promise((resolve, reject) => {
      _connectQueue.push({ resolve, reject });
    });
  }

  _connecting = true;
  try {
    _pool = await sql.connect(config);
    _pool.on('error', err => {
      console.error('[azureDb] Pool error — will reconnect on next query:', err.message);
      _pool = null;
    });
    console.log('[azureDb] Connected to Azure SQL:', config.server, '/', config.database);
    _connectQueue.forEach(q => q.resolve(_pool));
    _connectQueue = [];
    return _pool;
  } catch (err) {
    _connectQueue.forEach(q => q.reject(err));
    _connectQueue = [];
    throw err;
  } finally {
    _connecting = false;
  }
}

/**
 * Convenience wrapper — returns a prepared request on the live pool.
 * Usage:  const req = await azureDb.request();  req.input(...); await req.query(sql);
 */
async function request() {
  const pool = await getPool();
  return pool.request();
}

/**
 * Run a plain SQL string with no parameters (schema creation, migrations).
 */
async function runRaw(sqlString) {
  const pool = await getPool();
  return pool.request().query(sqlString);
}

/**
 * Ensure the [calendar] schema and all tables exist.
 * Called once on server startup — idempotent (IF NOT EXISTS everywhere).
 */
async function ensureSchema() {
  const pool = await getPool();
  const r = pool.request();

  await r.query(`
    IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'calendar')
      EXEC('CREATE SCHEMA [calendar]');
  `);

  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES
                   WHERE TABLE_SCHEMA='calendar' AND TABLE_NAME='events')
    CREATE TABLE [calendar].[events] (
      id            NVARCHAR(50)   NOT NULL PRIMARY KEY,
      title         NVARCHAR(500)  NOT NULL,
      date          NVARCHAR(20)   NOT NULL,
      endDate       NVARCHAR(20)   NULL,
      category      NVARCHAR(50)   NOT NULL,
      allDay        BIT            NOT NULL DEFAULT 0,
      time          NVARCHAR(10)   NULL,
      endTime       NVARCHAR(10)   NULL,
      location      NVARCHAR(500)  NULL,
      description   NVARCHAR(MAX)  NULL,
      repeat        NVARCHAR(20)   NOT NULL DEFAULT 'none',
      notify        INT            NULL,
      pinned        BIT            NOT NULL DEFAULT 0,
      creatorEmail  NVARCHAR(255)  NULL,
      creatorName   NVARCHAR(255)  NULL,
      approved      BIT            NOT NULL DEFAULT 0
    );
  `);

  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE name='idx_cal_events_date' AND object_id = OBJECT_ID('[calendar].[events]'))
      CREATE INDEX idx_cal_events_date     ON [calendar].[events](date);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE name='idx_cal_events_category' AND object_id = OBJECT_ID('[calendar].[events]'))
      CREATE INDEX idx_cal_events_category ON [calendar].[events](category);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE name='idx_cal_events_creator' AND object_id = OBJECT_ID('[calendar].[events]'))
      CREATE INDEX idx_cal_events_creator  ON [calendar].[events](creatorEmail);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE name='idx_cal_events_approved' AND object_id = OBJECT_ID('[calendar].[events]'))
      CREATE INDEX idx_cal_events_approved ON [calendar].[events](approved);
  `);

  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES
                   WHERE TABLE_SCHEMA='calendar' AND TABLE_NAME='users')
    CREATE TABLE [calendar].[users] (
      id          NVARCHAR(50)   NOT NULL PRIMARY KEY,
      email       NVARCHAR(255)  NOT NULL,
      name        NVARCHAR(255)  NULL,
      role        NVARCHAR(50)   NOT NULL DEFAULT 'employee',
      created_at  DATETIME2      NOT NULL DEFAULT GETUTCDATE(),
      last_login  DATETIME2      NULL,
      CONSTRAINT uq_cal_users_email UNIQUE (email)
    );
  `);

  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES
                   WHERE TABLE_SCHEMA='calendar' AND TABLE_NAME='roles')
    CREATE TABLE [calendar].[roles] (
      role        NVARCHAR(50)   NOT NULL PRIMARY KEY,
      categories  NVARCHAR(500)  NOT NULL DEFAULT '',
      label       NVARCHAR(100)  NULL
    );
  `);

  // Seed default roles if table is empty
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM [calendar].[roles])
    BEGIN
      INSERT INTO [calendar].[roles] (role, categories, label) VALUES
        ('admin',    'holiday,payday,birthday,meeting,company,deadline,personal,vacation', 'Administrator'),
        ('hr',       'holiday,payday,birthday,company,vacation',                           'HR'),
        ('manager',  'holiday,meeting,company,deadline,payday,vacation',                   'Manager'),
        ('employee', 'holiday,company,vacation',                                           'Employee');
    END
  `);

  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES
                   WHERE TABLE_SCHEMA='calendar' AND TABLE_NAME='employees')
    CREATE TABLE [calendar].[employees] (
      id            NVARCHAR(50)   NOT NULL PRIMARY KEY,
      name          NVARCHAR(255)  NOT NULL,
      role          NVARCHAR(255)  NULL,
      email         NVARCHAR(255)  NULL,
      birth_month   INT            NULL,
      birth_day     INT            NULL,
      phone         NVARCHAR(50)   NULL,
      department    NVARCHAR(255)  NULL,
      created_at    DATETIME2      NOT NULL DEFAULT GETUTCDATE()
    );
  `);

  console.log('[azureDb] Schema ready.');
}

module.exports = { getPool, request, runRaw, ensureSchema, sql };
