<#
.SYNOPSIS
    ADMIN TOOL - generates a one-click CRM Agent setup .bat for a specific rep.

.DESCRIPTION
    Run this yourself (the admin); do NOT send this .ps1 to reps. It emits
    Setup-CRM-Agent-<RepName>.bat into the current directory. You then ship
    that .bat to the rep, ideally in the same folder as install.bat +
    LocalCrmAgent.exe (e.g. inside the dist zip).

    Two ways the rep can use the generated .bat:

      A) Tool Manager popup (easiest — no folder needed): on machines where the
         CRM Agent is installed but unprovisioned (no repUserId in
         %APPDATA%\CrmAgent\agent-config.json and no CRM_AGENT_REP_KEY env var),
         the Tool Manager tray app pops up a "CRM Agent Setup" dialog after its
         update check and asks the rep to select this .bat via a file picker.
         Tool Manager parses the setx lines out of it, applies them, and
         restarts the agent. So you can send the rep JUST this .bat file.

      B) Double-click (classic): when the rep double-clicks the generated .bat it:
      1. Sets user-level environment variables via setx:
           CRM_AGENT_TOKEN         (team upload token)
           CRM_AGENT_REP_KEY       (the rep's GoHighLevel user id)
           CRM_AGENT_WORKER_URL    (only if you provided -WorkerUrl)
           CRM_AGENT_FALLBACK_URL  (only if you provided -FallbackUrl)
         The agent reads these on first launch and persists them into its own
         config (%APPDATA%\CrmAgent\agent-config.json, token DPAPI-encrypted),
         so the setup dialog never appears for the rep.
      2. Runs install.bat from the same folder if present (otherwise tells the
         rep to run install.bat).
      3. Prints a big SUCCESS banner and pauses.

    SECURITY: the generated .bat contains the shared agent token in plain text.
    Treat it like a password - send it over a private channel and tell the rep
    to delete it after running it. This script never echoes the full token.

    NOTE: keep this file pure ASCII. Windows PowerShell 5.1 reads BOM-less
    files as ANSI, and smart quotes / em dashes break parsing.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\make-rep-installer.ps1 -RepName "JohnD" -RepKey "a1B2c3D4e5" -AgentToken "shh-secret"

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\make-rep-installer.ps1
    # prompts interactively for every value
#>
[CmdletBinding()]
param(
    [string]$RepName,
    [string]$RepKey,
    [string]$AgentToken,
    [string]$WorkerUrl,
    [string]$FallbackUrl
)

$ErrorActionPreference = 'Stop'

Write-Host ""
Write-Host "=== CRM Agent - per-rep installer generator (admin tool) ===" -ForegroundColor Cyan
Write-Host ""

# ---- Gather inputs (prompt for anything not passed) -------------------------
if (-not $RepName)    { $RepName    = Read-Host "Rep name (used in the file name, e.g. JohnD)" }
if (-not $RepName)    { Write-Host "Rep name is required." -ForegroundColor Red; exit 1 }

if (-not $RepKey)     { $RepKey     = Read-Host "Rep key (GoHighLevel user ID)" }
if (-not $RepKey)     { Write-Host "Rep key is required." -ForegroundColor Red; exit 1 }

if (-not $AgentToken) { $AgentToken = Read-Host "Team agent upload token" }
if (-not $AgentToken) { Write-Host "Agent token is required." -ForegroundColor Red; exit 1 }

if (-not $WorkerUrl) {
    $WorkerUrl = Read-Host "Worker URL (optional - press Enter to use the built-in default)"
}
if (-not $FallbackUrl) {
    $FallbackUrl = Read-Host "Fallback relay URL (optional - press Enter to use the built-in default)"
}

# Filename-safe rep name.
$safeName = ($RepName -replace '[^A-Za-z0-9_\-]', '')
if (-not $safeName) { Write-Host "Rep name has no usable characters." -ForegroundColor Red; exit 1 }

# ---- Build the .bat ----------------------------------------------------------
$lines = New-Object System.Collections.Generic.List[string]
$lines.Add('@echo off')
$lines.Add("title CRM Agent Setup - $RepName")
$lines.Add('echo.')
$lines.Add('echo  ==================================================')
$lines.Add("echo   CRM Agent one-click setup for $RepName")
$lines.Add('echo  ==================================================')
$lines.Add('echo.')
$lines.Add('echo  Configuring your machine (this only takes a second)...')
$lines.Add('echo.')
# setx writes user-level env vars; values are quoted so spaces survive.
# Redirect setx chatter so the token never scrolls across the screen.
$lines.Add(('setx CRM_AGENT_TOKEN "{0}" >nul' -f $AgentToken))
$lines.Add(('setx CRM_AGENT_REP_KEY "{0}" >nul' -f $RepKey))
if ($WorkerUrl)   { $lines.Add(('setx CRM_AGENT_WORKER_URL "{0}" >nul' -f $WorkerUrl)) }
if ($FallbackUrl) { $lines.Add(('setx CRM_AGENT_FALLBACK_URL "{0}" >nul' -f $FallbackUrl)) }
$lines.Add('echo  Settings saved for your Windows account.')
$lines.Add('echo.')
$lines.Add('if exist "%~dp0install.bat" (')
$lines.Add('    echo  Running the CRM Agent installer...')
$lines.Add('    echo.')
$lines.Add('    call "%~dp0install.bat"')
$lines.Add(') else (')
$lines.Add('    echo  ==================================================')
$lines.Add('    echo   Almost done! Now run install.bat from the CRM')
$lines.Add('    echo   Agent folder to finish the installation.')
$lines.Add('    echo  ==================================================')
$lines.Add(')')
$lines.Add('echo.')
$lines.Add('echo  ==================================================')
$lines.Add('echo.')
$lines.Add('echo      SSSSS  U   U  CCCC  CCCC  EEEEE  SSSSS  SSSSS')
$lines.Add('echo      S      U   U  C     C     E      S      S')
$lines.Add('echo      SSSSS  U   U  C     C     EEEE   SSSSS  SSSSS')
$lines.Add('echo          S  U   U  C     C     E          S      S')
$lines.Add('echo      SSSSS   UUU   CCCC  CCCC  EEEEE  SSSSS  SSSSS')
$lines.Add('echo.')
$lines.Add("echo   You're all set, $RepName!")
$lines.Add('echo   The CRM Agent is configured for your account.')
$lines.Add('echo   You can delete this setup file now.')
$lines.Add('echo.')
$lines.Add('echo  ==================================================')
$lines.Add('echo.')
$lines.Add('pause')

$batName = "Setup-CRM-Agent-$safeName.bat"
$batPath = Join-Path (Get-Location) $batName
# ASCII keeps cmd.exe happy (no BOM surprises).
$lines | Out-File -FilePath $batPath -Encoding ascii

# ---- Report (never echo the full token) --------------------------------------
if ($AgentToken.Length -gt 4) {
    $tokenPreview = $AgentToken.Substring(0, 4) + ('*' * 8)
} else {
    $tokenPreview = '****'
}
Write-Host "Generated: $batPath" -ForegroundColor Green
Write-Host ""
Write-Host "  Rep name : $RepName"
Write-Host "  Rep key  : $RepKey"
Write-Host "  Token    : $tokenPreview (embedded in the .bat - treat it like a password)"
if ($WorkerUrl)   { Write-Host "  Worker   : $WorkerUrl" }
if ($FallbackUrl) { Write-Host "  Fallback : $FallbackUrl" }
Write-Host ""
Write-Host "Next, either:" -ForegroundColor Yellow
Write-Host "  A) Rep already has the CRM Agent (via Tool Manager): just send them" -ForegroundColor Yellow
Write-Host "     $batName. Tool Manager pops up a 'CRM Agent Setup' dialog" -ForegroundColor Yellow
Write-Host "     on unconfigured machines and asks them to select this file." -ForegroundColor Yellow
Write-Host "  B) Fresh machine: put $batName in the same folder as" -ForegroundColor Yellow
Write-Host "     install.bat + LocalCrmAgent.exe and send that folder to the rep." -ForegroundColor Yellow
Write-Host "     They just double-click it." -ForegroundColor Yellow
