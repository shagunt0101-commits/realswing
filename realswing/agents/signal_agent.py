"""
SignalAgent — 9Router AI Trade Decision Engine
==============================================
Uses 9Router (https://github.com/decolua/9router) to call
Claude/GPT/Gemini for free via its OpenAI-compatible endpoint.

WHY 9ROUTER?
  - Free — routes through Claude Code OAuth, Kiro, Gemini CLI,
    Codex, GitHub Copilot and 40+ other providers automatically
  - OpenAI-compatible API — same format as any OpenAI call
  - Auto-fallback — if one provider quota runs out, switches
    to next automatically. Never stops working.
  - RTK token compression — cuts ~40% of tokens automatically
  - Runs locally on your machine at http://localhost:20128

SETUP (one time):
  Option A — Docker (easiest):
    docker run -d --name 9router -p 20128:20128 \\
      -v ~/.9router:/data decolua/9router

  Option B — npm:
    git clone https://github.com/decolua/9router
    cd 9router && npm install && npm run dev

  Then:
    1. Open http://localhost:20128
    2. Go to Providers → Connect Kiro AI (free, no sign-up)
       or Claude Code (OAuth with your subscription)
    3. Go to Endpoint → copy your API key (starts with 9r_...)
    4. Paste it in NINE_ROUTER_API_KEY below

HOW IT WORKS:
  1. AnalystAgent produces an AnalystReport every 5s
  2. SignalAgent checks: did all 3 gates pass?
  3. If yes → builds a structured prompt with market context
  4. Sends to 9Router → auto-routes to best free provider
  5. Gets JSON trade decision back
  6. RiskAgent validates before ExecutorAgent places order

The prompt forces JSON output so we can parse it reliably.
"""

import asyncio
import json
import logging
import os
import httpx
from dataclasses import dataclass, field
from typing import Optional
from datetime import datetime

from agents.analyst_agent import AnalystAgent, AnalystReport

logger = logging.getLogger("SignalAgent")

# ── 9ROUTER CONFIG ────────────────────────────────────────────────────────────
# Get your API key from 9Router dashboard → Endpoint tab
# Or set env var: export NINE_ROUTER_API_KEY="9r_yourkey"

NINE_ROUTER_BASE = os.getenv("NINE_ROUTER_BASE", "http://localhost:20128/v1")
NINE_ROUTER_KEY  = os.getenv("NINE_ROUTER_API_KEY", "9r_paste_your_key_here")

# Model to use — 9Router model strings:
#   kr/claude-sonnet-4-5     ← Kiro (free Claude, recommended)
#   cc/claude-sonnet-4-6     ← Claude Code subscription
#   of/chatgpt-4o-latest     ← OpenCode Free (free GPT-4o)
#   glm/glm-4-flash          ← GLM (ultra cheap fallback $0.01/1M)
# Or create a Combo in the dashboard for auto-fallback across all of these.
NINE_ROUTER_MODEL = os.getenv("NINE_ROUTER_MODEL", "kr/claude-sonnet-4-5")


# ── OUTPUT DATACLASS ──────────────────────────────────────────────────────────

@dataclass
class TradeSignal:
    asset: str
    action: str             # "BUY_CE" | "BUY_PE" | "WAIT"
    strike: float           # chosen strike price
    ref_id: int             # Nubra ref_id from option chain
    lot_size: int
    entry_price: float      # suggested limit price (LTP of chosen strike)
    sl_price: float         # stop loss price
    target_price: float     # target price
    confidence: str         # "HIGH" | "MEDIUM" | "LOW"
    reason: str             # AI's reasoning (1-2 sentences)
    setup_type: str         # "HERO_ZERO" | "SCALP" | "MOMENTUM"
    rr_ratio: float         # reward:risk
    timestamp: datetime = field(default_factory=datetime.now)

    def __str__(self):
        return (
            f"[SignalAgent] {self.action} {self.asset} "
            f"{self.strike:.0f} {'CE' if 'CE' in self.action else 'PE'} "
            f"@ ₹{self.entry_price:.2f} | SL: ₹{self.sl_price:.2f} | "
            f"Target: ₹{self.target_price:.2f} | R:R {self.rr_ratio:.1f} | "
            f"{self.confidence} confidence | {self.setup_type}"
        )


# ── PROMPT BUILDER ────────────────────────────────────────────────────────────

def build_prompt(report: AnalystReport, chain_snapshot) -> str:
    """
    Build a structured prompt for Ollama.
    We want deterministic JSON output — not narrative.
    """
    # Get top 3 strikes near ATM for context
    atm = report.atm
    ce_strikes = sorted(chain_snapshot.ce, key=lambda x: abs(x.strike - atm))[:5]
    pe_strikes = sorted(chain_snapshot.pe, key=lambda x: abs(x.strike - atm))[:5]

    ce_info = [{"strike": s.strike, "ltp": s.ltp, "iv": s.iv, "delta": s.delta, "oi": s.oi, "ref_id": s.ref_id, "lot_size": s.lot_size} for s in ce_strikes]
    pe_info = [{"strike": s.strike, "ltp": s.ltp, "iv": s.iv, "delta": s.delta, "oi": s.oi, "ref_id": s.ref_id, "lot_size": s.lot_size} for s in pe_strikes]

    fvg_info = [{"top": f.top, "bottom": f.bottom, "dir": f.direction} for f in report.fvgs]
    ob_info  = [{"top": o.top, "bottom": o.bottom, "dir": o.direction} for o in report.order_blocks]

    prompt = f"""You are an expert Indian F&O scalping trader specialising in NSE/BSE options.
Your job: analyse this market context and decide whether to trade, and if so, which strike.

MARKET CONTEXT:
- Asset: {report.asset}
- Spot: {report.spot}
- ATM Strike: {report.atm}
- Trend (EMA9 vs EMA21): {report.trend} (EMA9={report.ema9}, EMA21={report.ema21})
- RSI(14): {report.rsi}
- Put/Call Ratio: {report.pcr}
- ATM IV: {report.iv_atm}%
- OI Direction: {report.oi_direction}
- CHoCH Level: {report.choch_level}
- BOS Level: {report.bos_level}
- Support: {report.support} | Resistance: {report.resistance}
- FVGs detected: {json.dumps(fvg_info)}
- Order Blocks: {json.dumps(ob_info)}

AVAILABLE CE STRIKES (near ATM):
{json.dumps(ce_info, indent=2)}

AVAILABLE PE STRIKES (near ATM):
{json.dumps(pe_info, indent=2)}

TRADING RULES (non-negotiable):
1. Only trade when trend is clear (BULLISH or BEARISH), NOT SIDEWAYS
2. For BEARISH trend → buy PE. For BULLISH trend → buy CE
3. Prefer strikes with delta 0.35–0.55 (near ATM but not deep ITM)
4. SL = entry_price × 0.75 (25% of premium)
5. Target = entry_price × 2.0 (2x the premium = Hero-Zero setup)
6. Minimum R:R must be 1.5
7. If IV > 20%, be extra cautious — high premium decay
8. If RSI is extreme (>75 or <25), momentum may reverse — prefer WAIT

RESPOND ONLY WITH THIS EXACT JSON (no explanation, no markdown, no extra text):
{{
  "action": "BUY_CE" | "BUY_PE" | "WAIT",
  "strike": <strike price as number, 0 if WAIT>,
  "ref_id": <ref_id from options above, 0 if WAIT>,
  "lot_size": <lot_size from options above, 0 if WAIT>,
  "entry_price": <suggested limit price in rupees, 0 if WAIT>,
  "sl_price": <stop loss in rupees, 0 if WAIT>,
  "target_price": <target in rupees, 0 if WAIT>,
  "setup_type": "HERO_ZERO" | "SCALP" | "MOMENTUM" | "NONE",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "reason": "<one sentence explaining your decision>"
}}"""

    return prompt


# ── 9ROUTER CALLER ───────────────────────────────────────────────────────────

async def call_9router(prompt: str, timeout: int = 30) -> Optional[dict]:
    """
    Call 9Router's OpenAI-compatible /v1/chat/completions endpoint.
    9Router auto-routes to best available free provider (Kiro, Claude Code,
    OpenCode Free, etc.) and falls back automatically if one hits quota.
    Returns parsed JSON dict or None on failure.
    """
    raw = ""
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(
                f"{NINE_ROUTER_BASE}/chat/completions",
                headers={
                    "Authorization": f"Bearer {NINE_ROUTER_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": NINE_ROUTER_MODEL,
                    "messages": [
                        {
                            "role": "system",
                            "content": (
                                "You are an expert Indian F&O scalping trader. "
                                "You ALWAYS respond with valid JSON only. "
                                "No explanation, no markdown, no extra text — pure JSON."
                            ),
                        },
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.1,    # low = deterministic trading decisions
                    "max_tokens": 400,
                    "stream": False,
                },
            )
            r.raise_for_status()
            raw = r.json()["choices"][0]["message"]["content"]
            # Strip any accidental markdown fences the model adds
            clean = (
                raw.strip()
                .removeprefix("```json")
                .removeprefix("```")
                .removesuffix("```")
                .strip()
            )
            return json.loads(clean)

    except json.JSONDecodeError as e:
        logger.error(f"[SignalAgent] JSON parse error: {e} | Raw: {raw[:300]}")
        return None
    except httpx.ConnectError:
        logger.error(
            "[SignalAgent] Cannot connect to 9Router at "
            f"{NINE_ROUTER_BASE}. Is it running? "
            "Start with: docker run -p 20128:20128 decolua/9router"
        )
        return None
    except httpx.HTTPStatusError as e:
        logger.error(f"[SignalAgent] 9Router HTTP {e.response.status_code}: {e.response.text[:200]}")
        return None
    except Exception as e:
        logger.error(f"[SignalAgent] 9Router call failed: {e}")
        return None


# ── SIGNAL AGENT ──────────────────────────────────────────────────────────────

class SignalAgent:
    def __init__(self, analyst: AnalystAgent, interval_sec: int = 10):
        self.analyst      = analyst
        self.interval     = interval_sec
        self.last_signals: dict[str, TradeSignal] = {}
        self._running     = False
        # Callbacks registered by other components (e.g. RiskAgent, dashboard)
        self._on_signal_callbacks = []

    def on_signal(self, callback):
        """Register a callback: fn(signal: TradeSignal)"""
        self._on_signal_callbacks.append(callback)

    async def evaluate(self, asset: str) -> Optional[TradeSignal]:
        """
        Check if AnalystReport passes all gates,
        then ask Ollama for a trade decision.
        """
        report = self.analyst.last_reports.get(asset)
        if not report:
            return None

        # Pre-filter: all 3 gates must pass before wasting a 9Router call
        if not (report.trend_gate_pass and report.momentum_pass and report.structure_pass):
            logger.debug(
                f"[SignalAgent] {asset} gates not passed — "
                f"Trend:{report.trend_gate_pass} Mom:{report.momentum_pass} Struct:{report.structure_pass}"
            )
            return None

        chain = self.analyst.state.option_chains.get(asset)
        if not chain:
            return None

        logger.info(f"[SignalAgent] All gates passed for {asset} — calling 9Router ({NINE_ROUTER_MODEL})...")

        prompt   = build_prompt(report, chain)
        decision = await call_9router(prompt)

        if not decision:
            return None

        action = decision.get("action", "WAIT")
        if action == "WAIT":
            logger.info(f"[SignalAgent] Ollama says WAIT for {asset}: {decision.get('reason')}")
            return None

        # Build TradeSignal from Ollama decision
        entry  = float(decision.get("entry_price", 0))
        sl     = float(decision.get("sl_price", 0))
        target = float(decision.get("target_price", 0))
        rr     = round((target - entry) / max(entry - sl, 0.01), 2) if entry > sl else 0

        signal = TradeSignal(
            asset        = asset,
            action       = action,
            strike       = float(decision.get("strike", 0)),
            ref_id       = int(decision.get("ref_id", 0)),
            lot_size     = int(decision.get("lot_size", 1)),
            entry_price  = entry,
            sl_price     = sl,
            target_price = target,
            confidence   = decision.get("confidence", "LOW"),
            reason       = decision.get("reason", ""),
            setup_type   = decision.get("setup_type", "SCALP"),
            rr_ratio     = rr,
        )

        # Skip LOW confidence signals
        if signal.confidence == "LOW":
            logger.info(f"[SignalAgent] LOW confidence, skipping: {signal}")
            return None

        # Skip bad R:R
        if signal.rr_ratio < 1.5:
            logger.info(f"[SignalAgent] R:R too low ({signal.rr_ratio}), skipping")
            return None

        logger.info(f"[SignalAgent] SIGNAL: {signal}")
        self.last_signals[asset] = signal

        # Fire callbacks (RiskAgent, dashboard SSE, etc.)
        for cb in self._on_signal_callbacks:
            try:
                await cb(signal)
            except Exception as e:
                logger.error(f"[SignalAgent] Callback error: {e}")

        return signal

    async def run(self, assets: list[str] = None):
        """Evaluate all assets every N seconds"""
        assets = assets or ["NIFTY", "BANKNIFTY", "SENSEX"]
        self._running = True
        logger.info(f"[SignalAgent] Started — evaluating {assets} every {self.interval}s")
        while self._running:
            for asset in assets:
                try:
                    await self.evaluate(asset)
                except Exception as e:
                    logger.error(f"[SignalAgent] Error evaluating {asset}: {e}")
            await asyncio.sleep(self.interval)

    def stop(self):
        self._running = False