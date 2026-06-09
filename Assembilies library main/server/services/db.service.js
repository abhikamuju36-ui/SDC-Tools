/**
 * db.service.js — MySQL edition.
 *
 * Replaces better-sqlite3 with mysql2/promise.
 * All methods are async. The exported API is identical to the SQLite version
 * so controllers and services need only minor await additions.
 *
 * Database: sdc_assemblies
 */

const mysql = require('mysql2/promise');

// ── Whitelists (SQL-injection prevention) ─────────────────────────────────────
const ALLOWED_SEARCH_FIELDS = new Set([
    'description', 'partno', 'file_name', 'job_id', 'job_name', 'comments', 'category', 'updated_by',
]);
const ALLOWED_SORT_FIELDS = new Set(['job_id', 'updated_at', 'partno', 'category']);
const ALLOWED_WRITE_FIELDS = new Set([
    'job_id', 'job_name', 'file_name', 'partno', 'description', 'category',
    'comments', 'updated_by', 'model_link', 'picture_link', 'preference',
    'sdc_standard', 'library', 'status',
]);

// ── In-process fuzzy scorer (same algorithm as the original SQLite UDF) ───────
function computeScore(text, term) {
    if (!text || !term) return 0;
    const t = String(text).toLowerCase();
    const q = String(term).toLowerCase();
    if (t === q) return 100;
    if (t.includes(q)) return 80;

    const words = t.split(/[^a-z0-9]+/).filter(Boolean);
    let maxScore = 0;
    for (const w of words) {
        if (w === q)                                          { maxScore = Math.max(maxScore, 90); continue; }
        if (w.includes(q) || (w.length >= 3 && q.includes(w))) { maxScore = Math.max(maxScore, 70); continue; }
        if (q.length < 3) continue;
        const alen = w.length, blen = q.length;
        if (Math.abs(alen - blen) > 2) continue;
        const tmp = Array.from({ length: alen + 1 }, (_, i) => [i]);
        for (let j = 0; j <= blen; j++) tmp[0][j] = j;
        for (let i = 1; i <= alen; i++)
            for (let j = 1; j <= blen; j++) {
                const cost = w[i - 1] === q[j - 1] ? 0 : 1;
                tmp[i][j] = Math.min(tmp[i - 1][j] + 1, tmp[i][j - 1] + 1, tmp[i - 1][j - 1] + cost);
            }
        const dist      = tmp[alen][blen];
        const maxErrors = blen >= 7 ? 2 : blen >= 4 ? 1 : 0;
        if (dist <= maxErrors) maxScore = Math.max(maxScore, 60 - dist * 10);
    }
    return maxScore;
}

function fuzzyMatch(text, term) { return computeScore(text, term) >= 40; }

// ── Connection pool ───────────────────────────────────────────────────────────
let _pool = null;
function getPool() {
    if (!_pool) {
        _pool = mysql.createPool({
            host:               process.env.MYSQL_HOST     || 'localhost',
            port:               Number(process.env.MYSQL_PORT) || 3306,
            user:               process.env.MYSQL_USER     || 'root',
            password:           process.env.MYSQL_PASSWORD || '',
            database:           process.env.MYSQL_DATABASE || 'sdc_assemblies',
            waitForConnections: true,
            connectionLimit:    10,
            timezone:           'Z',
            decimalNumbers:     true,
            multipleStatements: false,
        });
    }
    return _pool;
}

async function q(sql, params = []) {
    const [rows] = await getPool().execute(sql, params);
    return rows;
}

// ── DbService ─────────────────────────────────────────────────────────────────
class DbService {
    constructor() {
        this._distinctCache = new Map();
        this._CACHE_TTL     = 30_000;
    }

    // ── Read ──────────────────────────────────────────────────────────────────
    async readAll() {
        return q('SELECT * FROM assemblies WHERE deleted_at IS NULL ORDER BY CAST(job_id AS UNSIGNED) DESC, job_id DESC');
    }

    async getOne(partno) {
        const rows = await q('SELECT * FROM assemblies WHERE partno = ? LIMIT 1', [partno]);
        return rows[0] || null;
    }

    // ── Write (upsert batch) ──────────────────────────────────────────────────
    async writeAll(records) {
        if (!records || records.length === 0) return;
        const pool = getPool();
        const conn = await pool.getConnection();
        const newPartnos = [];

        try {
            await conn.beginTransaction();

            for (const item of records) {
                // Try INSERT IGNORE (inserts only if job_id+partno pair is new)
                const [ins] = await conn.execute(
                    `INSERT IGNORE INTO assemblies
                       (job_id, job_name, file_name, partno, description, category,
                        comments, updated_by, created_at, updated_at, model_link,
                        picture_link, preference, sdc_standard, \`library\`,
                        thumbnail, \`path\`, last_modified, size_bytes)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        item.job_id       ?? null,
                        item.job_name     ?? null,
                        item.file_name    ?? null,
                        item.partno,
                        item.description  ?? null,
                        item.category     ?? null,
                        item.comments     ?? null,
                        item.updated_by   ?? null,
                        item.created_at   ?? null,
                        item.updated_at   ?? null,
                        item.model_link   ?? null,
                        item.picture_link ?? null,
                        item.preference   ?? null,
                        item.sdc_standard ?? null,
                        item.library      ?? null,
                        item.thumbnail    ?? null,
                        item.path         ?? null,
                        item.last_modified ?? null,
                        item.size         ?? item.size_bytes ?? null,
                    ]
                );

                if (ins.affectedRows > 0) {
                    newPartnos.push(item.partno);
                } else {
                    // Existing row — refresh file system fields only
                    await conn.execute(
                        `UPDATE assemblies
                         SET model_link = ?, picture_link = ?, thumbnail = ?,
                             \`path\` = ?, last_modified = ?, size_bytes = ?
                         WHERE partno = ? AND COALESCE(job_id, '') = COALESCE(?, '')`,
                        [
                            item.model_link    ?? null,
                            item.picture_link  ?? null,
                            item.thumbnail     ?? null,
                            item.path          ?? null,
                            item.last_modified ?? null,
                            item.size          ?? item.size_bytes ?? null,
                            item.partno,
                            item.job_id        ?? null,
                        ]
                    );
                }
            }

            await conn.commit();
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }

        this._clearDistinctCache();

        // Audit log new records (outside transaction — non-critical)
        for (const partno of newPartnos) {
            const rec = records.find(r => r.partno === partno);
            await this.logAudit(partno, 'create', null, null, null, rec?.updated_by || null);
        }
    }

    // ── Complex query with fuzzy search + filters + pagination ────────────────
    async query(params = {}) {
        const {
            search,
            searchFields = ['description', 'partno', 'file_name', 'job_id', 'job_name'],
            sortBy       = 'job_id',
            sortOrder    = 'DESC',
            limit        = 40,
            offset       = 0,
            libraries, jobs, categories,
            modelFilter, imageFilter,
            sdcStandards, preferences,
            statusFilter, updatedAfter, updatedBefore,
            includeDeleted = false,
        } = params;

        // Build base WHERE clause (filters — no search yet)
        let where  = '1=1';
        const vals = [];

        const addFilter = (col, items) => {
            if (!items) return;
            const list = (Array.isArray(items) ? items : items.split(',')).map(s => s.trim()).filter(Boolean);
            if (!list.length) return;
            const hasNone = list.includes('None');
            const others  = list.filter(i => i !== 'None');
            const parts   = [];
            if (others.length) {
                parts.push(`\`${col}\` IN (${others.map(() => '?').join(',')})`);
                vals.push(...others);
            }
            if (hasNone) {
                parts.push(`(\`${col}\` IS NULL OR \`${col}\` = '' OR \`${col}\` = 'None')`);
            }
            if (parts.length) where += ` AND (${parts.join(' OR ')})`;
        };

        addFilter('library',      libraries);
        addFilter('job_id',       jobs);
        addFilter('category',     categories);
        addFilter('sdc_standard', sdcStandards);
        addFilter('preference',   preferences);

        const addBinary = (col, filter) => {
            if (filter === 'Yes')      { where += ` AND \`${col}\` IS NOT NULL AND \`${col}\` != ''`; }
            else if (filter === 'No')  { where += ` AND (\`${col}\` IS NULL OR \`${col}\` = '')`; }
        };
        addBinary('model_link',   modelFilter);
        addBinary('picture_link', imageFilter);

        if (!includeDeleted) where += ' AND deleted_at IS NULL';
        if (statusFilter)    { where += ' AND status = ?';      vals.push(statusFilter); }
        if (updatedAfter)    { where += ' AND updated_at >= ?'; vals.push(updatedAfter); }
        if (updatedBefore)   { where += ' AND updated_at <= ?'; vals.push(updatedBefore); }

        // ── No search → pure SQL pagination ──────────────────────────────────
        if (!search || !search.trim()) {
            const finalSort = ALLOWED_SORT_FIELDS.has(sortBy) ? sortBy : 'job_id';
            const dir       = sortOrder === 'ASC' ? 'ASC' : 'DESC';
            const orderBy   = finalSort === 'job_id'
                ? `CAST(job_id AS UNSIGNED) ${dir}, job_id ${dir}`
                : `\`${finalSort}\` ${dir}`;

            // LIMIT/OFFSET must be inlined — mysql2 prepared statements reject them as params
            const safeLimit  = parseInt(limit,  10) || 40;
            const safeOffset = parseInt(offset, 10) || 0;
            const [rows]   = await getPool().execute(`SELECT * FROM assemblies WHERE ${where} ORDER BY ${orderBy} LIMIT ${safeLimit} OFFSET ${safeOffset}`, vals);
            const [totRow] = await getPool().execute(`SELECT COUNT(*) AS total FROM assemblies WHERE ${where}`, vals);
            return { records: rows, total: totRow[0].total };
        }

        // ── Search: get candidates via LIKE, then JS fuzzy-score + paginate ──
        const rawFields = Array.isArray(searchFields) ? searchFields : searchFields.split(',');
        const fields    = rawFields.map(f => f.trim()).filter(f => ALLOWED_SEARCH_FIELDS.has(f));
        if (!fields.length) fields.push('description');

        const searchTerms = search.trim().split(/\s+/).filter(Boolean);

        // Build LIKE clause: each term must match at least one field
        const termClauses = [];
        const termVals    = [];
        for (const term of searchTerms) {
            const fieldClauses = fields.map(f => `\`${f}\` LIKE ?`);
            termClauses.push(`(${fieldClauses.join(' OR ')})`);
            fields.forEach(() => termVals.push(`%${term}%`));
        }
        const searchWhere = termClauses.join(' AND ');

        const candidateVals = [...vals, ...termVals];
        const candidateSQL  = `SELECT * FROM assemblies WHERE ${where} AND ${searchWhere}`;
        const [candidates]  = await getPool().execute(candidateSQL, candidateVals);

        // Score each candidate in JS
        const scored = candidates.map(row => {
            let score = 0;
            for (const term of searchTerms)
                for (const f of fields)
                    score += computeScore(row[f], term);
            return { row, score };
        });

        // Filter to rows that have at least one field matching the fuzzy threshold
        const matched = scored.filter(({ row }) =>
            searchTerms.every(term => fields.some(f => fuzzyMatch(row[f], term)))
        );

        // Sort by relevance DESC
        matched.sort((a, b) => b.score - a.score);

        const total   = matched.length;
        const records = matched.slice(offset, offset + limit).map(({ row }) => row);
        return { records, total };
    }

    // ── Update single record ──────────────────────────────────────────────────
    async updateRecord(partno, updates) {
        const keys = Object.keys(updates).filter(k => ALLOWED_WRITE_FIELDS.has(k));
        if (!keys.length) return;

        let current = {};
        try { current = await this.getOne(partno) || {}; } catch (_) {}

        const setClauses = [...keys.map(k => `\`${k}\` = ?`), 'updated_at = ?'].join(', ');
        const values     = [...keys.map(k => updates[k]), new Date().toISOString(), partno];
        await q(`UPDATE assemblies SET ${setClauses} WHERE partno = ?`, values);
        this._clearDistinctCache();

        const changedBy = updates.updated_by || null;
        for (const k of keys) {
            if (k === 'updated_by') continue;
            const oldVal = current[k] ?? null;
            const newVal = updates[k] ?? null;
            if (String(oldVal) !== String(newVal)) {
                await this.logAudit(partno, 'update', k, oldVal, newVal, changedBy);
            }
        }
    }

    // ── Distinct values (with 30-second in-memory cache) ─────────────────────
    async getDistinct(column) {
        const now    = Date.now();
        const cached = this._distinctCache.get(column);
        if (cached && cached.expiresAt > now) return cached.value;

        const rows = await q(
            `SELECT COALESCE(NULLIF(\`${column}\`, ''), 'None') AS \`value\`, COUNT(*) AS \`count\`
             FROM assemblies
             WHERE deleted_at IS NULL
             GROUP BY \`value\`
             ORDER BY \`count\` DESC`
        );
        this._distinctCache.set(column, { value: rows, expiresAt: now + this._CACHE_TTL });
        return rows;
    }

    async getCounts() {
        const rows = await q(`
            SELECT
                COUNT(*) AS globalTotal,
                SUM(CASE WHEN sdc_standard = 'Yes' THEN 1 ELSE 0 END) AS sdcStandardCount,
                SUM(CASE WHEN preference   = 'Yes' THEN 1 ELSE 0 END) AS preferredCount
            FROM assemblies
        `);
        const row = rows[0] || {};
        return {
            globalTotal:      Number(row.globalTotal)      || 0,
            sdcStandardCount: Number(row.sdcStandardCount) || 0,
            preferredCount:   Number(row.preferredCount)   || 0,
        };
    }

    _clearDistinctCache() { this._distinctCache.clear(); }

    // ── Soft delete / restore ─────────────────────────────────────────────────
    async softDelete(partno) {
        await q(`UPDATE assemblies SET deleted_at = ? WHERE partno = ?`, [new Date().toISOString(), partno]);
        this._clearDistinctCache();
        await this.logAudit(partno, 'archive', null, null, null, null);
    }

    async restore(partno) {
        await q('UPDATE assemblies SET deleted_at = NULL WHERE partno = ?', [partno]);
        this._clearDistinctCache();
        await this.logAudit(partno, 'restore', null, null, null, null);
    }

    // ── Hard delete ───────────────────────────────────────────────────────────
    async deleteOne(partno) {
        const result = await q('DELETE FROM assemblies WHERE partno = ?', [partno]);
        if (result.affectedRows > 0) {
            await this.logAudit(partno, 'delete', null, null, null, 'User');
            this._clearDistinctCache();
        }
        return result.affectedRows;
    }

    // ── Bulk update ───────────────────────────────────────────────────────────
    async bulkUpdate(partnos, field, value) {
        if (!partnos || !partnos.length) return 0;
        if (!ALLOWED_WRITE_FIELDS.has(field)) throw new Error(`Field "${field}" is not writable`);
        const placeholders = partnos.map(() => '?').join(', ');
        const result = await q(
            `UPDATE assemblies SET \`${field}\` = ?, updated_at = ? WHERE partno IN (${placeholders}) AND deleted_at IS NULL`,
            [value, new Date().toISOString(), ...partnos]
        );
        this._clearDistinctCache();
        return result.affectedRows;
    }

    // ── Bulk delete ───────────────────────────────────────────────────────────
    async bulkDelete(partnos) {
        if (!partnos || !partnos.length) return 0;
        const placeholders = partnos.map(() => '?').join(', ');
        const result = await q(`DELETE FROM assemblies WHERE partno IN (${placeholders})`, partnos);
        this._clearDistinctCache();
        return result.affectedRows;
    }

    // ── Stale link clearing ───────────────────────────────────────────────────
    async clearStaleLink(partno, jobId, _fileName) {
        await q(
            `UPDATE assemblies SET model_link = NULL, \`path\` = NULL
             WHERE partno = ? AND COALESCE(job_id, '') = COALESCE(?, '')`,
            [partno, jobId ?? null]
        );
        await this.logAudit(partno, 'stale-link-cleared', 'model_link', null, null, 'Sync');
    }

    // ── Backfill thumbnail column (one-time maintenance) ──────────────────────
    async backfillThumbnailColumn() {
        const rows = await q(
            `SELECT partno, job_id, picture_link FROM assemblies
             WHERE picture_link IS NOT NULL AND picture_link != ''
               AND (thumbnail IS NULL OR thumbnail = '')`
        );
        if (!rows.length) return 0;

        const pool = getPool();
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            for (const row of rows) {
                const thumb = row.picture_link.split('/').pop().split('\\').pop();
                if (thumb) {
                    await conn.execute(
                        `UPDATE assemblies SET thumbnail = ?
                         WHERE partno = ? AND COALESCE(job_id, '') = COALESCE(?, '')`,
                        [thumb, row.partno, row.job_id ?? null]
                    );
                }
            }
            await conn.commit();
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }
        return rows.length;
    }

    // ── Audit log ─────────────────────────────────────────────────────────────
    async logAudit(partno, action, field, oldValue, newValue, changedBy) {
        try {
            await q(
                'INSERT INTO audit_log (partno, action, field, old_value, new_value, changed_by) VALUES (?, ?, ?, ?, ?, ?)',
                [partno, action, field ?? null, oldValue ?? null, newValue ?? null, changedBy ?? null]
            );
        } catch (_) {}
    }

    async getAuditLog(partno) {
        try {
            return q('SELECT * FROM audit_log WHERE partno = ? ORDER BY changed_at DESC LIMIT 50', [partno]);
        } catch (_) { return []; }
    }

    // ── Sync history ──────────────────────────────────────────────────────────
    async getLastScanTimestamp() {
        const rows = await q('SELECT MAX(updated_at) AS last_scan FROM assemblies');
        return rows[0]?.last_scan || null;
    }

    async logSyncRun({ newRecords, extracted, stale, failed, linked, total, durationS, error }) {
        try {
            await q(
                'INSERT INTO sync_history (new_records, extracted, stale, failed, linked, total, duration_s, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [newRecords ?? 0, extracted ?? 0, stale ?? 0, failed ?? 0, linked ?? 0, total ?? 0, durationS ?? null, error ?? null]
            );
            // Keep last 100 runs
            await q(
                `DELETE FROM sync_history WHERE id NOT IN (
                    SELECT id FROM (SELECT id FROM sync_history ORDER BY id DESC LIMIT 100) t
                )`
            );
        } catch (_) {}
    }

    async getSyncHistory(limit = 20) {
        try {
            const n = parseInt(limit, 10) || 20;
            return q(`SELECT * FROM sync_history ORDER BY id DESC LIMIT ${n}`);
        } catch (_) { return []; }
    }

    async getLastSyncRun() {
        try {
            const rows = await q('SELECT * FROM sync_history ORDER BY id DESC LIMIT 1');
            return rows[0] || null;
        } catch (_) { return null; }
    }

    // ── Backup (MySQL — no-op, use mysqldump externally) ─────────────────────
    async backup() {
        console.log('[DB] MySQL backup: use mysqldump for backups. Skipping file-level backup.');
        return null;
    }

    close() {
        if (_pool) { _pool.end().catch(() => {}); _pool = null; }
    }

    static get ALLOWED_WRITE_FIELDS() { return ALLOWED_WRITE_FIELDS; }
}

module.exports = new DbService();
