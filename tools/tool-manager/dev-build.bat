@echo off
setlocal

:: Extract version from csproj
for /f "tokens=3 delims=><" %%v in ('findstr /r "<Version>" src\ToolManager\ToolManager.csproj') do set VERSION=%%v

echo ============================================
echo   Tool Manager v%VERSION% - Dev Build + Run
echo ============================================
echo.

:: Kill any running instance
taskkill /IM ToolManager.exe /F >nul 2>&1
timeout /t 1 /nobreak >nul

:: Build (Debug config, faster than Release)
echo Building...
dotnet publish src\ToolManager\ToolManager.csproj -c Debug -o dist-dev
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Build failed!
    pause
    exit /b 1
)

echo.
echo Build successful: dist-dev\ToolManager.exe

:: Deploy to installed location (copy ALL published files, not just exe)
set "INSTALL_DIR=%LocalAppData%\TableTurnerr\ToolManager"
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
if not exist "%INSTALL_DIR%\tools" mkdir "%INSTALL_DIR%\tools"
echo Updating installed version at %INSTALL_DIR%...
xcopy /Y /Q "dist-dev\*.*" "%INSTALL_DIR%\" >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [WARN] Could not update installed version. Launching from dist-dev instead.
    echo        Close the manager from system tray and try again.
    start "" "dist-dev\ToolManager.exe"
    goto :done
)
echo Installed version updated.
echo.

:: Start tray process (WinExe, no console window)
start "" "%INSTALL_DIR%\ToolManager.exe"
timeout /t 2 /nobreak >nul

:: Open interactive CLI (allocates its own console)
echo Opening Tool Manager CLI...
start "" "%INSTALL_DIR%\ToolManager.exe" --interactive

:done
echo Tool Manager is running in the system tray.
