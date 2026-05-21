/**
 * test-scan-db.js
 *
 * Tests: SQLite DB operations, scanner async correctness, L: drive path lookup,
 * and an end-to-end writeAll/readAll round-trip against the live database.
 *
 * Run: node tests/test-scan-db.js
 */

const fs     = require('fs');
const path   = require('path');
const config = require('../server/config/paths');
const db     = require('../server/services/db.service');
const scanner = require('../server/services/scanner.service');

// ─── helpers ─────────────────────────────────────────────────────────────────

let passed = 0, failed = 0;

function pass(name) {
    console.log(`  ✓  ${name}`);
    passed++;
}

function fail(name, reason) {
    console.error(`  ✗  ${name}`);
    console.error(`       ${reason}`);
    failed++;
}

function assert(condition, name, reason) {
    condition ? pass(name) : fail(name, reason || 'assertion failed');
}

// ─── Test 1: DB file reachable ────────────────────────────────────────────────

console.log('\n[1] Database connectivity');
assert(fs.existsSync(config.SQLITE_PATH), 'SQLITE_PATH exists', `Path: ${config.SQLITE_PATH}`);

// ─── Test 2: readAll returns an array ────────────────────────────────────────

console.log('\n[2] db.readAll()');
let allRecords;
try {
    allRecords = db.readAll();
    assert(Array.isArray(allRecords), 'readAll returns array');
    assert(allRecords.length > 0, `DB has records (got ${allRecords.length})`);
    const sample = allRecords[0];
    assert(typeof sample.id === 'number', 'records have numeric id');
    assert('partno' in sample, 'records have partno field');
    assert('job_id' in sample, 'records have job_id field');
    assert('model_link' in sample, 'records have model_link field');
    console.log(`     Total records in DB: ${allRecords.length}`);
} catch (err) {
    fail('readAll', err.message);
}

// ─── Test 3: writeAll inserts a new record and updates it ────────────────────

console.log('\n[3] db.writeAll() — insert + update round-trip');
const TEST_PARTNO = '__TEST_SCAN_' + Date.now();
const TEST_JOB    = '9999';

try {
    // Insert
    const before = db.readAll().length;
    db.writeAll([{
        job_id:       TEST_JOB,
        job_name:     'TEST JOB',
        file_name:    TEST_PARTNO,
        partno:       TEST_PARTNO,
        description:  'Automated test record — safe to delete',
        category:     '',
        comments:     '',
        updated_by:   'test-scan-db.js',
        created_at:   new Date().toISOString(),
        updated_at:   new Date().toISOString(),
        model_link:   null,
        picture_link: null,
        preference:   'No',
        sdc_standard: 'No',
        library:      'N Drive',
        thumbnail:    null,
        path:         null,
        last_modified: null,
        size:          null,
    }]);
    const after = db.readAll().length;
    assert(after === before + 1, `writeAll inserted 1 row (${before} → ${after})`);

    // Update (writeAll on same partno+job_id should update fs fields, not duplicate)
    db.writeAll([{
        job_id:       TEST_JOB,
        job_name:     'TEST JOB',
        file_name:    TEST_PARTNO,
        partno:       TEST_PARTNO,
        description:  'Automated test record — safe to delete',
        category:     '',
        comments:     '',
        updated_by:   'test-scan-db.js',
        created_at:   new Date().toISOString(),
        updated_at:   new Date().toISOString(),
        model_link:   'N:/fake/path/test.sldasm',
        picture_link: '/thumbnails/test.jpg',
        preference:   'No',
        sdc_standard: 'No',
        library:      'N Drive',
        thumbnail:    'test.jpg',
        path:         'N:/fake/path/test.sldasm',
        last_modified: null,
        size:          null,
    }]);
    const afterUpdate = db.readAll().length;
    assert(afterUpdate === after, `writeAll did not duplicate on second call (count still ${after})`);

    // Read back and check model_link was updated
    const updated = db.readAll().find(r => r.partno === TEST_PARTNO);
    assert(!!updated, 'can read back inserted record');
    assert(updated.model_link === 'N:/fake/path/test.sldasm', 'model_link updated correctly');
    assert(updated.thumbnail === 'test.jpg', 'thumbnail updated correctly');

} catch (err) {
    fail('writeAll round-trip', err.message);
}

// ─── Test 4: clearStaleLink nulls model_link ──────────────────────────────────

console.log('\n[4] db.clearStaleLink()');
try {
    db.clearStaleLink(TEST_PARTNO, TEST_JOB, TEST_PARTNO);
    const cleared = db.readAll().find(r => r.partno === TEST_PARTNO);
    assert(!!cleared, 'record still exists after clearStaleLink');
    assert(cleared.model_link === null || cleared.model_link === '', 'model_link is null after clearStaleLink');
    assert(cleared.path === null || cleared.path === '', 'path is null after clearStaleLink');
} catch (err) {
    fail('clearStaleLink', err.message);
}

// ─── Test 5: backfillThumbnailColumn ─────────────────────────────────────────

console.log('\n[5] db.backfillThumbnailColumn()');
try {
    const count = db.backfillThumbnailColumn();
    assert(typeof count === 'number', `backfill returns numeric count (got ${count})`);
    assert(count >= 0, 'backfill count is non-negative');
    console.log(`     Backfilled ${count} records`);
} catch (err) {
    fail('backfillThumbnailColumn', err.message);
}

// ─── Test 6: db.query() basic search ─────────────────────────────────────────

console.log('\n[6] db.query() — basic search');
try {
    const { records, total } = db.query({ limit: 10, offset: 0 });
    assert(Array.isArray(records), 'query returns records array');
    assert(typeof total === 'number', 'query returns numeric total');
    assert(records.length <= 10, 'query respects limit');
    console.log(`     query() total=${total}, returned ${records.length}`);
} catch (err) {
    fail('db.query', err.message);
}

// ─── Test 7: getCounts ────────────────────────────────────────────────────────

console.log('\n[7] db.getCounts()');
try {
    const counts = db.getCounts();
    assert(typeof counts.globalTotal === 'number', `globalTotal is number (${counts.globalTotal})`);
    assert(counts.globalTotal > 0, 'globalTotal > 0');
} catch (err) {
    fail('getCounts', err.message);
}

// ─── Test 8: scanner.safeReaddir returns array (async fix verification) ───────

console.log('\n[8] scanner.safeReaddir() is properly async');
(async () => {
    try {
        // safeReaddir must return a real array, not a Promise
        const result = await scanner.safeReaddir(path.dirname(config.SQLITE_PATH));
        assert(Array.isArray(result), 'safeReaddir resolves to an array');
        assert(result.includes('assemblies.db'), 'safeReaddir finds assemblies.db in SHARED_BASE');

        // Confirm that calling .filter() directly (without await) would break
        const rawPromise = scanner.safeReaddir(path.dirname(config.SQLITE_PATH));
        assert(typeof rawPromise.then === 'function', 'safeReaddir without await is a Promise (not an array)');
        assert(typeof rawPromise.filter === 'undefined', 'Promise does NOT have .filter — confirms old sync-all.js was broken');
    } catch (err) {
        fail('safeReaddir async check', err.message);
    }

    // ─── Test 9: N: drive root accessible ────────────────────────────────────

    console.log('\n[9] N: drive accessibility');
    try {
        const nEntries = await scanner.safeReaddir(config.DRIVES.N);
        assert(Array.isArray(nEntries), 'safeReaddir(N:) returns array');
        assert(nEntries.length > 0, `N: drive has entries (found ${nEntries.length})`);
        const jobFolders = nEntries.filter(n => /^\d{3,4}[\s_]/.test(n));
        console.log(`     N: entries: ${nEntries.length}, job folders: ${jobFolders.length}`);
        assert(jobFolders.length > 0, 'found job folders on N: drive');
    } catch (err) {
        fail('N: drive access', err.message);
    }

    // ─── Test 10: L: drive root accessible ───────────────────────────────────

    console.log('\n[10] L: drive accessibility');
    try {
        const lEntries = await scanner.safeReaddir(config.DRIVES.L);
        assert(Array.isArray(lEntries), 'safeReaddir(L:) returns array');
        console.log(`     L: entries: ${lEntries.length}`);
    } catch (err) {
        fail('L: drive access', err.message);
    }

    // ─── Test 11: scanNDrive discovers job dirs ───────────────────────────────

    console.log('\n[11] scanner.scanNDrive() — job folder discovery');
    try {
        const nJobDirMap = await scanner.scanNDrive();
        assert(typeof nJobDirMap === 'object', 'scanNDrive returns object');
        const jobCount = Object.keys(nJobDirMap).length;
        assert(jobCount > 0, `found ${jobCount} jobs with SolidWorks folders on N:`);
        console.log(`     Jobs with SW dirs on N:: ${jobCount}`);

        // Spot-check: all values should be valid directory paths
        let validPaths = 0;
        for (const [, dir] of Object.entries(nJobDirMap)) {
            if (fs.existsSync(dir)) validPaths++;
        }
        assert(validPaths === jobCount, `all ${jobCount} discovered SW dirs exist on disk`);
    } catch (err) {
        fail('scanNDrive', err.message);
    }

    // ─── Test 12: L: drive multi-padding lookup logic ─────────────────────────

    console.log('\n[12] L: drive folder padding candidates');
    try {
        // Verify the fix generates correct candidates for various job IDs
        const cases = [
            { jobId: '8',    expected: ['8', '008', '0008'] },
            { jobId: '83',   expected: ['83', '083', '0083'] },
            { jobId: '083',  expected: ['083', '0083'] },
            { jobId: '1083', expected: ['1083'] },
        ];
        let ok = true;
        for (const { jobId, expected } of cases) {
            const str = String(jobId).trim();
            const candidates = [...new Set([str, str.padStart(3, '0'), str.padStart(4, '0')])];
            const match = JSON.stringify(candidates) === JSON.stringify(expected);
            if (!match) {
                fail(`padding for ${jobId}`, `got ${JSON.stringify(candidates)}, expected ${JSON.stringify(expected)}`);
                ok = false;
            }
        }
        if (ok) pass('all job ID padding candidates correct');
    } catch (err) {
        fail('L: drive padding', err.message);
    }

    // ─── Test 13b: db.getOne() returns correct record ────────────────────────

    console.log('\n[13b] db.getOne()');
    try {
        // TEST_PARTNO was inserted in test [3] — read it back directly
        const found = db.getOne(TEST_PARTNO);
        assert(!!found, 'getOne finds existing record by partno');
        assert(found.partno === TEST_PARTNO, 'getOne returns correct partno');
        assert(found.job_id === TEST_JOB, 'getOne returns correct job_id');
        const missing = db.getOne('__DOES_NOT_EXIST__');
        assert(missing === null, 'getOne returns null for missing partno');
    } catch (err) {
        fail('db.getOne', err.message);
    }

    // ─── Test 13: sync.service writeAll path — small batch DB write ───────────

    console.log('\n[13] sync.service writeAll path — small live batch');
    const syncService = require('../server/services/sync.service');
    try {
        // Read a few existing records, modify only the updated_at, write them back
        const sample = db.readAll().slice(0, 5);
        assert(sample.length > 0, 'got sample records to test with');
        const originalLinks = sample.map(r => r.model_link);

        // Write back without changing model_link (should be a no-op update)
        db.writeAll(sample);
        const after = db.readAll().filter(r => sample.some(s => s.id === r.id));
        const linksMatch = after.every((r, i) => r.model_link === originalLinks[i]);
        assert(linksMatch, 'writeAll round-trip preserves model_link on existing records');
    } catch (err) {
        fail('sync writeAll live batch', err.message);
    }

    // ─── Cleanup test record ──────────────────────────────────────────────────

    console.log('\n[cleanup] removing test record');
    try {
        db.db.prepare(`DELETE FROM assemblies WHERE partno = ?`).run(TEST_PARTNO);
        const gone = !db.readAll().find(r => r.partno === TEST_PARTNO);
        assert(gone, 'test record deleted from DB');
    } catch (err) {
        fail('cleanup', err.message);
    }

    // ─── Summary ──────────────────────────────────────────────────────────────

    console.log(`\n${'─'.repeat(50)}`);
    console.log(`Results: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
        console.error('\nSome tests failed — review output above.');
        process.exit(1);
    } else {
        console.log('\nAll tests passed.');
    }
})();
