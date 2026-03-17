@echo off
setlocal

echo.
echo  =============================================
echo   TableTurnerr Tool Manager - Uninstall
echo  =============================================
echo.

set "INSTALL_DIR=%LocalAppData%\TableTurnerr\ToolManager"

echo  [1/4] Stopping Tool Manager...
taskkill /IM ToolManager.exe /F >nul 2>&1
timeout /t 1 /nobreak >nul
echo        Done.

echo  [2/4] Removing auto-start...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "ToolManager" /f >nul 2>&1
echo        Done.

echo  [3/4] Removing Start Menu shortcut...
if exist "%AppData%\Microsoft\Windows\Start Menu\Programs\TableTurnerr\Tool Manager.lnk" (
    del "%AppData%\Microsoft\Windows\Start Menu\Programs\TableTurnerr\Tool Manager.lnk"
)
echo        Done.

echo  [4/4] Removing files...
if exist "%INSTALL_DIR%" rmdir /s /q "%INSTALL_DIR%"
echo        Done.

echo.
echo  =============================================
echo   Uninstall Complete!
echo  =============================================
echo.
pause
