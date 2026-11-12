import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = process.env.QUIZCAST_E2E_DATA_DIR ?? mkdtempSync(join(tmpdir(), 'quizcast-e2e-'));
process.env.QUIZCAST_E2E_DATA_DIR = dataDir;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4319',
    viewport: { width: 1440, height: 1050 },
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run start',
    url: 'http://127.0.0.1:4319/api/health',
    reuseExistingServer: false,
    env: {
      PORT: '4319',
      DATA_DIR: dataDir,
      DEMO_AUTO: 'false',
      EULER_API_KEY: '',
      LICENSE_PUBLIC_KEY_FILE: '',
      ALLOW_UNLICENSED_LIVE: 'false',
    },
  },
  globalTeardown: './tests/e2e/teardown.ts',
});
