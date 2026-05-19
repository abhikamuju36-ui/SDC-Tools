/**
 * sync-sqlite-to-azure.js
 * Clears [assemblies].[assemblies] in Azure SQL, then loads all records
 * from the N:-drive SQLite database as a fresh INSERT.
 *
 * Usage:  node server/sync-sqlite-to-azure.js
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const Database = require('better-sqlite3');
const azureDb  = require('./azureDb');
const config   = require('./config/paths');

const SQLITE_PATH = config.SQLITE_PATH;   // N:/_Assembilies_Library_Application/assemblies.db
const BATCH       = 100;                  // rows per Azure transaction

async function main() {
  console.log(`\n[sync] Opening SQLite: ${SQLITE_PATH}`);
  const sqlite = new Database(SQLITE_PATH, { readonly: true });

  const rows = sqlite.prepare(`
    SELECT id, job_id, job_name, file_name, partno, description, category,
           comments, updated_by, created_at, updated_at, model_link,
           picture_link, preference, sdc_standard, library, status,
           thumbnail, path, last_modified, size, deleted_at
    FROM assemblies
  `).all();
  sqlite.close();

  console.log(`[sync] SQLite records loaded: ${rows.length}`);

  // ── Step 1: Clear Azure SQL table ────────────────────────────────────────
  console.log('[sync] Clearing [assemblies].[assemblies] in Azure SQL...');
  const rDel = await azureDb.request();
  await rDel.query('DELETE FROM [assemblies].[assemblies]');
  console.log('[sync] Table cleared.');

  // ── Step 2: Batch INSERT all rows ────────────────────────────────────────
  let inserted = 0, failed = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    try {
      for (const row of batch) {
        const r = await azureDb.request();
        r.input('id',           azureDb.sql.Int,                     row.id);
        r.input('job_id',       azureDb.sql.NVarChar(50),            row.job_id        || '');
        r.input('job_name',     azureDb.sql.NVarChar(255),           row.job_name      || '');
        r.input('file_name',    azureDb.sql.NVarChar(500),           row.file_name     || '');
        r.input('partno',       azureDb.sql.NVarChar(500),           row.partno        || '');
        r.input('description',  azureDb.sql.NVarChar(500),           row.description   || '');
        r.input('category',     azureDb.sql.NVarChar(100),           row.category      || '');
        r.input('comments',     azureDb.sql.NVarChar(azureDb.sql.MAX), row.comments   || '');
        r.input('updated_by',   azureDb.sql.NVarChar(255),           row.updated_by    || '');
        r.input('created_at',   azureDb.sql.NVarChar(50),            row.created_at    || null);
        r.input('updated_at',   azureDb.sql.NVarChar(50),            row.updated_at    || null);
        r.input('model_link',   azureDb.sql.NVarChar(azureDb.sql.MAX), row.model_link  || '');
        r.input('picture_link', azureDb.sql.NVarChar(azureDb.sql.MAX), row.picture_link || '');
        r.input('preference',   azureDb.sql.NVarChar(20),            row.preference    || 'No');
        r.input('sdc_standard', azureDb.sql.NVarChar(20),            row.sdc_standard  || 'No');
        r.input('library',      azureDb.sql.NVarChar(50),            row.library       || null);
        r.input('status',       azureDb.sql.NVarChar(20),            row.status        || 'Active');
        r.input('thumbnail',    azureDb.sql.NVarChar(500),           row.thumbnail     || null);
        r.input('path',         azureDb.sql.NVarChar(azureDb.sql.MAX), row.path        || null);
        r.input('last_modified',azureDb.sql.NVarChar(50),            row.last_modified || null);
        r.input('size',         azureDb.sql.BigInt,                   row.size          || null);
        r.input('deleted_at',   azureDb.sql.NVarChar(50),            row.deleted_at    || null);

        await r.query(`
          INSERT INTO [assemblies].[assemblies]
            (id, job_id, job_name, file_name, partno, description, category, comments,
             updated_by, created_at, updated_at, model_link, picture_link,
             preference, sdc_standard, library, status, thumbnail, path,
             last_modified, size, deleted_at)
          VALUES
            (@id, @job_id, @job_name, @file_name, @partno, @description, @category, @comments,
             @updated_by, @created_at, @updated_at, @model_link, @picture_link,
             @preference, @sdc_standard, @library, @status, @thumbnail, @path,
             @last_modified, @size, @deleted_at)
        `);
        inserted++;
      }
      process.stdout.write(`\r[sync] ${inserted} / ${rows.length} inserted...`);
    } catch (err) {
      console.error(`\n[sync] Batch error at row ${i}: ${err.message}`);
      failed += batch.length;
    }
  }

  // ── Step 3: Verify count in Azure SQL ────────────────────────────────────
  const r2 = await azureDb.request();
  const result = await r2.query('SELECT COUNT(*) AS total FROM [assemblies].[assemblies]');
  const azureTotal = result.recordset[0].total;

  console.log(`\n\n[sync] Done.`);
  console.log(`  SQLite source:  ${rows.length} records`);
  console.log(`  Azure SQL now:  ${azureTotal} records`);
  console.log(`  Inserted:       ${inserted}`);
  console.log(`  Failed:         ${failed}`);

  if (azureTotal !== rows.length) {
    console.warn(`[sync] WARNING: count mismatch — SQLite ${rows.length} vs Azure ${azureTotal}`);
  } else {
    console.log(`[sync] Record counts match.`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('[sync] Fatal:', err.message);
  process.exit(1);
});
