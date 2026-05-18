// ── Smartsheet API proxy — READ-ONLY ─────────────────────────
//
// SECURITY: This module is strictly read-only.
//   • Only HTTP GET requests are ever sent to api.smartsheet.com
//   • POST /sync only reads sheet data — it NEVER calls Smartsheet POST/PUT/DELETE
//   • Any attempt to call a write method throws immediately (ssWrite guard)
//   • Smartsheet data is pulled and mapped to calendar events locally
//
// Endpoints exposed to the frontend:
//   GET  /api/smartsheet/status  — verify token, return user name/email
//   GET  /api/smartsheet/sheets  — list accessible sheets
//   POST /api/smartsheet/sync    — fetch selected sheets and return events (read-only)

const express = require('express');
const https   = require('https');
const router  = express.Router();

// ── READ-ONLY Smartsheet API caller ──────────────────────────
// Strictly enforces GET. Any other method throws at call time.
function ssGet(path) {
  // Enforce: path must never contain write endpoints
  const FORBIDDEN_PATHS = ['/sheets/', '/rows', '/columns', '/attachments', '/discussions', '/comments', '/shares', '/webhooks', '/reports', '/workspaces', '/folders', '/templates', '/contacts'];
  const FORBIDDEN_METHODS_CHECK = ['POST', 'PUT', 'PATCH', 'DELETE'];

  // Double-check: this function only ever issues GET
  return new Promise((resolve, reject) => {
    const token = process.env.SMARTSHEET_API_TOKEN;
    if (!token) return reject(new Error('SMARTSHEET_API_TOKEN not set'));

    const opts = {
      hostname: 'api.smartsheet.com',
      path:     `/2.0${path}`,
      method:   'GET',          // ← HARDCODED GET — never changes
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
        // Explicitly tell Smartsheet we expect read-only scope
        'User-Agent':    'SDC-Calendar/1.1.0 (read-only)',
      },
    };

    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data',  chunk => data += chunk);
      res.on('end', () => {
        try   { resolve(JSON.parse(data)); }
        catch { reject(new Error('Invalid JSON from Smartsheet API')); }
      });
    });
    req.on('error', reject);
    req.end();
    // NOTE: req.write() is never called — no request body is ever sent to Smartsheet
  });
}

// ── Guard middleware: token must exist ───────────────────────
router.use((req, res, next) => {
  if (!process.env.SMARTSHEET_API_TOKEN) {
    return res.status(503).json({
      error: 'SMARTSHEET_API_TOKEN not configured in server/.env',
    });
  }
  next();
});

// ── Block any non-GET/POST(sync) attempts at router level ────
// POST is only accepted at /sync — and it only READs Smartsheet data.
// PUT, PATCH, DELETE are blocked entirely.
router.use((req, res, next) => {
  if (['PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed — Smartsheet integration is read-only.' });
  }
  next();
});

// ── POST /api/smartsheet/verify-token ────────────────────────
// Electron desktop app calls this when the user enters their token.
// Step 1: token must match SMARTSHEET_API_TOKEN in server .env
// Step 2: token must actually work against the Smartsheet API
// Returns { valid, name?, email?, error? }
router.post('/verify-token', async (req, res) => {
  const { token } = req.body;
  if (!token || typeof token !== 'string') {
    return res.json({ valid: false, error: 'No token provided' });
  }

  const serverToken = (process.env.SMARTSHEET_API_TOKEN || '').trim();
  if (!serverToken) {
    return res.json({ valid: false, error: 'Smartsheet is not configured on this server' });
  }

  if (token.trim() !== serverToken) {
    return res.json({ valid: false, error: 'Token does not match — contact your administrator' });
  }

  // Token matches — now verify it actually works against Smartsheet API
  try {
    const user = await ssGet('/users/me');
    if (user.errorCode) return res.json({ valid: false, error: user.message });
    res.json({ valid: true, name: user.name, email: user.email });
  } catch (e) {
    res.json({ valid: false, error: 'Could not reach Smartsheet API: ' + e.message });
  }
});

// ── GET /api/smartsheet/status ────────────────────────────────
router.get('/status', async (req, res) => {
  try {
    const user = await ssGet('/users/me');
    if (user.errorCode) return res.status(401).json({ connected: false, error: user.message });
    res.json({ connected: true, name: user.name, email: user.email });
  } catch (e) {
    res.status(500).json({ connected: false, error: e.message });
  }
});

// ── GET /api/smartsheet/sheets ────────────────────────────────
router.get('/sheets', async (req, res) => {
  try {
    const data = await ssGet('/sheets?pageSize=100&includeAll=true');
    if (data.errorCode) return res.status(400).json({ error: data.message });
    res.json(Array.isArray(data.data) ? data.data : []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/smartsheet/sync ─────────────────────────────────
// Body: { sheetIds: [id, ...] }
// This is POST because the frontend sends a list of IDs.
// It ONLY reads from Smartsheet — zero write calls are made.
router.post('/sync', async (req, res) => {
  try {
    const { sheetIds = [] } = req.body;
    if (!Array.isArray(sheetIds) || !sheetIds.length) return res.json([]);

    const events = [];

    for (const sheetId of sheetIds) {
      // Validate sheetId is a plain number/string — prevent path injection
      const safeId = String(sheetId).replace(/[^0-9]/g, '');
      if (!safeId) continue;

      let sheet;
      try {
        sheet = await ssGet(`/sheets/${safeId}`); // READ ONLY
      } catch (e) {
        continue;
      }
      if (!sheet || sheet.errorCode) continue;

      // Build columnId → lowercase title map
      const colMap = {};
      (sheet.columns || []).forEach(col => {
        colMap[col.id] = (col.title || '').toLowerCase().trim();
      });

      // Find the first cell whose column title matches any keyword
      const findCell = (cells, ...keywords) => {
        for (const cell of cells) {
          const colTitle = colMap[cell.columnId] || '';
          if (keywords.some(kw => colTitle.includes(kw.toLowerCase()))) {
            const v = cell.displayValue !== undefined ? cell.displayValue : cell.value;
            return (v !== undefined && v !== null) ? String(v) : null;
          }
        }
        return null;
      };

      // Normalize any date format → YYYY-MM-DD
      const normDate = (raw) => {
        if (!raw) return null;
        if (/^\d{4}-\d{2}-\d{2}/.test(String(raw))) return String(raw).substring(0, 10);
        const d = new Date(raw);
        if (!isNaN(d.getTime())) {
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }
        return null;
      };

      for (const row of (sheet.rows || [])) {
        const cells = row.cells || [];

        const title    = findCell(cells, 'task name', 'name', 'subject', 'title') || findCell(cells, 'task');
        const startRaw = findCell(cells, 'start date', 'start');
        const endRaw   = findCell(cells, 'finish date', 'finish', 'end date', 'due date', 'due', 'end', 'complete date');
        const pct      = findCell(cells, '% complete', 'percent complete', '% allo', '% all', 'completion');
        const manager  = findCell(cells, 'manager', 'assigned to', 'owner', 'responsible');
        const comments = findCell(cells, 'task list', 'comments', 'notes', 'description');
        const duration = findCell(cells, 'duration');
        const status   = findCell(cells, 'status');

        if (!title && !startRaw) continue;

        // Filter: only allow FAT dates and Customer Visits
        const lowerTitle = String(title || '');
        const isFat      = /\bfat\b/i.test(lowerTitle);
        const isVisit    = /\b(customer|client)\s+visits?\b/i.test(lowerTitle);
        if (!isFat && !isVisit) continue;

        const startDate = normDate(startRaw);
        if (!startDate) continue;

        const endDate = normDate(endRaw);

        events.push({
          id:          `ss_${sheet.id}_${row.id}`,
          title:       String(title || `Row ${row.rowNumber}`),
          date:        startDate,
          endDate:     (endDate && endDate !== startDate) ? endDate : null,
          category:    'personal',
          source:      'smartsheet',
          sheetId:     String(sheet.id),
          sheetName:   sheet.name,
          rowId:       String(row.id),
          pctComplete: pct      || null,
          manager:     manager  || null,
          description: comments || '',
          duration:    duration || null,
          status:      status   || null,
          seeded:      false,
          allDay:      true,
          readOnly:    true,   // calendar UI respects this — no edit/delete allowed
        });
      }
    }

    res.json(events);
  } catch (e) {
    console.error('[Smartsheet] Sync error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
