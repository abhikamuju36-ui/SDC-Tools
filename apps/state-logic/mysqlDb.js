/**
 * mysqlDb.js — MySQL storage for SDC State Logic Builder.
 *
 * Replaces azureDb.js (Azure SQL [statelogic] schema). Two tables, both
 * key + JSON-blob, in the local `sdc_statelogic` database:
 *   projects   — one row per project file (filename PK, JSON in `data`)
 *   standards  — one row per shared standard (id PK, JSON in `data`)
 *
 * Call ensureSchema() once on startup. Export getPool() for server.js.
 *
 * Environment (.env at project root):
 *   MYSQL_HOST      (default: localhost)
 *   MYSQL_PORT      (default: 3306)
 *   MYSQL_USER      (default: root)
 *   MYSQL_PASSWORD
 *   MYSQL_DATABASE  (default: sdc_statelogic)
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');

const DB_NAME = process.env.MYSQL_DATABASE || 'sdc_statelogic';
const CONN = {
  host:     process.env.MYSQL_HOST     || 'localhost',
  port:     Number(process.env.MYSQL_PORT) || 3306,
  user:     process.env.MYSQL_USER     || 'root',
  password: process.env.MYSQL_PASSWORD || '',
};

let _pool = null;

function getPool() {
  if (!_pool) {
    _pool = mysql.createPool({
      ...CONN,
      database:           DB_NAME,
      waitForConnections: true,
      connectionLimit:    5,
      timezone:           'Z',
    });
  }
  return _pool;
}

async function ensureSchema() {
  // Bootstrap: the pool binds to DB_NAME, so the database must exist before the
  // pool's first query. Create it via a connection with no default schema.
  const boot = await mysql.createConnection(CONN);
  await boot.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4`);
  await boot.end();

  const pool = getPool();

  // Projects: one row per project JSON file. data is LONGTEXT — project blobs
  // run to hundreds of KB (the Stuller project is ~170 KB), well past TEXT's 64 KB.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      filename      VARCHAR(200) PRIMARY KEY,
      name          VARCHAR(500),
      data          LONGTEXT NOT NULL,
      sm_count      INT DEFAULT 0,
      last_modified BIGINT,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  // Standards library: one row per standard entry (keyed by id).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS standards (
      id         VARCHAR(200) PRIMARY KEY,
      data       LONGTEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  console.log(`[MySQL:${DB_NAME}] Schema ready.`);
}

module.exports = { getPool, ensureSchema, DB_NAME };
