/**
 * API integration tests — /api/sync
 *
 * Covers: status polling, start sync, concurrent-start prevention.
 * Note: network drives (N:, L:) are not available in the test environment,
 * so runSync() completes immediately with zero discoveries — that is the
 * expected fast-path and is explicitly tested here.
 */

'use strict';

const { createTestServer, closeServer, seedDb } = require('../setup/helpers');

let request, server, db;

beforeAll(async () => {
  ({ request, server, db } = await createTestServer());
  seedDb(db);
});

afterAll(async () => {
  await closeServer(server);
});

describe('GET /api/sync/status', () => {
  it('returns a valid status object', async () => {
    const res = await request.get('/api/sync/status');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      running:  expect.any(Boolean),
      progress: expect.any(Number),
      total:    expect.any(Number),
      percent:  expect.any(Number),
    });
  });

  it('has running: false before any sync is triggered', async () => {
    const syncService = require('../../server/services/sync.service');
    // Ensure not running before we start
    syncService.status.running = false;
    const res = await request.get('/api/sync/status');
    expect(res.status).toBe(200);
    expect(res.body.running).toBe(false);
  });

  it('includes lastRun field (null or string)', async () => {
    const res = await request.get('/api/sync/status');
    const { lastRun } = res.body;
    expect(lastRun === null || typeof lastRun === 'string').toBe(true);
  });
});

describe('POST /api/sync/start', () => {
  it('accepts a sync start request and returns confirmation message', async () => {
    // Ensure sync is not running first
    const syncService = require('../../server/services/sync.service');
    syncService.status.running = false;
    syncService._syncLock = false;

    const res = await request.post('/api/sync/start');
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/Sync started/i);

    // Wait for the async sync to finish (fast since drives are offline)
    await new Promise(r => setTimeout(r, 500));
  });

  it('returns 400 if sync is already running', async () => {
    const syncService = require('../../server/services/sync.service');
    // Force running state by directly manipulating the service status
    const was = syncService.status.running;
    syncService.status.running = true;

    try {
      const res = await request.post('/api/sync/start');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/already running/i);
    } finally {
      // Always restore
      syncService.status.running = was;
    }
  });

  it('status shows progress fields after a completed sync', async () => {
    await new Promise(r => setTimeout(r, 300));
    const res = await request.get('/api/sync/status');
    expect(res.status).toBe(200);
    expect(typeof res.body.percent).toBe('number');
    expect(typeof res.body.newRecords).toBe('number');
  });
});
