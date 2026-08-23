@echo off
cd /d "%~dp0"
echo Installing dependencies...
call npm install
echo.
echo Starting SDC Build Readiness Report...
echo Open http://localhost:3000 in your browser
echo.
npm start
pause
