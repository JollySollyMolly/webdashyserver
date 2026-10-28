@echo off
rem Starts the WebDash helper (local server + GD level search + song downloader) and opens the game.
rem Needs Node.js 18 or newer: https://nodejs.org
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed - get it from https://nodejs.org & pause & exit /b 1)
start "" http://localhost:8080/
node tools\gdserver.js serve
pause
