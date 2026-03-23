@echo off
setlocal

:: Extract version from csproj so the banner stays in sync automatically
for /f "tokens=3 delims=><" %%v in ('findstr /r "<Version>" src\LocalCrmAgent\LocalCrmAgent.csproj') do set VERSION=%%v

echo ============================================
echo   Local CRM Agent v%VERSION% - Dev Build + Run
echo ============================================
echo.

:: Kill any running instance
taskkill /IM LocalCrmAgent.exe /F >nul 2>&1
timeout /t 1 /nobreak >nul

:: Build (Debug config, faster than Release)
echo Building...
dotnet publish src\LocalCrmAgent\LocalCrmAgent.csproj -c Debug -o dist-dev
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Build failed!
    pause
    exit /b 1
)

echo.
echo Build successful: dist-dev\LocalCrmAgent.exe

:: Determine install path: prefer managed path if Tool Manager exists, else legacy
set "MANAGED_DIR=%LocalAppData%\TableTurnerr\ToolManager\tools\local-crm-agent"
set "LEGACY_DIR=%LocalAppData%\TableTurnerr\LocalCrmAgent"

if exist "%LocalAppData%\TableTurnerr\ToolManager\ToolManager.exe" (
    set "INSTALL_DIR=%MANAGED_DIR%"
) else (
    set "INSTALL_DIR=%LEGACY_DIR%"
)

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
echo Updating installed version at %INSTALL_DIR%...
copy /Y "dist-dev\LocalCrmAgent.exe" "%INSTALL_DIR%\LocalCrmAgent.exe" >nul
if %ERRORLEVEL% neq 0 (
    echo [WARN] Could not update installed version. Launching from dist-dev instead.
    echo        Close the agent from system tray and try again.
    start "" "dist-dev\LocalCrmAgent.exe"
    goto :done
)
echo Installed version updated.
echo Launching...
echo.

:: Launch from the installed location so registry auto-start path stays correct
start "" "%INSTALL_DIR%\LocalCrmAgent.exe"

:done
echo Agent is running. Check the system tray.
