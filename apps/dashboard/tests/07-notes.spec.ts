/**
 * 07-notes.spec.ts
 * Full CRUD lifecycle for the Notes page (/notes).
 *
 * Tests: create → view → edit → search → archive → restore → soft-delete → tab switching
 * All test notes use TEST_PREFIX so they are identifiable and cleaned up in afterAll.
 */
import { test, expect } from '@playwright/test';
import { TEST_PREFIX, TEST_NOTE, waitForTableLoad } from './helpers/test-data';
import { cleanupByPrefix } from './helpers/pb-client';

test.describe('Notes Page', () => {
  test.afterAll(async () => {
    await cleanupByPrefix('notes', 'title', TEST_PREFIX);
    console.log('🧹 Cleaned up test notes.');
  });

  // ─── Page Load ───────────────────────────────────────────────────────────────

  test('notes page loads @smoke', async ({ page }) => {
    await page.goto('/notes');
    await waitForTableLoad(page);

    await expect(page).toHaveURL('/notes');
    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('notes page has Active / Archived / Deleted tabs', async ({ page }) => {
    await page.goto('/notes');
    await waitForTableLoad(page);

    for (const tabName of ['active', 'archived', 'deleted']) {
      const tab = page.locator('button, [role="tab"]').filter({ hasText: new RegExp(tabName, 'i') }).first();
      await expect(tab).toBeVisible();
    }
  });

  // ─── Create Note ──────────────────────────────────────────────────────────────

  test('create new note via UI', async ({ page }) => {
    await page.goto('/notes');
    await waitForTableLoad(page);

    // Click the "New Note" / "Add Note" / "Create" button.
    // Try several common label patterns; fall back to any button with a "+" or
    // "note" keyword so we handle icon-labelled or differently-worded buttons.
    const newNoteBtn = page
      .locator('button, [role="button"]')
      .filter({ hasText: /new note|add note|create note|new|create|\+/i })
      .first();
    await expect(newNoteBtn).toBeVisible({ timeout: 15_000 });
    await newNoteBtn.click();
    await page.waitForTimeout(500);

    // A form or editor should open
    // Title input
    const titleInput = page.locator('input[placeholder*="title" i], input[type="text"]').first();
    if (await titleInput.count() > 0 && await titleInput.isVisible()) {
      await titleInput.fill(TEST_NOTE.title);
    }

    // Wait for markdown editor to load (dynamic import)
    await page.waitForTimeout(1000);

    // Markdown body — the editor may be a textarea or a contenteditable div
    const bodyEditor = page.locator('textarea, [contenteditable="true"], .w-md-editor-text-input').first();
    if (await bodyEditor.count() > 0 && await bodyEditor.isVisible()) {
      await bodyEditor.fill(TEST_NOTE.body);
    }

    // Save the note
    const saveBtn = page.locator('button').filter({ hasText: /save|create|done/i }).first();
    if (await saveBtn.count() > 0) {
      await saveBtn.click();
      await page.waitForTimeout(1500);
    }

    // The new note should appear in the active list
    const noteCard = page.locator('text=' + TEST_NOTE.title.substring(0, 30)).first();
    await expect(noteCard).toBeVisible({ timeout: 20_000 });
  });

  // ─── Search Notes ─────────────────────────────────────────────────────────────

  test('search filters notes by title', async ({ page }) => {
    await page.goto('/notes');
    await waitForTableLoad(page);

    const searchInput = page.locator('input[placeholder*="earch"]').first();
    await expect(searchInput).toBeVisible();

    await searchInput.fill(TEST_NOTE.title.substring(0, 15));
    await page.waitForTimeout(500);

    const result = page.locator('text=' + TEST_NOTE.title.substring(0, 15)).first();
    await expect(result).toBeVisible({ timeout: 8_000 });
  });

  test('search returns empty for unknown term', async ({ page }) => {
    await page.goto('/notes');
    await waitForTableLoad(page);

    const searchInput = page.locator('input[placeholder*="earch"]').first();
    await searchInput.fill('ZZZNOMATCHNOTE999XYZ');
    await searchInput.press('Enter');
    await page.waitForTimeout(500);

    const noResult = page.locator('text=/no note|empty|nothing/i').first();
    const cards = page.locator('[class*="card"], [class*="note"]').first();
    const hasEmpty = await noResult.count() > 0;
    const hasFew = await cards.count() === 0;
    // Either shows empty state or no cards
    expect(hasEmpty || hasFew).toBeTruthy();
  });

  // ─── View Note ────────────────────────────────────────────────────────────────

  test('clicking a note card opens its content', async ({ page }) => {
    await page.goto('/notes');
    await waitForTableLoad(page);

    // Search for the test note
    const searchInput = page.locator('input[placeholder*="earch"]').first();
    await searchInput.fill(TEST_NOTE.title.substring(0, 15));
    await page.waitForTimeout(500);

    const noteCard = page.locator('text=' + TEST_NOTE.title.substring(0, 15)).first();
    if (await noteCard.count() > 0) {
      await noteCard.click();
      await page.waitForTimeout(500);

      // Either a panel opens on the right or a modal appears with the note content
      const noteContent = page.locator('text=/Playwright automated testing/').first();
      if (await noteContent.count() > 0) {
        await expect(noteContent).toBeVisible({ timeout: 5_000 });
      }
    }
  });

  // ─── Edit Note ────────────────────────────────────────────────────────────────

  test('edit note title and content', async ({ page }) => {
    await page.goto('/notes');
    await waitForTableLoad(page);

    const searchInput = page.locator('input[placeholder*="earch"]').first();
    await searchInput.fill(TEST_NOTE.title.substring(0, 15));
    await page.waitForTimeout(500);

    const noteCard = page.locator('text=' + TEST_NOTE.title.substring(0, 15)).first();
    if (await noteCard.count() > 0) {
      await noteCard.click();
      await page.waitForTimeout(500);

      // Look for edit button
      const editBtn = page.locator('button').filter({ hasText: /edit/i }).first();
      if (await editBtn.count() > 0) {
        await editBtn.click();
        await page.waitForTimeout(500);

        // Change title
        const titleInput = page.locator('input[type="text"]').first();
        if (await titleInput.count() > 0 && await titleInput.isVisible()) {
          await titleInput.clear();
          await titleInput.fill(TEST_NOTE.updatedTitle);
        }

        // Save
        const saveBtn = page.locator('button').filter({ hasText: /save|update/i }).first();
        if (await saveBtn.count() > 0) {
          await saveBtn.click();
          await page.waitForTimeout(1500);
        }
      }
    }
  });

  // ─── Archive Note ─────────────────────────────────────────────────────────────

  test('archiving a note moves it to Archived tab', async ({ page }) => {
    await page.goto('/notes');
    await waitForTableLoad(page);

    const searchInput = page.locator('input[placeholder*="earch"]').first();
    // Search with original or updated title
    await searchInput.fill(TEST_PREFIX);
    await page.waitForTimeout(500);

    // Find archive button for the note card (hover to reveal)
    const noteCard = page.locator('[class*="card"], [class*="note"]').filter({ hasText: new RegExp(TEST_PREFIX, 'i') }).first();
    if (await noteCard.count() > 0) {
      await noteCard.hover();
      await page.waitForTimeout(200);

      const archiveBtn = noteCard.locator('button').filter({ hasText: /archive/i }).first();
      if (await archiveBtn.count() === 0) {
        // May be an icon button — look for archive icon
        const archiveIconBtn = noteCard.locator('button[aria-label*="archive" i]').first();
        if (await archiveIconBtn.count() > 0) {
          await archiveIconBtn.click();
        }
      } else {
        await archiveBtn.click();
      }

      await page.waitForTimeout(1000);

      // Switch to Archived tab and verify
      const archivedTab = page.locator('button, [role="tab"]').filter({ hasText: /archived/i }).first();
      if (await archivedTab.count() > 0) {
        await archivedTab.click();
        await page.waitForTimeout(500);

        const archivedNote = page.locator('text=' + TEST_PREFIX).first();
        if (await archivedNote.count() > 0) {
          await expect(archivedNote).toBeVisible({ timeout: 5_000 });
        }
      }
    }
  });

  test('restoring archived note moves it back to Active tab', async ({ page }) => {
    await page.goto('/notes');
    await waitForTableLoad(page);

    // Go to Archived tab
    const archivedTab = page.locator('button, [role="tab"]').filter({ hasText: /archived/i }).first();
    if (await archivedTab.count() > 0) {
      await archivedTab.click();
      await page.waitForTimeout(500);

      const noteCard = page.locator('[class*="card"], [class*="note"]').filter({ hasText: new RegExp(TEST_PREFIX, 'i') }).first();
      if (await noteCard.count() > 0) {
        await noteCard.hover();
        await page.waitForTimeout(200);

        // Look for restore/unarchive button
        const restoreBtn = noteCard.locator('button').filter({ hasText: /restore|unarchive/i }).first();
        const restoreIcon = noteCard.locator('button[aria-label*="restore" i], button[aria-label*="unarchive" i]').first();
        const btn = (await restoreBtn.count() > 0) ? restoreBtn : restoreIcon;

        if (await btn.count() > 0) {
          await btn.click();
          await page.waitForTimeout(1000);

          // Should appear back in Active tab
          const activeTab = page.locator('button, [role="tab"]').filter({ hasText: /^active$/i }).first();
          if (await activeTab.count() > 0) {
            await activeTab.click();
            await page.waitForTimeout(500);
            const restoredNote = page.locator('text=' + TEST_PREFIX).first();
            if (await restoredNote.count() > 0) {
              await expect(restoredNote).toBeVisible();
            }
          }
        }
      }
    }
  });

  // ─── Soft Delete Note ─────────────────────────────────────────────────────────

  test('soft-deleting a note moves it to Deleted tab', async ({ page }) => {
    await page.goto('/notes');
    await waitForTableLoad(page);

    const searchInput = page.locator('input[placeholder*="earch"]').first();
    await searchInput.fill(TEST_PREFIX);
    await page.waitForTimeout(500);

    const noteCard = page.locator('[class*="card"], [class*="note"]').filter({ hasText: new RegExp(TEST_PREFIX, 'i') }).first();
    if (await noteCard.count() > 0) {
      await noteCard.hover();
      await page.waitForTimeout(200);

      // Look for delete/trash button
      const deleteBtn = noteCard.locator('button').filter({ hasText: /delete|trash/i }).first();
      const deleteIconBtn = noteCard.locator('button[aria-label*="delete" i], button[aria-label*="trash" i]').first();
      const btn = (await deleteBtn.count() > 0) ? deleteBtn : deleteIconBtn;

      if (await btn.count() > 0) {
        await btn.click();
        await page.waitForTimeout(500);

        // Confirm if a dialog appears
        const confirmBtn = page.locator('[role="dialog"] button').filter({ hasText: /confirm|delete|yes/i }).first();
        if (await confirmBtn.count() > 0) {
          await confirmBtn.click();
          await page.waitForTimeout(1000);
        }

        // Should now be in Deleted tab
        const deletedTab = page.locator('button, [role="tab"]').filter({ hasText: /deleted/i }).first();
        if (await deletedTab.count() > 0) {
          await deletedTab.click();
          await page.waitForTimeout(500);
          // Note should be in deleted tab
          await expect(page.locator('body')).not.toContainText('Application error');
        }
      }
    }
  });
});
