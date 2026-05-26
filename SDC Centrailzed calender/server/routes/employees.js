/**
 * server/routes/employees.js
 * REST API for the [calendar].[employees] table.
 *
 * GET    /api/employees          — list all employees
 * POST   /api/employees          — add one employee (admin only)
 * PUT    /api/employees/:id      — update an employee (admin only)
 * DELETE /api/employees/:id      — delete an employee (admin only)
 * POST   /api/employees/seed     — bulk-insert DEFAULT_EMPLOYEES (admin only, only when table is empty)
 */

const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { getPool, sql } = require('../azureDb');

const router = express.Router();

// ── GET /api/employees — public read so frontend can load directory without auth ──
router.get('/', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT id, name, role, email, birth_month, birth_day, phone, department
      FROM [calendar].[employees]
      ORDER BY name ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error('[employees] GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/employees/seed — bulk insert DEFAULT_EMPLOYEES (only when table is empty) ──
// Must be declared before /:id routes so Express matches it first
router.post('/seed', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  const employees = req.body; // array of employee objects from frontend DEFAULT_EMPLOYEES
  if (!Array.isArray(employees) || employees.length === 0) {
    return res.status(400).json({ error: 'employees array required in body' });
  }

  try {
    const pool = await getPool();

    // Only seed when the table is truly empty
    const countResult = await pool.request().query(`SELECT COUNT(*) AS cnt FROM [calendar].[employees]`);
    const count = countResult.recordset[0].cnt;
    if (count > 0) {
      // Return current employees instead of re-seeding
      const current = await pool.request().query(`SELECT id, name, role, email, birth_month, birth_day FROM [calendar].[employees] ORDER BY name ASC`);
      return res.json(current.recordset);
    }

    // Insert each employee
    for (const emp of employees) {
      const r = pool.request();
      r.input('id',          sql.NVarChar(50),  emp.id || String(Date.now() + Math.random()));
      r.input('name',        sql.NVarChar(255), emp.name || '');
      r.input('role',        sql.NVarChar(255), emp.role || '');
      r.input('email',       sql.NVarChar(255), emp.email || null);
      r.input('birth_month', sql.Int,           emp.bMonth || emp.birth_month || null);
      r.input('birth_day',   sql.Int,           emp.bDay   || emp.birth_day   || null);
      r.input('phone',       sql.NVarChar(50),  emp.phone  || null);
      r.input('department',  sql.NVarChar(255), emp.department || null);
      await r.query(`
        INSERT INTO [calendar].[employees] (id, name, role, email, birth_month, birth_day, phone, department)
        VALUES (@id, @name, @role, @email, @birth_month, @birth_day, @phone, @department)
      `);
    }

    // Return the full list
    const result = await pool.request().query(`SELECT id, name, role, email, birth_month, birth_day FROM [calendar].[employees] ORDER BY name ASC`);
    console.log(`[employees] Seeded ${result.recordset.length} employees.`);
    res.status(201).json(result.recordset);
  } catch (err) {
    console.error('[employees] seed error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/employees — add one employee ──
router.post('/', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'hr') {
    return res.status(403).json({ error: 'Admin or HR access required' });
  }
  try {
    const pool = await getPool();
    const emp = req.body;
    const id = emp.id || `emp-${Date.now()}`;
    const r = pool.request();
    r.input('id',          sql.NVarChar(50),  id);
    r.input('name',        sql.NVarChar(255), emp.name || '');
    r.input('role',        sql.NVarChar(255), emp.role || '');
    r.input('email',       sql.NVarChar(255), emp.email || null);
    r.input('birth_month', sql.Int,           emp.bMonth || emp.birth_month || null);
    r.input('birth_day',   sql.Int,           emp.bDay   || emp.birth_day   || null);
    r.input('phone',       sql.NVarChar(50),  emp.phone  || null);
    r.input('department',  sql.NVarChar(255), emp.department || null);
    await r.query(`
      INSERT INTO [calendar].[employees] (id, name, role, email, birth_month, birth_day, phone, department)
      VALUES (@id, @name, @role, @email, @birth_month, @birth_day, @phone, @department)
    `);
    res.status(201).json({ ...emp, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/employees/:id — update an employee ──
router.put('/:id', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'hr') {
    return res.status(403).json({ error: 'Admin or HR access required' });
  }
  try {
    const pool = await getPool();
    const emp = req.body;
    const r = pool.request();
    r.input('id',          sql.NVarChar(50),  req.params.id);
    r.input('name',        sql.NVarChar(255), emp.name || '');
    r.input('role',        sql.NVarChar(255), emp.role || '');
    r.input('email',       sql.NVarChar(255), emp.email || null);
    r.input('birth_month', sql.Int,           emp.bMonth || emp.birth_month || null);
    r.input('birth_day',   sql.Int,           emp.bDay   || emp.birth_day   || null);
    r.input('phone',       sql.NVarChar(50),  emp.phone  || null);
    r.input('department',  sql.NVarChar(255), emp.department || null);
    await r.query(`
      UPDATE [calendar].[employees]
      SET name=@name, role=@role, email=@email, birth_month=@birth_month,
          birth_day=@birth_day, phone=@phone, department=@department
      WHERE id=@id
    `);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/employees/:id ──
router.delete('/:id', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    const pool = await getPool();
    const r = pool.request();
    r.input('id', sql.NVarChar(50), req.params.id);
    await r.query(`DELETE FROM [calendar].[employees] WHERE id=@id`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
