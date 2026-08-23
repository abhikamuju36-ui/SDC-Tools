/**
 * sqlite.js — Events data layer (MySQL edition).
 *
 * Exports the same API as the original Azure SQL version so routes/events.js
 * needs zero changes. The file is named sqlite.js for historical compatibility.
 *
 * Table: sdc_calendar.events
 */

const crypto = require('crypto');
const { query } = require('./mysqlDb');

// Map a raw DB row to the shape routes expect (booleans, camelCase aliases)
function toEvent(row) {
  if (!row) return null;
  return {
    id:           row.id,
    title:        row.title,
    date:         row.date,
    endDate:      row.end_date   || null,
    category:     row.category,
    allDay:       !!row.all_day,
    time:         row.time       || null,
    endTime:      row.end_time   || null,
    location:     row.location   || null,
    description:  row.description || null,
    repeat:       row.repeat_rule,
    notify:       row.notify_mins || null,
    pinned:       !!row.pinned,
    creatorEmail: row.creator_email || null,
    creatorName:  row.creator_name  || null,
    approved:     !!row.approved,
    created_at:   row.created_at,
  };
}

const sqlite = {

  getAllEvents: async ({ month } = {}) => {
    let sql = 'SELECT * FROM events';
    const params = [];
    if (month) {
      sql += ' WHERE date LIKE ?';
      params.push(`${month}%`);
    }
    sql += ' ORDER BY date ASC';
    const [rows] = await query(sql, params);
    return rows.map(toEvent);
  },

  addEvent: async (ev) => {
    const id = ev.id || `evt-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    await query(
      `INSERT INTO events
         (id, title, date, end_date, category, all_day, time, end_time,
          location, description, repeat_rule, notify_mins, pinned,
          creator_email, creator_name, approved)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        ev.title,
        ev.date,
        ev.endDate    || null,
        ev.category,
        ev.allDay ? 1 : 0,
        ev.time       || null,
        ev.endTime    || null,
        ev.location   || null,
        ev.description || null,
        ev.repeat     || 'none',
        ev.notify     || null,
        ev.pinned ? 1 : 0,
        ev.creatorEmail || null,
        ev.creatorName  || null,
        ev.approved ? 1 : 0,
      ]
    );
    return { ...ev, id };
  },

  getEventById: async (id) => {
    const [rows] = await query('SELECT * FROM events WHERE id = ?', [id]);
    return toEvent(rows[0]);
  },

  updateEvent: async (id, ev) => {
    await query(
      `UPDATE events SET
         title=?, date=?, end_date=?, category=?, all_day=?,
         time=?, end_time=?, location=?, description=?,
         repeat_rule=?, notify_mins=?, pinned=?, approved=?
       WHERE id=?`,
      [
        ev.title,
        ev.date,
        ev.endDate    || null,
        ev.category,
        ev.allDay ? 1 : 0,
        ev.time       || null,
        ev.endTime    || null,
        ev.location   || null,
        ev.description || null,
        ev.repeat     || 'none',
        ev.notify     || null,
        ev.pinned ? 1 : 0,
        ev.approved ? 1 : 0,
        id,
      ]
    );
    return { success: true };
  },

  deleteEvent: async (id) => {
    await query('DELETE FROM events WHERE id = ?', [id]);
    return { success: true };
  },

  approveEvent: async (id) => {
    await query('UPDATE events SET approved = 1 WHERE id = ?', [id]);
    return { success: true };
  },
};

module.exports = sqlite;
