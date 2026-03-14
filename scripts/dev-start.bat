@echo off
title DarkIron - Dev Setup
color 0A
echo.
echo  ================================================
echo    DARKIRON ENGINE -- DEV START (HOME)
echo  ================================================
echo.

:: --- Step 1: Kill old processes ---
echo  [1/5] Killing old processes...
call D:\DarkIron\darkiron\scripts\kill.bat
timeout /t 2 >nul

:: --- Step 2: Check Docker ---
echo  [2/5] Checking Docker...
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo  Docker not running - starting Docker Desktop...
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    echo  Waiting 15s for Docker to start...
    timeout /t 15 /nobreak >nul
) else (
    echo  Docker OK.
)

:: --- Step 3: Start NATS ---
echo  [3/5] Starting NATS...
cd /d D:\DarkIron\darkiron
docker compose up -d nats
timeout /t 3 >nul
echo  NATS: :4222 TCP / :9222 WS / :8222 monitor

:: --- Step 4: Node deps ---
echo  [4/5] Syncing Node dependencies...
cd /d D:\DarkIron\darkiron
call pnpm install --frozen-lockfile

:: --- Step 5: Launch processes ---
echo  [5/5] Launching Runtime and Editor...

start "DarkIron Runtime" cmd /k "cd /d D:\DarkIron\darkiron\crates\darkiron-runtime && set NATS_URL=nats://localhost:4222 && set RUST_LOG=info,darkiron=debug && cargo run"
timeout /t 3 >nul

start "DarkIron Editor" cmd /k "cd /d D:\DarkIron\darkiron\packages\editor && set VITE_NATS_WS_URL=ws://localhost:9222 && pnpm run dev"
timeout /t 5 >nul

echo.
echo  ================================================
echo  [DONE] Stack is starting!
echo.
echo  Editor       : http://localhost:5173
echo  NATS Monitor : http://localhost:8222
echo  ================================================
echo.
start "" "http://localhost:5173"
pause