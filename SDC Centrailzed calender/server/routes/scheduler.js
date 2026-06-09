/**
 * server/routes/scheduler.js
 * Read-only bridge to the SDC Scheduler SQLite database.
 *
 * Reads directly from ../../SDC_Scheduler/scheduler.db using better-sqlite3.
 * Returns gracefully empty arrays if the file doesn't exist yet.
 */

const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

const SCHEDULER_DB = path.resolve(__dirname, '..', '..', '..', 'SDC_Scheduler', 'scheduler.db');

const PHASE_COLORS = {
  me:          '#aacee8',
  ce:          '#befa4f',
  engineering: '#d9d9d9',
  build:       '#ffde51',
  wire:        '#74c415',
  testing:     '#1574c4',
};

function getDb() {
  if (!fs.existsSync(SCHEDULER_DB)) return null;
  // Lazy-require so the app boots even if better-sqlite3 isn't installed yet
  const Database = require('better-sqlite3');
  return new Database(SCHEDULER_DB, { readonly: true, fileMustExist: true });
}

// GET /api/scheduler/projects — list unique projects
router.get('/projects', requireAuth, (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.json([]);
    const rows = db.prepare(
      `SELECT DISTINCT project FROM tasks
       WHERE project IS NOT NULL AND project != ''
       ORDER BY project ASC`
    ).all();
    db.close();
    res.json(rows.map(r => r.project));
  } catch (err) {
    console.error('[scheduler/projects] error:', err.message);
    res.json([]);
  }
});

// GET /api/scheduler/tasks?projects=Proj1,Proj2
router.get('/tasks', requireAuth, (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.json([]);

    let sql = `
      SELECT id, name, project, phase, assignee,
             start_date, end_date, progress, is_milestone, notes
      FROM tasks
      WHERE start_date IS NOT NULL AND start_date != ''
    `;
    const params = [];

    if (req.query.projects) {
      const projects = req.query.projects.split(',').map(p => p.trim()).filter(Boolean);
      if (projects.length > 0) {
        sql += ` AND project IN (${projects.map(() => '?').join(',')})`;
        params.push(...projects);
      }
    }

    sql += ' ORDER BY start_date ASC';

    const rows = db.prepare(sql).all(...params);
    db.close();

    const events = rows.map(t => ({
      id:          `sch_${t.id}`,
      title:       t.name,
      date:        t.start_date,
      endDate:     t.end_date    || null,
      category:    'company',
      color:       PHASE_COLORS[t.phase] || '#1574c4',
      source:      'scheduler',
      project:     t.project,
      phase:       t.phase,
      progress:    t.progress    || 0,
      assignee:    t.assignee,
      isMilestone: !!t.is_milestone,
      description: t.notes       || '',
      readOnly:    true,
      allDay:      true,
    }));

    res.json(events);
  } catch (err) {
    console.error('[scheduler/tasks] error:', err.message);
    res.json([]);
  }
});

module.exports = router;
