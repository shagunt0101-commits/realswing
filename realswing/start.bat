@echo off
title RealSwing
echo ============================================
echo  RealSwing — Starting all services
echo ============================================
echo.

:: Kill any leftover processes on our ports
for /f "tokens=5" %%a in ('netstat -aon ^| find ":9000" ^| find "LISTENING"') do taskkill /f /pid %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| find ":9001" ^| find "LISTENING"') do taskkill /f /pid %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| find ":5173" ^| find "LISTENING"') do taskkill /f /pid %%a >nul 2>&1
timeout /t 1 >nul

:: Start Nubra Backend Proxy (port 9000)
echo [1/3] Starting Nubra proxy on :9000 ...
start "Nubra Proxy" cmd /c "python nubra_backend.py"

:: Wait for :9000
:wait9000
timeout /t 1 >nul 2>&1
netstat -an | find ":9000 " >nul 2>&1 || goto wait9000
echo   ✓ Nubra proxy ready

:: Start Agent Orchestrator (port 9001)
echo [2/3] Starting agent orchestrator on :9001 ...
start "RealSwing Orchestrator" cmd /c "python orchestrator.py"

:: Wait for :9001
:wait9001
timeout /t 1 >nul 2>&1
netstat -an | find ":8001 " >nul 2>&1 || goto wait8001
echo   ✓ Orchestrator ready

:: Start Frontend (port 5173)
echo [3/3] Starting frontend on :5173 ...
start "RealSwing Frontend" cmd /c "cd ../frontend && npm run dev"

:: Wait for :5173
:wait5173
timeout /t 1 >nul 2>&1
netstat -an | find ":5173 " >nul 2>&1 || goto wait5173
echo   ✓ Frontend ready

echo.
echo ============================================
echo  All services running!
echo    Nubra Proxy   : http://localhost:9000
echo    Orchestrator  : http://localhost:9001
echo    Dashboard     : http://localhost:5173
echo ============================================
echo.
echo Press any key to stop all services...
pause >nul

echo Stopping services...
taskkill /fi "WINDOWTITLE eq Nubra Proxy*" /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq RealSwing Orchestrator*" /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq RealSwing Frontend*" /f >nul 2>&1
echo All services stopped.
timeout /t 2 >nul
