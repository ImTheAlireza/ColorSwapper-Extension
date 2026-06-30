@echo off
setlocal enabledelayedexpansion

echo ========================================
echo       Color Swapper - Installer
echo ========================================

:: CONFIGURATION
set "REPO=ImTheAlireza/ColorSwapper-Extension"

:: Define paths dynamically
set "TARGET_DIR=%APPDATA%\Adobe\CEP\extensions\ColorSwapper"
set "ZIP_FILE=%TEMP%\ColorSwapper.zip"

echo Install path:
echo %TARGET_DIR%
echo.

echo [1/3] Downloading latest release from GitHub...

:: Force TLS 1.2 protocol and output the exact error message if triggered
powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $api='https://api.github.com/repos/%REPO%/releases/latest'; try { $repo=Invoke-RestMethod -Uri $api -UseBasicParsing; $asset=$repo.assets | Where-Object { $_.name -like '*.zip' } | Select-Object -First 1; if ($asset) { Invoke-WebRequest -Uri $asset.browser_download_url -OutFile '%ZIP_FILE%' -UseBasicParsing } else { Write-Host '[ERROR] No public .zip file found attached to the latest release.'; exit 1 } } catch { Write-Host '[PowerShell Error]' $_.Exception.Message; exit 1 }"

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Installation aborted due to the download failure above.
    goto end
)

echo [2/3] Cleaning older installations...
if exist "%TARGET_DIR%" rmdir /s /q "%TARGET_DIR%"
mkdir "%TARGET_DIR%"

echo [3/3] Extracting extension assets...
powershell -Command "Expand-Archive -Path '%ZIP_FILE%' -DestinationPath '%TARGET_DIR%' -Force"
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Extraction failed.
    goto end
)

:: Clean up the temporary zip file
if exist "%ZIP_FILE%" del /f /q "%ZIP_FILE%"

echo.
echo Done! Color Swapper has been successfully installed.
echo Please restart your Adobe application.

:end
echo.
pause