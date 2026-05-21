/**
 * db.service.js
 * High-performance SQLite database service using better-sqlite3.
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const config = require('../config/paths');

// Columns callers are allowed to search against (SQL-injection prevention)
const ALLOWED_SEARCH_FIELDS = new Set(['description', 'partno', 'file_name', 'job_id', 'job_name', 'comments', 'category', 'updated_by']);

// Columns callers are allowed to sort by
const ALLOWED_SORT_FIELDS = new Set(['job_id', 'updated_at', 'partno', 'category']);

// Columns allowed in updateRecord / create
const ALLOWED_WRITE_FIELDS = new Set([
    'job_id', 'job_name', 'file_name', 'partno', 'description', 'category',
    'comments', 'updated_by', 'model_link', 'picture_link', 'preference',
    'sdc_standard', 'library', 'status',
]);

class DbService {
    constructor() {
        this.db = new Database(config.SQLITE_PATH);
        this._distinctCache = new Map(); // { column → { value, expiresAt } }
        this._CACHE_TTL = 30_000;        // 30-second TTL for distinct queries

        const computeScore = (text, term) => {
            if (!text || !term) return 0;
            const t = String(text).toLowerCase();
            const q = String(term).toLowerCase();
            if (t === q) return 100;
            if (t.includes(q)) return 80;

            const words = t.split(/[^a-z0-9]+/).filter(Boolean);
            let maxScore = 0;
            for (const w of words) {
                if (w === q) { maxScore = Math.max(maxScore, 90); continue; }
                if (w.includes(q) || (w.length >= 3 && q.includes(w))) { maxScore = Math.max(maxScore, 70); continue; }
                if (q.length < 3) continue;
                const alen = w.length, blen = q.length;
                if (Math.abs(alen - blen) > 2) continue;

                const tmp = [];
                for (let i = 0; i <= alen; i++) tmp[i] = [i];
                for (let j = 0; j <= blen; j++) tmp[0][j] = j;
                for (let i = 1; i <= alen; i++) {
                    for (let j = 1; j <= blen; j++) {
                        const cost = (w[i - 1] === q[j - 1]) ? 0 : 1;
                        tmp[i][j] = Math.min(tmp[i - 1][j] + 1, tmp[i][j - 1] + 1, tmp[i - 1][j - 1] + cost);
                    }
                }
                const dist = tmp[alen][blen];
                const maxErrors = blen >= 7 ? 2 : (blen >= 4 ? 1 : 0);
                if (dist <= maxErrors) {
                    maxScore = Math.max(maxScore, 60 - (dist * 10));
                }
            }
            return maxScore;
        };

        this.db.function('fuzzy_score', (text, term) => computeScore(text, term));
        this.db.function('fuzzy_match', (text, term) => computeScore(text, term) >= 40 ? 1 : 0);

        this.init();
        this._migrate();
    }

    _migrate() {
        try {
            const cleanup = this.db.prepare(`
                DELETE FROM assemblies
                WHERE id NOT IN (
                    SELECT MAX(id)
                    FROM assemblies
                    GROUP BY COALESCE(job_id, ''), partno
                )
            `).run();
            if (cleanup.changes > 0) {
                console.log(`[DB] Migration: Cleaned up ${cleanup.changes} duplicate records.`);
            }
        } catch (e) {
            console.error('[DB] Migration cleanup failed:', e.message);
        }

        try {
            this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_job_part ON assemblies(job_id, partno)`);
        } catch (_) {}

        try { this.db.exec(`ALTER TABLE assemblies ADD COLUMN status TEXT DEFAULT 'Active'`); } catch (_) {}
        try { this.db.exec(`ALTER TABLE assemblies ADD COLUMN deleted_at TEXT`); } catch (_) {}
        try {
            this.db.exec(`CREATE TABLE IF NOT EXISTS audit_log (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                partno     TEXT NOT NULL,
                action     TEXT NOT NULL,
                field      TEXT,
                old_value  TEXT,
                new_value  TEXT,
                changed_by TEXT,
                changed_at TEXT DEFAULT (datetime('now'))
            )`);
        } catch (_) {}
    }

    init() {
        this.db.pragma('busy_timeout = 5000');
        this.db.pragma('synchronous  = NORMAL');
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('cache_size   = -8000');
        this.db.pragma('foreign_keys = ON');

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS assemblies (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id        TEXT,
                job_name      TEXT,
                file_name     TEXT,
                partno        TEXT,
                description   TEXT,
                category      TEXT,
                comments      TEXT,
                updated_by    TEXT,
                created_at    TEXT,
                updated_at    TEXT,
                model_link    TEXT,
                picture_link  TEXT,
                preference    TEXT,
                sdc_standard  TEXT,
                library       TEXT,
                thumbnail     TEXT,
                path          TEXT,
                last_modified TEXT,
                size          INTEGER,
                UNIQUE(partno, job_id)
            );

            CREATE INDEX IF NOT EXISTS idx_partno      ON assemblies(partno);
            CREATE INDEX IF NOT EXISTS idx_job_id      ON assemblies(job_id);
            CREATE INDEX IF NOT EXISTS idx_description ON assemblies(description);
            CREATE INDEX IF NOT EXISTS idx_category    ON assemblies(category);
            CREATE INDEX IF NOT EXISTS idx_updated_at  ON assemblies(updated_at);
            CREATE INDEX IF NOT EXISTS idx_library     ON assemblies(library);
        `);
    }

    readAll() {
        return this.db.prepare('SELECT * FROM assemblies ORDER BY job_id DESC').all();
    }

    getOne(partno) {
        return this.db.prepare('SELECT * FROM assemblies WHERE partno = ?').get(partno) || null;
    }

    writeAll(records) {
        const insertNew = this.db.prepare(`
            INSERT OR IGNORE INTO assemblies (
                job_id, job_name, file_name, partno, description, category,
                comments, updated_by, created_at, updated_at, model_link,
                picture_link, preference, sdc_standard, library,
                thumbnail, path, last_modified, size
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const updateFsFields = this.db.prepare(`
            UPDATE assemblies
            SET    model_link    = ?,
                   picture_link  = ?,
                   thumbnail     = ?,
                   path          = ?,
                   last_modified = ?,
                   size          = ?
            WHERE  partno     = ?
              AND  COALESCE(job_id,    '') = COALESCE(?, '')
        `);

        const newPartnoSet = new Set();

        const transaction = this.db.transaction((items) => {
            for (const item of items) {
                const result = insertNew.run(
                    item.job_id,       item.job_name,   item.file_name,    item.partno,
                    item.description,  item.category,   item.comments,     item.updated_by,
                    item.created_at,   item.updated_at, item.model_link,
                    item.picture_link, item.preference, item.sdc_standard, item.library,
                    item.thumbnail,    item.path,       item.last_modified, item.size
                );

                if (result.changes > 0) {
                    newPartnoSet.add(item.partno);
                } else {
                    updateFsFields.run(
                        item.model_link,    item.picture_link, item.thumbnail,
                        item.path,          item.last_modified, item.size,
                        item.partno,        item.job_id
                    );
                }
            }
        });

        transaction(records);
        this._clearDistinctCache();

        for (const item of records) {
            if (newPartnoSet.has(item.partno)) {
                this.logAudit(item.partno, 'create', null, null, null, item.updated_by || null);
            }
        }
    }

    clearStaleLink(partno, jobId, fileName) {
        this.db.prepare(`
            UPDATE assemblies
            SET   model_link = NULL, path = NULL
            WHERE partno     = ?
              AND COALESCE(job_id,    '') = COALESCE(?, '')
        `).run(partno, jobId ?? '');
        this.logAudit(partno, 'stale-link-cleared', 'model_link', null, null, 'Sync');
    }

    backfillThumbnailColumn() {
        const rows = this.db.prepare(`
            SELECT partno, job_id, file_name, picture_link
            FROM   assemblies
            WHERE  picture_link IS NOT NULL AND picture_link != ''
              AND  (thumbnail IS NULL OR thumbnail = '')
        `).all();

        const update = this.db.prepare(`
            UPDATE assemblies SET thumbnail = ?
            WHERE  partno = ?
              AND  COALESCE(job_id,    '') = COALESCE(?, '')
        `);

        const tx = this.db.transaction((items) => {
            for (const row of items) {
                const thumb = row.picture_link.split('/').pop().split('\\').pop();
                if (thumb) update.run(thumb, row.partno, row.job_id);
            }
        });
        tx(rows);
        return rows.length;
    }

    query(params = {}) {
        const {
            search, searchFields = ['description', 'partno', 'file_name', 'job_id', 'job_name'],
            sortBy = 'job_id', sortOrder = 'DESC',
            limit = 40, offset = 0,
            libraries, jobs, categories,
            modelFilter, imageFilter, sdcStandards, preferences,
            statusFilter, updatedAfter, updatedBefore,
            includeDeleted = false,
        } = params;

        let sql      = 'SELECT * FROM assemblies WHERE 1=1';
        let countSql = 'SELECT COUNT(*) as total FROM assemblies WHERE 1=1';
        const values      = [];
        const countValues = [];

        let relevanceClause = '';
        const relevanceValues = [];

        if (search) {
            const rawFields = Array.isArray(searchFields) ? searchFields : searchFields.split(',');
            const fields = rawFields.map(f => f.trim()).filter(f => ALLOWED_SEARCH_FIELDS.has(f));
            if (fields.length === 0) fields.push('description');

            const searchTerms = search.trim().split(/\s+/).filter(Boolean);

            searchTerms.forEach(term => {
                const searchClause = ` AND (${fields.map(f => `fuzzy_match(${f}, ?)`).join(' OR ')})`;
                sql += searchClause;
                countSql += searchClause;
                fields.forEach(() => { values.push(term); countValues.push(term); });
            });

            const scoreExprs = [];
            searchTerms.forEach(term => {
                fields.forEach(f => {
                    scoreExprs.push(`fuzzy_score(${f}, ?)`);
                    relevanceValues.push(term);
                });
            });

            if (scoreExprs.length > 0) {
                relevanceClause = `(${scoreExprs.join(' + ')}) DESC, `;
            }
        }

        const addFilter = (column, items) => {
            if (!items) return;
            const list = (Array.isArray(items) ? items : items.split(',')).filter(Boolean);
            if (!list.length) return;

            const hasNone = list.includes('None');
            const others  = list.filter(i => i !== 'None');
            let clause    = '';
            const params  = [];

            if (others.length) {
                clause = `${column} IN (${others.map(() => '?').join(',')})`;
                params.push(...others);
            }
            if (hasNone) {
                const noneClause = `(${column} IS NULL OR ${column} = '' OR ${column} = 'None')`;
                clause = clause ? `(${clause} OR ${noneClause})` : noneClause;
            }
            if (clause) {
                const finalClause = ` AND ${clause}`;
                sql      += finalClause;
                countSql += finalClause;
                values.push(...params);
                countValues.push(...params);
            }
        };

        addFilter('library',      libraries);
        addFilter('job_id',       jobs);
        addFilter('category',     categories);
        addFilter('sdc_standard', sdcStandards);
        addFilter('preference',   preferences);

        const addBinary = (column, filter) => {
            if (filter === 'Yes') {
                const c = ` AND ${column} IS NOT NULL AND ${column} != ''`;
                sql += c; countSql += c;
            } else if (filter === 'No') {
                const c = ` AND (${column} IS NULL OR ${column} = '')`;
                sql += c; countSql += c;
            }
        };

        addBinary('model_link',   modelFilter);
        addBinary('picture_link', imageFilter);

        if (!includeDeleted) {
            const c = ' AND (deleted_at IS NULL)';
            sql += c; countSql += c;
        }

        if (statusFilter) {
            const c = ' AND status = ?';
            sql += c; countSql += c;
            values.push(statusFilter); countValues.push(statusFilter);
        }

        if (updatedAfter) {
            const c = ' AND updated_at >= ?';
            sql += c; countSql += c;
            values.push(updatedAfter); countValues.push(updatedAfter);
        }
        if (updatedBefore) {
            const c = ' AND updated_at <= ?';
            sql += c; countSql += c;
            values.push(updatedBefore); countValues.push(updatedBefore);
        }

        const finalSort = ALLOWED_SORT_FIELDS.has(sortBy) ? sortBy : 'job_id';
        const dir = sortOrder === 'ASC' ? 'ASC' : 'DESC';
        const orderBy = finalSort === 'job_id'
            ? `CAST(job_id AS INTEGER) ${dir}, job_id ${dir}`
            : `${finalSort} ${dir}`;

        sql += ` ORDER BY ${relevanceClause}${orderBy} LIMIT ? OFFSET ?`;
        values.push(...relevanceValues, limit, offset);

        const records = this.db.prepare(sql).all(...values);
        const total   = this.db.prepare(countSql).get(...countValues).total;

        return { records, total };
    }

    updateRecord(partno, updates) {
        const keys = Object.keys(updates).filter(k => ALLOWED_WRITE_FIELDS.has(k));
        if (!keys.length) return;

        let current = {};
        try { current = this.db.prepare('SELECT * FROM assemblies WHERE partno = ?').get(partno) || {}; } catch (_) {}

        const sql    = `UPDATE assemblies SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = ? WHERE partno = ?`;
        const values = [...keys.map(k => updates[k]), new Date().toISOString(), partno];
        this.db.prepare(sql).run(...values);
        this._clearDistinctCache();

        const changedBy = updates.updated_by || null;
        for (const k of keys) {
            if (k === 'updated_by') continue;
            const oldVal = current[k] ?? null;
            const newVal = updates[k] ?? null;
            if (String(oldVal) !== String(newVal)) {
                this.logAudit(partno, 'update', k, oldVal, newVal, changedBy);
            }
        }
    }

    getDistinct(column) {
        const now    = Date.now();
        const cached = this._distinctCache.get(column);
        if (cached && cached.expiresAt > now) return cached.value;

        const value = this.db.prepare(`
            SELECT COALESCE(NULLIF(${column}, ''), 'None') as value, COUNT(*) as count
            FROM assemblies
            GROUP BY value
            ORDER BY count DESC
        `).all();

        this._distinctCache.set(column, { value, expiresAt: now + this._CACHE_TTL });
        return value;
    }

    getCounts() {
        const row = this.db.prepare(`
            SELECT
                COUNT(*) as globalTotal,
                SUM(CASE WHEN sdc_standard = 'Yes' THEN 1 ELSE 0 END) as sdcStandardCount,
                SUM(CASE WHEN preference = 'Yes' THEN 1 ELSE 0 END) as preferredCount
            FROM assemblies
        `).get();
        return {
            globalTotal: row.globalTotal || 0,
            sdcStandardCount: row.sdcStandardCount || 0,
            preferredCount: row.preferredCount || 0,
        };
    }

    _clearDistinctCache() {
        this._distinctCache.clear();
    }

    softDelete(partno) {
        this.db.prepare(`UPDATE assemblies SET deleted_at = datetime('now') WHERE partno = ?`).run(partno);
        this._clearDistinctCache();
        this.logAudit(partno, 'archive', null, null, null, null);
    }

    restore(partno) {
        this.db.prepare(`UPDATE assemblies SET deleted_at = NULL WHERE partno = ?`).run(partno);
        this._clearDistinctCache();
        this.logAudit(partno, 'restore', null, null, null, null);
    }

    logAudit(partno, action, field, oldValue, newValue, changedBy) {
        try {
            this.db.prepare(`
                INSERT INTO audit_log (partno, action, field, old_value, new_value, changed_by)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(partno, action, field ?? null, oldValue ?? null, newValue ?? null, changedBy ?? null);
        } catch (_) {}
    }

    getAuditLog(partno) {
        try {
            return this.db.prepare(
                `SELECT * FROM audit_log WHERE partno = ? ORDER BY changed_at DESC LIMIT 50`
            ).all(partno);
        } catch (_) { return []; }
    }

    getLastScanTimestamp() {
        const row = this.db.prepare('SELECT MAX(updated_at) as last_scan FROM assemblies').get();
        return row ? row.last_scan : null;
    }

    async backup() {
        const backupDir = path.join(config.SHARED_BASE, 'backups');
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

        const ts         = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const backupPath = path.join(backupDir, `assemblies-${ts}.db`);

        await this.db.backup(backupPath);

        const files = fs.readdirSync(backupDir)
            .filter(f => f.startsWith('assemblies-') && f.endsWith('.db'))
            .sort();
        while (files.length > 7) {
            try { fs.unlinkSync(path.join(backupDir, files.shift())); } catch (_) {}
        }

        return backupPath;
    }

    static get ALLOWED_WRITE_FIELDS() { return ALLOWED_WRITE_FIELDS; }

    close() {
        try { this.db.close(); } catch (_) {}
    }
}

module.exports = new DbService();
