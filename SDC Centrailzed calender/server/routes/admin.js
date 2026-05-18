const express                       = require('express');
const { requireAuth, requireAdmin } = require('../middleware/requireAuth');
const db                            = require('../db');

const router = express.Router();

const VALID_ROLES = ['admin', 'hr', 'manager', 'employee'];
const ALL_CATS    = ['holiday','payday','birthday','meeting','company','deadline','personal'];

// GET /api/admin/users
router.get('/users', requireAdmin, async (_req, res) => {
  const users = await db.users.findAll();
  res.json(users.map(u => ({ id: u._id, email: u.email, name: u.name, role: u.role, created_at: u.created_at, last_login: u.last_login })));
});

// PUT /api/admin/users/:id/role
router.put('/users/:id/role', requireAdmin, async (req, res) => {
  const { role } = req.body;
  if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  await db.users.setRole(req.params.id, role);
  res.json({ success: true });
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', requireAdmin, async (req, res) => {
  await db.users.delete(req.params.id);
  res.json({ success: true });
});

// GET /api/admin/roles
router.get('/roles', requireAdmin, async (_req, res) => {
  const roles = await db.roles.findAll();
  res.json(roles.map(r => ({ role: r.role, categories: r.categories.join(','), label: r.label })));
});

// PUT /api/admin/roles/:role
router.put('/roles/:role', requireAdmin, async (req, res) => {
  const { role } = req.params;
  if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const { categories } = req.body;
  if (!Array.isArray(categories) || categories.some(c => !ALL_CATS.includes(c))) {
    return res.status(400).json({ error: 'Invalid categories' });
  }
  await db.roles.updateCategories(role, categories);
  res.json({ success: true });
});

module.exports = router;
