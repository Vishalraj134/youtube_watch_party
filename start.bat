@echo off
title YouTube Watch Party System Launcher
echo ========================================================
echo       Starting YouTube Watch Party System
echo ========================================================
echo.
echo [1/2] Launching Backend Server on port 5000...
start "YouTube Watch Party - Backend Server (Port 5000)" cmd /k "cd /d %~dp0server && npm.cmd run dev"

echo [2/2] Launching Frontend Client on port 5173...
start "YouTube Watch Party - Frontend Client (Port 5173)" cmd /k "cd /d %~dp0client && npm.cmd run dev"

echo.
echo Servers started successfully!
echo   - Backend Server: http://localhost:5000
echo   - Frontend Client: http://localhost:5173
echo.
echo Opening browser in 3 seconds...
timeout /t 3 /nobreak >nul
start http://localhost:5173

