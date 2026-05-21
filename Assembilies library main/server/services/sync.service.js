/**
 * sync.service.js
 * Discovers SolidWorks assembly files on N: and L: drives, links them to DB
 * records, and extracts thumbnails where missing.
 */

const fs   = require('fs');
const path = require('path');
const config  = require('../config/paths');
const scanner = require('./scanner.service');
const db      = require('./db.service');

// Maximum thumbnails extracted per sync cycle (prevents hours-long hangs)
const MAX_THUMBNAILS_PER_SYNC = 50;
// Periodic save interval (records)
const BATCH_SIZE = 200;
// Drive cache TTL (ms) — 5 minutes
const CACHE_TTL = 300_000;

class SyncService {
    constructor() {
        this.status = {
            running:    false,
            progress:   0,
            total:      0,
            percent:    0,
            extracted:  0,
            already:    0,
            failed:     0,
            skipped:    0,
            stale:      0,   // model_links cleared because file no longer exists
            linked:     0,
            newRecords: 0,
            lastRun:    null,
            lastError:  null,
            currentJob: '',
            // Drive discovery cache
            nCache:    null,
            lCache:    null,
            cacheTime: null,
            // Track which drives were successfully scanned this cycle
            nScanned:  false,
            lScanned:  false,
        };
        this._syncLock = false;
    }

    getStatus() {
        return {
            ...this.status,
            isScanning: this.status.running,
            lastScan:   this.status.lastRun,
            // Friendly summary for the last completed sync
            summary: !this.status.running && this.status.lastRun ? {
                newRecords: this.status.newRecords,
                extracted:  this.status.extracted,
                stale:      this.status.stale,
                failed:     this.status.failed,
            } : null,
        };
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────
    // Strip leading zeros so '008' and '8' and '0008' all map to '8'
    _normalizeJobId(id) {
        return String(parseInt(id, 10) || 0);
    }

    // Mirrors the DB UNIQUE(partno, job_id, file_name) constraint
    _makeKey(partno, jobId, fileName) {
        return `${(partno   || '').trim().toLowerCase()}` +
               `|${this._normalizeJobId(jobId)}`          +
               `|${(fileName || '').trim().toLowerCase()}`;
    }

    _setPercent(done, total) {
        this.status.percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
    }

    // ─── Main sync ────────────────────────────────────────────────────────────
    async runSync() {
        // Mutex check — both the flag and the lock prevent concurrent syncs
        if (this.status.running || this._syncLock) return;
        this._syncLock = true;
        this.status.running    = true;
        this.status.progress   = 0;
        this.status.percent    = 0;
        this.status.extracted  = 0;
        this.status.already    = 0;
        this.status.failed     = 0;
        this.status.skipped    = 0;
        this.status.stale      = 0;
        this.status.linked     = 0;
        this.status.newRecords = 0;
        this.status.lastError  = null;
        this.status.nScanned   = false;
        this.status.lScanned   = false;

        try {
            // ── 1. Drive discovery (with 5-minute cache) ─────────────────────
            const now = new Date();
            const cacheStale = !this.status.cacheTime ||
                               (now - this.status.cacheTime) > CACHE_TTL;

            if (!this.status.nCache || !this.status.lCache || cacheStale) {
                this.status.currentJob = 'Scanning N: Drive...';
                this.status.nCache = await scanner.scanNDrive();
                this.status.nScanned = true;

                this.status.currentJob = 'Scanning L: Drive...';
                this.status.lCache = await scanner.scanLDrive();
                this.status.lScanned = true;

                this.status.cacheTime = now;
            } else {
                this.status.currentJob = 'Using cached drive discovery...';
                // Still mark as scanned — cache came from a successful earlier scan
                this.status.nScanned = true;
                this.status.lScanned = true;
            }

            // ── 1b. One-time backfill: fix records with picture_link but no
            //        thumbnail column value (prevents needless re-extraction) ─
            this.status.currentJob = 'Checking thumbnail index...';
            const backfilled = await db.backfillThumbnailColumn();
            if (backfilled > 0) {
                console.log(`[Sync] Backfilled thumbnail column for ${backfilled} records`);
            }

            const nJobDirMap = this.status.nCache;
            const lFileMap   = this.status.lCache;

            // ── 2. Ensure thumbnail directory exists ──────────────────────────
            if (!fs.existsSync(config.THUMB_DIR)) {
                try {
                    fs.mkdirSync(config.THUMB_DIR, { recursive: true });
                } catch (mkdirErr) {
                    // N: drive may be read-only or not yet available — not fatal,
                    // thumbnail extraction will simply skip files it can't write.
                    console.warn(`[Sync] Could not create thumbnail dir: ${mkdirErr.message}`);
                }
            }

            // ── 3. Load existing records ──────────────────────────────────────
            this.status.currentJob = 'Loading database...';
            const records = await db.readAll();

            const existingKeys = new Set(
                records.map(r => this._makeKey(r.partno, r.job_id, r.file_name))
            );

            // ── 4. Discover new records on N: drive ───────────────────────────
            this.status.currentJob = 'Discovering new files on N: drive...';
            for (const [jobId, swDir] of Object.entries(nJobDirMap)) {
                const entries  = await scanner.safeReaddir(swDir);
                const sldFiles = entries.filter(f => /\.sldasm$/i.test(f) && !f.startsWith('~$'));

                for (const f of sldFiles) {
                    const name = f.replace(/\.sldasm$/i, '').trim();
                    const key  = this._makeKey(name, jobId, name);
                    if (!existingKeys.has(key)) {
                        records.push({
                            job_id:       jobId,
                            job_name:     path.basename(path.dirname(swDir)),
                            file_name:    name,
                            partno:       name,
                            description:  '',
                            category:     '',
                            comments:     '',
                            updated_by:   'Auto Sync',
                            created_at:   new Date().toISOString(),
                            updated_at:   new Date().toISOString(),
                            model_link:   path.join(swDir, f),
                            picture_link: '',
                            preference:   'No',
                            sdc_standard: 'No',
                            library:      'N Drive',
                        });
                        this.status.newRecords++;
                        existingKeys.add(key);
                    }
                }
            }

            // ── 5. Discover new records on L: drive ───────────────────────────
            this.status.currentJob = 'Discovering new files on L: drive...';
            for (const [name, fullPath] of lFileMap.entries()) {
                const match    = fullPath.match(/L:[\\/]+([^\\/]+)/i);
                const jobId    = match ? match[1] : 'Unknown';
                const fileName = path.basename(fullPath).replace(/\.sldasm$/i, '');
                const key      = this._makeKey(name, jobId, fileName);

                if (!existingKeys.has(key)) {
                    records.push({
                        job_id:       jobId,
                        job_name:     '',
                        file_name:    fileName,
                        partno:       fileName,
                        description:  '',
                        category:     '',
                        comments:     '',
                        updated_by:   'Auto Sync',
                        created_at:   new Date().toISOString(),
                        updated_at:   new Date().toISOString(),
                        model_link:   fullPath,
                        picture_link: '',
                        preference:   'No',
                        sdc_standard: 'No',
                        library:      'L Drive',
                    });
                    this.status.newRecords++;
                    existingKeys.add(key);
                }
            }

            this.status.total      = records.length;
            this.status.currentJob = `Starting sync (${this.status.newRecords} new discovered)...`;

            // ── 6. Per-job N: drive file lookup (lazy, cached per job) ────────
            const nSwFilesCache = {};
            const getNFiles = async (jobId) => {
                const normId = this._normalizeJobId(jobId);
                if (nSwFilesCache[normId]) return nSwFilesCache[normId];
                const dir = nJobDirMap[normId];
                if (!dir) return null;
                const map     = new Map();
                const entries = await scanner.safeReaddir(dir);
                entries
                    .filter(f => /\.sldasm$/i.test(f) && !f.startsWith('~$'))
                    .forEach(f => map.set(f.replace(/\.sldasm$/i, '').toLowerCase(), path.join(dir, f)));
                nSwFilesCache[normId] = map;
                return map;
            };

            // ── 7. Process every record ───────────────────────────────────────
            let thumbnailCount = 0;
            let batch          = [];
            // Track records that were skipped (no file found) but have a stored
            // model_link — candidates for stale-link clearing after the main loop.
            const staleCandiates = [];

            for (let i = 0; i < records.length; i++) {
                const record = records[i];
                const { job_id, file_name, partno, library } = record;

                const fn       = (file_name || '').trim().toLowerCase();
                const pn       = (partno    || '').trim().toLowerCase();
                const saveName = (file_name || partno || 'unnamed').trim();

                // Update progress every 10 records
                if ((i + 1) % 10 === 0 || i === records.length - 1) {
                    this.status.progress   = i + 1;
                    this._setPercent(i + 1, records.length);
                    this.status.currentJob = `Processing: ${saveName} (${i + 1}/${records.length})`;
                }

                // ── File lookup ──────────────────────────────────────────────
                let sldPath = null;

                // New records already have model_link set from discovery
                if (!record.id && record.model_link) {
                    sldPath = record.model_link;
                } else {
                    if (library === 'N Drive' || !library) {
                        const nFiles = await getNFiles(job_id);
                        if (nFiles) sldPath = nFiles.get(fn) || nFiles.get(pn);
                    }
                    if (!sldPath && (library === 'L Drive' || !library)) {
                        const jobIdStr = String(job_id || '').trim();
                        const lCandidates = [...new Set([
                            jobIdStr,
                            jobIdStr.padStart(3, '0'),
                            jobIdStr.padStart(4, '0'),
                        ])];
                        for (const lFolder of lCandidates) {
                            const directPath = path.join(config.DRIVES.L, lFolder, saveName + '.sldasm');
                            if (fs.existsSync(directPath)) { sldPath = directPath; break; }
                        }
                        if (!sldPath) sldPath = lFileMap.get(fn) || lFileMap.get(pn);
                    }
                }

                // No matching file found on disk
                if (!sldPath) {
                    this.status.skipped++;
                    // Remember for stale-link check below (only existing DB rows)
                    if (record.id && record.model_link) {
                        staleCandiates.push(record);
                    }
                    continue;
                }

                // ── Update model_link if path has changed ────────────────────
                if (record.model_link !== sldPath) {
                    record.model_link = sldPath;
                    this.status.linked++;
                }

                // ── Thumbnail ────────────────────────────────────────────────
                const thumbPath = path.join(config.THUMB_DIR, saveName + '.jpg');

                if (record.thumbnail && fs.existsSync(thumbPath)) {
                    // Confirmed thumbnail exists on disk — nothing to do
                    this.status.already++;
                } else {
                    // Either no thumbnail recorded, or file was deleted from disk
                    if (record.thumbnail && !fs.existsSync(thumbPath)) {
                        // Thumbnail was in DB but file is gone — re-extract
                        record.thumbnail    = null;
                        record.picture_link = null;
                    }
                    if (fs.existsSync(thumbPath)) {
                        // File already on disk (just missing from DB column)
                        record.picture_link = `/thumbnails/${saveName}.jpg`;
                        record.thumbnail    = saveName + '.jpg';
                        this.status.already++;
                    } else if (thumbnailCount < MAX_THUMBNAILS_PER_SYNC) {
                        const withTimeout = (promise, ms) => Promise.race([
                            promise,
                            new Promise((_, rej) => setTimeout(() => rej(new Error('Thumbnail timeout')), ms)),
                        ]);
                        let success = false;
                        try {
                            success = await withTimeout(scanner.extractThumbnail(sldPath, thumbPath), 30000);
                        } catch (thumbErr) {
                            console.warn(`[Sync] Thumbnail extraction failed for ${saveName}:`, thumbErr.message);
                        }
                        if (success) {
                            record.picture_link = `/thumbnails/${saveName}.jpg`;
                            record.thumbnail    = saveName + '.jpg';
                            this.status.extracted++;
                            thumbnailCount++;
                        } else {
                            this.status.failed++;
                        }
                    } else {
                        this.status.skipped++;
                    }
                }

                record.path = sldPath;
                batch.push(record);

                // Periodic save every BATCH_SIZE records
                if (batch.length >= BATCH_SIZE) {
                    await db.writeAll(batch);
                    batch = [];
                }
            }

            // Final flush
            if (batch.length > 0) {
                await db.writeAll(batch);
            }

            // ── 8. Stale link detection ───────────────────────────────────────
            // Only clear model_links when both drives were scanned this cycle,
            // otherwise a temporarily offline drive would incorrectly invalidate
            // every path on that drive.
            if (this.status.nScanned && this.status.lScanned && staleCandiates.length > 0) {
                this.status.currentJob = `Checking ${staleCandiates.length} stale link(s)...`;
                for (const r of staleCandiates) {
                    // Double-check: only clear if the file truly doesn't exist
                    if (r.model_link && !fs.existsSync(r.model_link)) {
                        await db.clearStaleLink(r.partno, r.job_id, r.file_name);
                        this.status.stale++;
                    }
                }
                if (this.status.stale > 0) {
                    console.log(`[Sync] Cleared ${this.status.stale} stale model_link(s)`);
                }
            }

            this.status.lastRun    = new Date();
            this.status.percent    = 100;
            this.status.currentJob = 'Complete';

        } catch (err) {
            // Categorise the error for a friendlier message
            let msg = err.message || 'Unknown error';
            if (err.code === 'ENOENT' && msg.includes('mkdir')) msg = `N: drive path not accessible — check network share`;
            else if (err.code === 'ENOENT')   msg = `File not found: ${msg}`;
            else if (err.code === 'EACCES') msg = `Permission denied: ${msg}`;
            else if (err.code === 'ETIMEDOUT' || msg.includes('timeout')) msg = `Network timeout: ${msg}`;
            else if (msg.includes('SQLITE')) msg = `Database error: ${msg}`;

            console.error('[Sync] Failed:', err);
            this.status.currentJob = `Error: ${msg}`;
            this.status.lastError  = msg;
        } finally {
            this._syncLock      = false;
            this.status.running = false;
        }
    }
}

module.exports = new SyncService();
