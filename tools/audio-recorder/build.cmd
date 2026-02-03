@echo off
echo =========================================
echo Building AudioRecorder Executable
echo =========================================
echo.

REM Display Python version for debugging
echo Python version:
py --version
echo.

cd /d "%~dp0"

REM Install all requirements
echo Installing requirements...
pip install -r requirements.txt --quiet
pip install pyinstaller --quiet

echo.
echo Building with PyInstaller...
echo.

REM Clean previous builds
if exist dist rmdir /s /q dist
if exist build rmdir /s /q build

REM Run PyInstaller
pyinstaller --clean recorder.spec

if errorlevel 1 (
    echo.
    echo =========================================
    echo BUILD FAILED!
    echo =========================================
    pause
    exit /b 1
)

echo.
echo =========================================
echo BUILD SUCCESSFUL!
echo =========================================
echo.
echo Executable created at:
echo %~dp0dist\AudioRecorder.exe
echo.

REM Check if NSIS is installed
where makensis >nul 2>&1
if errorlevel 1 (
    echo =========================================
    echo NSIS NOT FOUND - Skipping installer build
    echo =========================================
    echo.
    echo To create the installer, please install NSIS from:
    echo https://nsis.sourceforge.io/Download
    echo.
    echo Then add NSIS to your PATH and run this script again.
    echo.
    pause
    exit /b 0
)

echo.
echo =========================================
echo Building Installer with NSIS...
echo =========================================
echo.

makensis installer.nsi

if errorlevel 1 (
    echo.
    echo =========================================
    echo INSTALLER BUILD FAILED!
    echo =========================================
    pause
    exit /b 1
)

echo.
echo =========================================
echo INSTALLER BUILD SUCCESSFUL!
echo =========================================
echo.
echo Installer created at:
echo %~dp0dist\AudioRecorder_Setup.exe
echo.

pause

