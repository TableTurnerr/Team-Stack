@echo off
setlocal

echo.
echo  =============================================
echo   TableTurnerr CRM Local Agent - Uninstall
echo  =============================================
echo.

set "INSTALL_DIR=%LocalAppData%\TableTurnerr\LocalCrmAgent"

:: Stop running instance
echo  [1/4] Stopping agent...
taskkill /IM LocalCrmAgent.exe /F >nul 2>&1
timeout /t 1 /nobreak >nul
echo        Done.

:: Remove auto-start
echo  [2/4] Removing auto-start...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "LocalCrmAgent" /f >nul 2>&1
echo        Done.

:: Remove protocol handler
echo  [3/4] Removing protocol handler...
reg delete "HKCU\Software\Classes\crm-agent" /f >nul 2>&1
echo        Done.

:: Remove files
echo  [4/4] Removing files...
if exist "%INSTALL_DIR%" (
    rmdir /s /q "%INSTALL_DIR%"
)
echo        Done.

echo.
echo  =============================================
echo   Uninstall Complete!
echo  =============================================
echo.
pause
