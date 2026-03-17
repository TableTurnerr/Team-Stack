@echo off
setlocal

echo.
echo  =============================================
echo   TableTurnerr CRM Local Agent - Uninstall
echo  =============================================
echo.

:: Check both managed and legacy paths
set "MANAGED_DIR=%LocalAppData%\TableTurnerr\ToolManager\tools\local-crm-agent"
set "LEGACY_DIR=%LocalAppData%\TableTurnerr\LocalCrmAgent"

:: Stop running instance
echo  [1/5] Stopping agent...
taskkill /IM LocalCrmAgent.exe /F >nul 2>&1
timeout /t 1 /nobreak >nul
echo        Done.

:: Remove auto-start
echo  [2/5] Removing auto-start...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "LocalCrmAgent" /f >nul 2>&1
echo        Done.

:: Remove protocol handler
echo  [3/5] Removing protocol handler...
reg delete "HKCU\Software\Classes\crm-agent" /f >nul 2>&1
echo        Done.

:: Remove Start Menu shortcut
echo  [4/5] Removing Start Menu shortcut...
if exist "%AppData%\Microsoft\Windows\Start Menu\Programs\TableTurnerr\CRM Agent.lnk" (
    del "%AppData%\Microsoft\Windows\Start Menu\Programs\TableTurnerr\CRM Agent.lnk"
)
if exist "%AppData%\Microsoft\Windows\Start Menu\Programs\TableTurnerr" (
    rmdir "%AppData%\Microsoft\Windows\Start Menu\Programs\TableTurnerr" 2>nul
)
echo        Done.

:: Remove files from both locations
echo  [5/5] Removing files...
if exist "%MANAGED_DIR%" rmdir /s /q "%MANAGED_DIR%"
if exist "%LEGACY_DIR%" rmdir /s /q "%LEGACY_DIR%"
echo        Done.

echo.
echo  =============================================
echo   Uninstall Complete!
echo  =============================================
echo.
pause
