@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

:: =============================================
::  Lead Scraper Extension - Dev build + install
::
::  The extension SOURCE lives in this monorepo at
::  tools\chrome-extension\extension. Override with
::  GMAPS_SCRAPER_DIR only if you keep a checkout
::  elsewhere.
:: =============================================

set "SRC=%GMAPS_SCRAPER_DIR%"
if "%SRC%"=="" set "SRC=%~dp0extension"

:: Normalize to a full path
for %%I in ("%SRC%") do set "SRC=%%~fI"

if not exist "%SRC%\manifest.json" (
    echo [ERROR] Could not find the extension at:
    echo         %SRC%
    echo.
    echo The extension source should be at tools\chrome-extension\extension.
    echo Override with GMAPS_SCRAPER_DIR if it lives elsewhere, e.g.:
    echo     set GMAPS_SCRAPER_DIR=C:\path\to\extension
    echo     dev-build.bat
    pause
    exit /b 1
)

echo Extension source: %SRC%

:: Version from the extension's manifest.json
for /f "delims=" %%v in ('powershell -NoProfile -Command "(Get-Content '%SRC%\manifest.json' -Raw | ConvertFrom-Json).version"') do set VERSION=%%v
if "%VERSION%"=="" set VERSION=0.0.0

:: Dev version: date + daily counter (e.g. 4.2-dev.20260619.3)
for /f %%d in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd"') do set TODAY=%%d
set COUNTER_FILE=%~dp0.dev-build-counter
set BUILD_NUM=1
if exist "%COUNTER_FILE%" (
    for /f "tokens=1,2 delims=:" %%a in (%COUNTER_FILE%) do (
        if "%%a"=="%TODAY%" set /a BUILD_NUM=%%b+1
    )
)
echo %TODAY%:%BUILD_NUM%> "%COUNTER_FILE%"
set DEV_VERSION=%VERSION%-dev.%TODAY%.%BUILD_NUM%

echo ============================================
echo   Lead Scraper Extension v%DEV_VERSION% - Dev install
echo ============================================
echo.

:: Install into the Tool Manager's managed tools folder (id = lead-scraper)
set "INSTALL_DIR=%LocalAppData%\TableTurnerr\ToolManager\tools\lead-scraper"
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

echo Staging extension to %INSTALL_DIR% ...
robocopy "%SRC%" "%INSTALL_DIR%" /MIR /XD ".git" ".github" "node_modules" "dist" "dist-dev" /XF ".gitignore" ".dev-build-counter" /NFL /NDL /NJH /NJS /NP >nul
if %ERRORLEVEL% GEQ 8 (
    echo [ERROR] Failed to copy extension files.
    pause
    exit /b 1
)

:: Drop the tool manifest in next to the extension files
copy /Y "%~dp0tool.json" "%INSTALL_DIR%\tool.json" >nul

echo.
echo ============================================
echo   Staged dev build to:
echo   %INSTALL_DIR%
echo ============================================
echo.
echo   Load it in Chrome:  chrome://extensions  ^>  Developer mode
echo   ^>  Load unpacked  ^>  select the folder above.
echo   (If already loaded, click the reload icon on the card.)
echo.
echo   Note: this stages files for local testing only and does NOT touch the
echo   Tool Manager registry. To have the Tool Manager track and auto-update
echo   the extension, install it from the Tool Manager once a lead-scraper
echo   release exists (see build-chrome-extension.yml).
echo.
pause
