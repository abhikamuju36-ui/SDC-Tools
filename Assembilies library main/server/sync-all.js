/**
 * sync-all.js
 *
 * Unified scanner for N: and L: drives.
 * Refactored to use ScannerService and DbService.
 */

const fs = require('fs');
const path = require('path');
const config = require('./config/paths');
const scanner = require('./services/scanner.service');
const db = require('./services/db.service');

async function sync() {
    console.log('--- Starting Unified Sync ---');

    // 1. Discovery
    console.log('Scanning drives (this may take a minute)...');
    const nJobDirMap = await scanner.scanNDrive();
    const lFileMap = await scanner.scanLDrive();
    console.log(`Discovery complete. Found ${Object.keys(nJobDirMap).length} jobs on N: and ${lFileMap.size} files on L:`);

    // 2. Prepare environment
    if (!fs.existsSync(config.THUMB_DIR)) {
        fs.mkdirSync(config.THUMB_DIR, { recursive: true });
    }

    // 3. Process records
    const records = await db.readAll();
    console.log(`Processing ${records.length} records...`);

    let extracted = 0, already = 0, failed = 0, skipped = 0, linked = 0;

    const nSwFilesCache = {};
    const getNFiles = (jobId) => {
        if (nSwFilesCache[jobId]) return nSwFilesCache[jobId];
        const dir = nJobDirMap[jobId];
        if (!dir) return null;
        const map = new Map();
        scanner.safeReaddir(dir).filter(f => /\.sldasm$/i.test(f) && !f.startsWith('~$')).forEach(f => {
            map.set(f.replace(/\.sldasm$/i, '').toLowerCase(), path.join(dir, f));
        });
        nSwFilesCache[jobId] = map;
        return map;
    };

    for (let i = 0; i < records.length; i++) {
        const record = records[i];
        const { job_id, file_name, partno, library } = record;

        // Clean identifiers
        const fn = (file_name || '').trim().toLowerCase();
        const pn = (partno || '').trim().toLowerCase();
        const saveName = (file_name || partno || 'unnamed').trim();

        // 4. File Discovery
        let sldPath = null;

        // Try N Drive lookup
        if (library === 'N Drive' || !library) {
            const nFiles = getNFiles(job_id);
            if (nFiles) {
                sldPath = nFiles.get(fn) || nFiles.get(pn);
            }
        }

        // Try L Drive lookup if not found
        if (!sldPath && (library === 'L Drive' || !library)) {
            const lFolder = String(job_id || '').trim().padStart(3, '0');
            const directPath = path.join(config.DRIVES.L, lFolder, saveName + '.sldasm');
            if (fs.existsSync(directPath)) {
                sldPath = directPath;
            } else {
                sldPath = lFileMap.get(fn) || lFileMap.get(pn);
            }
        }

        if (!sldPath) {
            skipped++;
            continue;
        }

        // 5. Update Model Link
        if (record.model_link !== sldPath) {
            record.model_link = sldPath;
            linked++;
        }

        // 6. Thumbnail Extraction
        const thumbPath = path.join(config.THUMB_DIR, saveName + '.jpg');
        if (fs.existsSync(thumbPath)) {
            record.picture_link = `/thumbnails/${saveName}.jpg`;
            already++;
        } else {
            const success = scanner.extractThumbnail(sldPath, thumbPath);
            if (success) {
                record.picture_link = `/thumbnails/${saveName}.jpg`;
                extracted++;
                console.log(`  [${i + 1}/${records.length}] OK: ${saveName}`);
            } else {
                failed++;
            }
        }

        // 7. Periodic Save (every 500 records)
        if ((i + 1) % 500 === 0) {
            console.log(`Progress: ${i + 1}/${records.length} processed...`);
            await db.writeAll(records);
        }
    }

    // Final save
    await db.writeAll(records);
    console.log('\n--- Sync Complete ---');
    console.log(`Linked CAD: ${linked}`);
    console.log(`Extracted Images: ${extracted}`);
    console.log(`Already Had Images: ${already}`);
    console.log(`Failed/Skipped: ${failed}/${skipped}`);
}

sync().catch(err => {
    console.error('CRITICAL: Sync failed:', err);
    process.exit(1);
});
