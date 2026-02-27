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

  // Run tests in sequence to avoid conflicts on shared data
  fullyParallel: false,
  workers: 1,

  // Retry failed tests once (useful for flaky UI interactions)
  retries: 1,

  // Timeout per test
  timeout: 45_000,

  // Reporter: HTML report + terminal list
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],

  use: {
    baseURL: BASE_URL,

    // Collect traces and screenshots on first retry
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',

    // Slower actions to reduce flakiness on dynamic React pages
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
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

  // Start the Next.js dev server on a free port (TEST_PORT set by run-tests.mjs).
  // Falls back to port 3000 for manual `pnpm test` runs.
  webServer: {
    command: 'pnpm dev',
    url: BASE_URL,
    reuseExistingServer: !TEST_PORT, // only reuse when no specific port was requested
    timeout: 120_000,
    ...(TEST_PORT && { env: { PORT: String(TEST_PORT) } }),
  },
});
