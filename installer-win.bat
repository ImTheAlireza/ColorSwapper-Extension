@echo off
setlocal enabledelayedexpansion
title Color Swapper Installer
echo.
echo ========================================
echo    Color Swapper - Local Installer
echo ========================================
echo.

set "EXT_DIR=%APPDATA%\Adobe\CEP\extensions\ColorSwapper"

echo Install path:
echo %EXT_DIR%
echo.

echo [1/3] Cleaning older installations...
if exist "%EXT_DIR%" rmdir /s /q "%EXT_DIR%"
echo Done.
echo.

echo [2/3] Extracting extension assets...
if exist "ColorSwapper.zip" (
    powershell -Command "Expand-Archive -Path 'ColorSwapper.zip' -DestinationPath '%EXT_DIR%' -Force"
    if errorlevel 1 goto extractfailed
) else (
    goto missingarchive
)
echo Done.
echo.

echo [3/3] Enabling unsigned extensions...
for /L %%v in (8,1,16) do (
    reg add "HKCU\SOFTWARE\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
)
echo Done.
echo.

goto success

:success
echo ========================================
echo   Installation completed successfully!
echo   1. Close After Effects completely.
echo   2. Reopen After Effects.
echo   3. Navigate to: Window ^> Extensions ^> Color Swapper
echo ========================================
echo.
pause
exit

:extractfailed
echo [ERROR] Extraction failed. Ensure you have extraction permissions for %APPDATA%.
pause
exit

:missingarchive
echo [ERROR] 'ColorSwapper.zip' was not found in this folder.
echo Make sure you run this script in the exact same directory as the zip file.
pause
exit