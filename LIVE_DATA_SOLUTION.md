# RealSwing Live Data — Solution Guide

## 🔴 **The Problem**
You're not seeing live prices and data because **no agents are running yet**. The system requires authentication to start.

---

## ✅ **Solution: Two Paths Forward**

### **Path 1: Real Data (Nubra Authentication) — RECOMMENDED**
This is the proper way to use RealSwing with real market data.

**Steps:**
1. Open http://localhost:5173 in your browser
2. **Step 1:** Enter your phone number → Click "Send OTP"
3. **Step 2:** Confirm (triggers SMS with OTP code)  
4. **Step 3:** Enter the OTP from SMS → Click "Verify"
5. **Step 4:** Enter your MPIN → Click "Verify"
6. ✓ You'll get a session token (stored in browser)
7. **Click "Start Agents"** on the dashboard
8. ✓ **Live data will stream in real-time**

**What you'll see:**
- NIFTY, BANKNIFTY, SENSEX live prices (updated every 2 seconds)
- 5-minute candles with technical analysis
- Option chains with Greeks, IV, OI
- AI-powered trade signals from 9Router Claude
- Risk-checked order execution log

---

### **Path 2: Demo Mode (No Auth Required) — FOR TESTING**
Perfect for testing the system without real Nubra credentials.

**Status:** Demo endpoints added to `orchestrator.py` lines 302-373

**When ready to use:**
1. Restart the orchestrator:
   ```bash
   # Kill old process and start fresh
   taskkill /F /IM python.exe
   cd realswing
   python orchestrator.py
   ```

2. Call the demo endpoint:
   ```bash
   curl -X POST http://localhost:9010/demo/start
   ```

3. Frontend will auto-connect via SSE stream
4. Live data from Yahoo Finance will stream

---

## 📊 **System Architecture (Why Auth is Needed)**

```
┌─ Frontend (React) :5173
│  └─ Needs: session_token from authentication
│
├─ Orchestrator (FastAPI) :9010
│  ├─ Endpoint: POST /start  ← requires session_token
│  ├─ Endpoint: POST /demo/start  ← no auth (test mode)
│  └─ Endpoint: GET /stream  ← SSE live updates
│
├─ DataAgent (Nubra WebSocket)
│  └─ Connects to: wss://uatapi.nubra.io/apibatch/ws
│     Uses: session_token from step above
│
└─ MarketState (Shared Memory)
   ├─ Index ticks (NIFTY, BANKNIFTY, SENSEX)
   ├─ 5m OHLCV candles
   ├─ Option chains (CE/PE strikes, OI, Greeks)
   └─ Broadcast via SSE to frontend every 2 seconds
```

---

## 🔧 **Troubleshooting**

### "I can't get an OTP / don't have Nubra credentials"
- Use **Path 2 (Demo Mode)** instead
- Or contact Nubra to set up a UAT account (free for testing)

### "After login, I click 'Start Agents' but nothing happens"
1. Check browser console (F12) for errors
2. Verify `/start` request succeeded: DevTools > Network tab
3. Check orchestrator logs:
   ```bash
   tail -f /tmp/orchestrator.log
   ```
4. Look for `[Main] Starting agents...` message

### "Data appears but doesn't update"
1. Confirm DataAgent connected: `/health` endpoint should show `connected: true`
2. Check orchestrator logs for `[DataAgent] Connected ✓` message
3. If using Nubra: verify WebSocket is open (DevTools > Network > WS)

### "Session expired"
```javascript
// In browser console:
localStorage.removeItem("realswing_session")
// Then refresh page
```

---

## 🎯 **API Endpoints (Once Agents Are Running)**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/stream` | GET | Server-Sent Events — live market data |
| `/state` | GET | Snapshot of current MarketState |
| `/signals` | GET | Last trade signals per asset |
| `/analyst` | GET | Latest analyst reports (trend, RSI, PCR) |
| `/orders` | GET | Order execution log |
| `/health` | GET | Agent status (data/analyst/signal/risk/executor) |

---

## 📈 **Once Live Data Is Flowing**

Dashboard components will update automatically:
- **Market Snapshot:** Live index prices + change %
- **Option Chain:** Strikes with OI, IV, Greeks
- **Technical Analysis:** EMA, RSI, SMC, Support/Resistance
- **AI Signals:** Trade setup alerts from Claude
- **Order Flow:** OI momentum, put-call ratio, expected moves
- **Trade Log:** Executed orders with P&L

---

## 🚀 **Next Step**

Choose your path:
- **Real Data?** Go to http://localhost:5173 and complete auth flow
- **Demo Mode?** Restart orchestrator and call `/demo/start`

Both will get live market data flowing through the dashboard!

---

**Questions?**
- Check `REALSWING_START_GUIDE.md` for detailed architecture
- Review `orchestrator.py` for endpoint implementation
- Check frontend at `frontend/src/realswing-dashboard.jsx` for SSE handling
