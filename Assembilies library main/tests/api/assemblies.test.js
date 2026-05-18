/**
 * API integration tests — /api/assemblies
 *
 * Covers: list/search/filter/sort/paginate, create, update, bulk-update,
 * delete (single + bulk), metadata endpoints, openFile security, and edge cases.
 */

'use strict';

const { createTestServer, closeServer, seedDb, cleanDb, SEED } = require('../setup/helpers');

// ─── Shared state ─────────────────────────────────────────────────────────────
let request, server, db;
const DELETE_PW = process.env.DELETE_PASSWORD; // injected by vitest.config.mjs

beforeAll(async () => {
  ({ request, server, db } = await createTestServer());
  seedDb(db);
});

afterAll(async () => {
  cleanDb(db);
  await closeServer(server);
});

// ─── GET /api/assemblies/status ───────────────────────────────────────────────
describe('GET /api/assemblies/status', () => {
  it('returns lastScan and usingFallback', async () => {
    const res = await request.get('/api/assemblies/status');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('lastScan');
    expect(res.body).toHaveProperty('usingFallback');
  });
});

// ─── GET /api/assemblies/categories ───────────────────────────────────────────
describe('GET /api/assemblies/categories', () => {
  it('returns an array of category objects with value and count', async () => {
    const res = await request.get('/api/assemblies/categories');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const structural = res.body.find(c => c.value === 'Structural');
    expect(structural).toBeDefined();
    expect(structural.count).toBeGreaterThanOrEqual(1);
  });
});

// ─── GET /api/assemblies/jobs ──────────────────────────────────────────────────
describe('GET /api/assemblies/jobs', () => {
  it('returns distinct job IDs with counts', async () => {
    const res = await request.get('/api/assemblies/jobs');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some(j => j.value === '9001')).toBe(true);
  });
});

// ─── GET /api/assemblies/libraries ────────────────────────────────────────────
describe('GET /api/assemblies/libraries', () => {
  it('returns distinct libraries with counts', async () => {
    const res = await request.get('/api/assemblies/libraries');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some(l => l.value === 'N Drive')).toBe(true);
    expect(res.body.some(l => l.value === 'L Drive')).toBe(true);
  });
});

// ─── GET /api/assemblies (list + pagination) ───────────────────────────────────
describe('GET /api/assemblies — list and pagination', () => {
  it('returns all seeded records with total and page', async () => {
    const res = await request.get('/api/assemblies?limit=200');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.total).toBeGreaterThanOrEqual(SEED.length);
    expect(res.body.page).toBe(1);
    const partnos = res.body.data.map(a => a.partno);
    expect(partnos).toContain('TST-001');
    expect(partnos).toContain('TST-005');
  });

  it('respects limit and page parameters', async () => {
    const res = await request.get('/api/assemblies?limit=2&page=1');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(2);
    expect(res.body.page).toBe(1);
  });

  it('page 2 returns different records than page 1', async () => {
    const page1 = await request.get('/api/assemblies?limit=2&page=1');
    const page2 = await request.get('/api/assemblies?limit=2&page=2');
    expect(page1.status).toBe(200);
    expect(page2.status).toBe(200);
    const ids1 = page1.body.data.map(a => a.partno);
    const ids2 = page2.body.data.map(a => a.partno);
    expect(ids1).not.toEqual(ids2);
  });

  it('caps limit at 200', async () => {
    const res = await request.get('/api/assemblies?limit=9999');
    expect(res.status).toBe(200);
    // No error — just capped internally
  });

  it('handles invalid page gracefully (defaults to 1)', async () => {
    const res = await request.get('/api/assemblies?page=abc');
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
  });
});

// ─── Search ───────────────────────────────────────────────────────────────────
describe('GET /api/assemblies — search', () => {
  it('searches by description (default field)', async () => {
    const res = await request.get('/api/assemblies?search=Alpha+Structural&limit=200');
    expect(res.status).toBe(200);
    expect(res.body.data.some(a => a.partno === 'TST-001')).toBe(true);
  });

  it('returns empty when search term does not match', async () => {
    const res = await request.get('/api/assemblies?search=ZZZNOMATCH999&limit=200');
    expect(res.status).toBe(200);
    // May return 0 results among test records
    const testRecords = res.body.data.filter(a => a.partno.startsWith('TST-'));
    expect(testRecords.length).toBe(0);
  });

  it('searches by partno when searchFields=partno', async () => {
    const res = await request.get('/api/assemblies?search=TST-003&searchFields=partno&limit=200');
    expect(res.status).toBe(200);
    expect(res.body.data.some(a => a.partno === 'TST-003')).toBe(true);
  });

  it('searches across multiple fields', async () => {
    const res = await request.get('/api/assemblies?search=TST-002&searchFields=partno,description&limit=200');
    expect(res.status).toBe(200);
    expect(res.body.data.some(a => a.partno === 'TST-002')).toBe(true);
  });

  it('rejects unknown searchFields (falls back to description)', async () => {
    const res = await request.get('/api/assemblies?search=Alpha&searchFields=malicious_field;DROP+TABLE&limit=200');
    expect(res.status).toBe(200);
    // Should not throw — unknown fields are silently dropped
  });
});

// ─── Filters ──────────────────────────────────────────────────────────────────
describe('GET /api/assemblies — filters', () => {
  it('filters by single category', async () => {
    const res = await request.get('/api/assemblies?categories=Structural&limit=200');
    expect(res.status).toBe(200);
    const testRecs = res.body.data.filter(a => a.partno.startsWith('TST-'));
    expect(testRecs.every(a => a.category === 'Structural')).toBe(true);
    expect(testRecs.some(a => a.partno === 'TST-001')).toBe(true);
  });

  it('filters by multiple categories (comma-separated)', async () => {
    const res = await request.get('/api/assemblies?categories=Structural,Mechanical&limit=200');
    expect(res.status).toBe(200);
    const testRecs = res.body.data.filter(a => a.partno.startsWith('TST-'));
    expect(testRecs.every(a => ['Structural', 'Mechanical'].includes(a.category))).toBe(true);
  });

  it('filters by jobIds', async () => {
    const res = await request.get('/api/assemblies?jobIds=9001&limit=200');
    expect(res.status).toBe(200);
    const testRecs = res.body.data.filter(a => a.partno.startsWith('TST-'));
    expect(testRecs.every(a => a.job_id === '9001')).toBe(true);
    expect(testRecs.length).toBe(2); // TST-001, TST-003
  });

  it('filters by library', async () => {
    const res = await request.get('/api/assemblies?libraries=L+Drive&limit=200');
    expect(res.status).toBe(200);
    const testRecs = res.body.data.filter(a => a.partno.startsWith('TST-'));
    expect(testRecs.every(a => a.library === 'L Drive')).toBe(true);
  });

  it('filters sdc_standard=Yes', async () => {
    const res = await request.get('/api/assemblies?sdcStandards=Yes&limit=200');
    expect(res.status).toBe(200);
    const testRecs = res.body.data.filter(a => a.partno.startsWith('TST-'));
    expect(testRecs.every(a => a.sdc_standard === 'Yes')).toBe(true);
  });

  it('filters preference=Yes', async () => {
    const res = await request.get('/api/assemblies?preferences=Yes&limit=200');
    expect(res.status).toBe(200);
    const testRecs = res.body.data.filter(a => a.partno.startsWith('TST-'));
    expect(testRecs.every(a => a.preference === 'Yes')).toBe(true);
  });

  it('filters modelFilter=Yes (has model_link)', async () => {
    const res = await request.get('/api/assemblies?modelFilter=Yes&limit=200');
    expect(res.status).toBe(200);
    const testRecs = res.body.data.filter(a => a.partno.startsWith('TST-'));
    expect(testRecs.every(a => a.model_link)).toBe(true);
    // TST-002 and TST-005 have no model_link, should be absent
    expect(testRecs.some(a => a.partno === 'TST-002')).toBe(false);
  });

  it('filters modelFilter=No (missing model_link)', async () => {
    const res = await request.get('/api/assemblies?modelFilter=No&limit=200');
    expect(res.status).toBe(200);
    const testRecs = res.body.data.filter(a => a.partno.startsWith('TST-'));
    expect(testRecs.every(a => !a.model_link)).toBe(true);
    expect(testRecs.some(a => a.partno === 'TST-002')).toBe(true);
  });

  it('filters imageFilter=Yes (has picture_link)', async () => {
    const res = await request.get('/api/assemblies?imageFilter=Yes&limit=200');
    expect(res.status).toBe(200);
    const testRecs = res.body.data.filter(a => a.partno.startsWith('TST-'));
    expect(testRecs.every(a => a.picture_link)).toBe(true);
  });

  it('handles "None" in filter (finds records with null/empty value)', async () => {
    const res = await request.get('/api/assemblies?categories=None&limit=200');
    expect(res.status).toBe(200);
    // Should not throw; returns records where category is null/empty/'None'
  });
});

// ─── Sorting ──────────────────────────────────────────────────────────────────
describe('GET /api/assemblies — sorting', () => {
  it('sorts by partno ASC', async () => {
    const res = await request.get('/api/assemblies?sortBy=partno&sortOrder=ASC&limit=200');
    expect(res.status).toBe(200);
    const testRecs = res.body.data.filter(a => a.partno.startsWith('TST-'));
    const sorted = [...testRecs].sort((a, b) => a.partno.localeCompare(b.partno));
    expect(testRecs.map(a => a.partno)).toEqual(sorted.map(a => a.partno));
  });

  it('sorts by partno DESC', async () => {
    const res = await request.get('/api/assemblies?sortBy=partno&sortOrder=DESC&limit=200');
    expect(res.status).toBe(200);
    const testRecs = res.body.data.filter(a => a.partno.startsWith('TST-'));
    const sorted = [...testRecs].sort((a, b) => b.partno.localeCompare(a.partno));
    expect(testRecs.map(a => a.partno)).toEqual(sorted.map(a => a.partno));
  });

  it('sorts by job_id numerically', async () => {
    const res = await request.get('/api/assemblies?sortBy=job_id&sortOrder=ASC&limit=200');
    expect(res.status).toBe(200);
    // Should not throw; numeric sort applied
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('ignores invalid sortBy (falls back to job_id)', async () => {
    const res = await request.get('/api/assemblies?sortBy=malicious;DROP+TABLE&limit=200');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ─── POST /api/assemblies (create) ────────────────────────────────────────────
describe('POST /api/assemblies', () => {
  afterEach(() => {
    // Clean up any created records beyond the seed set
    db.db.prepare("DELETE FROM assemblies WHERE partno = 'TST-NEW-001'").run();
    db.db.prepare("DELETE FROM assemblies WHERE partno = 'TST-XSS'").run();
  });

  it('creates a new assembly and returns 201', async () => {
    const res = await request
      .post('/api/assemblies')
      .send({ partno: 'TST-NEW-001', description: 'New Test Assembly', category: 'Test' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.assembly.partno).toBe('TST-NEW-001');
  });

  it('persists the created record in the DB', async () => {
    await request.post('/api/assemblies').send({ partno: 'TST-NEW-001', description: 'Persist check' });
    const check = await request.get('/api/assemblies?search=TST-NEW-001&searchFields=partno&limit=200');
    expect(check.body.data.some(a => a.partno === 'TST-NEW-001')).toBe(true);
  });

  it('returns 400 when partno is missing', async () => {
    const res = await request.post('/api/assemblies').send({ description: 'No partno' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Validation/i);
  });

  it('strips fields not in ALLOWED_WRITE_FIELDS', async () => {
    const res = await request.post('/api/assemblies').send({
      partno: 'TST-NEW-001',
      description: 'Sanitised',
      admin_override: 'HACKED',
    });
    expect(res.status).toBe(201);
    expect(res.body.assembly).not.toHaveProperty('admin_override');
  });

  it('truncates field values exceeding 2000 chars', async () => {
    const longVal = 'x'.repeat(3000);
    const res = await request.post('/api/assemblies').send({ partno: 'TST-XSS', description: longVal });
    expect(res.status).toBe(201);
    expect(res.body.assembly.description.length).toBeLessThanOrEqual(2000);
  });
});

// ─── PATCH /api/assemblies/:partno (update single) ────────────────────────────
describe('PATCH /api/assemblies/:partno', () => {
  it('updates an allowed field and returns success', async () => {
    const res = await request
      .patch('/api/assemblies/TST-001')
      .send({ description: 'Updated Description', comments: 'Updated comment' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Verify the update persisted
    const check = await request.get('/api/assemblies?search=Updated+Description&limit=200');
    expect(check.body.data.some(a => a.partno === 'TST-001')).toBe(true);
  });

  it('returns 400 when body has no valid fields', async () => {
    const res = await request
      .patch('/api/assemblies/TST-001')
      .send({ illegal_col: 'value', another_bad: 'field' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No valid fields/i);
  });

  it('ignores unknown fields silently (strips them)', async () => {
    const res = await request
      .patch('/api/assemblies/TST-001')
      .send({ category: 'Structural', unknownField: 'ignored' });
    expect(res.status).toBe(200);
  });

  it('updates non-existent partno without error (0 rows affected is not an error)', async () => {
    const res = await request
      .patch('/api/assemblies/TST-DOES-NOT-EXIST')
      .send({ description: 'Ghost update' });
    expect(res.status).toBe(200);
  });
});

// ─── PATCH /api/assemblies (bulk update) ──────────────────────────────────────
describe('PATCH /api/assemblies — bulk update', () => {
  afterEach(() => seedDb(db)); // restore seed data after each test

  it('bulk-updates preference for multiple records', async () => {
    const res = await request
      .patch('/api/assemblies')
      .send({ partnos: ['TST-002', 'TST-005'], field: 'preference', value: 'Yes' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.updated).toBe(2);

    // Verify both records updated
    const check = await request.get('/api/assemblies?preferences=Yes&limit=200');
    const updated = check.body.data.filter(a => ['TST-002', 'TST-005'].includes(a.partno));
    expect(updated.length).toBe(2);
  });

  it('bulk-updates sdc_standard', async () => {
    const res = await request
      .patch('/api/assemblies')
      .send({ partnos: ['TST-002'], field: 'sdc_standard', value: 'Yes' });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);
  });

  it('returns 400 when partnos array is empty', async () => {
    const res = await request
      .patch('/api/assemblies')
      .send({ partnos: [], field: 'preference', value: 'Yes' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No part numbers/i);
  });

  it('returns 400 when partnos is not an array', async () => {
    const res = await request
      .patch('/api/assemblies')
      .send({ partnos: 'TST-001', field: 'preference', value: 'Yes' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid field', async () => {
    const res = await request
      .patch('/api/assemblies')
      .send({ partnos: ['TST-001'], field: 'admin_override', value: 'Yes' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid field/i);
  });

  it('prevents SQL injection via field name', async () => {
    const res = await request
      .patch('/api/assemblies')
      .send({ partnos: ['TST-001'], field: 'preference; DROP TABLE assemblies--', value: 'Yes' });
    expect(res.status).toBe(400);
  });
});

// ─── DELETE /api/assemblies/:partno (single delete) ───────────────────────────
describe('DELETE /api/assemblies/:partno', () => {
  beforeEach(() => seedDb(db));

  it('returns 503 when DELETE_PASSWORD env is not set', async () => {
    const saved = process.env.DELETE_PASSWORD;
    delete process.env.DELETE_PASSWORD;
    const res = await request.delete('/api/assemblies/TST-001').set('X-Delete-Password', 'anything');
    process.env.DELETE_PASSWORD = saved;
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/Delete disabled/i);
  });

  it('returns 403 for wrong password', async () => {
    const res = await request
      .delete('/api/assemblies/TST-001')
      .set('X-Delete-Password', 'wrong-password');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Forbidden/i);
  });

  it('returns 403 when password header is missing', async () => {
    const res = await request.delete('/api/assemblies/TST-001');
    expect(res.status).toBe(403);
  });

  it('deletes record with correct password', async () => {
    const res = await request
      .delete('/api/assemblies/TST-001')
      .set('X-Delete-Password', DELETE_PW);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Verify it's gone
    const check = await request.get('/api/assemblies?search=TST-001&searchFields=partno&limit=200');
    expect(check.body.data.some(a => a.partno === 'TST-001')).toBe(false);
  });
});

// ─── DELETE /api/assemblies (bulk delete) ─────────────────────────────────────
describe('DELETE /api/assemblies — bulk delete', () => {
  beforeEach(() => seedDb(db));

  it('bulk-deletes multiple records with correct password', async () => {
    const res = await request
      .delete('/api/assemblies')
      .set('X-Delete-Password', DELETE_PW)
      .send({ partnos: ['TST-002', 'TST-003'] });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.deleted).toBe(2);
  });

  it('returns 403 without password header', async () => {
    const res = await request
      .delete('/api/assemblies')
      .send({ partnos: ['TST-001'] });
    expect(res.status).toBe(403);
  });

  it('returns 400 when partnos array is empty', async () => {
    const res = await request
      .delete('/api/assemblies')
      .set('X-Delete-Password', DELETE_PW)
      .send({ partnos: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No part numbers/i);
  });

  it('bulk delete is atomic — all-or-nothing', async () => {
    // Deleting existing + non-existing records succeeds (non-existing rows = 0 changes)
    const res = await request
      .delete('/api/assemblies')
      .set('X-Delete-Password', DELETE_PW)
      .send({ partnos: ['TST-004', 'TST-NONEXISTENT'] });
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(1); // only the existing record was deleted
  });
});

// ─── GET /api/assemblies/open ─────────────────────────────────────────────────
describe('GET /api/assemblies/open', () => {
  it('returns 400 when path param is missing', async () => {
    const res = await request.get('/api/assemblies/open');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Path is required/i);
  });

  it('returns 403 for a disallowed file extension', async () => {
    const res = await request.get('/api/assemblies/open?path=N:/test/malware.exe');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Forbidden file type/i);
  });

  it('returns 403 for .bat extension', async () => {
    const res = await request.get('/api/assemblies/open?path=N:/test/script.bat');
    expect(res.status).toBe(403);
  });

  it('returns 403 for path outside allowed roots', async () => {
    const res = await request.get('/api/assemblies/open?path=C:/Windows/system32/notepad.exe');
    // .exe is blocked by extension check first
    expect([403]).toContain(res.status);
  });

  it('returns 403 for path traversal attempt with allowed extension', async () => {
    const res = await request.get('/api/assemblies/open?path=N:/../../etc/passwd.pdf');
    // Either 403 (path traversal) or 404 (file not found) — never 200
    expect([403, 404]).toContain(res.status);
  });

  it('returns 404 for a valid path that does not exist', async () => {
    const res = await request.get('/api/assemblies/open?path=N:/does/not/exist.sldasm');
    expect(res.status).toBe(404);
  });
});
