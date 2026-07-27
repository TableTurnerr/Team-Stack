import { test, expect } from '@playwright/test';

const config = {
  configured: true,
  locationId: 'loc',
  pipelines: [{ id: 'pipe', name: 'Sales Pipeline', stages: [{ id: 'new', name: 'New', position: 0 }, { id: 'qualified', name: 'Qualified', position: 1 }] }],
  users: [{ id: 'u1', name: 'GHL User' }],
  tags: [{ id: 'tag1', name: 'Dashboard' }],
  customFields: [],
  currentUser: { matched: true, ghlUserId: 'u1', ghlUserName: 'GHL User' },
  defaults: { leadSource: 'Dashboard' },
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/ghl/dashboard/config', route => route.fulfill({ json: config }));
});

test('lead validation and successful orchestration state', async ({ page }) => {
  await page.route('**/api/ghl/dashboard/leads', route => route.fulfill({ status: 201, json: { status: 'succeeded', contactId: 'c1', opportunityId: 'o1' } }));
  await page.goto('/lead-submission');
  const submit = page.getByRole('button', { name: 'Submit lead' });
  await expect(submit).toBeDisabled();
  await page.getByLabel('Email').fill('lead@example.com');
  await submit.click();
  await expect(page.getByText('Lead submitted')).toBeVisible();
});

test('duplicate result is explicit', async ({ page }) => {
  await page.route('**/api/ghl/dashboard/leads', route => route.fulfill({ status: 409, json: { status: 'duplicate', duplicate: true, contactId: 'c1', opportunityId: 'existing' } }));
  await page.goto('/lead-submission');
  await page.getByLabel('Phone').fill('+15551234567');
  await page.getByRole('button', { name: 'Submit lead' }).click();
  await expect(page.getByText('Existing opportunity found')).toBeVisible();
});

test('Kanban renders empty and populated independently paginated stages', async ({ page }) => {
  await page.route('**/api/ghl/dashboard/opportunities?**', async route => {
    const url = new URL(route.request().url());
    const stage = url.searchParams.get('stageId');
    await route.fulfill({ json: stage === 'new' ? { items: [{ id: 'o1', pipelineId: 'pipe', stageId: 'new', name: 'Example lead', monetaryValue: 100, status: 'open' }], nextCursor: 'next', complete: false } : { items: [], complete: true } });
  });
  await page.goto('/pipeline');
  await expect(page.getByText('Example lead')).toBeVisible();
  await expect(page.getByText('No opportunities')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load more' })).toBeVisible();
});

test('Team metrics show provenance and unavailable history', async ({ page }) => {
  await page.route('**/api/ghl/dashboard/team-overview?**', route => route.fulfill({ json: {
    period: { from: '2026-01-01', to: '2026-01-30' },
    submissions: { value: 3, source: 'local', complete: true },
    createdOpportunities: { value: 2, source: 'local', complete: true },
    submittedValue: { value: 500, source: 'local', complete: true },
    activeOpportunities: { value: 1, source: 'ghl', complete: true },
    won: { value: 1, source: 'ghl', complete: true }, lost: { value: 0, source: 'ghl', complete: true },
    stale: { value: 0, source: 'calculated', complete: true }, unassigned: { value: 0, source: 'ghl', complete: true },
    missingContactInfo: { value: 0, source: 'ghl', complete: true },
    averageCurrentStageAgeDays: { value: null, source: 'ghl', complete: false, unavailableReason: 'No timestamps.' },
    historicalAverageTimeInStage: { value: null, source: 'ghl', complete: false, unavailableReason: 'Complete stage-transition history is unavailable.' },
    stageConversionRates: { value: null, source: 'ghl', complete: false, unavailableReason: 'Complete stage-transition history is unavailable.' },
    byStage: [], bySubmitter: [],
  } }));
  await page.goto('/team');
  await expect(page.getByText('Historical average time in stage: unavailable')).toBeVisible();
  await expect(page.getByText('local', { exact: true }).first()).toBeVisible();
});

test('unmatched users can verify a GHL user ID and confirm the returned name', async ({ page }) => {
  await page.unroute('**/api/ghl/dashboard/config');
  await page.route('**/api/ghl/dashboard/config', route => route.fulfill({
    json: { ...config, currentUser: { matched: false } },
  }));
  await page.route('**/api/ghl/dashboard/identity/lookup', route => route.fulfill({
    json: { ghlUserId: 'ghl-user-1', name: 'Jane Smith' },
  }));
  await page.route('**/api/ghl/dashboard/identity/confirm', route => route.fulfill({
    json: { matched: true, ghlUserId: 'ghl-user-1', ghlUserName: 'Jane Smith', matchMethod: 'confirmed-id' },
  }));
  await page.goto('/lead-submission');
  await page.getByLabel('GHL user ID').fill('ghl-user-1');
  await page.getByRole('button', { name: 'Verify user ID' }).click();
  await expect(page.getByText('Is your name Jane Smith?')).toBeVisible();
  await expect(page.getByRole('button', { name: /Yes, I’m Jane Smith/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'No, try another ID' })).toBeVisible();
});
