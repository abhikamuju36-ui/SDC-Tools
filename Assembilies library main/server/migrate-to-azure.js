/**
 * migrate-to-azure.js — One-time migration: Assemblies SQLite → Azure SQL [assemblies]
 *
 * Run once:  node server/migrate-to-azure.js
 * Safe to re-run — uses MERGE (upsert) so rows are updated, not duplicated.
 *
 * SQLite lives on N: drive: N:/_Assembilies_Library_Application/assemblies.db
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const Database = require('better-sqlite3');
const { getPool, ensureSchema, sql } = require('./azureDb');
const config = require('./config/paths');

const BATCH = 200;  // rows per bulk operation

async function bulkUpsert(pool, rows) {
  // Build a Table object for bulk insert via MERGE
  for (const r of rows) {
    const req = pool.request();
    req.input('id',           sql.Int,           r.id);
    req.input('job_id',       sql.NVarChar(200),  r.job_id        ?? null);
    req.input('job_name',     sql.NVarChar(500),  r.job_name      ?? null);
    req.input('file_name',    sql.NVarChar(500),  r.file_name     ?? null);
    req.input('partno',       sql.NVarChar(200),  r.partno        ?? null);
    req.input('description',  sql.NVarChar(sql.MAX), r.description ?? null);
    req.input('category',     sql.NVarChar(200),  r.category      ?? null);
    req.input('comments',     sql.NVarChar(sql.MAX), r.comments    ?? null);
    req.input('updated_by',   sql.NVarChar(200),  r.updated_by    ?? null);
    req.input('created_at',   sql.NVarChar(50),   r.created_at    ?? null);
    req.input('updated_at',   sql.NVarChar(50),   r.updated_at    ?? null);
    req.input('model_link',   sql.NVarChar(sql.MAX), r.model_link  ?? null);
    req.input('picture_link', sql.NVarChar(sql.MAX), r.picture_link ?? null);
    req.input('preference',   sql.NVarChar(200),  r.preference    ?? null);
    req.input('sdc_standard', sql.NVarChar(200),  r.sdc_standard  ?? null);
    req.input('library',      sql.NVarChar(200),  r.library       ?? null);
    req.input('status',       sql.NVarChar(50),   r.status        ?? 'Active');
    req.input('deleted_at',   sql.NVarChar(50),   r.deleted_at    ?? null);
    await req.query(`
      MERGE [assemblies].[assemblies] AS target
      USING (SELECT @id AS id) AS src ON target.id = src.id
      WHEN MATCHED THEN UPDATE SET
        job_id=@job_id, job_name=@job_name, file_name=@file_name, partno=@partno,
        description=@description, category=@category, comments=@comments,
        updated_by=@updated_by, created_at=@created_at, updated_at=@updated_at,
        model_link=@model_link, picture_link=@picture_link, preference=@preference,
        sdc_standard=@sdc_standard, library=@library, status=@status, deleted_at=@deleted_at
      WHEN NOT MATCHED THEN INSERT
        (id,job_id,job_name,file_name,partno,description,category,comments,
         updated_by,created_at,updated_at,model_link,picture_link,preference,
         sdc_standard,library,status,deleted_at)
      VALUES
        (@id,@job_id,@job_name,@file_name,@partno,@description,@category,@comments,
         @updated_by,@created_at,@updated_at,@model_link,@picture_link,@preference,
         @sdc_standard,@library,@status,@deleted_at);
    `);
  }
}

async function main() {
  console.log('=== Assemblies Library → Azure SQL migration ===');
  console.log(`SQLite source: ${config.SQLITE_PATH}`);

  // Open SQLite
  const sqlite = new Database(config.SQLITE_PATH, { readonly: true });
  const total = sqlite.prepare('SELECT COUNT(*) AS n FROM assemblies').get().n;
  console.log(`Total records: ${total}`);

  // Connect and ensure schema
  const pool = await getPool();
  await ensureSchema();

  // Migrate in batches
  let offset = 0;
  let ok = 0, fail = 0;
  while (offset < total) {
    const rows = sqlite.prepare(
      'SELECT id,job_id,job_name,file_name,partno,description,category,comments,' +
      'updated_by,created_at,updated_at,model_link,picture_link,preference,' +
      'sdc_standard,library,status,deleted_at FROM assemblies LIMIT ? OFFSET ?'
    ).all(BATCH, offset);

    if (rows.length === 0) break;

    try {
      await bulkUpsert(pool, rows);
      ok += rows.length;
    } catch (e) {
      fail += rows.length;
      console.warn(`  Batch at offset ${offset} failed: ${e.message}`);
    }

    offset += rows.length;
    process.stdout.write(`\r  Progress: ${ok}/${total} upserted, ${fail} failed   `);
  }

  console.log(`\n\n✅ Done. ${ok} assemblies migrated to Azure SQL [assemblies].[assemblies].`);
  if (fail > 0) console.warn(`⚠️  ${fail} records failed — check logs above.`);
  console.log('   The app continues to use the N: drive SQLite as primary storage.');
  console.log('   Re-run this script anytime to refresh the Azure SQL copy.');

  sqlite.close();
  process.exit(0);
}

main().catch(e => { console.error('Migration failed:', e.message); process.exit(1); });
