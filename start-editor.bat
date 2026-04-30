@echo off
setlocal
set ROOT=%~dp0

start "capture-server" cmd /k "cd /d "%ROOT%tools" && node capture-server.js"

timeout /t 3 /nobreak >nul

start "" "%ROOT%index.html"

endlocal
