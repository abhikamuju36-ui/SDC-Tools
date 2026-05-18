/**
 * db.js — Users & Roles data layer (Azure SQL edition).
 *
 * Exports the same API as the original NeDB version so auth.js and
 * routes/admin.js work without any changes.
 *
 * Tables: [calendar].[users], [calendar].[roles]
 *
 * Note: NeDB used hash-string _id fields; we preserve that shape by
 * storing user IDs as NVARCHAR(50) and returning { _id, email, ... }
 * so JWT tokens and existing session references still work.
 */

const { request, sql } = require('./azureDb');
const crypto = require('crypto');

// Generate a short random ID matching NeDB's style
function newId() {
  return crypto.randomBytes(8).toString('base64url');
}

const db = {
  users: {
    findByEmail: async (email) => {
      const r = await request();
      r.input('email', sql.NVarChar(255), email.toLowerCase());
      const res = await r.query(
        `SELECT id AS _id, email, name, role, created_at, last_login
         FROM [calendar].[users] WHERE email=@email`
      );
      return res.recordset[0] || null;
    },

    findById: async (id) => {
      const r = await request();
      r.input('id', sql.NVarChar(50), id);
      const res = await r.query(
        `SELECT id AS _id, email, name, role, created_at, last_login
         FROM [calendar].[users] WHERE id=@id`
      );
      return res.recordset[0] || null;
    },

    findAll: async () => {
      const r = await request();
      const res = await r.query(
        `SELECT id AS _id, email, name, role, created_at, last_login
         FROM [calendar].[users] ORDER BY name`
      );
      return res.recordset;
    },

    upsert: async (email, name) => {
      const lowerEmail = email.toLowerCase();
      // Try update first
      const upd = await request();
      upd.input('email',      sql.NVarChar(255), lowerEmail);
      upd.input('name',       sql.NVarChar(255), name);
      upd.input('last_login', sql.DateTime2,     new Date());
      const updRes = await upd.query(`
        UPDATE [calendar].[users]
        SET name=@name, last_login=@last_login
        OUTPUT INSERTED.id AS _id, INSERTED.email, INSERTED.name,
               INSERTED.role, INSERTED.created_at, INSERTED.last_login
        WHERE email=@email
      `);
      if (updRes.recordset.length > 0) return updRes.recordset[0];

      // Not found — insert with default employee role
      const id = newId();
      const ins = await request();
      ins.input('id',         sql.NVarChar(50),  id);
      ins.input('email',      sql.NVarChar(255), lowerEmail);
      ins.input('name',       sql.NVarChar(255), name);
      ins.input('role',       sql.NVarChar(50),  'employee');
      ins.input('created_at', sql.DateTime2,     new Date());
      ins.input('last_login', sql.DateTime2,     new Date());
      const insRes = await ins.query(`
        INSERT INTO [calendar].[users] (id, email, name, role, created_at, last_login)
        OUTPUT INSERTED.id AS _id, INSERTED.email, INSERTED.name,
               INSERTED.role, INSERTED.created_at, INSERTED.last_login
        VALUES (@id, @email, @name, @role, @created_at, @last_login)
      `);
      return insRes.recordset[0];
    },

    setRole: async (id, role) => {
      const r = await request();
      r.input('id',   sql.NVarChar(50), id);
      r.input('role', sql.NVarChar(50), role);
      await r.query(`UPDATE [calendar].[users] SET role=@role WHERE id=@id`);
    },

    delete: async (id) => {
      const r = await request();
      r.input('id', sql.NVarChar(50), id);
      await r.query(`DELETE FROM [calendar].[users] WHERE id=@id`);
    },
  },

  roles: {
    findAll: async () => {
      const r = await request();
      const res = await r.query(
        `SELECT role, categories, label FROM [calendar].[roles] ORDER BY role`
      );
      return res.recordset.map(row => ({
        ...row,
        categories: row.categories ? row.categories.split(',') : [],
      }));
    },

    findByRole: async (role) => {
      const r = await request();
      r.input('role', sql.NVarChar(50), role);
      const res = await r.query(
        `SELECT role, categories, label FROM [calendar].[roles] WHERE role=@role`
      );
      const row = res.recordset[0];
      if (!row) return null;
      return { ...row, categories: row.categories ? row.categories.split(',') : [] };
    },

    updateCategories: async (role, categories) => {
      const r = await request();
      r.input('role',       sql.NVarChar(50),  role);
      r.input('categories', sql.NVarChar(500), categories.join(','));
      await r.query(
        `UPDATE [calendar].[roles] SET categories=@categories WHERE role=@role`
      );
    },
  },
};

module.exports = db;
