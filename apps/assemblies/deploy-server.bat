@echo off
echo.
echo ========================================
echo   SDC Library - Server Deploy
echo ========================================
echo.

cd /d "C:\AI Projects\sdc-library"

echo [1/3] Pulling latest code from GitHub...
git pull
if %errorlevel% neq 0 (
    echo ERROR: git pull failed. Check your connection.
    pause
    exit /b 1
)

echo.
echo [2/3] Restarting server...
rem NOTE: Use "pm2 restart" NOT "pm2 reload" — reload does zero-downtime
rem (starts new process before killing old) which causes EADDRINUSE on a
rem single-port server and triggers a 700+ restart crash loop.
pm2 restart sdc-library
if %errorlevel% neq 0 (
    echo ERROR: pm2 restart failed.
    pause
    exit /b 1
)

echo.
echo [3/3] Checking status...
timeout /t 3 /nobreak >nul
pm2 status

echo.
echo ========================================
echo   Deploy complete!
echo ========================================
echo.
pause
