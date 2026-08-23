/**
 * migrate-to-mysql.js — one-time import of local JSON files into MySQL.
 *
 * The app ran on its local-JSON fallback while Azure SQL was unreachable, so
 * the files on disk are the current source of truth. This imports them into
 * the `sdc_statelogic` MySQL database (creating it + the tables if needed).
 *
 * Idempotent: uses upsert, so re-running re-syncs from files without dupes.
 *
 *   node migrate-to-mysql.js
 *
 * Sources (same resolution as server.js):
 *   projects   — DATA_DIR    (default ./projects)        -> projects table
 *   standards  — STANDARDS_DIR/standards.json            -> standards table
 */
'use strict';
const fs   = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { getPool, ensureSchema, DB_NAME } = require('./mysqlDb');

const DATA_DIR      = process.env.DATA_DIR      || path.join(__dirname, 'projects');
const STANDARDS_DIR = process.env.STANDARDS_DIR || path.join(__dirname, 'standards');
const STANDARDS_FILE = path.join(STANDARDS_DIR, 'standards.json');

(async () => {
  await ensureSchema();
  const pool = getPool();

  // ── Projects ────────────────────────────────────────────────────────────
  let projCount = 0;
  if (fs.existsSync(DATA_DIR)) {
    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
    for (const filename of files) {
      const fp = path.join(DATA_DIR, filename);
      let body;
      try { body = fs.readFileSync(fp, 'utf8'); JSON.parse(body); }
      catch (e) { console.warn(`  skip ${filename}: ${e.message}`); continue; }
      const data    = JSON.parse(body);
      const name    = data.name || filename.replace('.json', '');
      const smCount = Array.isArray(data.stateMachines) ? data.stateMachines.length : 0;
      const lastMod = fs.statSync(fp).mtimeMs;
      await pool.query(`
        INSERT INTO projects (filename, name, data, sm_count, last_modified)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          name=VALUES(name), data=VALUES(data), sm_count=VALUES(sm_count), last_modified=VALUES(last_modified)
      `, [filename, name, body, smCount, Math.round(lastMod)]);
      projCount++;
      console.log(`  project: ${filename} (${smCount} SMs, ${body.length} bytes)`);
    }
  }

  // ── Standards ───────────────────────────────────────────────────────────
  let stdCount = 0;
  if (fs.existsSync(STANDARDS_FILE)) {
    let arr = [];
    try { arr = JSON.parse(fs.readFileSync(STANDARDS_FILE, 'utf8')); }
    catch (e) { console.warn(`  standards.json parse failed: ${e.message}`); }
    if (Array.isArray(arr)) {
      for (const s of arr) {
        if (!s?.id) continue;
        await pool.query(
          'INSERT INTO standards (id, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data=VALUES(data)',
          [s.id, JSON.stringify(s)]
        );
        stdCount++;
      }
    }
  } else {
    console.warn(`  standards file not found at ${STANDARDS_FILE}`);
  }

  const [[p]] = await pool.query('SELECT COUNT(*) AS n FROM projects');
  const [[s]] = await pool.query('SELECT COUNT(*) AS n FROM standards');
  console.log(`\nImported into ${DB_NAME}: ${projCount} project files, ${stdCount} standards.`);
  console.log(`Table totals now: projects=${p.n}, standards=${s.n}.`);
  process.exit(0);
})().catch(e => { console.error('Migration failed:', e.message); process.exit(1); });
