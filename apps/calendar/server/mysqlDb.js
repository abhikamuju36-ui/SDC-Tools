/**
 * mysqlDb.js — MySQL connection pool for the SDC Calendar.
 *
 * Replaces azureDb.js. All routes import { pool, query } from here.
 *
 * Environment variables required:
 *   MYSQL_HOST      (default: localhost)
 *   MYSQL_PORT      (default: 3306)
 *   MYSQL_USER      (default: root)
 *   MYSQL_PASSWORD
 *   MYSQL_DATABASE  (default: sdc_calendar)
 */

const mysql = require('mysql2/promise');

let _pool = null;

function getPool() {
  if (!_pool) {
    _pool = mysql.createPool({
      host:               process.env.MYSQL_HOST     || 'localhost',
      port:               Number(process.env.MYSQL_PORT) || 3306,
      user:               process.env.MYSQL_USER     || 'root',
      password:           process.env.MYSQL_PASSWORD || '',
      database:           process.env.MYSQL_DATABASE || 'sdc_calendar',
      waitForConnections: true,
      connectionLimit:    10,
      timezone:           'Z',        // store/retrieve as UTC
      decimalNumbers:     true,
    });
  }
  return _pool;
}

/**
 * Run a parameterised query.
 * Usage: const [rows] = await query('SELECT * FROM events WHERE id = ?', [id]);
 */
async function query(sql, params = []) {
  const pool = getPool();
  return pool.execute(sql, params);
}

/**
 * Verify the connection on startup and log the result.
 * Called once from server.js — non-fatal if it fails.
 */
async function testConnection() {
  const [rows] = await query('SELECT VERSION() AS v');
  return rows[0].v;
}

module.exports = { getPool, query, testConnection };
