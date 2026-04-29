@echo off
setlocal
cd /d "%~dp0"

:: Extract version from csproj so the banner stays in sync automatically
for /f "tokens=3 delims=><" %%v in ('findstr /r "<Version>" src\LocalCrmAgent\LocalCrmAgent.csproj') do set VERSION=%%v

:: Build dev version: date + daily counter (e.g. 1.0.9-dev.20260323.3)
for /f %%d in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd"') do set TODAY=%%d
set COUNTER_FILE=%~dp0.dev-build-counter
set BUILD_NUM=1
if exist "%COUNTER_FILE%" (
    for /f "tokens=1,2 delims=:" %%a in (%COUNTER_FILE%) do (
        if "%%a"=="%TODAY%" (
            set /a BUILD_NUM=%%b+1
        )
    )
)
echo %TODAY%:%BUILD_NUM%> "%COUNTER_FILE%"
set DEV_VERSION=%VERSION%-dev.%TODAY%.%BUILD_NUM%

echo ============================================
echo   Local CRM Agent v%DEV_VERSION% - Dev Build + Run
echo ============================================
echo.

:: Kill any running instance
taskkill /IM LocalCrmAgent.exe /F >nul 2>&1
timeout /t 1 /nobreak >nul

:: Build (Debug config, faster than Release)
echo Building...
dotnet publish src\LocalCrmAgent\LocalCrmAgent.csproj -c Debug -o dist-dev /p:Version=%DEV_VERSION%
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

:: Back up current release version before overwriting with dev build
set "CACHE_DIR=%LocalAppData%\TableTurnerr\ToolManager\cache\local-agent"
set "REGISTRY_FILE=%LocalAppData%\TableTurnerr\ToolManager\installed.json"
if exist "%INSTALL_DIR%\LocalCrmAgent.exe" (
    if exist "%REGISTRY_FILE%" (
        for /f "delims=" %%v in ('powershell -NoProfile -Command "$j=Get-Content '%REGISTRY_FILE%' -Raw | ConvertFrom-Json; foreach($t in $j){if($t.tagPrefix -eq 'local-agent' -and $t.version -notlike '*-dev.*'){$t.version; break}}"') do (
            if not "%%v"=="" (
                if not exist "%CACHE_DIR%\v%%v.zip" (
                    echo Caching current release v%%v before switching to dev build...
                    if not exist "%CACHE_DIR%" mkdir "%CACHE_DIR%"
                    powershell -NoProfile -Command "Compress-Archive -Path '%INSTALL_DIR%\*' -DestinationPath '%CACHE_DIR%\v%%v.zip' -Force" >nul 2>&1
                    echo        Done.
                )
            )
        )
    )
)

echo Updating installed version at %INSTALL_DIR%...
copy /Y "dist-dev\LocalCrmAgent.exe" "%INSTALL_DIR%\LocalCrmAgent.exe" >nul
if %ERRORLEVEL% neq 0 (
    echo [WARN] Could not update installed version. Launching from dist-dev instead.
    echo        Close the agent from system tray and try again.
    start "" "dist-dev\LocalCrmAgent.exe"
    goto :done
)
echo Installed version updated.

:: Update installed.json so Tool Manager knows this is a dev build and won't overwrite it
if exist "%REGISTRY_FILE%" (
    echo Updating Tool Manager registry with dev version...
    powershell -NoProfile -Command "$f='%REGISTRY_FILE%'; $j=Get-Content $f -Raw | ConvertFrom-Json; foreach($t in $j){if($t.tagPrefix -eq 'local-agent'){$t.version='%DEV_VERSION%'; $t.updatedAt=(Get-Date).ToUniversalTime().ToString('o')}}; $j | ConvertTo-Json -Depth 10 | Set-Content $f -Encoding UTF8"
    echo        Done.
)

echo Launching...
echo.

:: Launch from the installed location so registry auto-start path stays correct
start "" "%INSTALL_DIR%\LocalCrmAgent.exe"

:done
echo Agent is running. Check the system tray.
