@echo off
setlocal

echo ============================================
echo   Building Local CRM Agent (Release)
echo ============================================
echo.

:: Build self-contained single-file executable
dotnet publish src\LocalCrmAgent\LocalCrmAgent.csproj -c Release -o dist

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Build failed!
    pause
    exit /b 1
)

echo.
echo ============================================
echo   Build successful!
echo ============================================
echo.
echo Output: dist\LocalCrmAgent.exe
echo.
echo To distribute to your team:
echo   1. Copy the 'dist' folder contents
echo   2. Include 'install.bat' alongside LocalCrmAgent.exe
echo   3. Send both files to your team members
echo.

:: Copy installer script next to the built exe
copy /Y install.bat dist\install.bat >nul 2>&1
copy /Y uninstall.bat dist\uninstall.bat >nul 2>&1

:: Extract version from .csproj
for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "([xml](Get-Content 'src\LocalCrmAgent\LocalCrmAgent.csproj')).Project.PropertyGroup.Version"`) do set VERSION=%%a

set VERSION_DASHED=%VERSION:.=-%
set ZIPNAME=LocalCrmAgent-v%VERSION_DASHED%.zip

:: Zip the dist folder
echo Zipping dist to dist\%ZIPNAME%...
powershell -NoProfile -Command "Compress-Archive -Path 'dist\*' -DestinationPath 'dist\%ZIPNAME%' -Force"

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Zipping failed!
    pause
    exit /b 1
)

echo.
echo ============================================
echo   Ready to distribute: dist\%ZIPNAME%
echo ============================================
echo.
pause
