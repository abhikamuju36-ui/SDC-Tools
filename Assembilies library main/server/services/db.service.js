/**
 * db.service.js — Azure SQL edition
 *
 * Replaces better-sqlite3 with mssql (pure JS — no native module needed).
 * Same public API as the SQLite version so existing callers work with
 * `await` added where needed.
 *
 * Storage: Azure SQL [assemblies].[assemblies] + [assemblies].[audit_log]
 */
'use strict';

const azureDb = require('../azureDb');

// ── Allowed columns (SQL-injection prevention) ────────────────────────────────
const ALLOWED_SEARCH_FIELDS = new Set([
    'description', 'partno', 'file_name', 'job_id', 'job_name',
    'comments', 'category', 'updated_by',
]);
const ALLOWED_SORT_FIELDS = new Set(['job_id', 'updated_at', 'partno', 'category']);
const ALLOWED_WRITE_FIELDS = new Set([
    'job_id', 'job_name', 'file_name', 'partno', 'description', 'category',
    'comments', 'updated_by', 'model_link', 'picture_link', 'preference',
    'sdc_standard', 'library', 'status',
]);

// ── Fuzzy scoring (same algorithm as before — now runs in JS, not SQLite) ────
function computeScore(text, term) {
    if (!text || !term) return 0;
    const t = String(text).toLowerCase();
    const q = String(term).toLowerCase();
    if (t === q) return 100;
    if (t.includes(q)) return 80;

    const words = t.split(/[^a-z0-9]+/).filter(Boolean);
    let maxScore = 0;
    for (const w of words) {
        if (w === q) { maxScore = Math.max(maxScore, 90); continue; }
        if (w.includes(q) || (w.length >= 3 && q.includes(w))) {
            maxScore = Math.max(maxScore, 70); continue;
        }
        if (q.length < 3) continue;
        const alen = w.length, blen = q.length;
        if (Math.abs(alen - blen) > 2) continue;
        const tmp = [];
        for (let i = 0; i <= alen; i++) tmp[i] = [i];
        for (let j = 0; j <= blen; j++) tmp[0][j] = j;
        for (let i = 1; i <= alen; i++) {
            for (let j = 1; j <= blen; j++) {
                const cost = (w[i - 1] === q[j - 1]) ? 0 : 1;
                tmp[i][j] = Math.min(
                    tmp[i - 1][j] + 1,
                    tmp[i][j - 1] + 1,
                    tmp[i - 1][j - 1] + cost,
                );
            }
        }
        const dist = tmp[alen][blen];
        const maxErrors = blen >= 7 ? 2 : (blen >= 4 ? 1 : 0);
        if (dist <= maxErrors) maxScore = Math.max(maxScore, 60 - dist * 10);
    }
    return maxScore;
}

function fuzzyMatch(text, term) { return computeScore(text, term) >= 40; }

// ── Helpers ───────────────────────────────────────────────────────────────────
function nvMax(val) { return { type: azureDb.sql.NVarChar(azureDb.sql.MAX), value: val ?? null }; }
function nv200(val) { return { type: azureDb.sql.NVarChar(200),  value: val ?? null }; }
function nv500(val) { return { type: azureDb.sql.NVarChar(500),  value: val ?? null }; }
function nv50(val)  { return { type: azureDb.sql.NVarChar(50),   value: val ?? null }; }

// ─────────────────────────────────────────────────────────────────────────────

class DbService {
    constructor() {
        this._distinctCache = new Map(); // { column → { value, expiresAt } }
        this._CACHE_TTL     = 30_000;   // 30-second TTL

        // Initialise schema in background — server starts without waiting
        azureDb.ensureSchema()
            .then(() => console.log('[DB:assemblies] Azure SQL schema ready — 25k+ records available.'))
            .catch(e => console.error('[DB:assemblies] Schema init failed:', e.message));
    }

    // ─── Read all (used by sync) ──────────────────────────────────────────────
    async readAll() {
        const r = await azureDb.request();
        const result = await r.query('SELECT * FROM [assemblies].[assemblies] ORDER BY job_id DESC');
        return result.recordset;
    }

    // ─── Bulk upsert (INSERT new / UPDATE filesystem fields) ──────────────────
    // Mirrors the SQLite strategy:
    //   • New records  → insert all fields
    //   • Existing rows → update only filesystem-discovered fields
    //     (model_link, picture_link, thumbnail, path, last_modified, size)
    //     User-edited fields are NEVER overwritten.
    async writeAll(records) {
        if (!records || !records.length) return;
        const pool = await azureDb.getPool();

        // Process in batches of 100
        const BATCH = 100;
        for (let i = 0; i < records.length; i += BATCH) {
            const batch = records.slice(i, i + BATCH);
            for (const item of batch) {
                const req = pool.request();
                req.input('job_id',       azureDb.sql.NVarChar(200),             item.job_id       ?? null);
                req.input('job_name',     azureDb.sql.NVarChar(500),             item.job_name     ?? null);
                req.input('file_name',    azureDb.sql.NVarChar(500),             item.file_name    ?? null);
                req.input('partno',       azureDb.sql.NVarChar(200),             item.partno       ?? null);
                req.input('description',  azureDb.sql.NVarChar(azureDb.sql.MAX), item.description  ?? null);
                req.input('category',     azureDb.sql.NVarChar(200),             item.category     ?? null);
                req.input('comments',     azureDb.sql.NVarChar(azureDb.sql.MAX), item.comments     ?? null);
                req.input('updated_by',   azureDb.sql.NVarChar(200),             item.updated_by   ?? null);
                req.input('created_at',   azureDb.sql.NVarChar(50),              item.created_at   ?? null);
                req.input('updated_at',   azureDb.sql.NVarChar(50),              item.updated_at   ?? null);
                req.input('model_link',   azureDb.sql.NVarChar(azureDb.sql.MAX), item.model_link   ?? null);
                req.input('picture_link', azureDb.sql.NVarChar(azureDb.sql.MAX), item.picture_link ?? null);
                req.input('preference',   azureDb.sql.NVarChar(200),             item.preference   ?? null);
                req.input('sdc_standard', azureDb.sql.NVarChar(200),             item.sdc_standard ?? null);
                req.input('library',      azureDb.sql.NVarChar(200),             item.library      ?? null);
                req.input('thumbnail',    azureDb.sql.NVarChar(500),             item.thumbnail    ?? null);
                req.input('path',         azureDb.sql.NVarChar(azureDb.sql.MAX), item.path         ?? null);
                req.input('last_modified',azureDb.sql.NVarChar(50),              item.last_modified?? null);
                req.input('size',         azureDb.sql.BigInt,                    item.size         ?? null);

                await req.query(`
                    MERGE [assemblies].[assemblies] AS target
                    USING (SELECT @partno AS partno, COALESCE(@job_id,'') AS job_id) AS src
                       ON target.partno = src.partno
                      AND COALESCE(target.job_id,'') = src.job_id
                    WHEN MATCHED THEN
                        UPDATE SET
                            model_link    = @model_link,
                            picture_link  = @picture_link,
                            thumbnail     = @thumbnail,
                            path          = @path,
                            last_modified = @last_modified,
                            size          = @size
                    WHEN NOT MATCHED THEN
                        INSERT (job_id, job_name, file_name, partno, description,
                                category, comments, updated_by, created_at, updated_at,
                                model_link, picture_link, preference, sdc_standard,
                                library, thumbnail, path, last_modified, size)
                        VALUES (@job_id, @job_name, @file_name, @partno, @description,
                                @category, @comments, @updated_by, @created_at, @updated_at,
                                @model_link, @picture_link, @preference, @sdc_standard,
                                @library, @thumbnail, @path, @last_modified, @size);
                `);
            }
        }

        this._clearDistinctCache();
    }

    // ─── Clear stale filesystem links ─────────────────────────────────────────
    async clearStaleLink(partno, jobId, _fileName) {
        const req = await azureDb.request();
        req.input('partno',  azureDb.sql.NVarChar(200), partno);
        req.input('job_id',  azureDb.sql.NVarChar(200), jobId ?? '');
        await req.query(`
            UPDATE [assemblies].[assemblies]
            SET    model_link = NULL, path = NULL
            WHERE  partno = @partno
              AND  COALESCE(job_id, '') = @job_id
        `);
        this.logAudit(partno, 'stale-link-cleared', 'model_link', null, null, 'Sync').catch(() => {});
    }

    // ─── Backfill thumbnail column ────────────────────────────────────────────
    async backfillThumbnailColumn() {
        const req = await azureDb.request();
        const result = await req.query(`
            SELECT partno, job_id, picture_link
            FROM   [assemblies].[assemblies]
            WHERE  picture_link IS NOT NULL AND picture_link != ''
              AND  (thumbnail IS NULL OR thumbnail = '')
        `);
        const rows = result.recordset;
        let count = 0;
        for (const row of rows) {
            const thumb = (row.picture_link || '').split('/').pop().split('\\').pop();
            if (!thumb) continue;
            const r2 = await azureDb.request();
            r2.input('thumb',  azureDb.sql.NVarChar(500), thumb);
            r2.input('partno', azureDb.sql.NVarChar(200), row.partno);
            r2.input('job_id', azureDb.sql.NVarChar(200), row.job_id ?? '');
            await r2.query(`
                UPDATE [assemblies].[assemblies]
                SET    thumbnail = @thumb
                WHERE  partno = @partno
                  AND  COALESCE(job_id,'') = @job_id
            `);
            count++;
        }
        return count;
    }

    // ─── Paginated search ─────────────────────────────────────────────────────
    // Strategy:
    //   • No search term: pure SQL pagination (fast — let the DB do it)
    //   • Search term:    broad SQL LIKE filter → JS fuzzy scoring → JS pagination
    async query(params = {}) {
        const {
            search, searchFields = ['description', 'partno', 'file_name', 'job_id', 'job_name'],
            sortBy = 'job_id', sortOrder = 'DESC',
            limit = 40, offset = 0,
            libraries, jobs, categories,
            modelFilter, imageFilter, sdcStandards, preferences,
            statusFilter, updatedAfter, updatedBefore,
            includeDeleted = false,
        } = params;

        const pool   = await azureDb.getPool();
        const req    = pool.request();
        let   where  = '1=1';
        let   pIdx   = 0;

        const addParam = (val, type) => {
            const name = `p${pIdx++}`;
            req.input(name, type, val);
            return `@${name}`;
        };

        // ── Search (LIKE-based for SQL filter, fuzzy-scored in JS) ────────────
        const searchTerms = search
            ? search.trim().split(/\s+/).filter(Boolean)
            : [];

        if (searchTerms.length) {
            const rawFields = Array.isArray(searchFields)
                ? searchFields
                : String(searchFields).split(',');
            const fields = rawFields.map(f => f.trim()).filter(f => ALLOWED_SEARCH_FIELDS.has(f));
            if (!fields.length) fields.push('description');

            // Broad LIKE: must match at least one field for at least one term
            for (const term of searchTerms) {
                const likeClauses = fields.map(f => {
                    const p = addParam(`%${term}%`, azureDb.sql.NVarChar(azureDb.sql.MAX));
                    return `${f} LIKE ${p}`;
                });
                where += ` AND (${likeClauses.join(' OR ')})`;
            }
        }

        // ── IN filters ───────────────────────────────────────────────────────
        const addInFilter = (column, items) => {
            if (!items) return;
            const list = (Array.isArray(items) ? items : String(items).split(','))
                .map(x => x.trim()).filter(Boolean);
            if (!list.length) return;

            const hasNone  = list.includes('None');
            const others   = list.filter(i => i !== 'None');
            let   clause   = '';

            if (others.length) {
                const ps = others.map(v => addParam(v, azureDb.sql.NVarChar(200)));
                clause = `${column} IN (${ps.join(',')})`;
            }
            if (hasNone) {
                const noneClause = `(${column} IS NULL OR ${column}='' OR ${column}='None')`;
                clause = clause ? `(${clause} OR ${noneClause})` : noneClause;
            }
            if (clause) where += ` AND ${clause}`;
        };

        addInFilter('library',      libraries);
        addInFilter('job_id',       jobs);
        addInFilter('category',     categories);
        addInFilter('sdc_standard', sdcStandards);
        addInFilter('preference',   preferences);

        // ── Binary presence filters ───────────────────────────────────────────
        if (modelFilter === 'Yes') where += ' AND model_link IS NOT NULL AND model_link != \'\'';
        if (modelFilter === 'No')  where += ' AND (model_link IS NULL OR model_link = \'\')';
        if (imageFilter === 'Yes') where += ' AND picture_link IS NOT NULL AND picture_link != \'\'';
        if (imageFilter === 'No')  where += ' AND (picture_link IS NULL OR picture_link = \'\')';

        // ── Soft delete ───────────────────────────────────────────────────────
        if (!includeDeleted) where += ' AND deleted_at IS NULL';

        // ── Status ────────────────────────────────────────────────────────────
        if (statusFilter) {
            const p = addParam(statusFilter, azureDb.sql.NVarChar(50));
            where += ` AND status = ${p}`;
        }

        // ── Date range ────────────────────────────────────────────────────────
        if (updatedAfter) {
            const p = addParam(updatedAfter, azureDb.sql.NVarChar(50));
            where += ` AND updated_at >= ${p}`;
        }
        if (updatedBefore) {
            const p = addParam(updatedBefore, azureDb.sql.NVarChar(50));
            where += ` AND updated_at <= ${p}`;
        }

        // ── Sort ──────────────────────────────────────────────────────────────
        const finalSort = ALLOWED_SORT_FIELDS.has(sortBy) ? sortBy : 'job_id';
        const dir       = sortOrder === 'ASC' ? 'ASC' : 'DESC';
        const orderBy   = finalSort === 'job_id'
            ? `TRY_CAST(job_id AS INT) ${dir}, job_id ${dir}`
            : `${finalSort} ${dir}`;

        if (!searchTerms.length) {
            // ── Pure SQL pagination (fast path) ───────────────────────────────
            const countReq = pool.request();
            // Copy all inputs to count request
            for (const [k, v] of Object.entries(req.parameters || {})) {
                countReq.input(k, v.type, v.value);
            }
            const countResult = await countReq.query(
                `SELECT COUNT(*) AS total FROM [assemblies].[assemblies] WHERE ${where}`
            );
            const total = countResult.recordset[0].total;

            const lp = addParam(offset, azureDb.sql.Int);
            const fp = addParam(limit,  azureDb.sql.Int);
            const dataResult = await req.query(`
                SELECT * FROM [assemblies].[assemblies]
                WHERE ${where}
                ORDER BY ${orderBy}
                OFFSET ${lp} ROWS FETCH NEXT ${fp} ROWS ONLY
            `);

            return { records: dataResult.recordset, total };
        } else {
            // ── Fuzzy path: fetch broad set, score in JS ──────────────────────
            // Fetch up to 2000 broad-match rows, then score + paginate in JS.
            const rawFields = Array.isArray(searchFields)
                ? searchFields
                : String(searchFields).split(',');
            const fields = rawFields.map(f => f.trim()).filter(f => ALLOWED_SEARCH_FIELDS.has(f));
            if (!fields.length) fields.push('description');

            req.input('_fetchLimit', azureDb.sql.Int, 2000);
            const dataResult = await req.query(`
                SELECT TOP 2000 * FROM [assemblies].[assemblies]
                WHERE ${where}
                ORDER BY ${orderBy}
            `);

            // Score each record
            const scored = dataResult.recordset.map(row => {
                let totalScore = 0;
                for (const term of searchTerms) {
                    for (const f of fields) {
                        totalScore += computeScore(row[f], term);
                    }
                }
                return { ...row, _score: totalScore };
            }).filter(r => r._score > 0);

            // Sort by fuzzy score descending
            scored.sort((a, b) => b._score - a._score || 0);

            const total   = scored.length;
            const records = scored.slice(offset, offset + limit).map(({ _score, ...r }) => r);

            return { records, total };
        }
    }

    // ─── Single-record update ─────────────────────────────────────────────────
    async updateRecord(partno, updates) {
        const keys = Object.keys(updates).filter(k => ALLOWED_WRITE_FIELDS.has(k));
        if (!keys.length) return;

        // Read current for audit diff
        let current = {};
        try {
            const r = await azureDb.request();
            r.input('partno', azureDb.sql.NVarChar(200), partno);
            const res = await r.query(
                'SELECT * FROM [assemblies].[assemblies] WHERE partno = @partno'
            );
            current = res.recordset[0] || {};
        } catch (_) {}

        const req  = await azureDb.request();
        const sets = keys.map(k => {
            req.input(k, azureDb.sql.NVarChar(azureDb.sql.MAX), updates[k] ?? null);
            return `${k} = @${k}`;
        });
        req.input('updated_at', azureDb.sql.NVarChar(50), new Date().toISOString());
        req.input('partno',     azureDb.sql.NVarChar(200), partno);
        await req.query(`
            UPDATE [assemblies].[assemblies]
            SET    ${sets.join(', ')}, updated_at = @updated_at
            WHERE  partno = @partno
        `);
        this._clearDistinctCache();

        // Audit log
        const changedBy = updates.updated_by || null;
        for (const k of keys) {
            if (k === 'updated_by') continue;
            const oldVal = current[k] ?? null;
            const newVal = updates[k]  ?? null;
            if (String(oldVal) !== String(newVal)) {
                this.logAudit(partno, 'update', k, oldVal, newVal, changedBy).catch(() => {});
            }
        }
    }

    // ─── Bulk update ──────────────────────────────────────────────────────────
    async bulkUpdate(partnos, field, value) {
        if (!ALLOWED_WRITE_FIELDS.has(field)) throw new Error(`Field "${field}" not allowed`);
        if (!partnos || !partnos.length) return 0;
        const pool = await azureDb.getPool();
        const now  = new Date().toISOString();
        let updated = 0;
        for (const partno of partnos) {
            const req = pool.request();
            req.input('val',    azureDb.sql.NVarChar(azureDb.sql.MAX), String(value ?? '').slice(0, 2000));
            req.input('now',    azureDb.sql.NVarChar(50), now);
            req.input('partno', azureDb.sql.NVarChar(200), partno);
            const r = await req.query(
                `UPDATE [assemblies].[assemblies] SET ${field} = @val, updated_at = @now WHERE partno = @partno`
            );
            updated += r.rowsAffected[0] || 0;
        }
        this._clearDistinctCache();
        return updated;
    }

    // ─── Bulk hard delete ─────────────────────────────────────────────────────
    async bulkDelete(partnos) {
        if (!partnos || !partnos.length) return 0;
        const pool    = await azureDb.getPool();
        let   deleted = 0;
        for (const partno of partnos) {
            const req = pool.request();
            req.input('partno', azureDb.sql.NVarChar(200), partno);
            const r = await req.query(
                'DELETE FROM [assemblies].[assemblies] WHERE partno = @partno'
            );
            deleted += r.rowsAffected[0] || 0;
        }
        this._clearDistinctCache();
        return deleted;
    }

    // ─── Single hard delete ───────────────────────────────────────────────────
    async deleteOne(partno) {
        const req = await azureDb.request();
        req.input('partno', azureDb.sql.NVarChar(200), partno);
        const r = await req.query(
            'DELETE FROM [assemblies].[assemblies] WHERE partno = @partno'
        );
        this._clearDistinctCache();
        return r.rowsAffected[0] || 0;
    }

    // ─── Distinct values with TTL cache ──────────────────────────────────────
    async getDistinct(column) {
        if (!ALLOWED_SEARCH_FIELDS.has(column) && column !== 'library') {
            return [];
        }
        const now    = Date.now();
        const cached = this._distinctCache.get(column);
        if (cached && cached.expiresAt > now) return cached.value;

        const req    = await azureDb.request();
        const result = await req.query(`
            SELECT
                COALESCE(NULLIF(${column}, ''), 'None') AS value,
                COUNT(*) AS count
            FROM [assemblies].[assemblies]
            GROUP BY COALESCE(NULLIF(${column}, ''), 'None')
            ORDER BY count DESC
        `);
        const value = result.recordset;
        this._distinctCache.set(column, { value, expiresAt: now + this._CACHE_TTL });
        return value;
    }

    async getCounts() {
        const req    = await azureDb.request();
        const result = await req.query(`
            SELECT
                COUNT(*) AS globalTotal,
                SUM(CASE WHEN sdc_standard = 'Yes' THEN 1 ELSE 0 END) AS sdcStandardCount,
                SUM(CASE WHEN preference   = 'Yes' THEN 1 ELSE 0 END) AS preferredCount
            FROM [assemblies].[assemblies]
        `);
        const row = result.recordset[0] || {};
        return {
            globalTotal:      row.globalTotal      || 0,
            sdcStandardCount: row.sdcStandardCount || 0,
            preferredCount:   row.preferredCount   || 0,
        };
    }

    _clearDistinctCache() { this._distinctCache.clear(); }

    // ─── Soft delete / restore ────────────────────────────────────────────────
    async softDelete(partno) {
        const req = await azureDb.request();
        req.input('partno', azureDb.sql.NVarChar(200), partno);
        await req.query(
            "UPDATE [assemblies].[assemblies] SET deleted_at = CONVERT(NVARCHAR(50), GETUTCDATE(), 127) WHERE partno = @partno"
        );
        this._clearDistinctCache();
        this.logAudit(partno, 'archive', null, null, null, null).catch(() => {});
    }

    async restore(partno) {
        const req = await azureDb.request();
        req.input('partno', azureDb.sql.NVarChar(200), partno);
        await req.query(
            'UPDATE [assemblies].[assemblies] SET deleted_at = NULL WHERE partno = @partno'
        );
        this._clearDistinctCache();
        this.logAudit(partno, 'restore', null, null, null, null).catch(() => {});
    }

    // ─── Audit log ────────────────────────────────────────────────────────────
    async logAudit(partno, action, field, oldValue, newValue, changedBy) {
        try {
            const req = await azureDb.request();
            req.input('partno',     azureDb.sql.NVarChar(200),             partno);
            req.input('action',     azureDb.sql.NVarChar(100),             action);
            req.input('field',      azureDb.sql.NVarChar(200),             field      ?? null);
            req.input('old_value',  azureDb.sql.NVarChar(azureDb.sql.MAX), oldValue   ?? null);
            req.input('new_value',  azureDb.sql.NVarChar(azureDb.sql.MAX), newValue   ?? null);
            req.input('changed_by', azureDb.sql.NVarChar(200),             changedBy  ?? null);
            await req.query(`
                INSERT INTO [assemblies].[audit_log]
                    (partno, action, field, old_value, new_value, changed_by)
                VALUES
                    (@partno, @action, @field, @old_value, @new_value, @changed_by)
            `);
        } catch (_) {}
    }

    async getAuditLog(partno) {
        try {
            const req = await azureDb.request();
            req.input('partno', azureDb.sql.NVarChar(200), partno);
            const result = await req.query(`
                SELECT TOP 50 * FROM [assemblies].[audit_log]
                WHERE partno = @partno
                ORDER BY changed_at DESC
            `);
            return result.recordset;
        } catch (_) { return []; }
    }

    // ─── Last scan timestamp ──────────────────────────────────────────────────
    async getLastScanTimestamp() {
        try {
            const req    = await azureDb.request();
            const result = await req.query(
                'SELECT MAX(updated_at) AS last_scan FROM [assemblies].[assemblies]'
            );
            return result.recordset[0]?.last_scan ?? null;
        } catch (_) { return null; }
    }

    // ─── Backup — no-op (Azure SQL has built-in backup) ───────────────────────
    async backup() {
        console.log('[DB:assemblies] backup() called — Azure SQL has automatic backups, no action needed.');
        return null;
    }

    // ─── Expose ALLOWED_WRITE_FIELDS for controller validation ────────────────
    static get ALLOWED_WRITE_FIELDS() { return ALLOWED_WRITE_FIELDS; }
}

module.exports = new DbService();
