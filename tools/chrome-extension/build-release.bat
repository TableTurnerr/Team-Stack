@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

:: =============================================
::  Lead Scraper Extension - Release package
::
::  Packages the extension (from the in-repo source
::  at tools\chrome-extension\extension) + tool.json
::  + installers into a zip the Tool Manager can
::  install. CI normally does this via
::  build-chrome-extension.yml; this is the manual
::  equivalent.
:: =============================================

set "SRC=%GMAPS_SCRAPER_DIR%"
if "%SRC%"=="" set "SRC=%~dp0extension"
for %%I in ("%SRC%") do set "SRC=%%~fI"

if not exist "%SRC%\manifest.json" (
    echo [ERROR] Extension not found at %SRC%.
    echo The extension source should be at tools\chrome-extension\extension.
    pause
    exit /b 1
)

for /f "delims=" %%v in ('powershell -NoProfile -Command "(Get-Content '%SRC%\manifest.json' -Raw | ConvertFrom-Json).version"') do set VERSION=%%v

echo ============================================
echo   Packaging Lead Scraper Extension v%VERSION%
echo   Source: %SRC%
echo ============================================
echo.

set "STAGE=%~dp0dist\lead-scraper"
if exist "%STAGE%" rmdir /s /q "%STAGE%"
mkdir "%STAGE%"

robocopy "%SRC%" "%STAGE%" /MIR /XD ".git" ".github" "node_modules" "dist" "dist-dev" /XF ".gitignore" ".dev-build-counter" /NFL /NDL /NJH /NJS /NP >nul
if %ERRORLEVEL% GEQ 8 (
    echo [ERROR] Copy failed.
    pause
    exit /b 1
)

:: The committed source manifest is the DEV build (name carries " (dev)", no "key").
:: Turn this STAGED copy into the release manifest: strip the " (dev)" marker and
:: inject the signing key. Shared with CI via apply-release-manifest.ps1 so the local
:: and GitHub release builds can't drift.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0apply-release-manifest.ps1" -ManifestPath "%STAGE%\manifest.json"
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to build the release manifest from the dev source.
    pause
    exit /b 1
)

:: Inject the release tool.json (with the version filled in) + installers
powershell -NoProfile -Command "$m = Get-Content '%~dp0tool.json' -Raw | ConvertFrom-Json; $m | Add-Member -NotePropertyName version -NotePropertyValue '%VERSION%' -Force; $m | ConvertTo-Json -Depth 5 | Set-Content '%STAGE%\tool.json' -Encoding UTF8"
copy /Y "%~dp0install.bat" "%STAGE%\install.bat" >nul
copy /Y "%~dp0uninstall.bat" "%STAGE%\uninstall.bat" >nul

set VERSION_DASHED=%VERSION:.=-%
set "ZIP=%~dp0dist\LeadScraperExtension-v%VERSION_DASHED%.zip"
echo Zipping to %ZIP% ...
powershell -NoProfile -Command "Compress-Archive -Path '%STAGE%\*' -DestinationPath '%ZIP%' -Force"

echo.
echo ============================================
echo   Ready: %ZIP%
echo ============================================
echo   Release tag convention: lead-scraper-v%VERSION%
echo   (the Tool Manager discovers it from the Team-Stack release).
echo.
pause
