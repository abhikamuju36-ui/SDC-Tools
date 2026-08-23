/**
 * assemblies.controller.js
 */

const db       = require('../services/db.service');
const { execFile } = require('child_process');
const nodePath = require('path');
const fs       = require('fs');
const config   = require('../config/paths');
const syncService = require('../services/sync.service');

// ─── Input sanitisation ───────────────────────────────────────────────────────
const ALLOWED_WRITE_FIELDS = new Set([
    'job_id', 'job_name', 'file_name', 'partno', 'description', 'category',
    'comments', 'updated_by', 'model_link', 'picture_link', 'preference',
    'sdc_standard', 'library', 'status',
]);
const MAX_FIELD_LEN = 2000;

function sanitiseBody(body) {
    const out = {};
    for (const [k, v] of Object.entries(body || {})) {
        if (ALLOWED_WRITE_FIELDS.has(k)) {
            out[k] = String(v ?? '').slice(0, MAX_FIELD_LEN);
        }
    }
    return out;
}

// ─── Allowed roots for openFile ───────────────────────────────────────────────
function getAllowedRoots() {
    return [
        nodePath.resolve(config.DRIVES.N),
        nodePath.resolve(config.DRIVES.L),
        nodePath.resolve(config.SHARED_BASE),
    ].map(r => r.toLowerCase());
}

// ─── Delete password check ────────────────────────────────────────────────────
function checkDeletePassword(req, res) {
    const DELETE_PASSWORD = process.env.DELETE_PASSWORD;
    if (!DELETE_PASSWORD) {
        res.status(503).json({
            error: 'Delete disabled',
            detail: 'DELETE_PASSWORD is not configured on this server.',
        });
        return false;
    }
    if (req.headers['x-delete-password'] !== DELETE_PASSWORD) {
        res.status(403).json({ error: 'Forbidden', detail: 'Incorrect password.' });
        return false;
    }
    return true;
}

class AssembliesController {

    // ── Batch metadata ────────────────────────────────────────────────────────
    async getMeta(_req, res) {
        try {
            const [categories, jobs, libraries, dbScan] = await Promise.all([
                db.getDistinct('category'),
                db.getDistinct('job_id'),
                db.getDistinct('library'),
                db.getLastScanTimestamp(),
            ]);
            const memScan = syncService.getStatus().lastScan;
            const status  = {
                lastScan:      memScan ? memScan.toISOString() : dbScan,
                usingFallback: config.usingFallback,
            };
            res.json({ categories, jobs, libraries, status });
        } catch (e) {
            console.error('[Controller] getMeta:', e.message);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    // ── Metadata ──────────────────────────────────────────────────────────────
    async getCategories(_req, res) {
        try { res.json(await db.getDistinct('category')); }
        catch { res.status(500).json({ error: 'Database error' }); }
    }

    async getJobs(_req, res) {
        try { res.json(await db.getDistinct('job_id')); }
        catch { res.status(500).json({ error: 'Database error' }); }
    }

    async getLibraries(_req, res) {
        try { res.json(await db.getDistinct('library')); }
        catch { res.status(500).json({ error: 'Database error' }); }
    }

    async getStatus(_req, res) {
        try {
            const memScan = syncService.getStatus().lastScan;
            const dbScan  = await db.getLastScanTimestamp();
            res.json({
                lastScan:      memScan ? memScan.toISOString() : dbScan,
                usingFallback: config.usingFallback,
            });
        } catch { res.status(500).json({ error: 'Database error' }); }
    }

    async getCounts(_req, res) {
        try { res.json(await db.getCounts()); }
        catch { res.status(500).json({ error: 'Database error' }); }
    }

    // ── Paginated list ────────────────────────────────────────────────────────

    async getAll(req, res) {
        const {
            search = '', searchFields = 'description,partno,file_name,job_id,job_name',

            categories = '', jobIds = '',
            sortBy = 'job_id', sortOrder = 'DESC',
            page = '1', limit = '40',
            modelFilter = '', imageFilter = '',
            sdcStandards = '', preferences = '', libraries = '',
            statusFilter = '', updatedAfter = '', updatedBefore = '',
            includeDeleted = '',
        } = req.query;

        try {
            const pageNum  = Math.max(1, parseInt(page, 10) || 1);
            const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 40));
            const offset   = (pageNum - 1) * limitNum;

            const { records, total } = await db.query({
                search, searchFields,
                categories, jobs: jobIds, libraries,
                sortBy, sortOrder: sortOrder === 'ASC' ? 'ASC' : 'DESC',
                limit: limitNum, offset,
                modelFilter, imageFilter, sdcStandards, preferences,
                statusFilter: statusFilter || undefined,
                updatedAfter:  updatedAfter  || undefined,
                updatedBefore: updatedBefore || undefined,
                includeDeleted: includeDeleted === 'true',
            });

            res.json({ data: records, total, page: pageNum });
        } catch (err) {
            console.error('[Controller] getAll:', err.message);
            res.status(500).json({ error: 'Database error' });
        }
    }

    // ── Create ────────────────────────────────────────────────────────────────
    async create(req, res) {
        try {
            const sanitised = sanitiseBody(req.body);
            if (!sanitised.partno) {
                return res.status(400).json({ error: 'Validation error', detail: 'partno is required.' });
            }
            sanitised.created_at = sanitised.created_at || new Date().toISOString();
            sanitised.updated_at = new Date().toISOString();
            await db.writeAll([sanitised]);
            res.status(201).json({ success: true, assembly: sanitised });
        } catch (err) {
            console.error('[Controller] create:', err.message);
            res.status(500).json({ error: 'Database error' });
        }
    }

    // ── Update single ─────────────────────────────────────────────────────────
    async update(req, res) {
        const { partno } = req.params;
        if (!partno) return res.status(400).json({ error: 'partno is required' });
        try {
            const sanitised = sanitiseBody(req.body);
            if (!Object.keys(sanitised).length) {
                return res.status(400).json({ error: 'No valid fields provided' });
            }
            await db.updateRecord(partno, sanitised);
            const updated = await db.getOne(partno);
            res.json({ success: true, updated });
        } catch (err) {
            console.error('[Controller] update:', err.message);
            res.status(500).json({ error: 'Database error' });
        }
    }

    // ── Bulk update — single atomic transaction ────────────────────────────────
    async bulkUpdate(req, res) {
        const { partnos, field, value } = req.body;
        if (!Array.isArray(partnos) || !partnos.length) {
            return res.status(400).json({ error: 'No part numbers provided' });
        }
        if (!ALLOWED_WRITE_FIELDS.has(field)) {
            return res.status(400).json({ error: 'Invalid field', detail: `"${field}" cannot be bulk-updated.` });
        }
        try {
            const safeValue = String(value ?? '').slice(0, MAX_FIELD_LEN);
            const updated   = await db.bulkUpdate(partnos, field, safeValue);
            res.json({ success: true, updated });
        } catch (err) {
            console.error('[Controller] bulkUpdate:', err.message);
            res.status(500).json({ error: 'Database error' });
        }
    }

    // ── Bulk delete ───────────────────────────────────────────────────────────
    async bulkDelete(req, res) {
        if (!checkDeletePassword(req, res)) return;
        const { partnos } = req.body;
        if (!Array.isArray(partnos) || !partnos.length) {
            return res.status(400).json({ error: 'No part numbers provided' });
        }
        try {
            const deleted = await db.bulkDelete(partnos);
            res.json({ success: true, deleted });
        } catch (err) {
            console.error('[Controller] bulkDelete:', err.message);
            res.status(500).json({ error: 'Database error' });
        }
    }

    // ── Soft delete (archive) / restore ──────────────────────────────────────
    async archiveOne(req, res) {
        try {
            await db.softDelete(req.params.partno);
            res.json({ success: true });
        } catch (err) {
            console.error('[Controller] archiveOne:', err.message);
            res.status(500).json({ error: 'Database error' });
        }
    }

    async restoreOne(req, res) {
        try {
            await db.restore(req.params.partno);
            res.json({ success: true });
        } catch (err) {
            console.error('[Controller] restoreOne:', err.message);
            res.status(500).json({ error: 'Database error' });
        }
    }

    // ── Audit history ─────────────────────────────────────────────────────────
    async getHistory(req, res) {
        try {
            const log = await db.getAuditLog(req.params.partno);
            res.json(log);
        } catch (err) {
            console.error('[Controller] getHistory:', err.message);
            res.status(500).json({ error: 'Database error' });
        }
    }

    // ── Delete single ─────────────────────────────────────────────────────────
    async deleteOne(req, res) {
        if (!checkDeletePassword(req, res)) return;
        try {
            await db.deleteOne(req.params.partno);
            res.json({ success: true });
        } catch (err) {
            console.error('[Controller] deleteOne:', err.message);
            res.status(500).json({ error: 'Database error' });
        }
    }

    // ── CSV Export ────────────────────────────────────────────────────────────
    async exportCsv(req, res) {
        try {
            const {
                search = '', searchFields = 'description,partno,file_name,job_id,job_name',
                categories = '', jobIds = '',
                sortBy = 'job_id', sortOrder = 'DESC',
                modelFilter = '', imageFilter = '',
                sdcStandards = '', preferences = '', libraries = '',
            } = req.query;

            const { records } = await db.query({
                search, searchFields,
                categories, jobs: jobIds, libraries,
                sortBy, sortOrder: sortOrder === 'ASC' ? 'ASC' : 'DESC',
                limit: 10000, offset: 0,
                modelFilter, imageFilter, sdcStandards, preferences,
            });

            const cols = ['partno','job_id','job_name','file_name','description','category','comments',
                          'preference','sdc_standard','updated_by','model_link','picture_link','updated_at'];
            const escape = v => v == null ? '' : `"${String(v).replace(/"/g, '""')}"`;
            const csv = [cols.join(','), ...records.map(r => cols.map(c => escape(r[c])).join(','))].join('\r\n');

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="assemblies.csv"');
            res.send(csv);
        } catch (e) {
            console.error('[Controller] exportCsv:', e.message);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    // ── Open file in Explorer / default app ───────────────────────────────────
    async openFile(req, res) {
        const { path: filePath } = req.query;
        if (!filePath) return res.status(400).json({ error: 'Path is required' });

        // 1. Validate extension
        const allowedExts = ['.sldasm', '.sldprt', '.jpg', '.png', '.jpeg', '.pdf', '.docx', '.xlsx'];
        const ext = nodePath.extname(filePath).toLowerCase();
        if (!allowedExts.includes(ext)) {
            return res.status(403).json({ error: 'Forbidden file type', detail: `Allowed: ${allowedExts.join(', ')}` });
        }

        // 2. Resolve and canonicalise (follows symlinks to prevent traversal)
        let resolved;
        try {
            resolved = fs.realpathSync(nodePath.resolve(filePath));
        } catch {
            // File doesn't exist yet — fall back to resolve without realpathSync
            resolved = nodePath.resolve(filePath);
        }

        // 3. Restrict to allowed root directories
        const resolvedLower = resolved.toLowerCase();
        if (!getAllowedRoots().some(root => resolvedLower.startsWith(root))) {
            return res.status(403).json({ error: 'Access denied', detail: 'Path is outside allowed directories.' });
        }

        // 4. Existence check — distinguish network-offline from missing
        if (!fs.existsSync(resolved)) {
            const onNetwork = resolvedLower.startsWith('n:\\') || resolvedLower.startsWith('l:\\');
            return res.status(404).json({
                error: 'File not found',
                detail: onNetwork
                    ? 'File not found — the network drive may be offline or the file was moved.'
                    : 'File does not exist at the given path.',
            });
        }

        // 5. Open via cmd.exe — no shell-string injection possible
        execFile('cmd.exe', ['/c', 'start', '', resolved], { shell: false }, (error) => {
            if (error) {
                console.error('[Controller] openFile error:', error.message);
                return res.status(500).json({ error: 'Failed to open file' });
            }
            res.json({ success: true });
        });
    }
}

module.exports = new AssembliesController();
