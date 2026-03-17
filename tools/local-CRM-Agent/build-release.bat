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

:: Copy installer scripts next to the built exe
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
echo   Recommended: Push to the release branch
echo   and GitHub Actions will create the release
echo   automatically. The Tool Manager picks it up.
echo.
echo   Manual: Share the zip directly — teammates
echo   extract and run install.bat.
echo.
pause
