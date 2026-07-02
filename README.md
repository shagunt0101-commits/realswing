# RealSwing — F&O Options Scalping Platform

> ⚠️ **LIVE TRADING SYSTEM** — This platform executes real trades. Bugs = real money lost.

RealSwing is a multi-agent F&O (Futures & Options) scalping platform for Indian markets (NIFTY, BANKNIFTY, SENSEX, FINNIFTY) built with a 5-agent pipeline architecture. It provides automated technical analysis, AI-powered signal generation, risk management, and order execution via the Nubra API.

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           REALSWING SYSTEM                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐               │
│  │   Frontend   │     │  Orchestrator │     │ Nubra Proxy  │               │
│  │  React/Vite  │────▶│   (FastAPI)   │────▶│  (FastAPI)   │               │
│  │   :5173      │◀────│    :9010      │◀────│    :9000     │               │
│  └──────────────┘     └──────────────┘     └──────────────┘               │
│         │                      │                      │                    │
│         │              ┌────────┴────────┐              │                    │
│         │              │  SSE Stream    │              │                    │
│         │              │ (real-time)    │              │                    │
│         │              └────────────────┘              │                    │
│         │                                             │                    │
│         │                    ┌─────────────────────────┼─────────────────┐  │
│         │                    │      5-AGENT PIPELINE    │                 │  │
│         │                    ├──────────────────────────┤                 │  │
│         │                    │                          │                 │  │
│         ▼                    ▼                          ▼                 ▼  │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐ │
│  │  DataAgent  │───▶│ AnalystAgent │───▶│SignalAgent  │───▶│ RiskAgent   │ │
│  │  (WebSocket│    │ (pure Python)│    │ (9Router AI)│    │(pure Python)│ │
│  │  Nubra)     │    │    every 5s │    │   every 10s │    │   sync       │ │
│  └─────────────┘    └─────────────┘    └─────────────┘    └──────┬──────┘ │
│        │                  │                  │                  │         │
│        ▼                  │                  │                  ▼         │
│  ┌─────────────┐         │                  │           ┌─────────────┐    │
│  │ MarketState │─────────┴──────────────────┴─────────▶│ Executor   │    │
│  │ (shared)    │                                        │  Agent     │    │
│  └─────────────┘                                        └──────┬──────┘    │
│                                                               │            │
│                                                               ▼            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        NUBRA BROKER API                            │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  │   │
│  │  │ Market  │  │ Option  │  │ Portfolio│  │ Orders  │  │  Trade  │  │   │
│  │  │  Data   │  │  Chain  │  │   API    │  │   API   │  │   API   │  │   │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘  └─────────┘  │   │
│  │           (REST API + WebSocket)                                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 📁 Project Structure

```
Algok/
├── README.md                    ← This file
├── CLAUDE.md                    ← Claude Code instructions
│
├── realswing/                   ← Main project directory
│   ├── CLAUDE.md                ← Project-specific AI instructions
│   ├── main.py                  ← FastAPI orchestrator (port 9000)
│   ├── nubra_backend.py         ← Nubra REST proxy (auth + orders)
│   ├── orchestrator.py          ← 5-agent pipeline orchestration
│   ├── requirements.txt         ← Python dependencies
│   ├── .env                     ← Environment variables (NOT committed)
│   ├── start.bat               ← Windows startup script
│   │
│   ├── agents/                  ← Agent modules
│   │   ├── __init__.py
│   │   ├── data_agent.py        ← Nubra WebSocket → MarketState
│   │   ├── analyst_agent.py     ← EMA, RSI, PCR, SMC analysis
│   │   ├── signal_agent.py      ← 9Router AI trade decisions
│   │   ├── risk_executor.py     ← RiskAgent + ExecutorAgent
│   │   ├── psbb_indicator.py   ← PSBB trendline detector
│   │   └── psbb_integration.py ← PSBB → AnalystReport wiring
│   │
│   ├── tests/                   ← Test suite
│   │   ├── test_analyst.py
│   │   ├── test_psbb.py
│   │   ├── test_risk.py
│   │   └── fixtures/            ← Sample candle data JSON
│   │
│   └── frontend/                ← React + Vite dashboard
│       ├── package.json
│       ├── vite.config.js
│       ├── index.html
│       ├── src/
│       │   ├── main.jsx         ← React entry point
│       │   ├── realswing-dashboard.jsx  ← Main dashboard component
│       │   ├── App.css
│       │   ├── chart/           ← Chart components
│       │   ├── workspace/       ← Workspace layout
│       │   └── stores/          ← State management
│       └── dist/               ← Built output
│
├── archive/                     ← Old/backed up code
│   └── Old project/            ← Previous iterations
│
└── frontend/                    ← Standalone frontend (legacy)
```

---

## 🔄 How It Works

### 1. Authentication Flow (4-Step Nubra)

```
User Mobile → OTP → Verify OTP → MPIN → session_token
    ↓           ↓          ↓        ↓
  Step 1     Step 2    Step 3   Step 4
```

| Step | API Endpoint | Headers | Body | Returns |
|------|--------------|---------|------|---------|
| 1 | `/auth/step1` | — | `{phone, env}` | `temp_token` |
| 2 | `/auth/step2` | `x-temp-token` | `{phone, skip_totp: true}` | `temp_token` |
| 3 | `/auth/step3` | `x-temp-token, x-device-id` | `{phone, otp}` | `auth_token` |
| 4 | `/auth/step4` | `Authorization: Bearer, x-device-id` | `{pin}` | `session_token` |

> ⚠️ **CRITICAL**: `x-temp-token` must NOT be sent in Step 4.

### 2. Agent Pipeline (Data Flow)

```
Nubra WebSocket (wss://uatapi.nubra.io/apibatch/ws)
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ DATAAGENT (runs continuously)                                   │
│ • Parses index ticks, 5m OHLCV, option chains                  │
│ • Converts prices: PAISE ÷ 100 = RUPEES                        │
│ • Updates MarketState (shared dataclass)                       │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼ MarketState (read by all agents)
┌─────────────────────────────────────────────────────────────────┐
│ ANALYSTAGENT (every 5 seconds, pure Python)                   │
│ • EMA9/21 trend detection                                      │
│ • RSI(14) momentum                                             │
│ • PCR (Put/Call Ratio)                                         │
│ • SMC: CHoCH/BOS, FVGs, Order Blocks                           │
│ • Support/Resistance levels                                   │
│ • Returns: AnalystReport (dataclass)                           │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼ AnalystReport
┌─────────────────────────────────────────────────────────────────┐
│ PSBB DETECTOR (every 5 seconds, pure Python)                  │
│ • Swing pivot detection                                        │
│ • Trendline breakout identification                           │
│ • Returns: PSBBSignal (attached to AnalystReport.psbb_signal) │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼ AnalystReport + PSBBSignal
┌─────────────────────────────────────────────────────────────────┐
│ SIGNALAGENT (every 10 seconds, uses 9Router AI)               │
│ • Builds prompt with: trend, RSI, PCR, IV, OI, support/resist  │
│ • Sends to 9Router API (Claude Sonnet 4.5)                    │
│ • 3 GATES must pass: trend_gate + momentum_gate + struct_gate │
│ • Returns: TradeSignal (action, entry, SL, target, confidence)│
└─────────────────────────────────────────────────────────────────┘
    │
    ▼ TradeSignal
┌─────────────────────────────────────────────────────────────────┐
│ RISKAGENT (synchronous check, pure Python)                    │
│ • Daily loss limit check (default: 3%)                        │
│ • Max open positions (default: 3)                              │
│ • R:R ratio ≥ 1.5                                              │
│ • SL ≤ 30% of entry                                            │
│ • Capital budget check                                         │
│ • Returns: RiskResult (approved, lots, reason)                │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼ approved lots
┌─────────────────────────────────────────────────────────────────┐
│ EXECUTORAGENT (Nubra REST API, pure Python)                    │
│ • POST /orders/v2/single                                       │
│ • ALWAYS LIMIT orders (MARKET prohibited by Nubra)            │
│ • Prices: RUPEES × 100 = PAISE                                 │
│ • dry_run=True by default (safety)                            │
│ • Returns: OrderResult                                         │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼ OrderResult → SSE → Frontend
```

### 3. Real-Time Communication (SSE)

The frontend receives real-time updates via Server-Sent Events:

```javascript
// Frontend SSE connection
const es = new EventSource("http://localhost:9010/stream");

es.onmessage = (e) => {
    const { type, data } = JSON.parse(e.data);
    switch(type) {
        case "connected":     // Agent pipeline started
        case "market_state":  // Live market data
        case "analyst_report": // Technical analysis
        case "trade_signal":  // AI-generated signal
        case "order_placed":  // Executed order
        case "momentum":      // OI momentum data
    }
};
```

---

## 🧠 Technical Indicators

### Implemented in AnalystAgent

| Indicator | Period | Description |
|-----------|--------|-------------|
| EMA9 | 9 | Short-term trend |
| EMA21 | 21 | Medium-term trend |
| RSI | 14 | Momentum (0-100) |
| PCR | — | Put/Call Ratio |
| IV ATM | — | Implied Volatility |
| CHoCH | — | Change of Character (SMC) |
| BOS | — | Break of Structure (SMC) |
| FVG | — | Fair Value Gap (SMC) |
| Order Block | — | Institutional zones |
| Support/Resistance | — | S/R levels |

### Implemented in PSBB Detector

- **Swing Pivots**: Left/right pivot detection (configurable: default 3/3)
- **Trendlines**: Rising (bullish) / Falling (bearish) trendlines
- **Breakout Detection**: Price breaks trendline with momentum
- **Risk:Reward Calculation**: Automatic T1/T2 targets

---

## 🔌 API Endpoints

### Backend (nubra_backend.py — :9000)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/step1` | Send OTP |
| POST | `/auth/step2` | Resend OTP |
| POST | `/auth/step3` | Verify OTP |
| POST | `/auth/step4` | Verify MPIN → get session |
| GET | `/market/price/{instrument}` | Current price |
| GET | `/market/optionchain/{instrument}` | Option chain |
| GET | `/market/quotes/{ref_id}` | Order book quotes |
| GET | `/portfolio/positions` | Open positions |
| GET | `/portfolio/funds` | Available funds |
| GET | `/portfolio/orders` | Order history |
| POST | `/trade/order` | Place order (LIMIT only) |
| GET | `/health` | Health check |

### Orchestrator (orchestrator.py — :9010)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/stream` | SSE event stream |
| GET | `/health` | Agent status |
| POST | `/start` | Start agent pipeline |
| POST | `/stop` | Stop agent pipeline |

---

## 🛠️ Setup & Running

### Prerequisites

- Python 3.10+
- Node.js 18+
- 9Router running on `http://localhost:20128`

### Installation

```bash
# Backend
cd realswing
python -m venv venv
.\venv\Scripts\activate  # Windows
pip install -r requirements.txt

# Frontend
cd frontend
npm install
```

### Running

```bash
# Terminal 1: Start backend
cd realswing
python nubra_backend.py

# Terminal 2: Start orchestrator
cd realswing
python orchestrator.py

# Terminal 3: Start frontend
cd frontend
npm run dev
```

Access the dashboard at `http://localhost:5173`

---

## ⚙️ Environment Variables

Create `.env` in `realswing/`:

```bash
# 9Router (AI)
NINE_ROUTER_BASE=http://localhost:20128/v1
NINE_ROUTER_API_KEY=9r_xxx
NINE_ROUTER_MODEL=kr/claude-sonnet-4-5

# Nubra
NUBRA_ENV=UAT
NUBRA_DEVICE_ID=TS123

# Safety
DRY_RUN=true
```

---

## 🔐 Critical Rules

1. **Prices are in PAISE** — Divide by 100 when receiving, multiply by 100 when sending
2. **Orders are LIMIT only** — Never send `price_type="MARKET"` to Nubra
3. **dry_run=True default** — Never change this default
4. **4-step auth flow** — Never reorder or skip steps
5. **No hardcoded credentials** — Always use environment variables

---

## 📊 Supported Instruments

### Indices
- NIFTY (NSE)
- BANKNIFTY (NSE)
- FINNIFTY (NSE)
- MIDCPNIFTY (NSE)
- SENSEX (BSE)
- BANKEX (BSE)

### Stocks (F&O)
50+ stocks including RELIANCE, TCS, HDFCBANK, INFY, ICICIBANK, etc.

---

## 🔧 Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | FastAPI (Python 3.10+) |
| Frontend | React 18 + Vite |
| Broker API | Nubra (REST + WebSocket) |
| AI | 9Router → Claude Sonnet 4.5 |
| Database | SQLite (auth_data.db) |
| Real-time | Server-Sent Events (SSE) |

---

## 📝 License

Private — All rights reserved. This is a live trading system.

---

## 📞 Support

For issues or questions, refer to `realswing/CLAUDE.md` for detailed development guidelines.