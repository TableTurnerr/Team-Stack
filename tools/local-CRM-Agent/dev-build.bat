@echo off
setlocal

:: Extract version from csproj so the banner stays in sync automatically
for /f "tokens=2 delims=><" %%v in ('findstr /r "<Version>" src\LocalCrmAgent\LocalCrmAgent.csproj') do set VERSION=%%v

echo ============================================
echo   Local CRM Agent v%VERSION% — Dev Build + Run
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
echo Launching...
echo.

:: Launch the agent
start "" "dist-dev\LocalCrmAgent.exe"

echo Agent is running. Check the system tray.
