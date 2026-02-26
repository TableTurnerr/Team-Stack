import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load test environment variables
dotenv.config({ path: path.resolve(__dirname, '.env.test') });
dotenv.config({ path: path.resolve(__dirname, '.env.local'), override: false });

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
    baseURL: process.env.TEST_BASE_URL || 'http://localhost:3000',

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

  // Start the Next.js dev server automatically if not already running
  // Comment out if you prefer to start the server manually
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
