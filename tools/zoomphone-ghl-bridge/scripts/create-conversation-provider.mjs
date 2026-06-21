// One-shot: create a GHL Conversation Provider of type "Call" and print its ID.
//
// Run with:   node scripts/create-conversation-provider.mjs
// Reads GHL_PIT and GHL_LOCATION_ID from .env in the project root.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(process.cwd(), '.env');
let raw;
try {
  raw = readFileSync(envPath, 'utf8');
} catch {
  console.error(`Could not read ${envPath}. Run this from the project root.`);
  process.exit(1);
}

const env = {};
for (const line of raw.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq < 0) continue;
  env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
}

const pit = env.GHL_PIT;
const locationId = env.GHL_LOCATION_ID;
if (!pit || !locationId) {
  console.error('Missing GHL_PIT or GHL_LOCATION_ID in .env');
  process.exit(1);
}

const body = {
  locationId,
  name: 'Zoom Phone',
  type: 'Call',
};

const res = await fetch('https://services.leadconnectorhq.com/conversations/providers', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${pit}`,
    Version: '2021-04-15',
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(body),
});

const text = await res.text();
let parsed;
try { parsed = JSON.parse(text); } catch { parsed = text; }

if (!res.ok) {
  console.error(`HTTP ${res.status} ${res.statusText}`);
  console.error(parsed);
  if (res.status === 401 || res.status === 403) {
    console.error(
      '\nPITs may not be permitted to create Conversation Providers. ' +
      'Fallback: create a Marketplace App at https://marketplace.gohighlevel.com/ ' +
      'with a Conversation Provider module (type: Call), install it on the sub-account, ' +
      'and use the provider ID it generates.',
    );
  }
  process.exit(1);
}

console.log('Created:', parsed);
const id = parsed?.providerId ?? parsed?.id ?? parsed?._id;
if (id) {
  console.log(`\nGHL_CONVERSATION_PROVIDER_ID=${id}`);
  console.log('\nNext: npx wrangler secret put GHL_CONVERSATION_PROVIDER_ID');
}
