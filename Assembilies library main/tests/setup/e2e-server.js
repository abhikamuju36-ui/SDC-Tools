/**
 * E2E test server launcher.
 * Started by Playwright's webServer config.
 * Sets test env vars, seeds the DB with known data, then starts the Express server.
 */

'use strict';

const os   = require('os');
const path = require('path');
const fs   = require('fs');

// Must set env before requiring any server module
const TEST_BASE = path.join(os.tmpdir(), 'sdc-assemblies-e2e');
fs.mkdirSync(path.join(TEST_BASE, 'thumbnails'), { recursive: true });

process.env.SHARED_BASE       = TEST_BASE;
process.env.DELETE_PASSWORD   = 'admin123';
process.env.PORT               = '3001';
process.env.NODE_ENV           = 'test';

const http = require('http');
const app  = require('../../server/index');
const db   = require('../../server/services/db.service');

// Seed E2E test data (idempotent)
const now = new Date().toISOString();
db.db.prepare("DELETE FROM assemblies WHERE partno LIKE 'E2E-%'").run();
db.writeAll([
  {
    partno: 'E2E-001', job_id: '8001', job_name: 'E2E Alpha Job',
    file_name: 'e2e-alpha.sldasm', description: 'E2E Alpha Structural Frame',
    category: 'Structural', preference: 'Yes', sdc_standard: 'Yes',
    library: 'N Drive', model_link: 'N:/e2e/alpha.sldasm',
    picture_link: 'N:/e2e/alpha.jpg', comments: 'E2E test record',
    updated_by: 'e2e-tester', created_at: now, updated_at: now,
  },
  {
    partno: 'E2E-002', job_id: '8002', job_name: 'E2E Beta Job',
    file_name: 'e2e-beta.sldasm', description: 'E2E Beta Mechanical Arm',
    category: 'Mechanical', preference: 'No', sdc_standard: 'No',
    library: 'L Drive', model_link: null, picture_link: null,
    comments: null, updated_by: 'e2e-tester', created_at: now, updated_at: now,
  },
  {
    partno: 'E2E-003', job_id: '8001', job_name: 'E2E Alpha Job',
    file_name: 'e2e-gamma.sldasm', description: 'E2E Gamma Electrical Panel',
    category: 'Electrical', preference: 'Yes', sdc_standard: 'No',
    library: 'N Drive', model_link: 'N:/e2e/gamma.sldasm',
    picture_link: null, comments: null,
    updated_by: 'e2e-tester', created_at: now, updated_at: now,
  },
  {
    partno: 'E2E-004', job_id: '8003', job_name: 'E2E Gamma Job',
    file_name: 'e2e-delta.sldasm', description: 'E2E Delta Hydraulic Cylinder',
    category: 'Hydraulic', preference: 'No', sdc_standard: 'Yes',
    library: 'N Drive', model_link: 'N:/e2e/delta.sldasm',
    picture_link: 'N:/e2e/delta.png', comments: 'Hydraulic test',
    updated_by: 'e2e-tester', created_at: now, updated_at: now,
  },
  {
    partno: 'E2E-005', job_id: '8002', job_name: 'E2E Beta Job',
    file_name: 'e2e-epsilon.sldasm', description: 'E2E Epsilon Control Box',
    category: 'Electrical', preference: 'No', sdc_standard: 'No',
    library: 'L Drive', model_link: null, picture_link: null,
    comments: null, updated_by: 'e2e-tester', created_at: now, updated_at: now,
  },
  {
    partno: 'E2E-006', job_id: '8003', job_name: 'E2E Gamma Job',
    file_name: 'e2e-zeta.sldasm', description: 'E2E Zeta Support Bracket',
    category: 'Structural', preference: 'Yes', sdc_standard: 'Yes',
    library: 'N Drive', model_link: 'N:/e2e/zeta.sldasm',
    picture_link: null, comments: null,
    updated_by: 'e2e-tester', created_at: now, updated_at: now,
  },
]);

const server = http.createServer(app);
server.listen(3001, '127.0.0.1', () => {
  console.log('[E2E Server] Listening on http://127.0.0.1:3001');
  console.log(`[E2E Server] DB: ${TEST_BASE}/assemblies.db`);
});
