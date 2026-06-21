@echo off
setlocal

echo.
echo  =============================================
echo   TableTurnerr Lead Scraper Extension - Uninstall
echo  =============================================
echo.

set "MANAGED_DIR=%LocalAppData%\TableTurnerr\ToolManager\tools\lead-scraper"
set "STANDALONE_DIR=%LocalAppData%\TableTurnerr\LeadScraperExtension"

echo  Removing files...
if exist "%MANAGED_DIR%" rmdir /s /q "%MANAGED_DIR%"
if exist "%STANDALONE_DIR%" rmdir /s /q "%STANDALONE_DIR%"
echo        Done.

echo.
echo  Remove it from Chrome too: chrome://extensions  ^>  Remove.
echo.
pause
