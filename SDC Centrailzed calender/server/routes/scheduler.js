const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { request, sql } = require('../azureDb');

const router = express.Router();

// Reads scheduler tasks from Azure SQL [scheduler].[tasks]
// (same database, separate schema — migrated from local SQLite)

const PHASE_COLORS = {
  me:          '#aacee8',
  ce:          '#befa4f',
  engineering: '#d9d9d9',
  build:       '#ffde51',
  wire:        '#74c415',
  testing:     '#1574c4',
};

// GET /api/scheduler/projects — list unique projects
router.get('/projects', requireAuth, async (req, res) => {
  try {
    const r = await request();
    const result = await r.query(`
      SELECT DISTINCT project
      FROM [scheduler].[tasks]
      WHERE project IS NOT NULL AND project != ''
      ORDER BY project
    `);
    res.json(result.recordset.map(r => r.project));
  } catch (err) {
    console.error('[scheduler/projects] Azure SQL error:', err.message);
    res.json([]);
  }
});

// GET /api/scheduler/tasks?projects=Proj1,Proj2 — return tasks as calendar events
router.get('/tasks', requireAuth, async (req, res) => {
  try {
    const r = await request();

    let query = `
      SELECT id, name, project, phase, assignee,
             start_date, end_date, progress, is_milestone, notes
      FROM [scheduler].[tasks]
      WHERE start_date IS NOT NULL AND start_date != ''
    `;

    if (req.query.projects) {
      const projects = req.query.projects
        .split(',')
        .map(p => p.trim())
        .filter(Boolean);

      if (projects.length > 0) {
        // Parameterised IN clause
        projects.forEach((p, i) => r.input(`proj${i}`, sql.NVarChar(500), p));
        const placeholders = projects.map((_, i) => `@proj${i}`).join(', ');
        query += ` AND project IN (${placeholders})`;
      }
    }

    query += ' ORDER BY start_date ASC';

    const result = await r.query(query);

    const events = result.recordset.map(t => ({
      id:          `sch_${t.id}`,
      title:       t.name,
      date:        t.start_date,
      endDate:     t.end_date   || null,
      category:    'company',
      color:       PHASE_COLORS[t.phase] || '#1574c4',
      source:      'scheduler',
      project:     t.project,
      phase:       t.phase,
      progress:    t.progress   || 0,
      assignee:    t.assignee,
      isMilestone: !!t.is_milestone,
      description: t.notes      || '',
      readOnly:    true,
      allDay:      true,
    }));

    res.json(events);
  } catch (err) {
    console.error('[scheduler/tasks] Azure SQL error:', err.message);
    res.json([]);
  }
});

module.exports = router;
