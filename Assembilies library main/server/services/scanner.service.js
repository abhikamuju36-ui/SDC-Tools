/**
 * scanner.service.js
 * Scans N: and L: drives for SolidWorks assembly files and extracts thumbnails.
 */

const { execFile } = require('child_process');
const fs   = require('fs');
const path = require('path');
const config = require('../config/paths');

// Minimum JPEG file size we consider valid (100 bytes)
const MIN_THUMB_BYTES = 100;

class ScannerService {
    constructor() {
        this.MECH_HINTS    = ['mechanical', 'mech', 'mechan'];
        this.SW_HINTS      = ['solidworks', 'solid works', 'sw files', 'sw', 'parts', 'assembly',
                              'assemblies', 'part', 'sldworks', 'modeled', 'assy', 'cad'];
        this.JOB_FOLDER_RE = /^\d{3,4}[\s_]/;
        this.SIZE   = 1024;
        this.JPEG_Q = 85;
    }

    // ─── Filesystem helpers ───────────────────────────────────────────────────
    async safeReaddir(dir) {
        try { return await fs.promises.readdir(dir); }
        catch { return []; }
    }

    async subdirs(dir) {
        const entries = await this.safeReaddir(dir);
        const results = await Promise.all(entries.map(async name => {
            try {
                const stat = await fs.promises.stat(path.join(dir, name));
                return stat.isDirectory() ? name : null;
            } catch { return null; }
        }));
        return results.filter(Boolean);
    }

    async findSubdirByHints(parentDir, hints) {
        const children = await this.subdirs(parentDir);
        for (const hint of hints) {
            const found = children.find(c => c.toLowerCase().includes(hint.toLowerCase()));
            if (found) return path.join(parentDir, found);
        }
        return null;
    }

    // ─── N: drive scan ────────────────────────────────────────────────────────
    async scanNDrive() {
        console.log(`Scanning ${config.DRIVES.N} for job folders...`);
        const nJobDirMap = {};
        const jobFolders = (await this.subdirs(config.DRIVES.N))
            .filter(name => this.JOB_FOLDER_RE.test(name));

        const CHUNK = 10;
        for (let i = 0; i < jobFolders.length; i += CHUNK) {
            await Promise.all(jobFolders.slice(i, i + CHUNK).map(async jobFolder => {
                const jobPath  = path.join(config.DRIVES.N, jobFolder);
                const numMatch = jobFolder.match(/^(\d+)/);
                if (!numMatch) return;

                const jobId   = String(parseInt(numMatch[1], 10));
                const mechDir = await this.findSubdirByHints(jobPath, this.MECH_HINTS);
                if (!mechDir) return;

                const swDir = await this.findSubdirByHints(mechDir, this.SW_HINTS);
                if (!swDir) return;

                nJobDirMap[jobId] = swDir;
            }));
        }
        return nJobDirMap;
    }

    // ─── L: drive scan ────────────────────────────────────────────────────────
    async scanLDrive() {
        console.log(`Scanning ${config.DRIVES.L} for project folders...`);
        const lFileMap       = new Map();
        const projectFolders = (await this.subdirs(config.DRIVES.L))
            .filter(name => /^\d{3}/.test(name));

        const CHUNK = 5;
        for (let i = 0; i < projectFolders.length; i += CHUNK) {
            await Promise.all(projectFolders.slice(i, i + CHUNK).map(async projectFolder => {
                const projectPath = path.join(config.DRIVES.L, projectFolder);

                const walk = async (dir, depth = 0) => {
                    if (depth > 3) return; // Prevent endless hangs on massive network drives
                    let entries;
                    try {
                        entries = await fs.promises.readdir(dir, { withFileTypes: true });
                    } catch { return; }

                    for (const entry of entries) {
                        const fullPath = path.join(dir, entry.name);
                        try {
                            if (entry.isDirectory()) {
                                await walk(fullPath, depth + 1);
                            } else if (
                                entry.name.toLowerCase().endsWith('.sldasm') &&
                                !entry.name.startsWith('~$')
                            ) {
                                const name = entry.name.replace(/\.sldasm$/i, '').toLowerCase();
                                if (!lFileMap.has(name)) lFileMap.set(name, fullPath);
                            }
                        } catch { /* skip inaccessible entries */ }
                    }
                };

                await walk(projectPath);
            }));
        }
        return lFileMap;
    }

    // ─── Thumbnail extraction ─────────────────────────────────────────────────
    async extractThumbnail(sldPath, thumbPath) {
        // Guard: PS script must exist before attempting execution
        if (!fs.existsSync(config.PS_EXTRACTOR)) {
            if (!ScannerService._psWarnShown) {
                console.error(`[Scanner] PS_EXTRACTOR not found at: ${config.PS_EXTRACTOR} — thumbnail extraction disabled`);
                ScannerService._psWarnShown = true;
            }
            return false;
        }

        return new Promise((resolve) => {
            execFile(
                'powershell',
                [
                    '-NoProfile', '-ExecutionPolicy', 'Bypass',
                    '-File',        config.PS_EXTRACTOR,
                    '-InputFile',   sldPath,
                    '-OutputFile',  thumbPath,
                    '-Size',        String(this.SIZE),
                    '-JpegQuality', String(this.JPEG_Q),
                ],
                { timeout: 30_000 },
                (error) => {
                    if (error) {
                        if (process.env.DEBUG) {
                            console.error(`[Scanner] Thumbnail FAIL: ${path.basename(sldPath)} — ${error.message}`);
                        }
                        return resolve(false);
                    }

                    // Verify the output file exists and is a plausible JPEG (> 100 bytes)
                    try {
                        const stat = fs.statSync(thumbPath);
                        if (stat.size < MIN_THUMB_BYTES) {
                            // PowerShell succeeded but wrote an empty/corrupt file
                            try { fs.unlinkSync(thumbPath); } catch (_) {}
                            return resolve(false);
                        }
                        resolve(true);
                    } catch {
                        // File was never created despite no error code
                        resolve(false);
                    }
                }
            );
        });
    }
}

ScannerService._psWarnShown = false;
module.exports = new ScannerService();
