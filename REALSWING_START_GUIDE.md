# RealSwing — Quick Start Guide

## 🔴 Current Status
- ✓ Backend services running (Nubra Proxy :9000, Orchestrator :9010)
- ✓ Frontend running (:5173)
- ❌ **Agents NOT STARTED** — need session_token first

## 🎯 To Get Live Data Ticking

### Option 1: Complete Auth Flow (Real Data)
1. Open http://localhost:5173
2. **Step 1**: Enter your mobile number → Get temp_token
3. **Step 2**: Confirm (triggers SMS OTP)
4. **Step 3**: Enter OTP from SMS
5. **Step 4**: Enter your MPIN → Get session_token
6. **Click "Start Agents"** button on dashboard
7. ✓ Live data will start streaming

### Option 2: Demo Mode (Simulated Data)
Edit `orchestrator.py` line ~308 to auto-populate test token:
```python
# Add after @app.post("/start"):
if req.session_token == "test_demo":
    req.session_token = os.getenv("DEMO_SESSION_TOKEN", "dummy_for_demo")
    req.env = "UAT"
```

### Option 3: Use Stored Session (if you've logged in before)
- Session is saved in browser localStorage as `realswing_session`
- Page refresh should restore it automatically
- Check DevTools > Application > Storage > localStorage

## 🔧 Troubleshooting

### "Cannot connect to backend"
```bash
# Check if ports are open
netstat -an | grep -E ":5173|:9000|:9010"
```

### "Session expired"
- Click **Logout** → redo auth flow
- Or clear localStorage:
  ```javascript
  localStorage.removeItem("realswing_session")
  ```

### No data appearing after "Start Agents"
1. Check browser console (F12) for SSE errors
2. Verify orchestrator is receiving `/start` request:
   ```bash
   # Watch orchestrator logs
   tail -f orchestrator.log
   ```
3. Confirm Nubra WebSocket connects:
   - Look for `[DataAgent] Connected ✓` in logs

## 📊 What Happens When Agents Start
```
DataAgent (Nubra WebSocket)
  ↓ every tick
MarketState (shared memory)
  ↓ AnalystAgent (every 5s)
AnalystReport + PSBBSignal
  ↓ SignalAgent (every 10s, uses 9Router AI)
TradeSignal
  ↓ RiskAgent (sync check)
RiskResult
  ↓ ExecutorAgent (dry_run=true by default)
OrderResult
  ↓ SSE broadcast to frontend
Dashboard updates live
```

## ⚠️ IMPORTANT NOTES
- **Dry Run Mode**: Enabled by default (no real trades placed)
- **Market Hours**: 9:15 AM – 3:30 PM IST (Monday–Friday)
  - Outside hours: system still runs, but agent analysis pauses
- **9Router AI**: Uses Claude to evaluate trade signals
  - Key configured in `.env`: `NINE_ROUTER_API_KEY=sk-...`

## 🚀 Once Live Data Is Flowing
- Dashboard displays:
  - Live index prices (NIFTY, BANKNIFTY, SENSEX)
  - 5m candles with technical analysis
  - Option chain with OI, IV, Greeks
  - AI-powered trade signals
  - Risk-checked orders

---
**Next Step**: Open http://localhost:5173 and complete the auth flow
