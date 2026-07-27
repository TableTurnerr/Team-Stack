import { test, expect } from '@playwright/test';

test('Financial Overview remains available and backed by its existing UI @smoke', async ({ page }) => {
  await page.goto('/financial');
  await expect(page).toHaveURL(/\/financial$/);
  await expect(page.getByRole('heading', { name: /financial/i }).first()).toBeVisible();
  await expect(page.getByText(/locked/i)).not.toBeVisible();
});
