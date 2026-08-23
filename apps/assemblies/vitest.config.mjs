import { defineConfig } from 'vitest/config';
import path from 'path';
import os from 'os';
import { mkdirSync } from 'fs';

const TEST_BASE = path.join(os.tmpdir(), 'sdc-assemblies-test');
mkdirSync(path.join(TEST_BASE, 'thumbnails'), { recursive: true });

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks',
    maxWorkers: 1,
    minWorkers: 1,
    env: {
      NODE_ENV: 'test',
      SHARED_BASE: TEST_BASE,
      DELETE_PASSWORD: 'test-secret-123',
      PORT: '3099',
    },
    include: ['tests/api/**/*.test.js'],
    reporters: ['verbose'],
    testTimeout: 20000,
  },
});
