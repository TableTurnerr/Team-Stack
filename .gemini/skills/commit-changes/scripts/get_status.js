const fs = require('fs');
const path = require('path');

const components = [
  { name: 'Root', path: 'package.json' },
  { name: 'Dashboard', path: 'apps/dashboard/package.json' },
  { name: 'PocketBase', path: 'packages/pocketbase-client/package.json' },
  { name: 'DiscordBot', path: 'tools/discord-bot/package.json' },
  { name: 'Scraper (Manifest)', path: 'tools/TT-lead-scraper-extension/manifest.json' },
  { name: 'Scraper (Version)', path: 'tools/TT-lead-scraper-extension/version.json' },
  { name: 'HubSpot', path: 'packages/hubspot/package.json' }
];

console.log('--- Component Version Status ---');
components.forEach(comp => {
  try {
    if (fs.existsSync(comp.path)) {
      const content = JSON.parse(fs.readFileSync(comp.path, 'utf8'));
      console.log(`${comp.name.padEnd(20)}: ${content.version || 'No version'}`);
    } else {
      // console.log(`${comp.name.padEnd(20)}: Not found`);
    }
  } catch (e) {
    console.log(`${comp.name.padEnd(20)}: Error reading (${e.message})`);
  }
});
console.log('--------------------------------');
