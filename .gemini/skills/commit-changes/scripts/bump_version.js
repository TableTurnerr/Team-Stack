const fs = require('fs');
const path = require('path');

const filePath = process.argv[2];
const bumpType = process.argv[3]; // 'patch' or 'major'
const normalize = process.argv[4] === 'true';

if (!filePath || !bumpType) {
  console.error('Usage: node bump_version.js <filePath> <patch|major> [normalize]');
  process.exit(1);
}

const isCsproj = filePath.endsWith('.csproj');

try {
  const content = fs.readFileSync(filePath, 'utf8');

  if (isCsproj) {
    // Handle .csproj XML files — version format is X.Y.Z (semver)
    const match = content.match(/<Version>(.*?)<\/Version>/);
    if (!match) {
      console.error(`Error: No <Version> tag found in ${filePath}`);
      process.exit(1);
    }
    const version = match[1];
    let parts = version.split('.').map(Number);
    // Ensure at least 3 parts for semver
    while (parts.length < 3) parts.push(0);

    if (bumpType === 'major') {
      parts[0] += 1;
      parts[1] = 0;
      parts[2] = 0;
    } else if (bumpType === 'patch') {
      parts[2] += 1;
    }

    const newVersion = parts.join('.');
    const updated = content.replace(/<Version>.*?<\/Version>/, `<Version>${newVersion}</Version>`);
    fs.writeFileSync(filePath, updated);
    console.log(`Updated ${filePath}: ${version} -> ${newVersion}`);
  } else {
    // Handle JSON files (package.json, manifest.json, version.json)
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
  }
} catch (error) {
  console.error(`Error processing ${filePath}: ${error.message}`);
  process.exit(1);
}
