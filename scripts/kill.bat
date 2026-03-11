@echo off
title DarkIron - Kill All
color 0C
echo.
echo  ================================================
echo    DARKIRON ENGINE - KILL ALL PROCESSES
echo  ================================================
echo.
echo  [1/4] Killing Node.js (Vite editor)...
taskkill /F /IM node.exe >nul 2>&1
echo  [2/4] Killing Rust runtime...
taskkill /F /IM darkiron-runtime.exe >nul 2>&1
taskkill /F /IM darkiron_runtime.exe >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq DarkIron Runtime*" >nul 2>&1
echo  [3/4] Stopping NATS Docker container...
cd /d D:\DarkIron\darkiron
docker compose down
echo  [4/4] Closing DarkIron terminal windows...
taskkill /F /FI "WINDOWTITLE eq DarkIron*" >nul 2>&1
echo.
echo  [DONE] All processes stopped.
timeout /t 2 >nul