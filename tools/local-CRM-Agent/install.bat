@echo off
setlocal EnableDelayedExpansion

:: =============================================
::  TableTurnerr Local CRM Agent - Installer
::  NOTE: The Tool Manager is the recommended
::  way to install. Use this only for standalone
::  installs without the Tool Manager.
:: =============================================

echo.
echo  =============================================
echo   TableTurnerr CRM Local Agent - Setup
echo  =============================================
echo.

if not exist "%~dp0LocalCrmAgent.exe" (
    echo [ERROR] LocalCrmAgent.exe not found next to this installer.
    echo         Make sure install.bat and LocalCrmAgent.exe are in the same folder.
    echo.
    pause
    exit /b 1
)

:: Use managed path if Tool Manager is installed, otherwise legacy path
set "MANAGED_DIR=%LocalAppData%\TableTurnerr\ToolManager\tools\local-crm-agent"
set "LEGACY_DIR=%LocalAppData%\TableTurnerr\LocalCrmAgent"

if exist "%LocalAppData%\TableTurnerr\ToolManager\ToolManager.exe" (
    set "INSTALL_DIR=%MANAGED_DIR%"
) else (
    set "INSTALL_DIR=%LEGACY_DIR%"
)

echo  Install location: %INSTALL_DIR%
echo.

:: Kill any running instance before copying
taskkill /IM LocalCrmAgent.exe /F >nul 2>&1
timeout /t 1 /nobreak >nul

:: Create install directory
if not exist "%INSTALL_DIR%" (
    mkdir "%INSTALL_DIR%"
    if !ERRORLEVEL! neq 0 (
        echo [ERROR] Failed to create install directory.
        pause
        exit /b 1
    )
)

:: Copy the executable
echo  [1/5] Copying files...
copy /Y "%~dp0LocalCrmAgent.exe" "%INSTALL_DIR%\LocalCrmAgent.exe" >nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to copy files. Is the agent currently running?
    echo         Close it from the system tray and try again.
    pause
    exit /b 1
)
echo        Done.

:: Register auto-start in Windows registry
echo  [2/5] Registering auto-start...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "LocalCrmAgent" /t REG_SZ /d "\"%INSTALL_DIR%\LocalCrmAgent.exe\" --background" /f >nul 2>&1
echo        Done.

:: Register crm-agent:// protocol handler
echo  [3/5] Registering protocol handler...
reg add "HKCU\Software\Classes\crm-agent" /ve /t REG_SZ /d "URL:CRM Agent Protocol" /f >nul 2>&1
reg add "HKCU\Software\Classes\crm-agent" /v "URL Protocol" /t REG_SZ /d "" /f >nul 2>&1
reg add "HKCU\Software\Classes\crm-agent\DefaultIcon" /ve /t REG_SZ /d "\"%INSTALL_DIR%\LocalCrmAgent.exe\",0" /f >nul 2>&1
reg add "HKCU\Software\Classes\crm-agent\shell\open\command" /ve /t REG_SZ /d "\"%INSTALL_DIR%\LocalCrmAgent.exe\" \"%%1\"" /f >nul 2>&1
echo        Done.

:: Create Start Menu shortcut
echo  [4/5] Creating Start Menu shortcut...
set "SHORTCUT_DIR=%AppData%\Microsoft\Windows\Start Menu\Programs\TableTurnerr"
if not exist "!SHORTCUT_DIR!" mkdir "!SHORTCUT_DIR!"
powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%AppData%\Microsoft\Windows\Start Menu\Programs\TableTurnerr\CRM Agent.lnk'); $s.TargetPath = '%INSTALL_DIR%\LocalCrmAgent.exe'; $s.Description = 'TableTurnerr Local CRM Agent'; $s.WorkingDirectory = '%INSTALL_DIR%'; $s.Save()" >nul 2>&1
echo        Done.

:: Launch the agent
echo  [5/5] Starting CRM Agent...
start "" "%INSTALL_DIR%\LocalCrmAgent.exe"
echo        Done.

echo.
echo  =============================================
echo   Installation Complete!
echo  =============================================
echo.
echo   The CRM Agent is now running in your
echo   system tray (bottom-right corner).
echo.
echo   It will automatically start when you
echo   log into Windows.
echo.
pause
