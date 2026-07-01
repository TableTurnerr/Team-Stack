<#
.SYNOPSIS
  Turn the committed dev-flavoured extension manifest into the release manifest.

.DESCRIPTION
  The source manifest (tools/chrome-extension/extension/manifest.json) is the DEV
  build: its "name"/"description" carry a " (dev)" marker and its "key" is the DEV
  key, so loading it unpacked gives Chrome the stable dev id
  lgacebajcimhkmcgihcjcdnndkbdggak, distinct from the release id, so the two coexist.
  This script reverses that for a release build against a STAGED copy of the manifest:

    * strips the " (dev)" marker from name and description, and
    * swaps the dev "key" for the release "key" (from release.key beside this script)
      that pins the release to id jmedgkieldhfccjpjeafmgenaidchbmg. Both ids are
      whitelisted in the CRM Agent native-messaging host (see
      tools/local-CRM-Agent/NATIVE-MESSAGING.md); the release ships only the release id.

  Both the GitHub workflow (build-chrome-extension.yml) and the local build-release.bat
  call this so the two paths can never drift.

.PARAMETER ManifestPath
  Path to the STAGED manifest.json to rewrite in place. The committed source manifest
  is never touched.
#>
param([Parameter(Mandatory = $true)][string]$ManifestPath)

$ErrorActionPreference = 'Stop'

$keyPath = Join-Path $PSScriptRoot 'release.key'
$key = (Get-Content $keyPath -Raw).Trim()
if (-not $key) { throw "release.key ($keyPath) is empty -- cannot key the release manifest." }

$mf = Get-Content $ManifestPath -Raw
# Drop the marker wherever it appears (name + description).
$mf = $mf -replace ' \(dev\)', ''
# Swap the dev "key" value for the release key, preserving indentation/formatting.
$mf = $mf -replace '(?m)^(\s*"key":\s*")[^"]*(",)\s*$', ('${1}' + $key + '${2}')

# UTF-8 without BOM: Chrome rejects a BOM at the start of manifest.json.
[System.IO.File]::WriteAllText($ManifestPath, $mf, (New-Object System.Text.UTF8Encoding($false)))

# Fail loudly if the transform did not take -- shipping a dev-marked manifest, or one
# still carrying the dev key, would break the release (wrong id -> native messaging off).
$m = Get-Content $ManifestPath -Raw | ConvertFrom-Json
if ($m.name -match '\(dev\)' -or $m.description -match '\(dev\)') {
    throw "manifest still contains a (dev) marker after transform."
}
if (-not $m.key) {
    throw "manifest has no signing key after transform -- release would get an unstable id."
}
if ($m.key -ne $key) {
    throw "manifest key was not swapped to the release key -- the dev key would ship."
}
Write-Host "Release manifest ready: name='$($m.name)', release key injected."
