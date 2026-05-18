/**
 * migrate.js — One-time migration: SQLite + NeDB → Azure SQL
 *
 * Run ONCE after setting up the Azure SQL database:
 *   node migrate.js
 *
 * Safe to re-run — uses INSERT IF NOT EXISTS for events and MERGE for users/roles.
 */

require('dotenv').config();
const path    = require('path');
const sqlite3 = require('sqlite3').verbose();
const Datastore = require('@seald-io/nedb');
const { ensureSchema, request, sql } = require('./azureDb');

// ── Source paths ──────────────────────────────────────────────────────────────
const EVENTS_DB = path.join(__dirname, 'events.sqlite');
const USERS_DB  = path.join(__dirname, 'users.db');
const ROLES_DB  = path.join(__dirname, 'roles.db');

// ── Helpers ───────────────────────────────────────────────────────────────────
function readSqliteAll(dbPath, query) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, err => {
      if (err) return reject(err);
    });
    db.all(query, [], (err, rows) => {
      db.close();
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function readNedb(dbPath) {
  return new Promise((resolve, reject) => {
    const store = new Datastore({ filename: dbPath, autoload: true });
    store.find({}, (err, docs) => err ? reject(err) : resolve(docs));
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function migrate() {
  console.log('=== SDC Calendar → Azure SQL Migration ===\n');

  await ensureSchema();

  // ── 1. Events ─────────────────────────────────────────────────────────────
  console.log('Reading events from SQLite...');
  let events = [];
  try {
    events = await readSqliteAll(EVENTS_DB, 'SELECT * FROM events');
    console.log(`  Found ${events.length} events.`);
  } catch (e) {
    console.warn('  Could not read events.sqlite:', e.message, '— skipping events.');
  }

  let evInserted = 0, evSkipped = 0;
  for (const ev of events) {
    const r = await request();
    r.input('id', sql.NVarChar(50), ev.id);
    const exists = await r.query(`SELECT 1 FROM [calendar].[events] WHERE id=@id`);
    if (exists.recordset.length > 0) { evSkipped++; continue; }

    const ins = await request();
    ins.input('id',           sql.NVarChar(50),  ev.id);
    ins.input('title',        sql.NVarChar(500), ev.title);
    ins.input('date',         sql.NVarChar(20),  ev.date);
    ins.input('endDate',      sql.NVarChar(20),  ev.endDate   || null);
    ins.input('category',     sql.NVarChar(50),  ev.category);
    ins.input('allDay',       sql.Bit,           ev.allDay ? 1 : 0);
    ins.input('time',         sql.NVarChar(10),  ev.time      || null);
    ins.input('endTime',      sql.NVarChar(10),  ev.endTime   || null);
    ins.input('location',     sql.NVarChar(500), ev.location  || null);
    ins.input('description',  sql.NVarChar(sql.MAX), ev.description || null);
    ins.input('repeat',       sql.NVarChar(20),  ev.repeat    || 'none');
    ins.input('notify',       sql.Int,           ev.notify    || null);
    ins.input('pinned',       sql.Bit,           ev.pinned ? 1 : 0);
    ins.input('creatorEmail', sql.NVarChar(255), ev.creatorEmail || null);
    ins.input('creatorName',  sql.NVarChar(255), ev.creatorName  || null);
    ins.input('approved',     sql.Bit,           ev.approved ? 1 : 0);
    await ins.query(`
      INSERT INTO [calendar].[events]
        (id,title,date,endDate,category,allDay,time,endTime,location,description,
         repeat,notify,pinned,creatorEmail,creatorName,approved)
      VALUES
        (@id,@title,@date,@endDate,@category,@allDay,@time,@endTime,@location,@description,
         @repeat,@notify,@pinned,@creatorEmail,@creatorName,@approved)
    `);
    evInserted++;
  }
  console.log(`  Events — inserted: ${evInserted}, already existed: ${evSkipped}\n`);

  // ── 2. Users ──────────────────────────────────────────────────────────────
  console.log('Reading users from NeDB...');
  let users = [];
  try {
    users = await readNedb(USERS_DB);
    console.log(`  Found ${users.length} users.`);
  } catch (e) {
    console.warn('  Could not read users.db:', e.message, '— skipping users.');
  }

  let usrInserted = 0, usrSkipped = 0;
  for (const u of users) {
    const r = await request();
    r.input('id', sql.NVarChar(50), u._id);
    const exists = await r.query(`SELECT 1 FROM [calendar].[users] WHERE id=@id`);
    if (exists.recordset.length > 0) { usrSkipped++; continue; }

    const ins = await request();
    ins.input('id',         sql.NVarChar(50),  u._id);
    ins.input('email',      sql.NVarChar(255), u.email.toLowerCase());
    ins.input('name',       sql.NVarChar(255), u.name  || u.email);
    ins.input('role',       sql.NVarChar(50),  u.role  || 'employee');
    ins.input('created_at', sql.DateTime2,     u.created_at ? new Date(u.created_at) : new Date());
    ins.input('last_login', sql.DateTime2,     u.last_login ? new Date(u.last_login) : null);
    await ins.query(`
      INSERT INTO [calendar].[users] (id,email,name,role,created_at,last_login)
      VALUES (@id,@email,@name,@role,@created_at,@last_login)
    `);
    usrInserted++;
  }
  console.log(`  Users — inserted: ${usrInserted}, already existed: ${usrSkipped}\n`);

  // ── 3. Roles ──────────────────────────────────────────────────────────────
  console.log('Reading roles from NeDB...');
  let roles = [];
  try {
    roles = await readNedb(ROLES_DB);
    console.log(`  Found ${roles.length} roles.`);
  } catch (e) {
    console.warn('  Could not read roles.db:', e.message, '— skipping roles.');
  }

  let rolUpdated = 0;
  for (const role of roles) {
    const cats = Array.isArray(role.categories) ? role.categories.join(',') : (role.categories || '');
    const r = await request();
    r.input('role',       sql.NVarChar(50),  role.role);
    r.input('categories', sql.NVarChar(500), cats);
    r.input('label',      sql.NVarChar(100), role.label || role.role);
    await r.query(`
      MERGE [calendar].[roles] AS target
      USING (SELECT @role AS role) AS source ON target.role = source.role
      WHEN MATCHED     THEN UPDATE SET categories=@categories, label=@label
      WHEN NOT MATCHED THEN INSERT (role,categories,label) VALUES (@role,@categories,@label);
    `);
    rolUpdated++;
  }
  console.log(`  Roles — upserted: ${rolUpdated}\n`);

  console.log('=== Migration complete! ===');
  process.exit(0);
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
