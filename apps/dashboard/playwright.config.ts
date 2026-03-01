import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load test environment variables
dotenv.config({ path: path.resolve(__dirname, '.env.test') });
dotenv.config({ path: path.resolve(__dirname, '.env.local'), override: false });

// TEST_PORT is injected by the test menu (run-tests.mjs picks a free OS port).
// Falls back to TEST_BASE_URL, then 3000 for manual runs.
const TEST_PORT = process.env.TEST_PORT
  ? parseInt(process.env.TEST_PORT, 10)
  : undefined;
const BASE_URL = process.env.TEST_BASE_URL
  || (TEST_PORT ? `http://localhost:${TEST_PORT}` : 'http://localhost:3000');

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',

  // Parallelism: each worker gets a unique TEST_PREFIX in test-data.ts.
  // We keep fullyParallel: false because tests within a single .spec.ts
  // often share the same seeded record.
  fullyParallel: false,
  workers: process.env.TEST_WORKERS || (process.env.CI ? 1 : '50%'),

  // Retry failed tests once (useful for flaky UI interactions)
  retries: 1,

  // Timeout per test
  timeout: 60_000,

  // Reporter: HTML report + terminal list
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['./tests/helpers/copy-errors-reporter.ts'],
  ],

  use: {
    baseURL: BASE_URL,

    // Collect traces and screenshots on first retry
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',

    // Slower actions to reduce flakiness on dynamic React pages
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
  },

  projects: [
    // --- Setup: create auth state file ---
    {
      name: 'setup',
      testMatch: '**/tests/helpers/global-setup.ts',
    },

    // --- Main test run (depends on setup) ---
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],

  // Start the Next.js dev server (or reuse one that is already running).
  // reuseExistingServer:true means:
  //   - if `pnpm dev` is already running at BASE_URL → attach to it immediately
  //   - otherwise → start a new server and wait up to 5 min (cold start on
  //     Windows with Next 15 + Three.js can take well over 2 min)
  webServer: {
    command: TEST_PORT ? `pnpm dev -p ${TEST_PORT}` : 'pnpm dev',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 300_000,
  },
});
