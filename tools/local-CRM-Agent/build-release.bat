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

echo Ready to distribute: dist\
echo.
pause
