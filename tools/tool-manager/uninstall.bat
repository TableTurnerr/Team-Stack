@echo off
setlocal

echo.
echo  =============================================
echo   TableTurnerr Tool Manager - Uninstall
echo  =============================================
echo.

set "INSTALL_DIR=%LocalAppData%\TableTurnerr\ToolManager"

echo  [1/5] Stopping Tool Manager and managed tools...
taskkill /IM ToolManager.exe /F >nul 2>&1
taskkill /IM LocalCrmAgent.exe /F >nul 2>&1
timeout /t 2 /nobreak >nul
echo        Done.

echo  [2/5] Removing auto-start entries...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "ToolManager" /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "LocalCrmAgent" /f >nul 2>&1
echo        Done.

echo  [3/5] Removing protocol handlers...
reg delete "HKCU\Software\Classes\crm-agent" /f >nul 2>&1
echo        Done.

echo  [4/5] Removing Start Menu shortcuts...
if exist "%AppData%\Microsoft\Windows\Start Menu\Programs\TableTurnerr\TableTurnerr Tool Manager.lnk" (
    del "%AppData%\Microsoft\Windows\Start Menu\Programs\TableTurnerr\TableTurnerr Tool Manager.lnk"
)
if exist "%AppData%\Microsoft\Windows\Start Menu\Programs\TableTurnerr\Tool Manager.lnk" (
    del "%AppData%\Microsoft\Windows\Start Menu\Programs\TableTurnerr\Tool Manager.lnk"
)
if exist "%AppData%\Microsoft\Windows\Start Menu\Programs\TableTurnerr\CRM Agent.lnk" (
    del "%AppData%\Microsoft\Windows\Start Menu\Programs\TableTurnerr\CRM Agent.lnk"
)
if exist "%AppData%\Microsoft\Windows\Start Menu\Programs\TableTurnerr" (
    rmdir "%AppData%\Microsoft\Windows\Start Menu\Programs\TableTurnerr" 2>nul
)
echo        Done.

echo  [5/5] Removing all files (manager + managed tools)...
if exist "%INSTALL_DIR%" rmdir /s /q "%INSTALL_DIR%"
echo        Done.

echo.
echo  =============================================
echo   Uninstall Complete!
echo  =============================================
echo.
echo   Tool Manager and all managed tools removed.
echo   Chrome extensions must be removed manually
echo   from chrome://extensions if loaded.
echo.
pause
