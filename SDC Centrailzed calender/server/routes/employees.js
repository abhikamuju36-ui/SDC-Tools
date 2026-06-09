/**
 * server/routes/employees.js
 * REST API for the sdc_calendar.employees table (MySQL edition).
 *
 * GET    /api/employees        — list all (public)
 * POST   /api/employees/seed   — bulk-insert DEFAULT_EMPLOYEES (admin, only when empty)
 * POST   /api/employees        — add one (admin or hr)
 * PUT    /api/employees/:id    — update one (admin or hr)
 * DELETE /api/employees/:id    — delete one (admin)
 */

const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { query } = require('../mysqlDb');

const router = express.Router();

function toEmp(row) {
  return {
    id:          row.id,
    name:        row.name,
    role:        row.job_title,    // frontend calls this field "role"
    email:       row.email,
    birth_month: row.birth_month,
    birth_day:   row.birth_day,
    phone:       row.phone,
    department:  row.department,
  };
}

// GET /api/employees — public read
router.get('/', async (_req, res) => {
  try {
    const [rows] = await query('SELECT * FROM employees ORDER BY name ASC');
    res.json(rows.map(toEmp));
  } catch (err) {
    console.error('[employees] GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/employees/seed — bulk-insert only when table is empty
router.post('/seed', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  const employees = req.body;
  if (!Array.isArray(employees) || employees.length === 0) {
    return res.status(400).json({ error: 'employees array required in body' });
  }

  try {
    const [[{ cnt }]] = await query('SELECT COUNT(*) AS cnt FROM employees');
    if (cnt > 0) {
      const [rows] = await query('SELECT * FROM employees ORDER BY name ASC');
      return res.json(rows.map(toEmp));
    }

    for (const emp of employees) {
      const id = emp.id || `emp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await query(
        `INSERT INTO employees (id, name, job_title, email, birth_month, birth_day, phone, department)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          emp.name        || '',
          emp.role        || null,   // frontend sends "role" meaning job title
          emp.email       || null,
          emp.bMonth      || emp.birth_month || null,
          emp.bDay        || emp.birth_day   || null,
          emp.phone       || null,
          emp.department  || null,
        ]
      );
    }

    const [rows] = await query('SELECT * FROM employees ORDER BY name ASC');
    console.log(`[employees] Seeded ${rows.length} employees.`);
    res.status(201).json(rows.map(toEmp));
  } catch (err) {
    console.error('[employees] seed error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/employees — add one
router.post('/', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'hr') {
    return res.status(403).json({ error: 'Admin or HR access required' });
  }
  try {
    const emp = req.body;
    const id = emp.id || `emp-${Date.now()}`;
    await query(
      `INSERT INTO employees (id, name, job_title, email, birth_month, birth_day, phone, department)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        emp.name        || '',
        emp.role        || null,
        emp.email       || null,
        emp.bMonth      || emp.birth_month || null,
        emp.bDay        || emp.birth_day   || null,
        emp.phone       || null,
        emp.department  || null,
      ]
    );
    res.status(201).json({ ...emp, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/employees/:id — update one
router.put('/:id', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'hr') {
    return res.status(403).json({ error: 'Admin or HR access required' });
  }
  try {
    const emp = req.body;
    await query(
      `UPDATE employees
       SET name=?, job_title=?, email=?, birth_month=?, birth_day=?, phone=?, department=?
       WHERE id=?`,
      [
        emp.name        || '',
        emp.role        || null,
        emp.email       || null,
        emp.bMonth      || emp.birth_month || null,
        emp.bDay        || emp.birth_day   || null,
        emp.phone       || null,
        emp.department  || null,
        req.params.id,
      ]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/employees/:id
router.delete('/:id', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    await query('DELETE FROM employees WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
