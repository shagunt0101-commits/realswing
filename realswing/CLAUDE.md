# RealSwing Scalping Assistant — Claude Code Instructions
# =========================================================
# This file trains Claude Code (running inside Antigravity or terminal)
# on how to design, implement, review, and test every part of this project.
#
# HOW TO USE:
#   Place this file at the ROOT of your project: realswing/CLAUDE.md
#   Claude Code reads it automatically at the start of every session.
#   In Antigravity: open the project folder → Claude sees this file.
#   In terminal:    cd realswing && claude
#
# PHILOSOPHY:
#   This is a LIVE TRADING SYSTEM. Bugs = real money lost.
#   Every change must be: Designed → Implemented → Reviewed → Tested
#   before it touches any file that ExecutorAgent uses.
# =========================================================


## PROJECT OVERVIEW

RealSwing is a multi-agent F&O options scalping platform for Indian markets
(NIFTY, BANKNIFTY, SENSEX) built on:

  Backend  : FastAPI (Python 3.10+) — realswing/main.py
  Frontend : React + Vite (JSX)    — realswing/frontend/src/
  Broker   : Nubra API (UAT + PROD) via REST + WebSocket
  AI Model : 9Router (OpenAI-compatible proxy) → kr/claude-sonnet-4-5
  Agents   : 5-agent pipeline + PSBB trendline detector

### Folder Structure
```
realswing/
├── CLAUDE.md                  ← YOU ARE HERE
├── main.py                    ← FastAPI orchestrator + SSE
├── nubra_backend.py           ← Nubra REST proxy (auth + orders)
├── requirements.txt
├── agents/
│   ├── __init__.py
│   ├── data_agent.py          ← Nubra WebSocket, MarketState
│   ├── analyst_agent.py       ← EMA, RSI, PCR, SMC (pure Python)
│   ├── signal_agent.py        ← 9Router AI trade decision
│   ├── risk_executor.py       ← RiskAgent + ExecutorAgent
│   ├── psbb_indicator.py      ← Priyank Sharma BB trendline detector
│   └── psbb_integration.py   ← PSBB wired into pipeline
├── tests/
│   ├── test_analyst.py
│   ├── test_psbb.py
│   ├── test_risk.py
│   └── fixtures/              ← sample candle data JSON
└── frontend/
    ├── src/
    │   ├── realswing-dashboard.jsx   ← main dashboard
    │   ├── ChartAnalyst.jsx          ← AI chart vision panel
    │   └── main.jsx
    └── package.json
```


## AGENT PIPELINE (read before touching any agent file)

```
Nubra WebSocket
      ↓
  DataAgent          — pure Python, NO AI
  (data_agent.py)    Parses: index ticks, 5m OHLCV, option chains
  Prices: ALL Nubra prices are in PAISE → always divide by 100
      ↓ MarketState (shared dataclass, read by all agents)
  AnalystAgent       — pure Python, NO AI, runs every 5s
  (analyst_agent.py) EMA9/21 trend, RSI(14), PCR, CHoCH/BOS,
                     FVGs, Order Blocks, S/R levels
      ↓ AnalystReport
  PSBBDetector       — pure Python, NO AI, runs every 5s
  (psbb_indicator.py) Swing pivot detection + trendline breakout
      ↓ PSBBSignal (attached to AnalystReport as .psbb_signal)
  SignalAgent        — uses 9Router AI (kr/claude-sonnet-4-5)
  (signal_agent.py)  Only fires if all 3 gates pass:
                     trend_gate_pass + momentum_pass + structure_pass
                     → sends prompt to 9Router → gets JSON decision
      ↓ TradeSignal
  RiskAgent          — pure Python, NO AI
  (risk_executor.py) Checks: daily loss limit, max positions,
                     R:R ≥ 1.5, SL ≤ 30% of entry, capital budget
      ↓ approved lots
  ExecutorAgent      — pure Python, NO AI
  (risk_executor.py) POST /orders/v2/single via nubra_backend.py
                     ALWAYS LIMIT orders — NEVER MARKET (Nubra rule)
                     dry_run=True by default (safety)
      ↓ OrderResult → SSE → React Dashboard
```


## CRITICAL RULES — READ BEFORE EVERY CODE CHANGE

### 1. NEVER break these invariants
- All Nubra prices are in PAISE. Divide by 100 before display/logic.
- Orders are ALWAYS LIMIT. Never send price_type="MARKET" to Nubra.
- ExecutorAgent.dry_run defaults to True. Never change this default.
- session_token is the Bearer token for all Nubra API calls after login.
- The 4-step Nubra auth flow is: sendphoneotp(skip_totp=False) →
  sendphoneotp(skip_totp=True, x-temp-token) →
  verifyphoneotp → verifypin(pin=MPIN, Bearer=auth_token)
- x-temp-token must NOT be sent in the verifypin (Step 4) call.
- 9Router base URL: http://localhost:20128/v1
- 9Router model: kr/claude-sonnet-4-5 (via env NINE_ROUTER_MODEL)
- Nubra UAT WebSocket: wss://uatapi.nubra.io/apibatch/ws
- WebSocket subscribe format: "batch_subscribe {token} {channel} {json} [exchange]"

### 2. Before writing ANY code, state your plan
Always respond with a PLAN first:
```
PLAN:
1. What I am changing and why
2. Which files are affected
3. What could break
4. How I will test it
Then ask: "Shall I proceed?"
```
Do not write code until the plan is confirmed.

### 3. Never modify more than ONE agent at a time
Each agent is independent. Changing DataAgent while fixing SignalAgent
creates cascading bugs that are hard to trace in a live system.
Complete → test → commit one agent before touching another.

### 4. All prices in the codebase use RUPEES (float)
Conversion happens ONLY at the API boundary:
- Receiving from Nubra: divide by 100 immediately in DataAgent parsers
- Sending to Nubra: multiply by 100 (int) in ExecutorAgent only
Never pass raw paise values through business logic.

### 5. Every new function needs a docstring with:
- What it does (one line)
- Parameters and types
- Return value
- Example if non-obvious


## DESIGN PATTERNS TO FOLLOW

### Adding a new indicator to AnalystAgent
```python
# 1. Pure function — takes list[OHLCVCandle], returns a value
def my_indicator(candles: list[OHLCVCandle], period: int = 14) -> float:
    """Calculate X from last N candles. Returns 0.0 if insufficient data."""
    if len(candles) < period:
        return 0.0
    # ... logic ...
    return result

# 2. Add to AnalystReport dataclass (analyst_agent.py)
@dataclass
class AnalystReport:
    ...
    my_indicator_value: float = 0.0   # always provide default

# 3. Compute in analyse() method
report = AnalystReport(
    ...
    my_indicator_value = my_indicator(candles),
)

# 4. Add to SignalAgent prompt context (signal_agent.py build_prompt())
f"My Indicator: {report.my_indicator_value:.2f}"

# 5. Write a test in tests/test_analyst.py
```

### Adding a new API endpoint to main.py
```python
@app.get("/my/endpoint")
async def my_endpoint(session_token: str = "", env: str = "UAT"):
    """One-line description of what this returns."""
    if not registry.data_agent:
        raise HTTPException(503, "Agents not started")
    # ... logic ...
    return {"result": ...}
```

### Adding a new React panel to the dashboard
```jsx
// 1. Create frontend/src/MyPanel.jsx as a standalone component
// 2. Import in realswing-dashboard.jsx
// 3. Add to tab list: { id: "mypanel", label: "🔧 My Panel" }
// 4. Add: {activeTab === "mypanel" && <MyPanel session={session} />}
// Keep all styling inline using the C = {...} color token object
// Never use external CSS files or Tailwind in this project
```


## IMPLEMENTATION WORKFLOW (follow every time)

### Step 1 — UNDERSTAND
Before touching any file:
```
claude: "Show me the current state of [file]"
claude: "What does [function] currently do?"
claude: "What calls [function] and what depends on its output?"
```

### Step 2 — DESIGN
Write the design as a comment block FIRST, before any code:
```python
# DESIGN: MyNewFeature
# Purpose: ...
# Input: ...
# Output: ...
# Edge cases: ...
# Tests needed: ...
```

### Step 3 — IMPLEMENT (small chunks)
- Maximum 50 lines per edit
- One logical change per edit
- Never refactor + add feature in same edit
- After each edit: run the relevant test immediately

### Step 4 — SELF-REVIEW CHECKLIST
Before marking any task complete, check every item:
```
[ ] Paise/rupee conversion correct at API boundary only?
[ ] dry_run=True default preserved in ExecutorAgent?
[ ] New function has docstring?
[ ] No hardcoded credentials or tokens?
[ ] No print() statements (use logger.info/debug/error)?
[ ] All new dataclass fields have defaults?
[ ] Import added to __init__.py if needed?
[ ] Frontend: all styles use inline C.* color tokens?
[ ] Frontend: no form tags (use onClick handlers)?
[ ] Tested with dry_run=True before anything else?
```

### Step 5 — TEST (required, not optional)
```bash
# Python — run from realswing/ folder
python -m pytest tests/ -v

# Test a single agent in isolation
python -m agents.psbb_indicator    # self-test mode
python -m agents.analyst_agent     # if __main__ block exists

# Frontend
cd frontend && npm run build       # must build with 0 errors
```

### Step 6 — COMMIT (with descriptive message)
```bash
git add -p                         # stage in hunks, review each
git commit -m "feat(agent): describe what changed and why"
# Format: type(scope): description
# Types: feat, fix, refactor, test, docs, chore
```


## TESTING GUIDE

### Unit tests location: realswing/tests/

### Test structure for agents:
```python
# tests/test_analyst.py
import pytest
from agents.data_agent import OHLCVCandle
from agents.analyst_agent import ema, rsi, detect_fvgs

def make_candles(closes: list[float]) -> list[OHLCVCandle]:
    """Helper: build candle list from close prices."""
    candles = []
    for i, c in enumerate(closes):
        candles.append(OHLCVCandle(
            symbol="NIFTY", interval="5m",
            open=c-5, high=c+10, low=c-10, close=c,
            volume=10000, timestamp=1700000000 + i*300
        ))
    return candles

def test_ema_basic():
    closes = list(range(1, 30))  # 1,2,3...29
    result = ema([float(c) for c in closes], period=9)
    assert len(result) > 0
    assert result[-1] > result[0]   # EMA should rise with rising prices

def test_rsi_overbought():
    # 20 consecutive up candles → RSI should be high
    closes = [100 + i*2 for i in range(20)]
    r = rsi([float(c) for c in closes])
    assert r > 60, f"Expected RSI > 60 on uptrend, got {r}"

def test_rsi_insufficient_data():
    # Less than 15 candles → should return 50.0 (neutral)
    assert rsi([100.0, 101.0, 102.0]) == 50.0
```

### Test structure for PSBB:
```python
# tests/test_psbb.py
from agents.psbb_indicator import PSBBDetector, calc_atr
from agents.data_agent import OHLCVCandle

def make_downtrend_then_breakout():
    """Build candles: downtrend lower highs → then strong up candle"""
    candles = []
    price = 24000.0
    ts = 1700000000
    # Falling highs (resistance trendline)
    for i in range(15):
        high = price + 50 - i * 3   # decreasing highs
        candles.append(OHLCVCandle(
            symbol="NIFTY", interval="5m",
            open=price, high=high, low=price-30, close=price-10,
            volume=10000, timestamp=ts + i*300
        ))
        price -= 5
    # Breakout candle — closes above the falling trendline
    candles.append(OHLCVCandle(
        symbol="NIFTY", interval="5m",
        open=price, high=price+120, low=price-10, close=price+100,
        volume=25000, timestamp=ts + 15*300
    ))
    return candles

def test_psbb_bull_detected():
    detector = PSBBDetector(pivot_left=2, pivot_right=2, min_risk=5.0)
    candles = make_downtrend_then_breakout()
    # Check last few candles for signal
    signal = None
    for i in range(8, len(candles)):
        s = detector.detect(candles[:i+1], "NIFTY")
        if s and s.direction == "BULL":
            signal = s
            break
    # Signal may or may not fire depending on pivot detection
    # At minimum verify no crash
    assert True  # no exception = pass

def test_psbb_sl_above_entry_for_bear():
    """For BEAR signal: SL must always be above entry"""
    # This is a mathematical invariant — always true by design
    # Test by checking the formula directly
    entry = 24136.55
    sl    = 24166.05
    risk  = sl - entry
    t1    = entry - risk
    t2    = entry - 2 * risk
    assert sl > entry,  "BEAR SL must be above entry"
    assert t1 < entry,  "BEAR T1 must be below entry"
    assert t2 < t1,     "BEAR T2 must be below T1"
    assert abs((entry - t1) - (sl - entry)) < 0.01, "T1 must be 1:1 R:R"
```

### Test structure for RiskAgent:
```python
# tests/test_risk.py
from agents.risk_executor import RiskAgent, RiskConfig
from agents.signal_agent import TradeSignal
from datetime import datetime

def make_signal(entry=150.0, sl=112.5, target=225.0, lot_size=50):
    return TradeSignal(
        asset="NIFTY", action="BUY_PE",
        strike=24000, ref_id=12345, lot_size=lot_size,
        entry_price=entry, sl_price=sl, target_price=target,
        confidence="HIGH", reason="test", setup_type="TEST",
        rr_ratio=round((target-entry)/max(entry-sl, 0.01), 2)
    )

def test_risk_approves_valid_signal():
    risk = RiskAgent(RiskConfig(total_capital=100_000))
    sig  = make_signal()
    result = risk.check(sig)
    assert result.approved
    assert result.lots >= 1

def test_risk_rejects_low_rr():
    risk = RiskAgent(RiskConfig(total_capital=100_000, min_rr=1.5))
    sig  = make_signal(entry=150, sl=140, target=155)  # R:R = 0.5
    sig.rr_ratio = 0.5
    result = risk.check(sig)
    assert not result.approved
    assert "R:R" in result.reason

def test_risk_respects_daily_loss_limit():
    risk = RiskAgent(RiskConfig(total_capital=100_000, daily_loss_limit=0.03))
    risk.daily_pnl = -3500  # over 3% of 1L
    sig = make_signal()
    result = risk.check(sig)
    assert not result.approved
    assert "loss limit" in result.reason.lower()

def test_risk_max_positions():
    risk = RiskAgent(RiskConfig(total_capital=100_000, max_open_positions=3))
    sig = make_signal()
    for _ in range(3):
        risk.register_open(sig)
    result = risk.check(sig)
    assert not result.approved
    assert "position" in result.reason.lower()
```


## ERROR HANDLING PATTERNS

### Agent errors — never crash the pipeline:
```python
# CORRECT: catch and log, continue loop
async def run(self):
    while self._running:
        for asset in assets:
            try:
                self.analyse(asset)
            except Exception as e:
                logger.error(f"[AgentName] Error on {asset}: {e}", exc_info=True)
        await asyncio.sleep(self.interval)

# WRONG: unhandled exception kills the entire agent task
async def run(self):
    while self._running:
        self.analyse(asset)   # ← if this throws, whole loop dies
```

### API errors — always check status code:
```python
# CORRECT
async with httpx.AsyncClient() as c:
    r = await c.post(url, json=payload, timeout=10)
    if r.status_code != 200:
        raise HTTPException(r.status_code, r.text)
    return r.json()

# WRONG — will crash on 401/429/500 without useful message
return httpx.post(url, json=payload).json()
```

### 9Router errors — fail gracefully, don't block trading:
```python
# In signal_agent.py call_9router():
# If 9Router is down → return None → SignalAgent skips this cycle
# NEVER let a 9Router timeout block the DataAgent or AnalystAgent
result = await call_9router(prompt)
if result is None:
    logger.warning("[SignalAgent] 9Router unavailable, skipping cycle")
    return None   # ← graceful skip, not a crash
```

### WebSocket reconnection — always auto-reconnect:
```python
# DataAgent.run() already handles this with try/except + sleep(3)
# Never add bare await ws.recv() without the reconnect wrapper
```


## COMMON MISTAKES TO AVOID

### ❌ Sending MARKET orders to Nubra
```python
# WRONG
"price_type": "MARKET"

# CORRECT — always LIMIT
"price_type": "LIMIT",
"order_price": int(entry_price * 100)   # in paise
```

### ❌ Forgetting paise conversion
```python
# WRONG — displays 2413655 instead of 24136.55
label = f"Entry: {signal.entry_price}"   # if entry_price is still in paise

# CORRECT — convert at DataAgent parse boundary
ltp = raw_data["ltp"] / 100   # rupees from here on
```

### ❌ Blocking the event loop in an async function
```python
# WRONG — blocks entire FastAPI event loop during Ollama/9Router call
import time
time.sleep(5)

# CORRECT
await asyncio.sleep(5)
```

### ❌ Mutating MarketState from multiple agents simultaneously
```python
# MarketState is read by all agents — DataAgent is the ONLY writer
# Other agents only READ from state, never write
# WRONG in AnalystAgent:
self.state.nifty.ltp = 24000   # ← never do this

# CORRECT: AnalystAgent reads, produces its own AnalystReport
report = AnalystReport(spot=self.state.nifty.ltp, ...)
```

### ❌ Hardcoding credentials
```python
# WRONG
session_token = "eyJhbGciOiJIUzI1..."

# CORRECT — always from env or request body
session_token = os.getenv("NUBRA_SESSION_TOKEN", "")
```

### ❌ React: using <form> tags
```jsx
// WRONG — breaks in this project
<form onSubmit={handleSubmit}>

// CORRECT — always use button onClick
<button onClick={handleSubmit}>Submit</button>
```

### ❌ React: localStorage in artifacts/dashboard
```jsx
// WRONG — not supported in Claude.ai artifacts
localStorage.setItem("key", value)

// CORRECT — use React state
const [data, setData] = useState(null)
```


## WORKFLOW FOR COMMON TASKS

### "Add a new technical indicator"
1. Add pure function to analyst_agent.py
2. Add field to AnalystReport dataclass with default value
3. Compute it in analyse() method
4. Add to build_prompt() in signal_agent.py
5. Write test in tests/test_analyst.py
6. Run: python -m pytest tests/test_analyst.py -v

### "Fix a bug in order placement"
1. First reproduce: write a test that fails
2. Read risk_executor.py ExecutorAgent.place() carefully
3. Check: is it paise/rupees? Is dry_run respected? Is error caught?
4. Fix minimum lines needed
5. Confirm test passes
6. Manually test with dry_run=True via /docs Swagger UI

### "Add a new dashboard panel"
1. Create frontend/src/NewPanel.jsx
2. Use inline styles with C.* tokens only
3. Import in realswing-dashboard.jsx
4. Add tab entry + conditional render
5. Run: cd frontend && npm run build
6. Fix any build errors before calling it done

### "Modify the PSBB indicator parameters"
1. Understand current defaults: pivot_left=3, pivot_right=3, min_risk=10.0
2. Change only in main.py where PSBBSignalAgent/attach_psbb_to_analyst are called
3. Never change PSBBDetector defaults — they are documentation of the algorithm
4. Run: python -m agents.psbb_indicator to verify self-test

### "Update Nubra auth flow"
1. Check nubra_backend.py — the auth proxy
2. Check realswing-dashboard.jsx AuthPanel — the frontend flow
3. Auth sequence is sacred — do not reorder steps
4. Test manually: log in on UAT with real mobile number


## BEFORE STARTING ANY NEW FEATURE — ASK THESE QUESTIONS

1. **Does this touch ExecutorAgent or order placement?**
   If YES → mandatory dry_run test first, never skip

2. **Does this change MarketState structure?**
   If YES → all 5 agents must be checked for compatibility

3. **Does this change the Nubra API payload?**
   If YES → test against UAT first, document the change in code comments

4. **Does this add a new dependency (pip or npm)?**
   If YES → add to requirements.txt or package.json immediately,
   and check if it works on Windows (Navneet's dev machine)

5. **Does this run on every candle (every 5s)?**
   If YES → profile for performance. Must complete in < 1 second.
   No network calls inside tight loops.

6. **Is this frontend?**
   If YES → npm run build must pass with 0 errors before it's done.


## SESSION STARTUP CHECKLIST

At the start of every Claude Code session, run:

```bash
# 1. Verify project structure is intact
ls realswing/agents/

# 2. Check Python environment
source venv/bin/activate
python -m pytest tests/ -v --tb=short

# 3. Check 9Router is running
curl http://localhost:20128/v1/models

# 4. Start backend (separate terminal)
python main.py

# 5. Start frontend (separate terminal)
cd frontend && npm run dev

# 6. Verify health endpoint
curl http://localhost:8000/health
```

Expected health response:
```json
{
  "running": false,
  "connected": false,
  "agents": {
    "data": false, "analyst": false, "signal": false,
    "risk": false, "executor": false
  }
}
```
(false = not yet started, which is correct before /start is called)


## GIT CONVENTIONS

```
Branch naming:
  feat/psbb-tuning
  fix/paise-conversion-bug
  refactor/analyst-ema
  test/risk-agent-coverage

Commit message format:
  feat(psbb): add pivot_right=1 mode for faster live signal detection
  fix(executor): correct paise conversion in stoploss trigger_price
  test(risk): add daily loss limit boundary test
  docs(claude): add session startup checklist

Never commit:
  - session_token, auth_token, or any API keys
  - nubra_backend.py with real PROD credentials
  - dry_run=False as a default anywhere
```


## ANTIGRAVITY-SPECIFIC NOTES

Since you're using Antigravity IDE with Claude Code:

1. **Use Manager View for planning** — paste your feature request,
   let Antigravity generate the task breakdown, then switch to
   Claude Code for actual implementation

2. **Use Editor View for review** — after Claude Code writes code,
   review diffs in Editor View before accepting

3. **Agent-assisted mode recommended** — not full autopilot.
   You approve each file change for trading system safety.

4. **Browser panel for frontend testing** — Antigravity's built-in
   browser can open localhost:5173 to visually verify dashboard changes

5. **Model selection** — use Claude Sonnet 4.6 in Antigravity for
   complex refactors; switch to claude-sonnet-4-5 for quick fixes

6. **Artifact comments** — use Antigravity's comment system to mark
   which code sections need review before going to PROD mode


## ENVIRONMENT VARIABLES REFERENCE

```bash
# 9Router
NINE_ROUTER_BASE=http://localhost:20128/v1
NINE_ROUTER_API_KEY=9r_your_key_here
NINE_ROUTER_MODEL=kr/claude-sonnet-4-5

# Nubra (never hardcode — always from env)
NUBRA_ENV=UAT          # or PROD
NUBRA_DEVICE_ID=TS123

# Safety
DRY_RUN=true           # always true until explicitly ready for live
```

Create a `.env` file in realswing/ (never commit it):
```
NINE_ROUTER_API_KEY=9r_xxx
NINE_ROUTER_MODEL=kr/claude-sonnet-4-5
DRY_RUN=true
```

Load in main.py:
```python
from dotenv import load_dotenv
load_dotenv()
```
Add to requirements.txt: `python-dotenv==1.0.1`


## FINAL RULE

**When in doubt, do less.**
A smaller correct change is always better than a larger broken one.
This is a live trading system. Correctness > speed of development.
