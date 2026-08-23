/**
 * db.js — Users & Roles data layer (MySQL edition).
 *
 * Exports the same API as the original NeDB/Azure SQL versions so auth.js
 * and routes/admin.js work without any changes.
 *
 * Tables: sdc_calendar.users, sdc_calendar.roles
 */

const crypto = require('crypto');
const { query } = require('./mysqlDb');

function newId() {
  return crypto.randomBytes(8).toString('base64url');
}

// Map a raw users row to the { _id, ... } shape the rest of the app expects
function toUser(row) {
  if (!row) return null;
  return {
    _id:        row.id,
    email:      row.email,
    name:       row.name,
    role:       row.role,
    created_at: row.created_at,
    last_login: row.last_login,
  };
}

// Map a raw roles row — categories stored as CSV, returned as array
function toRole(row) {
  if (!row) return null;
  return {
    role:       row.role,
    label:      row.label,
    categories: row.categories ? row.categories.split(',') : [],
  };
}

const db = {
  users: {
    findByEmail: async (email) => {
      const [rows] = await query(
        'SELECT * FROM users WHERE email = ?',
        [email.toLowerCase()]
      );
      return toUser(rows[0]);
    },

    findById: async (id) => {
      const [rows] = await query('SELECT * FROM users WHERE id = ?', [id]);
      return toUser(rows[0]);
    },

    findAll: async () => {
      const [rows] = await query('SELECT * FROM users ORDER BY name ASC');
      return rows.map(toUser);
    },

    upsert: async (email, name) => {
      const lowerEmail = email.toLowerCase();
      const now = new Date();

      // Try update first
      const [upd] = await query(
        'UPDATE users SET name = ?, last_login = ? WHERE email = ?',
        [name, now, lowerEmail]
      );

      if (upd.affectedRows > 0) {
        const [rows] = await query('SELECT * FROM users WHERE email = ?', [lowerEmail]);
        return toUser(rows[0]);
      }

      // Not found — insert with default employee role
      const id = newId();
      await query(
        'INSERT INTO users (id, email, name, role, created_at, last_login) VALUES (?, ?, ?, ?, ?, ?)',
        [id, lowerEmail, name, 'employee', now, now]
      );
      const [rows] = await query('SELECT * FROM users WHERE id = ?', [id]);
      return toUser(rows[0]);
    },

    setRole: async (id, role) => {
      await query('UPDATE users SET role = ? WHERE id = ?', [role, id]);
    },

    delete: async (id) => {
      await query('DELETE FROM users WHERE id = ?', [id]);
    },
  },

  roles: {
    findAll: async () => {
      const [rows] = await query('SELECT * FROM roles ORDER BY role ASC');
      return rows.map(toRole);
    },

    findByRole: async (role) => {
      const [rows] = await query('SELECT * FROM roles WHERE role = ?', [role]);
      return toRole(rows[0]);
    },

    updateCategories: async (role, categories) => {
      await query(
        'UPDATE roles SET categories = ? WHERE role = ?',
        [categories.join(','), role]
      );
    },
  },
};

module.exports = db;
