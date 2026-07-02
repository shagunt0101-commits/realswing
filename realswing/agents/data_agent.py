"""
DataAgent — Nubra WebSocket Live Market Feed
=============================================
Connects to wss://uatapi.nubra.io/apibatch/ws
Subscribes to:
  - index        : NIFTY / BANKNIFTY / SENSEX live LTP ticks
  - index_bucket : 5m OHLCV candles for trend analysis
  - option       : Full option chain updates (ATM ± 10 strikes)

WebSocket message format (Nubra):
  batch_subscribe [session_token] <channel> <json_payload> [exchange]

All prices from Nubra are in PAISE → divide by 100 for rupees.
Parsed data is stored in a shared MarketState object that all
other agents read from.
"""

import asyncio
import json
import websockets
import logging
from dataclasses import dataclass, field
from typing import Optional
from datetime import datetime

logger = logging.getLogger("DataAgent")

UAT_WS  = "wss://uatapi.nubra.io/apibatch/ws"
PROD_WS = "wss://api.nubra.io/apibatch/ws"


# ── SHARED MARKET STATE (read by all agents) ──────────────────────────────────

@dataclass
class IndexTick:
    symbol: str
    ltp: float          # in rupees
    prev_close: float
    change_pct: float
    volume: int
    timestamp: int

@dataclass
class OHLCVCandle:
    symbol: str
    interval: str
    open: float
    high: float
    low: float
    close: float
    volume: int
    timestamp: int

@dataclass
class OptionStrike:
    strike: float
    ref_id: int
    lot_size: int
    ltp: float
    iv: float
    delta: float
    theta: float
    oi: int
    volume: int
    prev_oi: int

@dataclass
class OptionChainSnapshot:
    asset: str
    expiry: str
    exchange: str
    spot: float         # currentprice in rupees
    atm: float          # atm strike in rupees
    ce: list[OptionStrike] = field(default_factory=list)
    pe: list[OptionStrike] = field(default_factory=list)
    timestamp: datetime = field(default_factory=datetime.now)

@dataclass
class MarketState:
    """
    Single source of truth for all agents.
    Updated by DataAgent, read by AnalystAgent and SignalAgent.
    """
    # Live index ticks
    nifty:     Optional[IndexTick] = None
    banknifty: Optional[IndexTick] = None
    sensex:    Optional[IndexTick] = None

    # OHLCV candle history per symbol (last 50 candles)
    candles: dict = field(default_factory=lambda: {
        "NIFTY": [], "BANKNIFTY": [], "SENSEX": []
    })

    # Option chain snapshots
    option_chains: dict = field(default_factory=dict)

    # Connection status
    connected: bool = False
    last_update: Optional[datetime] = None

    def get_chain(self, asset: str) -> Optional[OptionChainSnapshot]:
        return self.option_chains.get(asset)

    def get_atm_options(self, asset: str):
        """Returns (atm_ce, atm_pe) OptionStrike objects or (None, None)"""
        chain = self.get_chain(asset)
        if not chain:
            return None, None
        atm_ce = min(chain.ce, key=lambda x: abs(x.strike - chain.atm), default=None)
        atm_pe = min(chain.pe, key=lambda x: abs(x.strike - chain.atm), default=None)
        return atm_ce, atm_pe


# ── DATA AGENT ────────────────────────────────────────────────────────────────

class DataAgent:
    def __init__(self, session_token: str, expiry: str, env: str = "UAT"):
        self.token   = session_token
        self.expiry  = expiry          # e.g. "20250627"
        self.env     = env
        self.ws_url  = UAT_WS if env == "UAT" else PROD_WS
        self.state   = MarketState()
        self._ws     = None
        self._running = False

    # ── Subscribe helpers ──────────────────────────────────────────────────────

    def _sub_index(self) -> str:
        """Subscribe to live LTP for NIFTY, BANKNIFTY, SENSEX"""
        nse_payload = json.dumps({"indexes": ["NIFTY", "BANKNIFTY"]}, separators=(',', ':'))
        bse_payload = json.dumps({"indexes": ["SENSEX"]}, separators=(',', ':'))
        return [
            f"batch_subscribe {self.token} index {nse_payload} NSE",
            f"batch_subscribe {self.token} index {bse_payload} BSE",
        ]

    def _sub_ohlcv(self) -> list[str]:
        """Subscribe to 5m OHLCV candles"""
        nse = json.dumps({"indexes": ["NIFTY", "BANKNIFTY"]}, separators=(',', ':'))
        bse = json.dumps({"indexes": ["SENSEX"]}, separators=(',', ':'))
        return [
            f"batch_subscribe {self.token} index_bucket {nse} 5m NSE",
            f"batch_subscribe {self.token} index_bucket {bse} 5m BSE",
        ]

    def _sub_option_chain(self) -> list[str]:
        """Subscribe to option chain for NIFTY + BANKNIFTY + SENSEX"""
        chains = json.dumps([
            {"exchange": "NSE", "asset": "NIFTY",     "expiry": self.expiry},
            {"exchange": "NSE", "asset": "BANKNIFTY",  "expiry": self.expiry},
            {"exchange": "BSE", "asset": "SENSEX",    "expiry": self.expiry},
        ], separators=(',', ':'))
        return [f"batch_subscribe {self.token} option {chains}"]

    # ── Message parsers ───────────────────────────────────────────────────────

    def _parse_index(self, data: dict):
        """Parse index tick — prices in paise, divide by 100"""
        for idx in data.get("indexes", []):
            tick = IndexTick(
                symbol      = idx["indexname"],
                ltp         = idx["index_value"] / 100,
                prev_close  = idx.get("prev_close", 0) / 100,
                change_pct  = idx.get("changepercent", 0.0),
                volume      = idx.get("volume", 0),
                timestamp   = idx.get("timestamp", 0),
            )
            sym = tick.symbol.upper()
            if "BANKNIFTY" in sym:
                self.state.banknifty = tick
            elif "NIFTY" in sym:
                self.state.nifty = tick
            elif "SENSEX" in sym:
                self.state.sensex = tick

    def _parse_ohlcv(self, data: dict):
        """Parse 5m candle — prices in paise"""
        for bucket in data.get("indexes", []):
            candle = OHLCVCandle(
                symbol    = bucket["indexname"],
                interval  = str(bucket.get("interval", "5m")),
                open      = bucket["open"]  / 100,
                high      = bucket["high"]  / 100,
                low       = bucket["low"]   / 100,
                close     = bucket["close"] / 100,
                volume    = bucket.get("bucket_volume", 0),
                timestamp = bucket.get("bucket_timestamp", 0),
            )
            sym = candle.symbol.upper()
            if sym in self.state.candles:
                hist = self.state.candles[sym]
                # Avoid duplicate candles (same bucket_timestamp)
                if not hist or hist[-1].timestamp != candle.timestamp:
                    hist.append(candle)
                    if len(hist) > 50:
                        hist.pop(0)
                else:
                    hist[-1] = candle  # update last candle in progress

    def _parse_option_chain(self, data: dict):
        """Parse full option chain update"""
        asset    = data.get("asset", "")
        expiry   = data.get("expiry", "")
        exchange = data.get("exchange", "NSE")
        spot     = data.get("currentprice", 0) / 100
        atm      = data.get("atm", 0) / 100

        def parse_strikes(items) -> list[OptionStrike]:
            strikes = []
            for s in items:
                strikes.append(OptionStrike(
                    strike   = s.get("sp", 0) / 100,
                    ref_id   = s.get("ref_id", 0),
                    lot_size = s.get("ls", 1),
                    ltp      = s.get("ltp", 0) / 100,
                    iv       = s.get("iv", 0.0),
                    delta    = s.get("delta", 0.0),
                    theta    = s.get("theta", 0.0),
                    oi       = s.get("oi", 0),
                    volume   = s.get("volume", 0),
                    prev_oi  = s.get("prev_oi", 0),
                ))
            return sorted(strikes, key=lambda x: x.strike)

        chain = OptionChainSnapshot(
            asset    = asset,
            expiry   = expiry,
            exchange = exchange,
            spot     = spot,
            atm      = atm,
            ce       = parse_strikes(data.get("ce", [])),
            pe       = parse_strikes(data.get("pe", [])),
        )
        self.state.option_chains[asset] = chain
        logger.debug(f"[DataAgent] Option chain updated: {asset} spot={spot} atm={atm}")

    def _dispatch(self, raw: str):
        """Route incoming WebSocket message to correct parser"""
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            return  # Nubra sometimes sends plain-text ack messages

        key = msg.get("key", "")

        if key == "index":
            self._parse_index(msg.get("data", {}))
        elif key == "index_bucket":
            self._parse_ohlcv(msg.get("data", {}))
        elif key == "option":
            self._parse_option_chain(msg.get("data", {}))
        # orderbook / greeks can be added here later

        self.state.last_update = datetime.now()

    # ── Main WebSocket loop ────────────────────────────────────────────────────

    async def run(self):
        """Connect to Nubra WebSocket and keep running. Reconnects on drop."""
        self._running = True
        while self._running:
            try:
                logger.info(f"[DataAgent] Connecting to {self.ws_url}")
                async with websockets.connect(self.ws_url, ping_interval=20) as ws:
                    self._ws = ws
                    self.state.connected = True
                    logger.info("[DataAgent] Connected ✓")

                    # Send all subscriptions
                    subs = (
                        self._sub_index() +
                        self._sub_ohlcv() +
                        self._sub_option_chain()
                    )
                    for sub in subs:
                        await ws.send(sub)
                        logger.debug(f"[DataAgent] Sent: {sub[:80]}...")
                        await asyncio.sleep(0.1)

                    # Listen forever — handle binary frames (Nubra sometimes sends binary)
                    async for message in ws:
                        if isinstance(message, bytes):
                            try:
                                text = message.decode('utf-8')
                            except UnicodeDecodeError:
                                try:
                                    text = message.decode('latin-1')
                                except Exception:
                                    logger.debug(f"[DataAgent] Skipping unparseable binary frame: {len(message)} bytes")
                                    continue
                        else:
                            text = message
                        self._dispatch(text)

            except websockets.ConnectionClosed:
                logger.warning("[DataAgent] Connection closed, reconnecting in 3s...")
            except Exception as e:
                logger.error(f"[DataAgent] Error: {e}, reconnecting in 5s...")
                await asyncio.sleep(2)
            finally:
                self.state.connected = False
                await asyncio.sleep(3)

    def stop(self):
        self._running = False
        if self._ws:
            asyncio.create_task(self._ws.close())
