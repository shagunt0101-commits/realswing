@echo off
title RealSwing — Launch All Services
cd /d "F:\Algok"

echo ============================================
echo   RealSwing — Starting All Services
echo ============================================
echo.

:: ===== 1. Start Nubra Backend =====
echo [1/4] Starting Nubra Proxy on :9000...
start "Nubra-Proxy" /min cmd /c "cd /d F:\Algok\realswing && .\venv\Scripts\python.exe nubra_backend.py"
timeout /t 4 >nul

:: ===== 2. Start Orchestrator =====
echo [2/4] Starting Orchestrator on :9010...
start "Orchestrator" /min cmd /c "cd /d F:\Algok\realswing && .\venv\Scripts\python.exe orchestrator.py"
timeout /t 4 >nul

:: ===== 3. Start Frontend =====
echo [3/4] Starting Frontend on :5173...
start "Frontend" /min cmd /c "cd /d F:\Algok\frontend && npx vite --port 5173 --host"
timeout /t 6 >nul

:: ===== 4. Start Cloudflare Tunnel =====
echo [4/4] Starting Cloudflare Tunnel (ngrok alternative)...
echo.
echo IMPORTANT: After tunnel starts, copy the URL and set in Vercel:
echo   VITE_API_BASE = ^<tunnel-url^>
echo   VITE_ORCH_BASE = ^<tunnel-url^>
echo.
start "Cloudflare-Tunnel" cmd /c "cloudflared tunnel --url http://localhost:9000"

:: ===== Verify Services =====
echo.
echo Verifying services...
timeout /t 5 >nul

echo.
echo ============================================
echo   Services Status:
curl -s http://localhost:9000/health >nul 2>&1 && echo   [✓] Nubra Proxy :9000 || echo   [✗] Nubra Proxy :9000
curl -s http://localhost:9010/health >nul 2>&1 && echo   [✓] Orchestrator :9010 || echo   [✗] Orchestrator :9010
curl -s http://localhost:5173 >nul 2>&1 && echo   [✓] Frontend :5173 || echo   [✗] Frontend :5173
echo.
echo ============================================
echo   Dashboard: http://localhost:5173
echo   Cloudflare tunnel starting in new window...
echo   Close all services: taskkill /F /IM python.exe
echo ============================================

pause
