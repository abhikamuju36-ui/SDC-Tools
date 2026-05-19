/**
 * sqlite.js — Events data layer (Azure SQL edition).
 *
 * Exports the same API as the original SQLite version so all routes
 * (routes/events.js) work without any changes.
 *
 * Table: [calendar].[events]
 */

const crypto = require('crypto');
const { request, sql } = require('./azureDb');

const sqlite = {

  // Optional { month: 'YYYY-MM' } filter — applied server-side to keep payloads small
  getAllEvents: async ({ month } = {}) => {
    const r = await request();
    const whereClause = month
      ? `WHERE date LIKE @monthPrefix + '%'`
      : '';
    if (month) r.input('monthPrefix', sql.NVarChar(10), month);
    const result = await r.query(`
      SELECT * FROM [calendar].[events] ${whereClause} ORDER BY date
    `);
    return result.recordset.map(row => ({
      ...row,
      allDay:   !!row.allDay,
      pinned:   !!row.pinned,
      approved: !!row.approved,
    }));
  },

  addEvent: async (ev) => {
    // Generate a unique ID if the caller didn't supply one
    const id = ev.id || `evt-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const r = await request();
    r.input('id',           sql.NVarChar(50),  id);
    r.input('title',        sql.NVarChar(500), ev.title);
    r.input('date',         sql.NVarChar(20),  ev.date);
    r.input('endDate',      sql.NVarChar(20),  ev.endDate   || null);
    r.input('category',     sql.NVarChar(50),  ev.category);
    r.input('allDay',       sql.Bit,           ev.allDay ? 1 : 0);
    r.input('time',         sql.NVarChar(10),  ev.time      || null);
    r.input('endTime',      sql.NVarChar(10),  ev.endTime   || null);
    r.input('location',     sql.NVarChar(500), ev.location  || null);
    r.input('description',  sql.NVarChar(sql.MAX), ev.description || null);
    r.input('repeat',       sql.NVarChar(20),  ev.repeat    || 'none');
    r.input('notify',       sql.Int,           ev.notify    || null);
    r.input('pinned',       sql.Bit,           ev.pinned ? 1 : 0);
    r.input('creatorEmail', sql.NVarChar(255), ev.creatorEmail || null);
    r.input('creatorName',  sql.NVarChar(255), ev.creatorName  || null);
    r.input('approved',     sql.Bit,           ev.approved ? 1 : 0);

    await r.query(`
      INSERT INTO [calendar].[events]
        (id, title, date, endDate, category, allDay, time, endTime,
         location, description, repeat, notify, pinned, creatorEmail, creatorName, approved)
      VALUES
        (@id, @title, @date, @endDate, @category, @allDay, @time, @endTime,
         @location, @description, @repeat, @notify, @pinned, @creatorEmail, @creatorName, @approved)
    `);

    return { ...ev, id };
  },

  updateEvent: async (id, ev) => {
    const r = await request();
    r.input('id',          sql.NVarChar(50),  id);
    r.input('title',       sql.NVarChar(500), ev.title);
    r.input('date',        sql.NVarChar(20),  ev.date);
    r.input('endDate',     sql.NVarChar(20),  ev.endDate  || null);
    r.input('category',    sql.NVarChar(50),  ev.category);
    r.input('allDay',      sql.Bit,           ev.allDay ? 1 : 0);
    r.input('time',        sql.NVarChar(10),  ev.time     || null);
    r.input('endTime',     sql.NVarChar(10),  ev.endTime  || null);
    r.input('location',    sql.NVarChar(500), ev.location || null);
    r.input('description', sql.NVarChar(sql.MAX), ev.description || null);
    r.input('repeat',      sql.NVarChar(20),  ev.repeat   || 'none');
    r.input('notify',      sql.Int,           ev.notify   || null);
    r.input('pinned',      sql.Bit,           ev.pinned ? 1 : 0);
    r.input('approved',    sql.Bit,           ev.approved ? 1 : 0);

    await r.query(`
      UPDATE [calendar].[events] SET
        title=@title, date=@date, endDate=@endDate, category=@category,
        allDay=@allDay, time=@time, endTime=@endTime, location=@location,
        description=@description, repeat=@repeat, notify=@notify,
        pinned=@pinned, approved=@approved
      WHERE id=@id
    `);

    return { success: true };
  },

  deleteEvent: async (id) => {
    const r = await request();
    r.input('id', sql.NVarChar(50), id);
    await r.query(`DELETE FROM [calendar].[events] WHERE id=@id`);
    return { success: true };
  },

  approveEvent: async (id) => {
    const r = await request();
    r.input('id', sql.NVarChar(50), id);
    await r.query(`UPDATE [calendar].[events] SET approved=1 WHERE id=@id`);
    return { success: true };
  },
};

module.exports = sqlite;
