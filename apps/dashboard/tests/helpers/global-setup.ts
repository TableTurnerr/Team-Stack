/**
 * global-setup.ts
 * Runs ONCE before all tests. Logs in and saves the auth cookie/storage state
 * so all subsequent tests skip the login step.
 */
import { test as setup, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const AUTH_FILE = path.join(__dirname, '../.auth/user.json');

setup('authenticate', async ({ page }) => {
  const email = process.env.TEST_USER_EMAIL;
  const password = process.env.TEST_USER_PASSWORD;

  if (!email || !password) {
    throw new Error(
      '❌  TEST_USER_EMAIL and TEST_USER_PASSWORD must be set in .env.test\n' +
      '   Copy .env.test.example → .env.test and fill in your credentials.'
    );
  }

  // Go to login page
  await page.goto('/login');
  await expect(page).toHaveURL(/\/login/);

  // Fill in credentials
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();

  // Wait for redirect to dashboard
  await page.waitForURL('/', { timeout: 60_000 });
  await expect(page).toHaveURL('/');

  // Ensure the .auth directory exists
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });

  // Save storage state (cookies + localStorage) for reuse
  await page.context().storageState({ path: AUTH_FILE });
  console.log('✅  Auth state saved.');
});
