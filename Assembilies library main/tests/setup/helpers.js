/**
 * Test helpers: shared server factory and seed data for API tests.
 *
 * IMPORTANT: This module must be required AFTER env vars are set (vitest.config.mjs injects
 * SHARED_BASE / DELETE_PASSWORD before the test process starts, so module-load-time
 * singletons in db.service.js and paths.js will pick up the correct values).
 */

'use strict';

const http = require('http');
const supertest = require('supertest');

// ─── Test records used across API test files ───────────────────────────────────
const SEED = [
  {
    partno: 'TST-001', job_id: '9001', job_name: 'Alpha Project',
    file_name: 'alpha.sldasm', description: 'Alpha Structural Frame',
    category: 'Structural', preference: 'Yes', sdc_standard: 'Yes',
    library: 'N Drive', model_link: 'N:/jobs/9001/alpha.sldasm',
    picture_link: 'N:/jobs/9001/alpha.jpg', comments: 'Primary frame',
    updated_by: 'tester',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  },
  {
    partno: 'TST-002', job_id: '9002', job_name: 'Beta Project',
    file_name: 'beta.sldasm', description: 'Beta Mechanical Arm',
    category: 'Mechanical', preference: 'No', sdc_standard: 'No',
    library: 'L Drive', model_link: null, picture_link: null,
    comments: null, updated_by: 'tester',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  },
  {
    partno: 'TST-003', job_id: '9001', job_name: 'Alpha Project',
    file_name: 'gamma.sldasm', description: 'Gamma Electrical Panel',
    category: 'Electrical', preference: 'Yes', sdc_standard: 'No',
    library: 'N Drive', model_link: 'N:/jobs/9001/gamma.sldasm',
    picture_link: null, comments: 'High voltage',
    updated_by: 'tester',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  },
  {
    partno: 'TST-004', job_id: '9003', job_name: 'Gamma Project',
    file_name: 'delta.sldasm', description: 'Delta Hydraulic Cylinder',
    category: 'Hydraulic', preference: 'No', sdc_standard: 'Yes',
    library: 'N Drive', model_link: 'N:/jobs/9003/delta.sldasm',
    picture_link: 'N:/jobs/9003/delta.png', comments: null,
    updated_by: 'tester',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  },
  {
    partno: 'TST-005', job_id: '9002', job_name: 'Beta Project',
    file_name: 'epsilon.sldasm', description: 'Epsilon Control Box',
    category: 'Electrical', preference: 'No', sdc_standard: 'No',
    library: 'L Drive', model_link: null, picture_link: null,
    comments: null, updated_by: 'tester',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  },
];

/**
 * Start an HTTP server on a random port bound to 127.0.0.1 and return a
 * supertest agent pointed at it.  The localhost-only middleware in server/index.js
 * checks req.socket.remoteAddress — binding to 127.0.0.1 ensures it passes.
 *
 * Returns { request, server, db } where db is the DbService singleton.
 */
function createTestServer() {
  const app = require('../../server/index');
  const db  = require('../../server/services/db.service');

  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const request  = supertest(`http://127.0.0.1:${port}`);
      resolve({ request, server, db });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

/** Wipe all test records (partno starts with 'TST-') then re-insert SEED. */
function seedDb(db) {
  db.db.prepare("DELETE FROM assemblies WHERE partno LIKE 'TST-%'").run();
  db.writeAll(SEED);
}

/** Remove all test records. */
function cleanDb(db) {
  db.db.prepare("DELETE FROM assemblies WHERE partno LIKE 'TST-%'").run();
}

module.exports = { createTestServer, closeServer, seedDb, cleanDb, SEED };
