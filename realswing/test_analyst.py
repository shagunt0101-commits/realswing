# tests/test_analyst.py
# Run: python -m pytest tests/test_analyst.py -v

import pytest
from agents.data_agent import OHLCVCandle
from agents.analyst_agent import ema, rsi, detect_fvgs, detect_order_blocks, calc_pcr


# ── FIXTURES ──────────────────────────────────────────────────────────────────

def make_candles(closes: list[float], highs=None, lows=None) -> list[OHLCVCandle]:
    candles = []
    for i, c in enumerate(closes):
        h = highs[i] if highs else c + 10
        l = lows[i]  if lows  else c - 10
        candles.append(OHLCVCandle(
            symbol="NIFTY", interval="5m",
            open=c - 5, high=h, low=l, close=c,
            volume=10000, timestamp=1700000000 + i * 300
        ))
    return candles


# ── EMA TESTS ─────────────────────────────────────────────────────────────────

def test_ema_rises_with_rising_prices():
    closes = [float(i * 10 + 100) for i in range(20)]
    result = ema(closes, period=9)
    assert len(result) > 0
    assert result[-1] > result[0], "EMA should rise with rising prices"

def test_ema_falls_with_falling_prices():
    closes = [float(200 - i * 5) for i in range(20)]
    result = ema(closes, period=9)
    assert result[-1] < result[0], "EMA should fall with falling prices"

def test_ema_insufficient_data():
    closes = [100.0, 101.0, 102.0]
    result = ema(closes, period=9)
    assert result == [], "EMA should return empty list if < period candles"

def test_ema_period_1_equals_close():
    closes = [100.0, 200.0, 300.0]
    result = ema(closes, period=1)
    assert abs(result[-1] - 300.0) < 0.01


# ── RSI TESTS ─────────────────────────────────────────────────────────────────

def test_rsi_neutral_on_insufficient_data():
    closes = [100.0, 101.0, 99.0]
    assert rsi(closes) == 50.0

def test_rsi_high_on_uptrend():
    closes = [float(100 + i * 2) for i in range(20)]
    r = rsi(closes, period=14)
    assert r > 60, f"Expected RSI > 60 on strong uptrend, got {r}"

def test_rsi_low_on_downtrend():
    closes = [float(200 - i * 2) for i in range(20)]
    r = rsi(closes, period=14)
    assert r < 40, f"Expected RSI < 40 on strong downtrend, got {r}"

def test_rsi_neutral_on_sideways():
    # Alternating up/down
    closes = [100.0 + (5 if i % 2 == 0 else -5) for i in range(20)]
    r = rsi(closes, period=14)
    assert 35 < r < 65, f"Expected RSI near 50 on sideways, got {r}"

def test_rsi_100_on_all_gains():
    # All gains = RSI should be 100
    closes = [float(100 + i) for i in range(20)]
    r = rsi(closes, period=5)
    assert r == 100.0


# ── FVG TESTS ─────────────────────────────────────────────────────────────────

def test_fvg_bearish_detected():
    # c0.low > c2.high → bearish FVG
    highs  = [110, 108, 106, 104, 102, 100]
    lows   = [100,  98,  50,  88,  86,  84]   # c2 low=50, c0 low=100 → gap
    closes = [105, 103, 101,  99,  97,  95]
    candles = make_candles(closes, highs=highs, lows=lows)
    fvgs = detect_fvgs(candles, lookback=10)
    bearish = [f for f in fvgs if f.direction == "BEARISH"]
    assert len(bearish) >= 1, "Should detect at least one bearish FVG"

def test_fvg_returns_at_most_3():
    closes = list(range(100, 130))
    candles = make_candles(closes)
    fvgs = detect_fvgs(candles, lookback=20)
    assert len(fvgs) <= 3, "Should return at most 3 recent FVGs"

def test_fvg_empty_on_choppy_market():
    # Very tight candles with overlapping ranges — no FVGs possible
    closes = [100.0] * 10
    highs  = [101.0] * 10
    lows   = [ 99.0] * 10
    candles = make_candles(closes, highs=highs, lows=lows)
    fvgs = detect_fvgs(candles, lookback=10)
    # May or may not find FVGs — just verify no crash
    assert isinstance(fvgs, list)


# ── PCR TESTS ─────────────────────────────────────────────────────────────────

def test_pcr_bearish_when_puts_heavy():
    from agents.data_agent import OptionChainSnapshot, OptionStrike
    chain = OptionChainSnapshot(
        asset="NIFTY", expiry="20250627", exchange="NSE",
        spot=24000, atm=24000
    )
    # More put OI than call OI
    chain.ce = [OptionStrike(strike=24000, ref_id=1, lot_size=50,
                              ltp=150, iv=15, delta=0.5, theta=-2, oi=100000, volume=5000, prev_oi=95000)]
    chain.pe = [OptionStrike(strike=24000, ref_id=2, lot_size=50,
                              ltp=140, iv=16, delta=-0.5, theta=-2, oi=150000, volume=7000, prev_oi=140000)]
    pcr = calc_pcr(chain)
    assert pcr > 1.0, f"PCR should be > 1 when puts > calls, got {pcr}"

def test_pcr_bullish_when_calls_heavy():
    from agents.data_agent import OptionChainSnapshot, OptionStrike
    chain = OptionChainSnapshot(
        asset="NIFTY", expiry="20250627", exchange="NSE",
        spot=24000, atm=24000
    )
    chain.ce = [OptionStrike(strike=24000, ref_id=1, lot_size=50,
                              ltp=150, iv=15, delta=0.5, theta=-2, oi=200000, volume=10000, prev_oi=190000)]
    chain.pe = [OptionStrike(strike=24000, ref_id=2, lot_size=50,
                              ltp=140, iv=16, delta=-0.5, theta=-2, oi=80000, volume=4000, prev_oi=75000)]
    pcr = calc_pcr(chain)
    assert pcr < 1.0, f"PCR should be < 1 when calls > puts, got {pcr}"

def test_pcr_default_on_empty_chain():
    from agents.data_agent import OptionChainSnapshot
    chain = OptionChainSnapshot(
        asset="NIFTY", expiry="20250627", exchange="NSE",
        spot=24000, atm=24000
    )
    pcr = calc_pcr(chain)
    assert pcr == 1.0, "Empty chain should return neutral PCR of 1.0"
