const fs = require('fs');
const path = require('path');

const filePath = process.argv[2];
const bumpType = process.argv[3]; // 'patch' or 'major'
const normalize = process.argv[4] === 'true';

if (!filePath || !bumpType) {
  console.error('Usage: node bump_version.js <filePath> <patch|major> [normalize]');
  process.exit(1);
}

try {
  const content = fs.readFileSync(filePath, 'utf8');
  let data = JSON.parse(content);
  let version = data.version;

  if (!version) {
    console.error(`Error: No version field found in ${filePath}`);
    process.exit(1);
  }

  // Handle normalization to X.Y
  let parts = version.split('.').map(Number);
  if (normalize || parts.length > 2) {
    parts = [parts[0] || 1, parts[1] || 0];
  }

  if (bumpType === 'major') {
    parts[0] += 1;
    parts[1] = 0;
  } else if (bumpType === 'patch') {
    parts[1] += 1;
  }

  const newVersion = parts.join('.');
  data.version = newVersion;

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
  console.log(`Updated ${filePath}: ${version} -> ${newVersion}`);
} catch (error) {
  console.error(`Error processing ${filePath}: ${error.message}`);
  process.exit(1);
}
