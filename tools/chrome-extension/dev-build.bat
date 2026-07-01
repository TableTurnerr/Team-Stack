@echo off
setlocal
cd /d "%~dp0"

:: =============================================
::  Lead Scraper Extension - Dev load helper
::
::  There is nothing to build. The committed source
::  at tools\chrome-extension\extension is ALREADY the
::  dev build: its name shows " (dev)" and it has no
::  signing "key", so Chrome assigns it its own
::  extension id and it coexists with the Tool
::  Manager's release install. Just load the folder
::  unpacked and edit in place.
::
::  The GitHub release workflow (build-chrome-extension.yml)
::  and build-release.bat strip the " (dev)" marker and
::  inject the signing key via apply-release-manifest.ps1,
::  so the published release is clean and keyed.
:: =============================================

set "SRC=%~dp0extension"
for %%I in ("%SRC%") do set "SRC=%%~fI"

if not exist "%SRC%\manifest.json" (
    echo [ERROR] Extension not found at %SRC%.
    pause
    exit /b 1
)

:: Informational sanity check that the source really is the dev build (dev-marked
:: name + the DEV key, not the release key -- sharing the release key would collide
:: with the installed release id and Chrome would refuse to load both).
powershell -NoProfile -Command "$m = Get-Content '%SRC%\manifest.json' -Raw | ConvertFrom-Json; if ($m.name -notmatch '\(dev\)') { Write-Host '[WARN] Source manifest name is not (dev)-marked:' $m.name }; $rk = (Get-Content '%~dp0release.key' -Raw).Trim(); if (-not $m.key) { Write-Host '[WARN] Source manifest has no key - the dev id will vary per machine and native messaging will not work.' } elseif ($m.key -eq $rk) { Write-Host '[WARN] Source manifest carries the RELEASE key - it will collide with the installed release; restore the dev key.' }"

echo ============================================
echo   Lead Scraper Extension - load the DEV build
echo ============================================
echo.
echo   1. Open  chrome://extensions
echo   2. Enable  Developer mode  (top-right)
echo   3. Click  Load unpacked  and select this folder:
echo.
echo        %SRC%
echo.
echo   It loads as "TableTurner Lead Scraper (dev)" with its own extension id,
echo   so it runs side by side with the Tool Manager's release install. Edit
echo   files and click the card's reload icon to pick up changes.
echo.
echo   Note: native messaging (Zoom web-phone recording) only trusts the
echo   release id, so that one feature does not fire on the dev build.
echo.
pause
