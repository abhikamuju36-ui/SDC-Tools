@echo off
title SDC Calendar Backend
color 0B
echo.
echo  ============================================
echo   SDC Centralized Calendar — Backend Server
echo  ============================================
echo.

cd /d "%~dp0"

where node >nul 2>&1
if %errorlevel% neq 0 (
  echo  ERROR: Node.js not found. Please install Node.js first.
  pause
  exit /b 1
)

if not exist node_modules (
  echo  Installing dependencies...
  npm install
  echo.
)

echo  Starting server...
echo.
node server.js

pause
