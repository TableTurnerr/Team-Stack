@echo off
setlocal EnableDelayedExpansion

:: =============================================
::  TableTurnerr Local CRM Agent - Installer
:: =============================================

echo.
echo  =============================================
echo   TableTurnerr CRM Local Agent - Setup
echo  =============================================
echo.

:: Check if running from the correct location (LocalCrmAgent.exe should be alongside this script)
if not exist "%~dp0LocalCrmAgent.exe" (
    echo [ERROR] LocalCrmAgent.exe not found next to this installer.
    echo         Make sure install.bat and LocalCrmAgent.exe are in the same folder.
    echo.
    pause
    exit /b 1
)

:: Define install location
set "INSTALL_DIR=%LocalAppData%\TableTurnerr\LocalCrmAgent"

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
echo  [1/4] Copying files...
copy /Y "%~dp0LocalCrmAgent.exe" "%INSTALL_DIR%\LocalCrmAgent.exe" >nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to copy files. Is the agent currently running?
    echo         Close it from the system tray and try again.
    pause
    exit /b 1
)
echo        Done.

:: Register auto-start in Windows registry
echo  [2/4] Registering auto-start...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "LocalCrmAgent" /t REG_SZ /d "\"%INSTALL_DIR%\LocalCrmAgent.exe\" --background" /f >nul 2>&1
echo        Done.

:: Register crm-agent:// protocol handler
echo  [3/4] Registering protocol handler...
reg add "HKCU\Software\Classes\crm-agent" /ve /t REG_SZ /d "URL:CRM Agent Protocol" /f >nul 2>&1
reg add "HKCU\Software\Classes\crm-agent" /v "URL Protocol" /t REG_SZ /d "" /f >nul 2>&1
reg add "HKCU\Software\Classes\crm-agent\DefaultIcon" /ve /t REG_SZ /d "\"%INSTALL_DIR%\LocalCrmAgent.exe\",0" /f >nul 2>&1
reg add "HKCU\Software\Classes\crm-agent\shell\open\command" /ve /t REG_SZ /d "\"%INSTALL_DIR%\LocalCrmAgent.exe\" \"%%1\"" /f >nul 2>&1
echo        Done.

:: Launch the agent
echo  [4/4] Starting CRM Agent...
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
echo   You can now open the CRM dashboard and
echo   start a call session.
echo.
pause
