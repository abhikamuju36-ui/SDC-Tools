const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const sqlite = require('../sqlite');

const router = express.Router();

// Helper to check if user can edit/delete
const canMutate = (user, event) => {
  if (user.role === 'admin' || user.role === 'manager') return true;
  return event.creatorEmail === user.email;
};

// GET /api/events
router.get('/', requireAuth, async (req, res) => {
  try {
    const all = await sqlite.getAllEvents();
    if (req.user.role === 'admin' || req.user.role === 'manager') {
      res.json(all);
    } else {
      // Employee: show all approved events + their own pending events
      const filtered = all.filter(e => e.approved || e.creatorEmail === req.user.email);
      res.json(filtered);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/events
router.post('/', requireAuth, async (req, res) => {
  try {
    const isPrivileged = req.user.role === 'admin' || req.user.role === 'manager';
    const isVacationImport = req.body.category === 'vacation';
    const ev = {
      ...req.body,
      creatorEmail: req.user.email,
      creatorName: req.user.name || req.user.email,
      approved: (isPrivileged || isVacationImport) ? 1 : 0
    };
    const created = await sqlite.addEvent(ev);

    // ── Trigger Attendee Emails ──
    if (ev.attendees) {
      const recipients = ev.attendees.split(',').map(e => e.trim()).filter(e => e.includes('@'));
      if (recipients.length > 0) {
        console.log('');
        console.log('======================================================');
        console.log(`✉️ TRANSACTIONAL EMAIL INVITE DISPATCHED`);
        console.log(`👥 Recipients: ${recipients.join(', ')}`);
        console.log(`📅 Subject: Calendar Invitation: "${ev.title}"`);
        console.log(`💬 Details: You have been invited by ${ev.creatorName}. Starts ${ev.date}.`);
        console.log('======================================================');
        console.log('');
      }
    }

    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/events/:id
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const all = await sqlite.getAllEvents();
    const existing = all.find(e => e.id === req.params.id);
    if (!existing) return res.status(404).json({ error: 'Event not found' });

    if (!canMutate(req.user, existing)) {
      return res.status(403).json({ error: 'Forbidden — you do not own this event' });
    }

    const updated = { ...existing, ...req.body };
    await sqlite.updateEvent(req.params.id, updated);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/events/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const all = await sqlite.getAllEvents();
    const existing = all.find(e => e.id === req.params.id);
    if (!existing) return res.status(404).json({ error: 'Event not found' });

    if (!canMutate(req.user, existing)) {
      return res.status(403).json({ error: 'Forbidden — you do not own this event' });
    }

    await sqlite.deleteEvent(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/events/:id/approve
router.post('/:id/approve', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'manager') {
    return res.status(403).json({ error: 'Forbidden — manager or admin access required' });
  }
  try {
    await sqlite.approveEvent(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
