"""
RiskAgent — Pure Python Capital & Risk Validator
ExecutorAgent — Nubra API Order Placer
===============================================
NO AI NEEDED. Pure deterministic logic.

RiskAgent checks BEFORE every order:
  1. Max capital per trade (configurable %)
  2. Max open positions at once
  3. Daily loss limit (stop trading if breached)
  4. SL within allowed premium % loss
  5. Lot size within margin limits

ExecutorAgent places LIMIT orders via Nubra REST API.
Nubra constraint: NEVER use MARKET orders — always LIMIT.
"""

import asyncio
import httpx
import logging
from dataclasses import dataclass, field
from typing import Optional
from datetime import datetime, date

from agents.signal_agent import TradeSignal

logger = logging.getLogger("RiskAgent/ExecutorAgent")


# ── RISK CONFIG (edit these to match your risk appetite) ─────────────────────

@dataclass
class RiskConfig:
    total_capital:       float = 100_000.0   # ₹1 lakh default
    max_trade_pct:       float = 0.05        # max 5% of capital per trade
    max_open_positions:  int   = 3           # no more than 3 concurrent trades
    daily_loss_limit:    float = 0.03        # stop for the day if down 3%
    max_sl_pct:          float = 0.30        # SL must be within 30% of entry
    min_rr:              float = 1.5         # minimum R:R ratio
    max_lots_per_trade:  int   = 2           # max lots per signal


# ── RISK REPORT ───────────────────────────────────────────────────────────────

@dataclass
class RiskCheckResult:
    approved: bool
    lots: int
    capital_at_risk: float
    reason: str


# ── RISK AGENT ────────────────────────────────────────────────────────────────

class RiskAgent:
    def __init__(self, config: RiskConfig):
        self.config          = config
        self.open_positions  = []          # list of active TradeSignal
        self.daily_pnl       = 0.0
        self.daily_date      = date.today()
        self._reset_daily_if_needed()

    def _reset_daily_if_needed(self):
        if date.today() != self.daily_date:
            logger.info("[RiskAgent] New trading day — resetting daily P&L")
            self.daily_pnl  = 0.0
            self.daily_date = date.today()

    def update_pnl(self, realized_pnl: float):
        """Call this when a position is closed"""
        self.daily_pnl += realized_pnl
        logger.info(f"[RiskAgent] Daily P&L updated: ₹{self.daily_pnl:,.0f}")

    def check(self, signal: TradeSignal) -> RiskCheckResult:
        """
        Run all risk checks. Returns RiskCheckResult.
        approved=True means ExecutorAgent can place the order.
        """
        self._reset_daily_if_needed()
        cfg = self.config

        # 1. Daily loss limit
        daily_loss_limit = cfg.total_capital * cfg.daily_loss_limit
        if self.daily_pnl < -daily_loss_limit:
            return RiskCheckResult(
                approved=False, lots=0, capital_at_risk=0,
                reason=f"Daily loss limit hit: ₹{self.daily_pnl:,.0f} < -₹{daily_loss_limit:,.0f}"
            )

        # 2. Max open positions
        if len(self.open_positions) >= cfg.max_open_positions:
            return RiskCheckResult(
                approved=False, lots=0, capital_at_risk=0,
                reason=f"Max open positions reached: {len(self.open_positions)}/{cfg.max_open_positions}"
            )

        # 3. R:R check
        if signal.rr_ratio < cfg.min_rr:
            return RiskCheckResult(
                approved=False, lots=0, capital_at_risk=0,
                reason=f"R:R too low: {signal.rr_ratio} < {cfg.min_rr} minimum"
            )

        # 4. SL sanity check
        if signal.entry_price > 0:
            sl_pct = (signal.entry_price - signal.sl_price) / signal.entry_price
            if sl_pct > cfg.max_sl_pct:
                return RiskCheckResult(
                    approved=False, lots=0, capital_at_risk=0,
                    reason=f"SL too wide: {sl_pct:.1%} > {cfg.max_sl_pct:.1%} max"
                )

        # 5. Calculate affordable lots
        max_capital = cfg.total_capital * cfg.max_trade_pct
        cost_per_lot = signal.entry_price * signal.lot_size
        if cost_per_lot <= 0:
            return RiskCheckResult(
                approved=False, lots=0, capital_at_risk=0,
                reason="Invalid entry price or lot size"
            )

        affordable_lots = int(max_capital / cost_per_lot)
        approved_lots   = min(affordable_lots, cfg.max_lots_per_trade)

        if approved_lots < 1:
            return RiskCheckResult(
                approved=False, lots=0, capital_at_risk=0,
                reason=f"Insufficient capital: need ₹{cost_per_lot:,.0f} per lot, max budget ₹{max_capital:,.0f}"
            )

        capital_at_risk = cost_per_lot * approved_lots

        logger.info(
            f"[RiskAgent] APPROVED — {signal.asset} {signal.action} "
            f"{approved_lots} lot(s) | Capital at risk: ₹{capital_at_risk:,.0f} | "
            f"R:R {signal.rr_ratio} | SL gap: {sl_pct:.1%}"
        )

        return RiskCheckResult(
            approved=True,
            lots=approved_lots,
            capital_at_risk=capital_at_risk,
            reason="All risk checks passed",
        )

    def register_open(self, signal: TradeSignal):
        self.open_positions.append(signal)

    def register_close(self, signal: TradeSignal, pnl: float):
        self.open_positions = [p for p in self.open_positions if p.ref_id != signal.ref_id]
        self.update_pnl(pnl)


# ── EXECUTOR AGENT ────────────────────────────────────────────────────────────

@dataclass
class OrderResult:
    success: bool
    order_id: Optional[str]
    order_status: Optional[str]
    error: Optional[str]
    signal: TradeSignal
    lots: int
    timestamp: datetime = field(default_factory=datetime.now)

    def __str__(self):
        if self.success:
            return (f"[ExecutorAgent] ✓ Order placed | ID: {self.order_id} | "
                    f"Status: {self.order_status} | {self.signal.action} "
                    f"{self.lots} lot(s) @ ₹{self.signal.entry_price}")
        return f"[ExecutorAgent] ✗ Order FAILED: {self.error}"


class ExecutorAgent:
    def __init__(
        self,
        session_token: str,
        device_id: str = "TS123",
        env: str = "UAT",
        backend_url: str = "http://localhost:8000",
        dry_run: bool = True,    # ← SAFETY: set to False only for live trading
    ):
        self.token       = session_token
        self.device_id   = device_id
        self.env         = env
        self.backend_url = backend_url
        self.dry_run     = dry_run
        self.order_log: list[OrderResult] = []

        if dry_run:
            logger.warning("[ExecutorAgent] DRY RUN MODE — no real orders will be placed")

    async def place(self, signal: TradeSignal, lots: int) -> OrderResult:
        """
        Place a LIMIT order via Nubra API through the FastAPI backend.
        Always LIMIT — never MARKET (Nubra constraint).
        """
        if self.dry_run:
            logger.info(f"[ExecutorAgent] DRY RUN: Would place {signal.action} "
                        f"{lots} lot(s) of {signal.asset} "
                        f"@ ₹{signal.entry_price} | ref_id: {signal.ref_id}")
            result = OrderResult(
                success=True,
                order_id=f"DRY_{signal.ref_id}_{int(datetime.now().timestamp())}",
                order_status="DRY_RUN_SIMULATED",
                error=None,
                signal=signal,
                lots=lots,
            )
            self.order_log.append(result)
            return result

        order_side = "ORDER_SIDE_BUY" if "BUY" in signal.action else "ORDER_SIDE_SELL"

        # Nubra: prices in PAISE
        order_price_paise   = int(signal.entry_price * 100)
        trigger_price_paise = int(signal.sl_price * 100) if signal.sl_price else None

        payload = {
            "ref_id":              signal.ref_id,
            "order_type":          "ORDER_TYPE_STOPLOSS" if trigger_price_paise else "ORDER_TYPE_REGULAR",
            "order_qty":           lots * signal.lot_size,
            "order_side":          order_side,
            "order_delivery_type": "ORDER_DELIVERY_TYPE_IDAY",
            "validity_type":       "DAY",
            "order_price":         order_price_paise,
            "trigger_price":       trigger_price_paise,
            "tag":                 "realswing_scalp",
            "session_token":       self.token,
            "device_id":           self.device_id,
            "env":                 self.env,
        }

        try:
            async with httpx.AsyncClient(timeout=8) as client:
                r = await client.post(f"{self.backend_url}/trade/order", json=payload)
                data = r.json()
                if r.status_code == 200:
                    result = OrderResult(
                        success=True,
                        order_id=str(data.get("order_id", "")),
                        order_status=data.get("order_status", "UNKNOWN"),
                        error=None,
                        signal=signal,
                        lots=lots,
                    )
                else:
                    result = OrderResult(
                        success=False, order_id=None, order_status=None,
                        error=data.get("detail", f"HTTP {r.status_code}"),
                        signal=signal, lots=lots,
                    )
        except Exception as e:
            result = OrderResult(
                success=False, order_id=None, order_status=None,
                error=str(e), signal=signal, lots=lots,
            )

        logger.info(str(result))
        self.order_log.append(result)
        return result


# ── COMBINED PIPELINE CALLBACK ────────────────────────────────────────────────

def make_risk_executor_callback(risk: RiskAgent, executor: ExecutorAgent, on_order=None):
    """
    Returns an async callback for SignalAgent.on_signal().
    When SignalAgent fires a signal → RiskAgent checks → ExecutorAgent places.
    """
    async def callback(signal: TradeSignal):
        risk_result = risk.check(signal)

        if not risk_result.approved:
            logger.warning(f"[RiskAgent] REJECTED: {risk_result.reason}")
            return

        result = await executor.place(signal, risk_result.lots)

        if result.success:
            risk.register_open(signal)
            if on_order:
                await on_order(result)

    return callback
