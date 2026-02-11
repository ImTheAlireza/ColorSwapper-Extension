@echo off

title Color Swapper Uninstaller

echo.
echo  ========================================
echo   Color Swapper - Uninstaller
echo  ========================================
echo.

set "EXT_DIR=%APPDATA%\Adobe\CEP\extensions\ColorSwapper"

if not exist "%EXT_DIR%" (
    echo  Color Swapper is not installed.
    echo.
    pause
    exit /b 0
)

echo  This will remove Color Swapper from:
echo  %EXT_DIR%
echo.
set /p CONFIRM="  Are you sure? (y/n): "

if /i not "%CONFIRM%"=="y" (
    echo  Cancelled.
    pause
    exit /b 0
)

echo.
echo  Removing files...
rmdir /s /q "%EXT_DIR%"

echo  Done. Restart After Effects.
echo.
pause
