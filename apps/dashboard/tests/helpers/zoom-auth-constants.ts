/**
 * zoom-auth-constants.ts
 * Shared constants for Zoom authentication helpers.
 * Kept in a separate non-test file so both zoom-auth-setup.ts (a test file)
 * and 12-live-call-flow.spec.ts can import without triggering Playwright's
 * "test file should not import test file" restriction.
 */
import * as path from 'path';

/** Path to the saved Zoom web phone auth state (cookies). */
export const ZOOM_AUTH_FILE = path.resolve(__dirname, '../.auth/zoom.json');
