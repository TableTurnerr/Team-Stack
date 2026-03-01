/**
 * test-data.ts
 * Central place for all test data constants.
 * All test entries use the "TEST_PW_" prefix so they can be
 * bulk-identified and cleaned up without touching real data.
 */

// Unique prefix per worker allows running tests in parallel safely
// (otherwise workers delete each other's data during cleanup)
const workerId = process.env.TEST_WORKER_INDEX || '0';
export const TEST_PREFIX = `TPW${workerId}_`;

export const TEST_COMPANY = {
  name: `${TEST_PREFIX}Restaurant Alpha`,
  owner: `${TEST_PREFIX}John Doe`,
  phone: '555-0199',
  location: 'Test City, TC 00001',
  instagram: `@${TEST_PREFIX.toLowerCase()}restalpha`,
  email: `test_pw_restalpha@example.com`,
  status: 'Cold No Reply' as const,
  source: 'Manual' as const,
};

export const TEST_COMPANY_2 = {
  name: `${TEST_PREFIX}Restaurant Beta`,
  owner: `${TEST_PREFIX}Jane Smith`,
  phone: '555-0200',
  location: 'Beta Town, BT 00002',
  instagram: `@${TEST_PREFIX.toLowerCase()}restbeta`,
  email: `test_pw_restbeta@example.com`,
  status: 'Cold No Reply' as const,
};

export const TEST_PHONE_NUMBER = {
  number: '555-0101',
  label: 'Main Line TEST',
  locationName: 'TEST Location Branch',
  receptionistName: `${TEST_PREFIX}Receptionist`,
};

export const TEST_CALL_LOG = {
  recipientName: `${TEST_PREFIX}Owner`,
  outcome: 'Interested' as const,
  interestLevel: 7,
  notes: `[${TEST_PREFIX}] Playwright automated test call log entry`,
  ownerName: `${TEST_PREFIX}Owner Name`,
};

export const TEST_NOTE = {
  title: `${TEST_PREFIX}Test Note Title`,
  body: `# ${TEST_PREFIX}Test Heading\n\nThis note was created by Playwright automated testing.\n\n- Item A\n- Item B`,
  updatedTitle: `${TEST_PREFIX}Test Note Updated`,
};

export const TEST_ACTOR = {
  username: `${TEST_PREFIX}insta_account`,
};

export const TEST_SESSION = {
  notes: `${TEST_PREFIX}Playwright session notes`,
};

// Selectors reused across specs
export const SELECTORS = {
  sidebar: {
    overview: 'a[href="/"]',
    session: 'a[href="/session"]',
    sessionLogs: 'a[href="/session-logs"]',
    coldCalls: 'a[href="/cold-calls"]',
    companies: 'a[href="/companies"]',
    actors: 'a[href="/actors"]',
    notes: 'a[href="/notes"]',
    recordings: 'a[href="/recordings"]',
    goals: 'a[href="/goals"]',
    team: 'a[href="/team"]',
    settings: 'a[href="/settings"]',
  },
  search: 'input[placeholder*="Search"]',
  refreshButton: 'button[aria-label*="refresh"], button:has(svg.lucide-refresh-cw)',
};

// Shared wait helper — waits for skeleton loaders to disappear
export async function waitForTableLoad(page: import('@playwright/test').Page) {
  // Wait for any skeleton to disappear
  await page.waitForFunction(() => {
    const skeletons = document.querySelectorAll('[data-testid="skeleton"], .animate-pulse');
    return skeletons.length === 0;
  }, { timeout: 15_000 }).catch(() => {
    // If no skeleton was ever found, that's fine
  });
  // Then wait for network to settle
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
}
