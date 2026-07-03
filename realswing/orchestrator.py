"""
RealSwing — Main Orchestrator
==============================
Wires all 5 agents together and exposes a FastAPI server
with Server-Sent Events (SSE) so the React dashboard gets
live updates without polling.

Architecture:
  DataAgent (WebSocket to Nubra)
      ↓ MarketState (shared memory)
  AnalystAgent (every 5s, pure Python)
      ↓ AnalystReport
  SignalAgent (every 10s, 9Router AI → Claude/GPT)
      ↓ TradeSignal
  RiskAgent (sync check, pure Python)
      ↓ RiskCheckResult
  ExecutorAgent (Nubra REST API via port 8000)
      ↓ OrderResult

FastAPI routes:
  POST /start          → initialise agents with session_token + expiry
  GET  /stream         → SSE stream: market state, analyst reports, signals
  GET  /state          → current MarketState snapshot (JSON)
  GET  /signals        → last signals per asset
  GET  /orders         → order log
  POST /stop           → shut down agents

Run:
  python orchestrator.py
  → http://localhost:9010
"""

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime
from dataclasses import dataclass, field
from typing import AsyncGenerator

from dotenv import load_dotenv
load_dotenv()  # loads realswing/.env

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from agents.data_agent    import DataAgent, MarketState
from agents.analyst_agent import AnalystAgent
from agents.signal_agent  import SignalAgent
from agents.analyst_agent import AnalystAgent as TechnicalAnalystAgent
from agents.report_agent  import ReportAgent, build_levels_table
from agents.risk_executor import RiskAgent, RiskConfig, ExecutorAgent, make_risk_executor_callback
from agents.indicator_engine import compute_indicators, get_candles_from_state, compute_oi_momentum, expected_move

# ── YAHOO FINANCE REAL DATA FETCHER ──────────────────────────────────────────
# Free, no API key needed. Used when Nubra agents aren't running.
# Yahoo symbols: ^NSEI (NIFTY), ^NSEBANK (BANKNIFTY), BSESN (SENSEX)

YAHOO_SYMBOLS = {
    "NIFTY":     "%5ENSEI",
    "BANKNIFTY": "%5ENSEBANK",
    "SENSEX":    "BSESN",
    "FINNIFTY":  "%5ECNXMID",
}
YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart"
YAHOO_UA   = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

TF_YAHOO = {"1m":"1m","3m":"2m","5m":"5m","15m":"15m","30m":"30m","1h":"1h","4h":"1h","1d":"1d"}
TF_LIMIT = {"1m":120,"3m":200,"5m":300,"15m":200,"30m":200,"1h":200,"4h":200,"1d":200}  # max bars to return per TF
YAHOO_RANGE = {"5m":"5d","15m":"5d","30m":"5d","1h":"5d","1d":"5d"}


def _fetch_yahoo_bars(instrument: str, timeframe: str, limit: int = 200) -> list:
    """Fetch real OHLCV bars from Yahoo Finance."""
    import urllib.request, json, ssl
    sym = YAHOO_SYMBOLS.get(instrument.upper())
    if not sym:
        return []
    yahoo_tf = TF_YAHOO.get(timeframe, "5m")
    yahoo_range = YAHOO_RANGE.get(timeframe, "5d")
    url = f"{YAHOO_BASE}/{sym}?interval={yahoo_tf}&range={yahoo_range}&includePrePost=False"
    req = urllib.request.Request(url, headers={"User-Agent": YAHOO_UA})
    ctx = ssl.create_default_context()
    try:
        resp = urllib.request.urlopen(req, context=ctx, timeout=10)
        data = json.loads(resp.read())
        result = data["chart"]["result"][0]
        ts = result.get("timestamp", [])
        if not ts:
            return []
        quotes = result["indicators"]["quote"][0]
        bars = []
        for t, o, h, l, c, v in zip(ts, quotes["open"], quotes["high"],
                                     quotes["low"], quotes["close"], quotes["volume"]):
            if c is not None:  # skip None-close (outside market hours)
                bars.append({
                    "time": t,
                    "open": round(o, 2), "high": round(h, 2),
                    "low": round(l, 2), "close": round(c, 2),
                    "volume": v or 0,
                })
        return bars[-limit:]
    except Exception as e:
        logger.warning(f"[Main] Yahoo fetch failed for {instrument}: {e}")
        return []


def _fetch_yahoo_data(instrument: str, timeframe: str) -> dict | None:
    """Fetch OHLCV from Yahoo and return as {open, high, low, close, volume, times} dict."""
    bars = _fetch_yahoo_bars(instrument, timeframe, limit=TF_LIMIT.get(timeframe, 200))
    if not bars:
        return None
    return {
        "open":   [b["open"]   for b in bars],
        "high":   [b["high"]   for b in bars],
        "low":    [b["low"]    for b in bars],
        "close":  [b["close"]  for b in bars],
        "volume": [b["volume"] for b in bars],
        "times":  [b["time"] * 1000 for b in bars],
    }


# ── MARKET HOURS (IST) ──────────────────────────────────────────────────────────
# NSE/BSE equity derivatives: 9:15 AM – 3:30 PM, Monday–Friday
import datetime as _dt

def in_market_hours() -> bool:
    """Return True if market is currently open (IST)."""
    now = _dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(hours=5, minutes=30)
    if now.weekday() >= 5:
        return False
    open_t  = _dt.time(9, 15)
    close_t = _dt.time(15, 30)
    return open_t <= now.time() <= close_t

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("Main")


# ── GLOBAL AGENT REGISTRY ────────────────────────────────────────────────────

class AgentRegistry:
    """Shared registry for agent instances, lifecycle tasks, and SSE clients.
    Uses __init__ to avoid mutable class-level defaults."""
    def __init__(self):
        self.data_agent:           DataAgent           = None
        self.analyst_agent:        AnalystAgent         = None
        self.signal_agent:         SignalAgent          = None
        self.risk_agent:           RiskAgent            = None
        self.executor_agent:       ExecutorAgent        = None
        self.tech_analyst_agent:   TechnicalAnalystAgent = None
        self.report_agent:         ReportAgent          = None
        self.tasks:                list                 = []
        self.sse_clients:          list                 = []
        self.active_strategies:    list                 = []   # list of asyncio.Queue for SSE
        self.running:              bool                 = False

registry = AgentRegistry()


# ── SSE BROADCAST ─────────────────────────────────────────────────────────────

async def broadcast(event_type: str, data: dict):
    """Send an SSE event to all connected dashboard clients.
    Critical events (order, signal) never drop; market data drops on backpressure."""
    payload = json.dumps({"type": event_type, "data": data, "ts": datetime.now().isoformat()})
    is_critical = event_type in ("order", "signal", "trade_signal", "order_placed")
    dead = []
    for q in registry.sse_clients:
        if is_critical:
            await q.put(payload)
        else:
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                dead.append(q)
    for q in dead:
        registry.sse_clients.remove(q)


# ── STATE SERIALISER ─────────────────────────────────────────────────────────

def serialise_state(state: MarketState) -> dict:
    def tick(t):
        if not t: return None
        return {"symbol": t.symbol, "ltp": t.ltp, "prev_close": t.prev_close,
                "change_pct": round(t.change_pct, 2), "volume": t.volume}
    candles = {}
    for sym, hist in state.candles.items():
        candles[sym] = [{"o": c.open, "h": c.high, "l": c.low, "c": c.close,
                         "v": c.volume, "ts": c.timestamp} for c in hist[-20:]]
    chains = {}
    for asset, ch in state.option_chains.items():
        chains[asset] = {
            "spot": ch.spot, "atm": ch.atm, "expiry": ch.expiry,
            "ce_count": len(ch.ce), "pe_count": len(ch.pe),
        }
    return {
        "connected":    state.connected,
        "last_update":  state.last_update.isoformat() if state.last_update else None,
        "nifty":        tick(state.nifty),
        "banknifty":    tick(state.banknifty),
        "sensex":       tick(state.sensex),
        "candles":      candles,
        "option_chains": chains,
    }


# ── BACKGROUND BROADCAST LOOP ─────────────────────────────────────────────────

async def broadcast_loop():
    """Push market state to SSE clients every 2 seconds.
    Market state always broadcasts (so dashboard stays alive).
    Analyst reports only update during market hours."""
    while registry.running:
        if registry.data_agent:
            state_data = serialise_state(registry.data_agent.state)
            await broadcast("market_state", state_data)

            # Also broadcast analyst reports (only during market hours)
            if registry.analyst_agent and in_market_hours():
                for asset, report in registry.analyst_agent.last_reports.items():
                    await broadcast("analyst_report", {
                        "asset":           asset,
                        "trend":           report.trend,
                        "rsi":             report.rsi,
                        "pcr":             report.pcr,
                        "iv_atm":          report.iv_atm,
                        "oi_direction":    report.oi_direction,
                        "choch":           report.choch_level,
                        "support":         report.support,
                        "resistance":      report.resistance,
                        "trend_gate_pass": report.trend_gate_pass,
                        "momentum_pass":   report.momentum_pass,
                        "structure_pass":  report.structure_pass,
                        "spot":            report.spot,
                        "atm":             report.atm,
                    })

            # Broadcast momentum data every tick (cached — only recompute when OI changes)
            if registry.data_agent and registry.data_agent.state.option_chains:
                for asset, chain in registry.data_agent.state.option_chains.items():
                    # Build a quick hash of OI snapshots to skip unchanged data
                    oi_sig = str([(s.get('sp',0), s.get('oi',0)) for s in (chain.ce or [])[:5] + (chain.pe or [])[:5]])
                    if getattr(registry, '_momentum_cache', None) is None:
                        registry._momentum_cache = {}
                    cached = registry._momentum_cache.get(asset)
                    if cached and cached['sig'] == oi_sig:
                        momentum = cached['result']
                    else:
                        momentum = compute_oi_momentum({
                            "ce": chain.ce, "pe": chain.pe,
                            "spot": chain.spot, "atm": chain.atm,
                        }, asset)
                        registry._momentum_cache[asset] = {'sig': oi_sig, 'result': momentum}
                    em = expected_move(chain.spot, 14, 7)
                    if chain.spot:
                        await broadcast("momentum", {
                            "asset": asset,
                            "spot": chain.spot,
                            "concentration": momentum["concentration"],
                            "pc_ratio": momentum["pc_ratio"],
                            "top_bullish": momentum["top_bullish"],
                            "top_bearish": momentum["top_bearish"],
                            "expected_move": em,
                            "strikes": momentum["strikes"][:10],
                        })
        await asyncio.sleep(1)


# ── FASTAPI APP ───────────────────────────────────────────────────────────────

app = FastAPI(title="RealSwing Multi-Agent Backend", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)


# ── START / STOP ──────────────────────────────────────────────────────────────

class AssetConfig(BaseModel):
    name: str
    exchange: str = "NSE"
    expiry: str = ""       # YYYYMMDD; empty = week's expiry

class StartRequest(BaseModel):
    session_token: str
    env: str = "UAT"
    device_id: str = "TS123"
    total_capital: float = 100_000.0
    dry_run: bool = True
    assets: list[AssetConfig] = [
        AssetConfig(name="NIFTY", exchange="NSE"),
        AssetConfig(name="BANKNIFTY", exchange="NSE"),
        AssetConfig(name="SENSEX", exchange="BSE"),
    ]

@app.post("/demo/start")
async def demo_start():
    """
    Demo mode — starts agents with Yahoo Finance live data (no Nubra auth needed).
    Perfect for testing the 5-agent pipeline with real market data.
    """
    if registry.running:
        return {"status": "already_running"}

    logger.info("[Demo] Starting in DEMO MODE with Yahoo Finance data")

    # Use dummy token for demo
    demo_token = "demo_mode_token_" + datetime.now().strftime("%Y%m%d_%H%M%S")

    # Create agents with demo configuration
    registry.data_agent = DataAgent(session_token=demo_token, expiry="", env="UAT")

    # Simulate demo market data (Yahoo prices updated every 2 seconds)
    async def demo_data_loop():
        """Fetch live prices from Yahoo and update market state."""
        while registry.running:
            try:
                for symbol in ["NIFTY", "BANKNIFTY", "SENSEX"]:
                    bars = await asyncio.to_thread(_fetch_yahoo_bars, symbol, "1m", 50)
                    if bars:
                        latest = bars[-1]
                        tick = IndexTick(
                            symbol=symbol,
                            ltp=latest["close"],
                            prev_close=bars[0]["close"] if bars else latest["close"],
                            change_pct=((latest["close"] - bars[0]["close"]) / bars[0]["close"] * 100) if bars else 0,
                            volume=int(latest["volume"]),
                            timestamp=int(latest["time"]),
                        )
                        if symbol == "NIFTY": registry.data_agent.state.nifty = tick
                        elif symbol == "BANKNIFTY": registry.data_agent.state.banknifty = tick
                        elif symbol == "SENSEX": registry.data_agent.state.sensex = tick
                        registry.data_agent.state.last_update = datetime.now()
                        registry.data_agent.state.connected = True

                await asyncio.sleep(1)
            except Exception as e:
                logger.error(f"[Demo] Error fetching Yahoo data: {e}")
                await asyncio.sleep(2)

    registry.analyst_agent = AnalystAgent(state=registry.data_agent.state, interval_sec=5)
    registry.signal_agent = SignalAgent(analyst=registry.analyst_agent, interval_sec=10)
    registry.risk_agent = RiskAgent(config=RiskConfig(total_capital=100_000))
    registry.executor_agent = ExecutorAgent(session_token=demo_token, device_id="DEMO", env="UAT", dry_run=True)

    # Init tech analyst + report agent (for pandas-ta indicators & BS levels)
    class _NubraClient:
        """Minimal client for analyst_agent to fetch OHLC/chain from our own API."""
        def __init__(self): pass
        async def get(self, path): return None  # In demo mode, we won't have Nubra data
    registry.tech_analyst_agent = TechnicalAnalystAgent(_NubraClient())
    registry.report_agent = ReportAgent()

    # Wire callbacks
    async def on_signal(signal):
        await broadcast("trade_signal", {
            "asset": signal.asset,
            "action": signal.action,
            "strike": signal.strike,
            "entry": signal.entry_price,
            "sl": signal.sl_price,
            "target": signal.target_price,
            "confidence": signal.confidence,
            "reason": signal.reason,
            "setup_type": signal.setup_type,
            "rr_ratio": signal.rr_ratio,
        })

    registry.signal_agent.on_signal(on_signal)

    registry.running = True
    registry.tasks = [
        asyncio.create_task(demo_data_loop()),
        asyncio.create_task(registry.analyst_agent.run(["NIFTY", "BANKNIFTY", "SENSEX"])),
        asyncio.create_task(registry.signal_agent.run(["NIFTY", "BANKNIFTY", "SENSEX"])),
        asyncio.create_task(broadcast_loop()),
    ]

    return {"status": "demo_started", "mode": "Yahoo Finance (no auth)", "assets": ["NIFTY", "BANKNIFTY", "SENSEX"]}


@app.post("/start")
async def start_agents(req: StartRequest):
    if registry.running:
        return {"status": "already_running"}

    if not in_market_hours():
        logger.warning("[Main] Market is closed — agents will connect but only broadcast SSE until 9:15 AM IST")

    logger.info(f"[Main] Starting agents — env={req.env} assets={[a.name for a in req.assets]} dry_run={req.dry_run}")

    # Use the first asset's expiry as the default for DataAgent WS subscription
    default_expiry = next((a.expiry for a in req.assets if a.expiry), "")

    # 1. DataAgent
    registry.data_agent = DataAgent(
        session_token=req.session_token,
        expiry=default_expiry,
        env=req.env,
    )

    # 2. AnalystAgent (reads DataAgent state)
    registry.analyst_agent = AnalystAgent(
        state=registry.data_agent.state,
        interval_sec=5,
    )

    # 3. SignalAgent (reads AnalystAgent reports)
    registry.signal_agent = SignalAgent(
        analyst=registry.analyst_agent,
        interval_sec=10,
    )

    # 4. RiskAgent
    registry.risk_agent = RiskAgent(
        config=RiskConfig(total_capital=req.total_capital)
    )

    # 5. ExecutorAgent
    registry.executor_agent = ExecutorAgent(
        session_token=req.session_token,
        device_id=req.device_id,
        env=req.env,
        dry_run=req.dry_run,
    )

    # Wire: SignalAgent → RiskAgent → ExecutorAgent → SSE broadcast
    async def on_order(result):
        await broadcast("order_placed", {
            "success":      result.success,
            "order_id":     result.order_id,
            "order_status": result.order_status,
            "error":        result.error,
            "asset":        result.signal.asset,
            "action":       result.signal.action,
            "strike":       result.signal.strike,
            "entry":        result.signal.entry_price,
            "sl":           result.signal.sl_price,
            "target":       result.signal.target_price,
            "lots":         result.lots,
            "reason":       result.signal.reason,
        })

    async def on_signal(signal):
        # Broadcast signal to dashboard before risk check
        await broadcast("trade_signal", {
            "asset":        signal.asset,
            "action":       signal.action,
            "strike":       signal.strike,
            "entry":        signal.entry_price,
            "sl":           signal.sl_price,
            "target":       signal.target_price,
            "confidence":   signal.confidence,
            "reason":       signal.reason,
            "setup_type":   signal.setup_type,
            "rr_ratio":     signal.rr_ratio,
        })

    risk_exec_cb = make_risk_executor_callback(
        registry.risk_agent,
        registry.executor_agent,
        on_order=on_order,
    )
    registry.signal_agent.on_signal(on_signal)
    registry.signal_agent.on_signal(risk_exec_cb)

    # Launch all agent tasks with user-selected assets
    registry.running = True
    asset_names = [a.name for a in req.assets]
    registry.tasks = [
        asyncio.create_task(registry.data_agent.run()),
        asyncio.create_task(registry.analyst_agent.run(asset_names)),
        asyncio.create_task(registry.signal_agent.run(asset_names)),
        asyncio.create_task(broadcast_loop()),
    ]

    return {"status": "started", "dry_run": req.dry_run, "env": req.env, "assets": asset_names}


@app.post("/stop")
async def stop_agents():
    registry.running = False
    if registry.data_agent:    registry.data_agent.stop()
    if registry.analyst_agent: registry.analyst_agent.stop()
    if registry.signal_agent:  registry.signal_agent.stop()
    for t in registry.tasks:
        t.cancel()
    await asyncio.gather(*registry.tasks, return_exceptions=True)
    registry.tasks = []
    return {"status": "stopped"}


@app.post("/demo/stop")
async def demo_stop():
    """Stop demo mode agents."""
    return await stop_agents()


# ── SSE STREAM ────────────────────────────────────────────────────────────────

@app.get("/stream")
async def sse_stream():
    """
    Server-Sent Events endpoint.
    React dashboard connects here and receives live updates.
    """
    queue: asyncio.Queue = asyncio.Queue(maxsize=50)
    registry.sse_clients.append(queue)

    async def event_generator() -> AsyncGenerator[str, None]:
        try:
            yield "data: {\"type\":\"connected\"}\n\n"
            while True:
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=15)
                    yield f"data: {payload}\n\n"
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"   # keep-alive
        except asyncio.CancelledError:
            pass
        finally:
            if queue in registry.sse_clients:
                registry.sse_clients.remove(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":               "no-cache",
            "X-Accel-Buffering":           "no",
            "Access-Control-Allow-Origin": "*",
        },
    )


# ── SNAPSHOT ENDPOINTS ────────────────────────────────────────────────────────

@app.get("/state")
async def get_state():
    if not registry.data_agent:
        return {"error": "Agents not started"}
    return serialise_state(registry.data_agent.state)

@app.get("/signals")
async def get_signals():
    if not registry.signal_agent:
        return {}
    return {
        asset: {
            "action": s.action, "strike": s.strike,
            "entry": s.entry_price, "sl": s.sl_price, "target": s.target_price,
            "confidence": s.confidence, "reason": s.reason,
            "rr_ratio": s.rr_ratio, "setup_type": s.setup_type,
            "timestamp": s.timestamp.isoformat(),
        }
        for asset, s in registry.signal_agent.last_signals.items()
    }

@app.get("/orders")
async def get_orders():
    if not registry.executor_agent:
        return []
    return [
        {
            "success": r.success, "order_id": r.order_id,
            "order_status": r.order_status, "error": r.error,
            "asset": r.signal.asset, "action": r.signal.action,
            "entry": r.signal.entry_price, "lots": r.lots,
            "timestamp": r.timestamp.isoformat(),
        }
        for r in registry.executor_agent.order_log
    ]

@app.get("/analyst")
async def get_analyst():
    if not registry.analyst_agent:
        return {}
    out = {}
    for asset, r in registry.analyst_agent.last_reports.items():
        out[asset] = {
            "trend": r.trend, "rsi": r.rsi, "pcr": r.pcr,
            "iv_atm": r.iv_atm, "oi_direction": r.oi_direction,
            "choch": r.choch_level, "bos": r.bos_level,
            "support": r.support, "resistance": r.resistance,
            "ema9": r.ema9, "ema21": r.ema21,
            "trend_gate_pass": r.trend_gate_pass,
            "momentum_pass": r.momentum_pass,
            "structure_pass": r.structure_pass,
            "fvgs": [{"top": f.top, "bottom": f.bottom, "dir": f.direction} for f in r.fvgs],
            "obs": [{"top": o.top, "bottom": o.bottom, "dir": o.direction} for o in r.order_blocks],
        }
    return out


@app.get("/tech-signals")
async def get_tech_signals():
    """
    Returns DataFrame-friendly technical signals from the pandas-based
    AnalystAgent (RSI, MACD, Supertrend, ADX, patterns, OI walls).
    Available only when Nubra data feeds are connected.
    """
    if not registry.tech_analyst_agent:
        return {"status": "tech_analyst_not_initialized"}
    return {
        "status": "active",
        "note": "Run /demo/start or /start with active Nubra data to generate real signals",
    }


@app.get("/history/{instrument}")
async def get_history(instrument: str, timeframe: str = "5m", limit: int = 200):
    """
    Return OHLCV bars for charting.
    Priority: Nubra live data → Yahoo Finance → empty.
    """
    # 1. Try Nubra live data (when agents are running)
    bars = _fetch_real_bars(instrument, timeframe, limit)
    if bars:
        return {"bars": bars, "instrument": instrument, "timeframe": timeframe, "actual_timeframe": "1m", "source": "nubra"}

    # 2. Fall back to Yahoo Finance (run in thread to avoid blocking event loop)
    yahoo_bars = await asyncio.to_thread(_fetch_yahoo_bars, instrument, timeframe, limit)
    if yahoo_bars:
        return {"bars": yahoo_bars, "instrument": instrument, "timeframe": timeframe, "source": "yahoo"}

    return {"bars": [], "instrument": instrument, "timeframe": timeframe, "source": "none"}


def _fetch_real_bars(instrument: str, timeframe: str, limit: int):
    """Try to fetch real candle data from agent state.
    DataAgent stores candles by symbol name (e.g. 'NIFTY'), not by timeframe key."""
    _ = timeframe  # kept for signature compatibility
    if not registry.data_agent:
        return []
    state = registry.data_agent.state
    candles = state.candles.get(instrument) or []
    if not candles or not state.connected:
        return []
    return [{
        "time": c.timestamp // 1000,
        "open": c.open, "high": c.high, "low": c.low,
        "close": c.close, "volume": c.volume,
    } for c in candles[-limit:]]


@app.get("/indicators/{instrument}")
async def get_indicators(instrument: str, timeframe: str = "5m", indicators: str = ""):
    """
    Compute indicators for given instrument/timeframe.
    Priority: Nubra live data → Yahoo Finance → empty.
    Query: indicators=EMA9,EMA21,RSI(14),Bollinger Bands
    """
    data = None
    # 1. Try Nubra live data
    if registry.data_agent:
        state = registry.data_agent.state
        data = get_candles_from_state(state, instrument, timeframe)
    # 2. Fall back to Yahoo Finance
    if not data:
        data = _fetch_yahoo_data(instrument, timeframe)
    if not data:
        return {}
    names = [n.strip() for n in indicators.split(",") if n.strip()] or ["EMA9", "EMA21", "RSI(14)"]
    return compute_indicators(data, names)


@app.get("/orderflow/{instrument}")
async def orderflow(instrument: str):
    """Return OI momentum snapshot for a given instrument."""
    if not registry.data_agent or not registry.data_agent.state.option_chains:
        return {"error": "No data available"}
    chain = registry.data_agent.state.option_chains.get(instrument.upper())
    if not chain:
        return {"error": f"No chain for {instrument}"}
    momentums = compute_oi_momentum({"ce": chain.ce, "pe": chain.pe, "spot": chain.spot, "atm": chain.atm}, instrument)
    return {
        "asset": instrument,
        "spot": chain.spot,
        "concentration": momentums["concentration"],
        "pc_ratio": momentums["pc_ratio"],
        "top_bullish": momentums["top_bullish"],
        "top_bearish": momentums["top_bearish"],
        "strikes": momentums["strikes"],
    }


@app.get("/health")
async def health():
    return {
        "running":    registry.running,
        "connected":  registry.data_agent.state.connected if registry.data_agent else False,
        "market_open": in_market_hours(),
        "agents": {
            "data":     registry.data_agent is not None,
            "analyst":  registry.analyst_agent is not None,
            "signal":   registry.signal_agent is not None,
            "risk":     registry.risk_agent is not None,
            "executor": registry.executor_agent is not None,
        },
        "algo_strategies": len(registry.active_strategies),
    }


# ── ALGO TRADING ENDPOINTS ─────────────────────────────────────────────────

from pydantic import BaseModel as PydanticBase

class AlgoStrategyDef(PydanticBase):
    name: str
    conditions: dict = {}
    asset: str = "NIFTY"
    mode: str = "paper"
    interval_sec: int = 30

@dataclass
class AlgoStrategyInstance:
    name: str
    asset: str
    mode: str
    interval_sec: int
    conditions: dict
    running: bool = True
    started_at: datetime = field(default_factory=datetime.now)
    signals_generated: int = 0
    trades_executed: int = 0
    total_pnl: float = 0.0

@app.post("/algo/start")
async def algo_start(defn: AlgoStrategyDef):
    """Start an AI-gated algo strategy."""
    inst = AlgoStrategyInstance(
        name=defn.name, asset=defn.asset, mode=defn.mode,
        interval_sec=defn.interval_sec, conditions=defn.conditions,
    )
    registry.active_strategies.append(inst)
    logger.info(f"[Algo] Started: {defn.name} on {defn.asset} ({defn.mode})")
    return {"status": "started", "name": defn.name, "asset": defn.asset, "mode": defn.mode}

@app.post("/algo/stop")
async def algo_stop(name: str = ""):
    """Stop a strategy (or all if no name)."""
    if not name:
        registry.active_strategies.clear()
        return {"status": "stopped_all"}
    registry.active_strategies = [s for s in registry.active_strategies if s.name != name]
    return {"status": "stopped", "name": name}

@app.get("/algo/status")
async def algo_status():
    """List active strategies with metrics."""
    return {
        "strategies": [
            {
                "name": s.name, "asset": s.asset, "mode": s.mode,
                "running": s.running, "interval_sec": s.interval_sec,
                "signals_generated": s.signals_generated,
                "trades_executed": s.trades_executed,
                "total_pnl": s.total_pnl,
                "started_at": s.started_at.isoformat(),
            }
            for s in registry.active_strategies
        ]
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=9010, reload=False)
