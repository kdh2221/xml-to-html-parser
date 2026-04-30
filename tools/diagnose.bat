@echo off
echo ===== Node version =====
node -v
echo.
echo ===== Dependencies check =====
if exist node_modules\express (echo express: OK) else (echo express: MISSING)
if exist node_modules\puppeteer (echo puppeteer: OK) else (echo puppeteer: MISSING)
echo.
echo ===== Starting capture-server.js (errors will be shown below) =====
echo.
node capture-server.js
echo.
echo ===== Server exited =====
pause
