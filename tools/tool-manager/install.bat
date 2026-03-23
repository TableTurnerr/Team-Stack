@echo off
setlocal EnableDelayedExpansion

echo.
echo  =============================================
echo   TableTurnerr Tool Manager - Setup
echo  =============================================
echo.

if not exist "%~dp0ToolManager.exe" (
    echo [ERROR] ToolManager.exe not found next to this installer.
    pause
    exit /b 1
)

set "INSTALL_DIR=%LocalAppData%\TableTurnerr\ToolManager"

echo  Install location: %INSTALL_DIR%
echo.

taskkill /IM ToolManager.exe /F >nul 2>&1
timeout /t 1 /nobreak >nul

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

echo  [1/5] Copying files...
if not exist "%INSTALL_DIR%\tools" mkdir "%INSTALL_DIR%\tools"
copy /Y "%~dp0ToolManager.exe" "%INSTALL_DIR%\ToolManager.exe" >nul
if exist "%~dp0tool.json" copy /Y "%~dp0tool.json" "%INSTALL_DIR%\tool.json" >nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to copy files.
    pause
    exit /b 1
)
echo        Done.

echo  [2/5] Cleaning up legacy installs...
:: Remove old standalone CRM Agent if it exists at the legacy path
set "LEGACY_LCA=%LocalAppData%\TableTurnerr\LocalCrmAgent"
if exist "!LEGACY_LCA!\LocalCrmAgent.exe" (
    echo        Found legacy CRM Agent at !LEGACY_LCA! - migrating...
    taskkill /IM LocalCrmAgent.exe /F >nul 2>&1
    timeout /t 1 /nobreak >nul
    reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "LocalCrmAgent" /f >nul 2>&1
    reg delete "HKCU\Software\Classes\crm-agent" /f >nul 2>&1
    if exist "%AppData%\Microsoft\Windows\Start Menu\Programs\TableTurnerr\CRM Agent.lnk" (
        del "%AppData%\Microsoft\Windows\Start Menu\Programs\TableTurnerr\CRM Agent.lnk" >nul 2>&1
    )
    rmdir /s /q "!LEGACY_LCA!" >nul 2>&1
    echo        Legacy CRM Agent removed.
)
echo        Done.

echo  [3/5] Registering auto-start...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "ToolManager" /t REG_SZ /d "\"%INSTALL_DIR%\ToolManager.exe\" --background" /f >nul 2>&1
echo        Done.

echo  [4/5] Creating Start Menu shortcut...
set "SHORTCUT_DIR=%AppData%\Microsoft\Windows\Start Menu\Programs\TableTurnerr"
if not exist "!SHORTCUT_DIR!" mkdir "!SHORTCUT_DIR!"
powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%AppData%\Microsoft\Windows\Start Menu\Programs\TableTurnerr\Tool Manager.lnk'); $s.TargetPath = '%INSTALL_DIR%\ToolManager.exe'; $s.Description = 'TableTurnerr Tool Manager'; $s.WorkingDirectory = '%INSTALL_DIR%'; $s.Save()" >nul 2>&1
echo        Done.

echo  [5/5] Starting Tool Manager...
start "" "%INSTALL_DIR%\ToolManager.exe"
echo        Done.

echo.
echo  =============================================
echo   Installation Complete!
echo  =============================================
echo.
echo   The Tool Manager is now running. Pick which
echo   tools to install - updates are automatic.
echo.
pause
