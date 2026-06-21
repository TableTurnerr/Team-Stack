// Probe: can we log a Call-type message in GHL without a conversationProviderId?
//
// Run with:   node scripts/probe-call-message.mjs
//
// 1. Creates a throwaway test contact (phone +15550000001).
// 2. Tries POST /conversations/messages with type:"Call" and no provider ID.
// 3. Tries POST /conversations/messages/inbound (the "external provider" path) without a provider ID.
// 4. Tries the same /inbound call WITH a junk providerId, to confirm provider ID is the only thing missing.
// 5. Cleans up the contact.
//
// The point is to see exactly which field GHL refuses, so we know whether
// the Marketplace App path is really required for call logging.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
const env = {};
for (const line of raw.split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq > 0) env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
}

const PIT = env.GHL_PIT;
const LOCATION_ID = env.GHL_LOCATION_ID;
if (!PIT || !LOCATION_ID) {
  console.error('Missing GHL_PIT or GHL_LOCATION_ID in .env');
  process.exit(1);
}

const BASE = 'https://services.leadconnectorhq.com';
const headers = {
  Authorization: `Bearer ${PIT}`,
  Version: '2021-04-15',
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { ok: res.ok, status: res.status, body: parsed };
}

function show(label, r) {
  console.log(`\n── ${label} ──`);
  console.log(`HTTP ${r.status}`);
  console.log(typeof r.body === 'string' ? r.body : JSON.stringify(r.body, null, 2));
}

// 1. Create a throwaway contact.
console.log('Creating throwaway test contact...');
const created = await call('POST', '/contacts/', {
  locationId: LOCATION_ID,
  firstName: 'Probe',
  lastName: 'Delete-Me',
  phone: '+15550000001',
  source: 'zoomphone-probe',
});

if (!created.ok) {
  show('Create contact FAILED — cannot continue', created);
  process.exit(1);
}

const contactId = created.body?.contact?.id ?? created.body?.id;
if (!contactId) {
  show('Could not extract contact ID from response', created);
  process.exit(1);
}
console.log(`Test contact: ${contactId}`);

// 2. /conversations/messages with type:"Call" and no provider ID.
const a = await call('POST', '/conversations/messages', {
  type: 'Call',
  contactId,
  message: 'Probe: outbound call placeholder',
  direction: 'outbound',
});
show('A) POST /conversations/messages  (no providerId)', a);

// 3. /conversations/messages/inbound  (external-provider path) without provider ID.
const b = await call('POST', '/conversations/messages/inbound', {
  type: 'Call',
  locationId: LOCATION_ID,
  contactId,
  message: 'Probe: inbound call placeholder',
  direction: 'inbound',
  call: { to: '+15550000001', from: '+15550000099', status: 'completed' },
});
show('B) POST /conversations/messages/inbound  (no providerId)', b);

// 4. Same /inbound but WITH a junk providerId to confirm the field name is right.
const c = await call('POST', '/conversations/messages/inbound', {
  type: 'Call',
  locationId: LOCATION_ID,
  contactId,
  conversationProviderId: '000000000000000000000000',
  message: 'Probe: inbound call with junk providerId',
  direction: 'inbound',
  call: { to: '+15550000001', from: '+15550000099', status: 'completed' },
});
show('C) POST /conversations/messages/inbound  (junk providerId)', c);

// 5. Clean up.
const del = await call('DELETE', `/contacts/${contactId}`);
console.log(`\nCleanup: HTTP ${del.status}`);

console.log('\n── Verdict ──');
console.log('A 2xx → no provider ID needed, use /conversations/messages.');
console.log('A 4xx + B 2xx → use /inbound without provider ID.');
console.log('A & B 4xx complaining about conversationProviderId → Marketplace App is required.');
console.log('C 4xx with a "not found" / "invalid" provider message → confirms the field name is conversationProviderId.');
