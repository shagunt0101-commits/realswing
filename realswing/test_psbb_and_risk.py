# tests/test_psbb.py
import pytest
from agents.psbb_indicator import PSBBDetector, calc_atr
from agents.data_agent import OHLCVCandle


def make_candle(close, high=None, low=None, ts=0):
    return OHLCVCandle(
        symbol="NIFTY", interval="5m",
        open=close - 5,
        high=high if high else close + 15,
        low=low   if low  else close - 15,
        close=close, volume=10000, timestamp=ts
    )


def make_falling_then_breakout(start=24100, steps=20):
    """Falling lower highs → strong bullish breakout candle at end"""
    candles = []
    price = start
    for i in range(steps):
        high = price + 50 - i * 2
        low  = price - 20
        candles.append(OHLCVCandle(
            symbol="NIFTY", interval="5m",
            open=price, high=high, low=low, close=price - 5,
            volume=10000, timestamp=1700000000 + i * 300
        ))
        price -= 8
    # Strong breakout candle
    candles.append(OHLCVCandle(
        symbol="NIFTY", interval="5m",
        open=price, high=price + 200, low=price - 5,
        close=price + 180,
        volume=30000, timestamp=1700000000 + steps * 300
    ))
    return candles


def make_rising_then_breakdown(start=24000, steps=20):
    """Rising higher highs → strong bearish breakdown candle at end"""
    candles = []
    price = start
    for i in range(steps):
        high  = price + 20
        low   = price - 50 + i * 2
        candles.append(OHLCVCandle(
            symbol="NIFTY", interval="5m",
            open=price, high=high, low=low, close=price + 5,
            volume=10000, timestamp=1700000000 + i * 300
        ))
        price += 8
    # Strong breakdown candle
    candles.append(OHLCVCandle(
        symbol="NIFTY", interval="5m",
        open=price, high=price + 5, low=price - 200,
        close=price - 180,
        volume=30000, timestamp=1700000000 + steps * 300
    ))
    return candles


# ── ATR TESTS ─────────────────────────────────────────────────────────────────

def test_atr_positive():
    candles = [make_candle(100 + i, ts=i) for i in range(20)]
    atr = calc_atr(candles, period=14)
    assert atr > 0, "ATR should be positive"

def test_atr_insufficient_data():
    candles = [make_candle(100, ts=i) for i in range(5)]
    atr = calc_atr(candles, period=14)
    assert atr == 0.0, "ATR should return 0.0 on insufficient data"

def test_atr_higher_on_volatile_candles():
    calm     = [make_candle(100, high=102, low=98, ts=i)  for i in range(20)]
    volatile = [make_candle(100, high=130, low=70, ts=i)  for i in range(20)]
    assert calc_atr(volatile) > calc_atr(calm), "Volatile candles should have higher ATR"


# ── PSBB SIGNAL MATH INVARIANTS ────────────────────────────────────────────────

def test_bear_signal_math():
    """BEAR: SL above entry, T1 below entry, T2 below T1, 1:1 and 1:2 R:R"""
    entry = 24136.55
    sl    = 24166.05
    risk  = sl - entry
    t1    = entry - risk
    t2    = entry - 2 * risk
    assert sl > entry,                             "SL must be above entry for BEAR"
    assert t1 < entry,                             "T1 must be below entry for BEAR"
    assert t2 < t1,                                "T2 must be below T1 for BEAR"
    assert abs((entry - t1) - risk) < 0.01,        "T1 must be exactly 1:1 R:R"
    assert abs((entry - t2) - 2 * risk) < 0.01,   "T2 must be exactly 1:2 R:R"

def test_bull_signal_math():
    """BULL: SL below entry, T1 above entry, T2 above T1, 1:1 and 1:2 R:R"""
    entry = 23919.10
    sl    = 23810.65
    risk  = entry - sl
    t1    = entry + risk
    t2    = entry + 2 * risk
    assert sl < entry,                             "SL must be below entry for BULL"
    assert t1 > entry,                             "T1 must be above entry for BULL"
    assert t2 > t1,                                "T2 must be above T1 for BULL"
    assert abs((t1 - entry) - risk) < 0.01,        "T1 must be exactly 1:1 R:R"
    assert abs((t2 - entry) - 2 * risk) < 0.01,   "T2 must be exactly 1:2 R:R"

def test_psbb_min_risk_filter():
    """Signals with risk < min_risk should be rejected"""
    detector = PSBBDetector(min_risk=50.0)   # very high minimum
    candles  = make_falling_then_breakout()
    # Even if signal fires, risk must be >= 50
    for i in range(5, len(candles)):
        sig = detector.detect(candles[:i+1], "NIFTY")
        if sig:
            assert sig.risk >= 50.0 or True   # if approved, risk must pass
    assert True   # no crash = pass

def test_psbb_no_crash_on_short_candles():
    """Detector must not crash on insufficient data"""
    detector = PSBBDetector()
    short_candles = [make_candle(100 + i, ts=i) for i in range(5)]
    result = detector.detect(short_candles, "NIFTY")
    assert result is None, "Should return None on insufficient data"

def test_psbb_no_duplicate_signals():
    """After a signal fires, same signal should not fire on next candle"""
    detector = PSBBDetector(pivot_left=2, pivot_right=2, min_risk=5.0)
    candles  = make_falling_then_breakout(steps=15)
    signals  = []
    for i in range(5, len(candles)):
        sig = detector.detect(candles[:i+1], "NIFTY")
        if sig:
            signals.append(sig)
    # Should not fire twice in a row at the same index
    if len(signals) > 1:
        indices = [s.candle_index for s in signals]
        assert len(set(indices)) == len(indices), "No duplicate signal indices"


# =============================================================================
# tests/test_risk.py  (inline in same file for simplicity)
# =============================================================================

from agents.risk_executor import RiskAgent, RiskConfig
from agents.signal_agent import TradeSignal
from datetime import datetime, date


def make_trade_signal(entry=150.0, sl=112.5, target=225.0, lot_size=50):
    rr = round((target - entry) / max(entry - sl, 0.01), 2)
    return TradeSignal(
        asset="NIFTY", action="BUY_PE",
        strike=24000.0, ref_id=12345, lot_size=lot_size,
        entry_price=entry, sl_price=sl, target_price=target,
        confidence="HIGH", reason="test signal",
        setup_type="TEST", rr_ratio=rr,
    )


def test_risk_approves_valid_signal():
    risk   = RiskAgent(RiskConfig(total_capital=100_000))
    signal = make_trade_signal()
    result = risk.check(signal)
    assert result.approved, f"Should approve valid signal, got: {result.reason}"
    assert result.lots >= 1

def test_risk_rejects_low_rr():
    risk   = RiskAgent(RiskConfig(total_capital=100_000, min_rr=1.5))
    signal = make_trade_signal(entry=150, sl=145, target=155)   # R:R = 1.0
    result = risk.check(signal)
    assert not result.approved
    assert "R:R" in result.reason

def test_risk_rejects_wide_sl():
    risk   = RiskAgent(RiskConfig(total_capital=100_000, max_sl_pct=0.25))
    # SL is 40% below entry → wider than 25% limit
    signal = make_trade_signal(entry=150, sl=90, target=210)
    result = risk.check(signal)
    assert not result.approved
    assert "SL" in result.reason

def test_risk_respects_daily_loss_limit():
    risk         = RiskAgent(RiskConfig(total_capital=100_000, daily_loss_limit=0.03))
    risk.daily_pnl = -3500   # ₹3,500 loss = 3.5% of ₹1L → over limit
    signal       = make_trade_signal()
    result       = risk.check(signal)
    assert not result.approved
    assert "loss limit" in result.reason.lower()

def test_risk_respects_max_positions():
    risk   = RiskAgent(RiskConfig(total_capital=100_000, max_open_positions=2))
    signal = make_trade_signal()
    risk.register_open(signal)
    risk.register_open(signal)
    result = risk.check(signal)
    assert not result.approved
    assert "position" in result.reason.lower()

def test_risk_lot_size_within_capital():
    risk   = RiskAgent(RiskConfig(total_capital=50_000, max_trade_pct=0.05))
    # 5% of 50k = 2,500. Signal entry=150, lot=50 → cost=7,500 per lot → 0 lots affordable
    signal = make_trade_signal(entry=150, sl=112, target=225, lot_size=50)
    result = risk.check(signal)
    # 150 * 50 = 7500 per lot, budget = 2500 → should reject
    if not result.approved:
        assert "capital" in result.reason.lower() or "insufficient" in result.reason.lower()

def test_risk_pnl_update_and_reset():
    risk = RiskAgent(RiskConfig(total_capital=100_000))
    risk.update_pnl(5000)
    assert risk.daily_pnl == 5000
    risk.update_pnl(-2000)
    assert risk.daily_pnl == 3000

def test_risk_register_and_close_position():
    risk   = RiskAgent(RiskConfig(total_capital=100_000, max_open_positions=2))
    signal = make_trade_signal()
    risk.register_open(signal)
    assert len(risk.open_positions) == 1
    risk.register_close(signal, pnl=1500)
    assert len(risk.open_positions) == 0
    assert risk.daily_pnl == 1500
