const fs = require('fs');
const path = require('path');

const components = [
  { name: 'Root', path: 'package.json' },
  { name: 'Dashboard', path: 'apps/dashboard/package.json' },
  { name: 'PocketBase', path: 'packages/pocketbase-client/package.json' },
  { name: 'DiscordBot', path: 'tools/discord-bot/package.json' },
  { name: 'HubSpot', path: 'packages/hubspot/package.json' },
  { name: 'Local CRM Agent', path: 'tools/local-CRM-Agent/src/LocalCrmAgent/LocalCrmAgent.csproj', format: 'csproj' }
];

function readCsprojVersion(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const match = content.match(/<Version>(.*?)<\/Version>/);
  return match ? match[1] : 'No version';
}

console.log('--- Component Version Status ---');
components.forEach(comp => {
  try {
    if (fs.existsSync(comp.path)) {
      if (comp.format === 'csproj') {
        console.log(`${comp.name.padEnd(20)}: ${readCsprojVersion(comp.path)}`);
      } else {
        const content = JSON.parse(fs.readFileSync(comp.path, 'utf8'));
        console.log(`${comp.name.padEnd(20)}: ${content.version || 'No version'}`);
      }
    } else {
      // console.log(`${comp.name.padEnd(20)}: Not found`);
    }
  } catch (e) {
    console.log(`${comp.name.padEnd(20)}: Error reading (${e.message})`);
  }
});
console.log('--------------------------------');
