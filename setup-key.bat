@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Starting DSH Usage Display - API Key importer...
echo The panel will auto-import the key within seconds.
echo.
node setup-key.js
if errorlevel 1 (
  echo.
  echo ERROR: API key not found automatically.
  echo Usage: node setup-key.js "path\to\.credentials.yaml"
  pause
)
