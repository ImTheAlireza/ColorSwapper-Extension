@echo off
setlocal enabledelayedexpansion

title Color Swapper Installer

echo.
echo  ========================================
echo   Color Swapper - Installer
echo  ========================================
echo.


set "BASE_URL=https://raw.githubusercontent.com/ImTheAlireza/ColorSwapper-Extension/main"


set "EXT_DIR=%APPDATA%\Adobe\CEP\extensions\ColorSwapper"

echo  Install path:
echo  %EXT_DIR%
echo.

where curl >nul 2>&1
if errorlevel 1 goto nocurl

echo  [1/4] Creating folders...
if not exist "%EXT_DIR%\client" mkdir "%EXT_DIR%\client"
if not exist "%EXT_DIR%\host" mkdir "%EXT_DIR%\host"
if not exist "%EXT_DIR%\CSXS" mkdir "%EXT_DIR%\CSXS"
echo        Done.
echo.

echo  [2/4] Downloading files...
set "FAIL=0"

call :download "client/index.html"       "%EXT_DIR%\client\index.html"
call :download "client/app.js"           "%EXT_DIR%\client\app.js"
call :download "client/style.css"        "%EXT_DIR%\client\style.css"
call :download "client/CSInterface.js"   "%EXT_DIR%\client\CSInterface.js"
call :download "host/hostScript.jsx"     "%EXT_DIR%\host\hostScript.jsx"
call :download "CSXS/manifest.xml"       "%EXT_DIR%\CSXS\manifest.xml"

echo.

if !FAIL! GTR 0 goto downloadfailed

echo        All files downloaded.
echo.

echo  [3/4] Enabling unsigned extensions...
reg add "HKCU\SOFTWARE\Adobe\CSXS.8" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKCU\SOFTWARE\Adobe\CSXS.9" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKCU\SOFTWARE\Adobe\CSXS.10" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKCU\SOFTWARE\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKCU\SOFTWARE\Adobe\CSXS.12" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
echo        Done.
echo.

goto success

:success
echo  [4/4] Installation complete!
echo.
echo  ========================================
echo   Next steps:
echo   1. Close After Effects completely
echo   2. Reopen After Effects
echo   3. Go to Window, Extensions, Color Swapper
echo  ========================================
echo.
echo  Press any key to close...
pause >nul
goto realend

:nocurl
echo.
echo  [ERROR] curl not found.
echo  Please update Windows 10 or install curl.
echo.
echo  Press any key to close...
pause >nul
goto realend

:downloadfailed
echo  [!] !FAIL! file(s) failed to download.
echo      Check your internet connection and try again.
echo.
echo  Press any key to close...
pause >nul
goto realend

:download
set "REMOTE=%~1"
set "LOCAL=%~2"
echo        Downloading %REMOTE%...
curl -sL -o "%LOCAL%" "%BASE_URL%/%REMOTE%"
if errorlevel 1 (
    echo        [FAILED] %REMOTE%
    set /a FAIL+=1
)
exit /b

:realend
