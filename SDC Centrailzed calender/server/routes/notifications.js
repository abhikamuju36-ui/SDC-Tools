const express      = require('express');
const router       = express.Router();
const sqlite       = require('../sqlite');

// GET /api/notifications/pending
// Returns events starting within the next `window` minutes (default 30).
// Used by the shell's MAIN PROCESS to poll for upcoming reminders (see
// shell/electron/main.js's pollAppNotifications) — a plain Node fetch with no
// BrowserWindow/session behind it, so it never carries the sdc_session
// cookie requireAuth now checks. Left unauthenticated deliberately rather
// than broken: the handler never reads req.user and returns no per-person
// data, only which already-approved events are starting soon — the same
// thing every signed-in person already sees on the calendar itself.
router.get('/pending', async (req, res) => {
  try {
    const windowMins = parseInt(req.query.window, 10) || 30;
    const now        = new Date();
    const cutoff     = new Date(now.getTime() + windowMins * 60 * 1000);

    const events = await sqlite.getAllEvents();

    const pending = events
      .filter(ev => ev.approved)
      .map(ev => {
        const dateStr = ev.date instanceof Date
          ? ev.date.toISOString().slice(0, 10)
          : String(ev.date).slice(0, 10);
        const base = ev.allDay || !ev.time
          ? new Date(dateStr + 'T00:00:00')
          : new Date(dateStr + 'T' + ev.time + ':00');
        return { ...ev, _start: base };
      })
      .filter(ev => ev._start > now && ev._start <= cutoff)
      .map(ev => ({
        id:       ev.id,
        title:    ev.title,
        category: ev.category,
        date:     ev.date,
        time:     ev.time || null,
        location: ev.location || null,
        minsUntil: Math.round((ev._start - now) / 60000),
      }));

    res.json(pending);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
