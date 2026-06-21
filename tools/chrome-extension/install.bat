@echo off
setlocal EnableDelayedExpansion

:: =============================================
::  Lead Scraper Extension - Installer
::  NOTE: The Tool Manager is the recommended way
::  to install. Use this only for standalone setup
::  without the Tool Manager.
:: =============================================

echo.
echo  =============================================
echo   TableTurnerr Lead Scraper Extension - Setup
echo  =============================================
echo.

if not exist "%~dp0manifest.json" (
    echo [ERROR] manifest.json not found next to this installer.
    echo         Run this from the extracted release folder.
    pause
    exit /b 1
)

:: Stage into the Tool Manager's managed folder if present, else a standalone folder
set "MANAGED_DIR=%LocalAppData%\TableTurnerr\ToolManager\tools\lead-scraper"
set "STANDALONE_DIR=%LocalAppData%\TableTurnerr\LeadScraperExtension"

if exist "%LocalAppData%\TableTurnerr\ToolManager\ToolManager.exe" (
    set "INSTALL_DIR=%MANAGED_DIR%"
) else (
    set "INSTALL_DIR=%STANDALONE_DIR%"
)

echo  Install location: %INSTALL_DIR%
echo.

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

echo  [1/1] Copying extension files...
robocopy "%~dp0." "%INSTALL_DIR%" /MIR /XF "install.bat" "uninstall.bat" /NFL /NDL /NJH /NJS /NP >nul
if %ERRORLEVEL% GEQ 8 (
    echo [ERROR] Failed to copy files.
    pause
    exit /b 1
)
echo        Done.

echo.
echo  =============================================
echo   Installed.
echo  =============================================
echo.
echo   Load the extension in Chrome:
echo     1. Open  chrome://extensions
echo     2. Enable "Developer mode" (top-right)
echo     3. Click "Load unpacked"
echo     4. Select:  %INSTALL_DIR%
echo.
echo   If it is already loaded, just click the reload
echo   icon on the extension card to pick up this update.
echo.
pause
