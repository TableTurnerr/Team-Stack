@echo off
setlocal

echo ============================================
echo   Building Tool Manager (Release)
echo ============================================
echo.

dotnet publish src\ToolManager\ToolManager.csproj -c Release -o dist

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Build failed!
    pause
    exit /b 1
)

echo.
echo Build successful: dist\ToolManager.exe
echo.

copy /Y install.bat dist\install.bat >nul 2>&1
copy /Y uninstall.bat dist\uninstall.bat >nul 2>&1

for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "([xml](Get-Content 'src\ToolManager\ToolManager.csproj')).Project.PropertyGroup.Version"`) do set VERSION=%%a

set VERSION_DASHED=%VERSION:.=-%
set ZIPNAME=ToolManager-v%VERSION_DASHED%.zip

echo Zipping to dist\%ZIPNAME%...
powershell -NoProfile -Command "Compress-Archive -Path 'dist\*' -DestinationPath 'dist\%ZIPNAME%' -Force"

echo.
echo ============================================
echo   Ready: dist\%ZIPNAME%
echo ============================================
echo.
pause
