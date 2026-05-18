/**
 * migrate.js — One-time migration: JSON project files → Azure SQL [statelogic]
 *
 * Run once:  node migrate.js
 * Safe to re-run — uses MERGE (upsert) so existing rows are updated.
 */
'use strict';
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { getPool, ensureSchema, sql } = require('./azureDb');

const DATA_DIR      = process.env.DATA_DIR      || path.join(__dirname, 'projects');
const STANDARDS_DIR = process.env.STANDARDS_DIR || path.join(__dirname, 'standards');
const STANDARDS_FILE = path.join(STANDARDS_DIR, 'standards.json');

async function main() {
  console.log('=== State Logic Builder → Azure SQL migration ===');
  const pool = await getPool();
  await ensureSchema();

  // ── Projects ──────────────────────────────────────────────────────────────
  const files = fs.existsSync(DATA_DIR)
    ? fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'))
    : [];
  console.log(`\nMigrating ${files.length} project file(s) from ${DATA_DIR}…`);

  let ok = 0, fail = 0;
  for (const filename of files) {
    try {
      const fp   = path.join(DATA_DIR, filename);
      const raw  = fs.readFileSync(fp, 'utf8');
      const data = JSON.parse(raw);
      const stat = fs.statSync(fp);

      const req = pool.request();
      req.input('filename',      sql.NVarChar(200),     filename);
      req.input('name',          sql.NVarChar(500),     data.name || filename.replace('.json', ''));
      req.input('data',          sql.NVarChar(sql.MAX), raw);
      req.input('sm_count',      sql.Int,               Array.isArray(data.stateMachines) ? data.stateMachines.length : 0);
      req.input('last_modified', sql.BigInt,            Math.round(stat.mtimeMs));
      await req.query(`
        MERGE [statelogic].[projects] AS target
        USING (SELECT @filename AS filename) AS src ON target.filename = src.filename
        WHEN MATCHED THEN UPDATE SET
          name=@name, data=@data, sm_count=@sm_count,
          last_modified=@last_modified, updated_at=GETUTCDATE()
        WHEN NOT MATCHED THEN INSERT
          (filename, name, data, sm_count, last_modified)
        VALUES (@filename, @name, @data, @sm_count, @last_modified);
      `);
      ok++;
    } catch (e) {
      fail++;
      console.warn(`  [projects] ${filename} failed: ${e.message}`);
    }
  }
  console.log(`  Projects: ${ok} migrated, ${fail} failed.`);

  // ── Standards ─────────────────────────────────────────────────────────────
  let standards = [];
  try {
    if (fs.existsSync(STANDARDS_FILE)) {
      standards = JSON.parse(fs.readFileSync(STANDARDS_FILE, 'utf8'));
      if (!Array.isArray(standards)) standards = [];
    }
  } catch (e) {
    console.warn(`  Could not read standards: ${e.message}`);
  }

  console.log(`\nMigrating ${standards.length} standard(s)…`);
  let sok = 0, sfail = 0;
  for (const s of standards) {
    if (!s?.id) { sfail++; continue; }
    try {
      const req = pool.request();
      req.input('id',   sql.NVarChar(200),     s.id);
      req.input('data', sql.NVarChar(sql.MAX), JSON.stringify(s));
      await req.query(`
        MERGE [statelogic].[standards] AS target
        USING (SELECT @id AS id) AS src ON target.id = src.id
        WHEN MATCHED THEN UPDATE SET data=@data, updated_at=GETUTCDATE()
        WHEN NOT MATCHED THEN INSERT (id, data) VALUES (@id, @data);
      `);
      sok++;
    } catch (e) {
      sfail++;
      console.warn(`  [standards] ${s.id} failed: ${e.message}`);
    }
  }
  console.log(`  Standards: ${sok} migrated, ${sfail} failed.`);

  console.log('\n✅ Migration complete.');
  console.log('   Projects and standards are now in Azure SQL [statelogic] schema.');
  console.log('   The local JSON files in projects/ and standards/ remain as backups.');
  process.exit(0);
}

main().catch(e => { console.error('Migration failed:', e.message); process.exit(1); });
