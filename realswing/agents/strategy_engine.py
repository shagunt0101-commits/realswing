"""Strategy Engine — Options strategy construction, pricing, risk.

Provides Leg/Strategy datamodels, 10 strategy templates, payoff
computation (vollib BS), net Greeks, POP, and what-if overrides.

Import: from agents.strategy_engine import *
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional, Sequence, Tuple

from vollib.black_scholes import black_scholes as _bs
from vollib.black_scholes.greeks.analytical import (
    delta as _delta,
    gamma as _gamma,
    theta as _theta,
    vega as _vega,
)

# ---------------------------------------------------------------------------
# Normal CDF — scipy preferred, math.erf fallback
# ---------------------------------------------------------------------------
try:
    from scipy.stats import norm as _norm
    _NORM_CDF = lambda x: float(_norm.cdf(x))  # noqa: E731
    HAS_SCIPY = True
except ImportError:
    def _NORM_CDF(x: float) -> float:
        return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))
    HAS_SCIPY = False

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
RISK_FREE_RATE: float = 0.065         # India risk-free (matches report_agent)
BASE_STRIKE_STEP: float = 50.0        # default step for NIFTY
DEFAULT_QTY: int = 1


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------
class OptionType(str, Enum):
    CE = "CE"
    PE = "PE"


class Action(str, Enum):
    BUY = "BUY"
    SELL = "SELL"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _flag(ot: Optional[OptionType]) -> str:
    if ot is None:
        return "u"  # underlying
    return "c" if ot == OptionType.CE else "p"


def _direction(a: Action) -> int:
    return 1 if a == Action.BUY else -1


def _round_strike(price: float, step: float = BASE_STRIKE_STEP) -> float:
    return round(price / step) * step


def days_to_expiry(expiry: str) -> int:
    """Calendar days between today and expiry YYYYMMDD."""
    exp = datetime.strptime(expiry, "%Y%m%d")
    return max((exp - datetime.now()).days, 0)


def _tte_years(dte: int) -> float:
    """Convert days to years (min 0.5 day floor)."""
    return max(max(dte, 0), 0.5) / 365.0


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------
@dataclass
class Leg:
    strike: float
    option_type: Optional[OptionType]  # None = underlying position
    action: Action
    expiry: str                        # YYYYMMDD
    quantity: int = DEFAULT_QTY
    entry_price: Optional[float] = None


@dataclass
class Strategy:
    name: str
    underlying: str
    legs: List[Leg] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.now)


# ---------------------------------------------------------------------------
# Intra-leg helpers (payoff)
# ---------------------------------------------------------------------------
def _intrinsic(leg: Leg, spot: float) -> float:
    """Intrinsic value at expiry for one unit of a leg."""
    if leg.option_type is None:
        return spot  # underlying: value = spot
    if leg.option_type == OptionType.CE:
        return max(0.0, spot - leg.strike)
    return max(0.0, leg.strike - spot)


def _bs_price(leg: Leg, spot: float, iv: float, t: float) -> float:
    """Black-Scholes price for one unit."""
    if leg.option_type is None:
        return spot  # underlying tracks spot
    return _bs(_flag(leg.option_type), spot, leg.strike, t, RISK_FREE_RATE, iv)


def _greek(fn, leg: Leg, spot: float, iv: float, t: float) -> float:
    """Compute a single Greek for a leg (or 1.0/0.0 for underlying)."""
    if leg.option_type is None:
        # Underlying: delta=1, gamma=theta=vega=0
        return 1.0 if fn is _delta else 0.0
    return fn(_flag(leg.option_type), spot, leg.strike, t, RISK_FREE_RATE, iv)


# ===========================================================================
# Strategy Templates — (spot, params?) -> List[Leg]
# ===========================================================================
# Each template accepts optional params dict keys:
#   expiry (str YYYYMMDD), qty (int), strike_step (float),
#   otm_distance (float strikes), wing1/wing2 (float strikes),
#   wing (float), ref_price (float for entry)

def bull_call_spread(spot: float, params: Optional[Dict] = None) -> List[Leg]:
    """BUY ATM-1 CE, SELL ATM+1 CE.  Bullish debit spread."""
    p = {**(params or {})}
    s = p.get("strike_step", BASE_STRIKE_STEP)
    atm = _round_strike(spot, s)
    exp = p.get("expiry", "99991231")
    q = p.get("qty", DEFAULT_QTY)
    return [
        Leg(strike=atm - s, option_type=OptionType.CE, action=Action.BUY,
            expiry=exp, quantity=q, entry_price=p.get("ref_price")),
        Leg(strike=atm + s, option_type=OptionType.CE, action=Action.SELL,
            expiry=exp, quantity=q, entry_price=p.get("ref_price")),
    ]


def bear_put_spread(spot: float, params: Optional[Dict] = None) -> List[Leg]:
    """BUY ATM+1 PE, SELL ATM-1 PE.  Bearish debit spread."""
    p = {**(params or {})}
    s = p.get("strike_step", BASE_STRIKE_STEP)
    atm = _round_strike(spot, s)
    exp = p.get("expiry", "99991231")
    q = p.get("qty", DEFAULT_QTY)
    return [
        Leg(strike=atm + s, option_type=OptionType.PE, action=Action.BUY,
            expiry=exp, quantity=q, entry_price=p.get("ref_price")),
        Leg(strike=atm - s, option_type=OptionType.PE, action=Action.SELL,
            expiry=exp, quantity=q, entry_price=p.get("ref_price")),
    ]


def straddle(spot: float, params: Optional[Dict] = None) -> List[Leg]:
    """BUY ATM CE, BUY ATM PE.  Long volatility — profit from large moves."""
    p = {**(params or {})}
    s = p.get("strike_step", BASE_STRIKE_STEP)
    atm = _round_strike(spot, s)
    exp = p.get("expiry", "99991231")
    q = p.get("qty", DEFAULT_QTY)
    return [
        Leg(strike=atm, option_type=OptionType.CE, action=Action.BUY,
            expiry=exp, quantity=q, entry_price=p.get("ref_price")),
        Leg(strike=atm, option_type=OptionType.PE, action=Action.BUY,
            expiry=exp, quantity=q, entry_price=p.get("ref_price")),
    ]


def strangle(spot: float, params: Optional[Dict] = None) -> List[Leg]:
    """BUY OTM CE, BUY OTM PE.  Long volatility — cheaper than straddle."""
    p = {**(params or {})}
    s = p.get("strike_step", BASE_STRIKE_STEP)
    d = p.get("otm_distance", 2.0)
    atm = _round_strike(spot, s)
    exp = p.get("expiry", "99991231")
    q = p.get("qty", DEFAULT_QTY)
    return [
        Leg(strike=atm + d * s, option_type=OptionType.CE, action=Action.BUY,
            expiry=exp, quantity=q, entry_price=p.get("ref_price")),
        Leg(strike=atm - d * s, option_type=OptionType.PE, action=Action.BUY,
            expiry=exp, quantity=q, entry_price=p.get("ref_price")),
    ]


def iron_condor(spot: float, params: Optional[Dict] = None) -> List[Leg]:
    """BUY OTM+W2 PE, SELL OTM+W1 PE, SELL OTM-W1 CE, BUY OTM-W2 CE.
    Neutral credit spread — max profit between inner strikes.
    """
    p = {**(params or {})}
    s = p.get("strike_step", BASE_STRIKE_STEP)
    w1 = p.get("wing1", 1.0)
    w2 = p.get("wing2", 2.0)
    atm = _round_strike(spot, s)
    exp = p.get("expiry", "99991231")
    q = p.get("qty", DEFAULT_QTY)
    rp = p.get("ref_price")
    return [
        Leg(strike=atm - w2 * s, option_type=OptionType.PE, action=Action.BUY,
            expiry=exp, quantity=q, entry_price=rp),
        Leg(strike=atm - w1 * s, option_type=OptionType.PE, action=Action.SELL,
            expiry=exp, quantity=q, entry_price=rp),
        Leg(strike=atm + w1 * s, option_type=OptionType.CE, action=Action.SELL,
            expiry=exp, quantity=q, entry_price=rp),
        Leg(strike=atm + w2 * s, option_type=OptionType.CE, action=Action.BUY,
            expiry=exp, quantity=q, entry_price=rp),
    ]


def iron_butterfly(spot: float, params: Optional[Dict] = None) -> List[Leg]:
    """BUY ATM-W PE, SELL ATM PE x2, BUY ATM+W PE.  Put fly — short vol."""
    p = {**(params or {})}
    s = p.get("strike_step", BASE_STRIKE_STEP)
    w = p.get("wing", 1.0)
    atm = _round_strike(spot, s)
    exp = p.get("expiry", "99991231")
    q = p.get("qty", DEFAULT_QTY)
    rp = p.get("ref_price")
    return [
        Leg(strike=atm - w * s, option_type=OptionType.PE, action=Action.BUY,
            expiry=exp, quantity=q, entry_price=rp),
        Leg(strike=atm, option_type=OptionType.PE, action=Action.SELL,
            expiry=exp, quantity=q * 2, entry_price=rp),
        Leg(strike=atm + w * s, option_type=OptionType.PE, action=Action.BUY,
            expiry=exp, quantity=q, entry_price=rp),
    ]


def covered_call(spot: float, params: Optional[Dict] = None) -> List[Leg]:
    """BUY 100 underlying, SELL OTM CE.  Income strategy — caps upside."""
    p = {**(params or {})}
    s = p.get("strike_step", BASE_STRIKE_STEP)
    d = p.get("otm_distance", 1.0)
    atm = _round_strike(spot, s)
    exp = p.get("expiry", "99991231")
    q = p.get("qty", DEFAULT_QTY)
    rp = p.get("ref_price")
    return [
        Leg(strike=atm, option_type=None, action=Action.BUY,  # underlying
            expiry=exp, quantity=100, entry_price=rp),
        Leg(strike=atm + d * s, option_type=OptionType.CE, action=Action.SELL,
            expiry=exp, quantity=q, entry_price=rp),
    ]


def bull_put_spread(spot: float, params: Optional[Dict] = None) -> List[Leg]:
    """BUY OTM PE, SELL ATM PE.  Bullish credit spread."""
    p = {**(params or {})}
    s = p.get("strike_step", BASE_STRIKE_STEP)
    d = p.get("otm_distance", 1.0)
    atm = _round_strike(spot, s)
    exp = p.get("expiry", "99991231")
    q = p.get("qty", DEFAULT_QTY)
    rp = p.get("ref_price")
    return [
        Leg(strike=atm - d * s, option_type=OptionType.PE, action=Action.BUY,
            expiry=exp, quantity=q, entry_price=rp),
        Leg(strike=atm, option_type=OptionType.PE, action=Action.SELL,
            expiry=exp, quantity=q, entry_price=rp),
    ]


def bear_call_spread(spot: float, params: Optional[Dict] = None) -> List[Leg]:
    """BUY OTM CE, SELL ATM CE.  Bearish credit spread."""
    p = {**(params or {})}
    s = p.get("strike_step", BASE_STRIKE_STEP)
    d = p.get("otm_distance", 1.0)
    atm = _round_strike(spot, s)
    exp = p.get("expiry", "99991231")
    q = p.get("qty", DEFAULT_QTY)
    rp = p.get("ref_price")
    return [
        Leg(strike=atm + d * s, option_type=OptionType.CE, action=Action.BUY,
            expiry=exp, quantity=q, entry_price=rp),
        Leg(strike=atm, option_type=OptionType.CE, action=Action.SELL,
            expiry=exp, quantity=q, entry_price=rp),
    ]


def jade_lizard(spot: float, params: Optional[Dict] = None) -> List[Leg]:
    """SELL OTM PE, SELL OTM CE, BUY further OTM CE.  Credit with upside cap."""
    p = {**(params or {})}
    s = p.get("strike_step", BASE_STRIKE_STEP)
    d1 = p.get("otm_distance", 1.0)       # short strikes
    d2 = p.get("far_distance", 2.0)        # long call wing
    atm = _round_strike(spot, s)
    exp = p.get("expiry", "99991231")
    q = p.get("qty", DEFAULT_QTY)
    rp = p.get("ref_price")
    return [
        Leg(strike=atm - d1 * s, option_type=OptionType.PE, action=Action.SELL,
            expiry=exp, quantity=q, entry_price=rp),
        Leg(strike=atm + d1 * s, option_type=OptionType.CE, action=Action.SELL,
            expiry=exp, quantity=q, entry_price=rp),
        Leg(strike=atm + d2 * s, option_type=OptionType.CE, action=Action.BUY,
            expiry=exp, quantity=q, entry_price=rp),
    ]


# Map names for __all__ / dynamic access
STRATEGY_TEMPLATES: Dict[str, callable] = {
    "bull_call_spread": bull_call_spread,
    "bear_put_spread": bear_put_spread,
    "straddle": straddle,
    "strangle": strangle,
    "iron_condor": iron_condor,
    "iron_butterfly": iron_butterfly,
    "covered_call": covered_call,
    "bull_put_spread": bull_put_spread,
    "bear_call_spread": bear_call_spread,
    "jade_lizard": jade_lizard,
}


# ===========================================================================
# Payoff computation
# ===========================================================================
def compute_payoff(
    strategy: Strategy,
    spot_current: float,
    iv_decimal: float,
    days_to_expiry: int,
    spot_range: Sequence[float],
) -> List[dict]:
    """Compute P&L profile for every spot in range.

    Returns list of {spot, pnl_at_expiry, pnl_today}.
    - pnl_at_expiry uses intrinsic value at expiry.
    - pnl_today uses BS price with current IV + remaining time.
    """
    t = _tte_years(days_to_expiry)
    results: List[dict] = []

    for spot in spot_range:
        pnl_e = 0.0
        pnl_t = 0.0
        for leg in strategy.legs:
            ep = leg.entry_price
            qty = leg.quantity
            d = _direction(leg.action)

            if ep is None:
                # No entry — use BS price at spot_current as hypothetical entry
                ep_cur = _bs_price(leg, spot_current, iv_decimal, t) if leg.option_type is not None else spot_current
            else:
                ep_cur = ep

            # pnl at expiry (intrinsic)
            iv_e = _intrinsic(leg, spot)
            pnl_e += (iv_e - ep_cur) * qty * d

            # pnl today (BS)
            bs_cur = _bs_price(leg, spot, iv_decimal, t)
            pnl_t += (bs_cur - ep_cur) * qty * d

        results.append({
            "spot": round(spot, 2),
            "pnl_at_expiry": round(pnl_e, 2),
            "pnl_today": round(pnl_t, 2),
        })

    return results


def compute_payoff_raw(
    strategy: Strategy,
    spot_current: float,
    iv_decimal: float,
    days_to_expiry: int,
    spot_range: Sequence[float],
) -> Tuple[List[float], List[float], List[float]]:
    """Same as compute_payoff but returns raw arrays (spots, pnl_e, pnl_t).
    Useful for fast plotting / numeric analysis."""
    rows = compute_payoff(strategy, spot_current, iv_decimal,
                          days_to_expiry, spot_range)
    spots = [r["spot"] for r in rows]
    pnl_e = [r["pnl_at_expiry"] for r in rows]
    pnl_t = [r["pnl_today"] for r in rows]
    return spots, pnl_e, pnl_t


# ===========================================================================
# Net Greeks
# ===========================================================================
def _net_greeks(
    strategy: Strategy,
    spot: float,
    iv: float,
    days_to_expiry: int,
) -> Dict[str, float]:
    """Sum position-level Greeks across all legs."""
    t = _tte_years(days_to_expiry)
    net_d = 0.0
    net_g = 0.0
    net_t = 0.0
    net_v = 0.0

    for leg in strategy.legs:
        qty = leg.quantity
        d = _direction(leg.action)
        net_d += _greek(_delta, leg, spot, iv, t) * qty * d
        net_g += _greek(_gamma, leg, spot, iv, t) * qty * d
        net_t += _greek(_theta, leg, spot, iv, t) * qty * d
        net_v += _greek(_vega, leg, spot, iv, t) * qty * d

    return {
        "delta": round(net_d, 4),
        "gamma": round(net_g, 6),
        "theta": round(net_t, 4),
        "vega": round(net_v, 4),
    }


def net_delta(
    strategy: Strategy, spot: float, iv: float, days_to_expiry: int
) -> float:
    return _net_greeks(strategy, spot, iv, days_to_expiry)["delta"]


def net_gamma(
    strategy: Strategy, spot: float, iv: float, days_to_expiry: int
) -> float:
    return _net_greeks(strategy, spot, iv, days_to_expiry)["gamma"]


def net_theta(
    strategy: Strategy, spot: float, iv: float, days_to_expiry: int
) -> float:
    return _net_greeks(strategy, spot, iv, days_to_expiry)["theta"]


def net_vega(
    strategy: Strategy, spot: float, iv: float, days_to_expiry: int
) -> float:
    return _net_greeks(strategy, spot, iv, days_to_expiry)["vega"]


# ===========================================================================
# Probability of Profit
# ===========================================================================
def _ln_return(strike: float, spot: float, iv: float, t: float,
               r: float = RISK_FREE_RATE) -> float:
    """Standardised log-return for lognormal process."""
    return (math.log(strike / spot) - (r - 0.5 * iv * iv) * t) / (iv * math.sqrt(t))


def probability_of_profit(
    strategy: Strategy,
    spot_current: float,
    iv_decimal: float,
    days_to_expiry: int,
    n_samples: int = 200,
) -> dict:
    """Probability of positive P&L at expiry under lognormal evolution.

    Returns {pop_pct, breakevens, avg_profit, avg_loss, profit_factor}.
    """
    t = _tte_years(days_to_expiry)
    if t <= 0 or iv_decimal <= 0:
        return {"pop_pct": 0.0, "breakevens": [], "avg_profit": 0.0,
                "avg_loss": 0.0, "profit_factor": 0.0}

    # Build P&L profile across a wide spot range (0.1x to 3x current)
    if spot_current > 0:
        lo = max(spot_current * 0.1, 0.01)
        hi = spot_current * 3.0
    else:
        lo, hi = 0.01, 100.0
    step_sz = (hi - lo) / n_samples
    spots = [lo + i * step_sz for i in range(n_samples + 1)]

    pnls: List[float] = []
    for spot in spots:
        pnl = 0.0
        for leg in strategy.legs:
            ep = leg.entry_price
            qty = leg.quantity
            d = _direction(leg.action)
            if ep is None:
                ep_cur = (_bs_price(leg, spot_current, iv_decimal, t)
                          if leg.option_type is not None else spot_current)
            else:
                ep_cur = ep
            pnl += (_intrinsic(leg, spot) - ep_cur) * qty * d
        pnls.append(pnl)

    # Find breakevens (sign changes)
    breakevens: List[float] = []
    for i in range(1, len(pnls)):
        if pnls[i - 1] * pnls[i] < 0:
            # Linear interpolation
            x1, x2 = spots[i - 1], spots[i]
            y1, y2 = pnls[i - 1], pnls[i]
            if y2 != y1:
                be = x1 - y1 * (x2 - x1) / (y2 - y1)
                breakevens.append(round(be, 2))
        elif abs(pnls[i]) < 1e-9:
            breakevens.append(round(spots[i], 2))

    # Find profit zones and sum lognormal probabilities
    total_prob = 0.0
    in_profit = pnls[0] > 0
    if in_profit:
        zone_start = lo
    for i in range(len(pnls)):
        # Check for sign change at midpoint
        if i > 0 and pnls[i - 1] * pnls[i] < 0:
            # Boundary: interpolate spot where P&L = 0
            x1, x2 = spots[i - 1], spots[i]
            y1, y2 = pnls[i - 1], pnls[i]
            cross = x1 - y1 * (x2 - x1) / (y2 - y1) if y2 != y1 else x1
            if in_profit:
                total_prob += _pop_interval(zone_start, cross, spot_current,
                                            iv_decimal, t)
            zone_start = cross
            in_profit = not in_profit
        elif i == len(pnls) - 1 and in_profit:
            total_prob += _pop_interval(zone_start, hi, spot_current,
                                        iv_decimal, t)

    # Avg profit / loss in profit zone
    total_pnl = sum(pnls)
    n_pts = len(pnls)
    avg_pnl = total_pnl / n_pts if n_pts > 0 else 0.0

    pos_pnls = [p for p in pnls if p > 0]
    neg_pnls = [p for p in pnls if p < 0]
    avg_profit = sum(pos_pnls) / len(pos_pnls) if pos_pnls else 0.0
    avg_loss = abs(sum(neg_pnls) / len(neg_pnls)) if neg_pnls else 0.0
    pf = avg_profit / avg_loss if avg_loss > 0 else float("inf")

    return {
        "pop_pct": round(total_prob * 100.0, 2),
        "breakevens": breakevens,
        "avg_profit": round(avg_profit, 2),
        "avg_loss": round(avg_loss, 2),
        "profit_factor": round(pf, 4),
    }


def _pop_interval(a: float, b: float, spot: float, iv: float, t: float,
                  r: float = RISK_FREE_RATE) -> float:
    """Lognormal probability of being between a and b."""
    if b <= a:
        return 0.0
    z_a = _ln_return(a, spot, iv, t, r)
    z_b = _ln_return(b, spot, iv, t, r)
    prob = _NORM_CDF(z_b) - _NORM_CDF(z_a)
    return max(0.0, prob)


# ===========================================================================
# What-if scenario
# ===========================================================================
def what_if(
    strategy: Strategy,
    spot_override: float,
    iv_override: float,
    dte_override: int,
    spot_range: Optional[Sequence[float]] = None,
) -> dict:
    """Recompute payoff + Greeks + POP with overridden spot/IV/DTE.

    If spot_range omitted, builds one around spot_override.
    """
    if spot_range is None:
        lo = spot_override * 0.7
        hi = spot_override * 1.3
        step_sz = (hi - lo) / 100
        spot_range = [lo + i * step_sz for i in range(101)]

    payoff = compute_payoff(strategy, spot_override, iv_override,
                            dte_override, spot_range)
    greeks = _net_greeks(strategy, spot_override, iv_override, dte_override)
    pop = probability_of_profit(strategy, spot_override, iv_override,
                                dte_override)

    return {
        "payoff": payoff,
        "greeks": greeks,
        "pop": pop,
        "scenario": {
            "spot": spot_override,
            "iv": iv_override,
            "dte": dte_override,
        },
    }


# ===========================================================================
# Module exports
# ===========================================================================
__all__ = [
    # Enums
    "OptionType", "Action",
    # Models
    "Leg", "Strategy",
    # Constants
    "RISK_FREE_RATE", "BASE_STRIKE_STEP", "DEFAULT_QTY",
    # Helpers
    "days_to_expiry", "HAS_SCIPY",
    # Template constructors
    "bull_call_spread", "bear_put_spread", "straddle", "strangle",
    "iron_condor", "iron_butterfly", "covered_call",
    "bull_put_spread", "bear_call_spread", "jade_lizard",
    "STRATEGY_TEMPLATES",
    # Payoff
    "compute_payoff", "compute_payoff_raw",
    # Greeks
    "net_delta", "net_gamma", "net_theta", "net_vega", "_net_greeks",
    # POP
    "probability_of_profit",
    # What-if
    "what_if",
]
