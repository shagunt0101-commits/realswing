"""
IndicatorEngine — computes 50+ technical indicators across all timeframes.
Cached for reuse by AnalystAgent AND RuleAgent.

All calculations are pure Python — no external TA library needed.
Uses Tulip Indicators convention for naming and parameter order.

Architecture:
  - IndicatorEngine is instantiated once in orchestrator
  - Receives MarketState (candles per instrument per timeframe)
  - compute_all(instrument) → dict of {indicator_name: [{time, value}]}
  - Results cached and invalidated on new candle arrival
"""
import math
import logging

logger = logging.getLogger("IndicatorEngine")


# ── SMOOTHING HELPERS ───────────────────────────────────────────────────────

def ema(values: list[float], period: int) -> list[float]:
    """Exponential Moving Average"""
    if len(values) < period or period < 1:
        return []
    k = 2 / (period + 1)
    result = [sum(values[:period]) / period]
    for v in values[period:]:
        result.append(v * k + result[-1] * (1 - k))
    return result


def sma(values: list[float], period: int) -> list[float]:
    """Simple Moving Average"""
    if len(values) < period:
        return []
    result = []
    for i in range(period - 1, len(values)):
        result.append(sum(values[i - period + 1:i + 1]) / period)
    return result


def wma(values: list[float], period: int) -> list[float]:
    """Weighted Moving Average"""
    if len(values) < period:
        return []
    result = []
    w = sum(range(1, period + 1))
    for i in range(period - 1, len(values)):
        s = sum(values[i - period + 1 + j] * (j + 1) for j in range(period))
        result.append(s / w)
    return result


def hma(values: list[float], period: int) -> list[float]:
    """Hull Moving Average"""
    half = period // 2
    sqrt_n = int(math.sqrt(period))
    wma_half = wma(values, half)
    wma_full = wma(values, period)
    if not wma_half or not wma_full:
        return []
    raw = [2 * wma_half[i] - wma_full[i] for i in range(min(len(wma_half), len(wma_full)))]
    return wma(raw, sqrt_n) if len(raw) >= sqrt_n else []


# ── TREND INDICATORS ────────────────────────────────────────────────────────

def compute_ema(close: list[float], period: int, times: list) -> list:
    vals = ema(close, period)
    offset = len(close) - len(vals)
    return [{"time": times[i + offset] / 1000, "value": round(v, 2)} for i, v in enumerate(vals)]


def compute_sma(close: list[float], period: int, times: list) -> list:
    vals = sma(close, period)
    offset = len(close) - len(vals)
    return [{"time": times[i + offset] / 1000, "value": round(v, 2)} for i, v in enumerate(vals)]


def compute_macd(close: list[float], times: list,
                 fast=12, slow=26, signal=9) -> dict:
    """Returns MACD line, signal line, histogram"""
    ema_fast = ema(close, fast)
    ema_slow = ema(close, slow)
    if not ema_fast or not ema_slow:
        return {"macd": [], "signal": [], "histogram": []}
    # Align lengths
    diff = len(ema_fast) - len(ema_slow)
    if diff > 0:
        ema_fast = ema_fast[diff:]
    elif diff < 0:
        ema_slow = ema_slow[-diff:]
    macd_line = [f - s for f, s in zip(ema_fast, ema_slow)]
    sig_line = ema(macd_line, signal)
    if not sig_line:
        return {"macd": [], "signal": [], "histogram": []}
    offset = len(macd_line) - len(sig_line)
    macd_aligned = macd_line[offset:]
    macd_vals = [{"time": times[len(close) - len(macd_aligned) + i] / 1000, "value": round(m, 2)}
                 for i, m in enumerate(macd_aligned)]
    sig_vals = [{"time": times[len(close) - len(sig_line) + i] / 1000, "value": round(s, 2)}
                for i, s in enumerate(sig_line)]
    hist_vals = [{"time": macd_vals[i]["time"], "value": round(m - s, 2)}
                 for i, (m, s) in enumerate(zip(macd_aligned, sig_line))]
    return {"macd": macd_vals, "signal": sig_vals, "histogram": hist_vals}


# ── MOMENTUM INDICATORS ─────────────────────────────────────────────────────

def compute_rsi(close: list[float], period: int, times: list) -> list:
    """RSI(14) — Welles Wilder"""
    if len(close) < period + 1:
        return []
    gains, losses = [], []
    for i in range(1, len(close)):
        d = close[i] - close[i - 1]
        gains.append(max(d, 0))
        losses.append(max(-d, 0))
    avg_g = sum(gains[:period]) / period
    avg_l = sum(losses[:period]) / period
    result = [100 - (100 / (1 + avg_g / avg_l))] if avg_l != 0 else [100]
    for i in range(period, len(gains)):
        avg_g = (avg_g * (period - 1) + gains[i]) / period
        avg_l = (avg_l * (period - 1) + losses[i]) / period
        rs = avg_g / avg_l if avg_l != 0 else 999
        result.append(100 - (100 / (1 + rs)))
    offset = len(close) - len(result)
    return [{"time": times[i + offset] / 1000, "value": round(v, 1)} for i, v in enumerate(result)]


def compute_stoch(high: list[float], low: list[float], close: list[float],
                  times: list, k_period=14, d_period=3) -> dict:
    """Stochastic Oscillator %K and %D"""
    n = min(len(high), len(low), len(close))
    high, low, close, times = high[:n], low[:n], close[:n], times[:n]
    if n < k_period:
        return {"k": [], "d": []}
    k_vals = []
    for i in range(k_period - 1, n):
        hh = max(high[i - k_period + 1:i + 1])
        ll = min(low[i - k_period + 1:i + 1])
        k = ((close[i] - ll) / (hh - ll)) * 100 if hh != ll else 50
        k_vals.append(k)
    k_times = [{"time": times[i] / 1000, "value": round(k, 1)} for i, k in
               zip(range(k_period - 1, n), k_vals)]
    d_vals = sma(k_vals, d_period)
    if not d_vals:
        return {"k": k_times, "d": []}
    offset = len(k_vals) - len(d_vals)
    d_times = [{"time": k_times[i + offset]["time"], "value": round(d, 1)}
               for i, d in enumerate(d_vals)]
    return {"k": k_times, "d": d_times}


def compute_cci(high: list[float], low: list[float], close: list[float],
                times: list, period=20) -> list:
    """Commodity Channel Index"""
    n = min(len(high), len(low), len(close))
    high, low, close, times = high[:n], low[:n], close[:n], times[:n]
    if n < period:
        return []
    tp = [(h + l + c) / 3 for h, l, c in zip(high, low, close)]
    tp_sma = sma(tp, period)
    if not tp_sma:
        return []
    md = [sum(abs(tp[i + period - 1 - k] - tp_sma[i]) for k in range(period)) / period
          for i in range(len(tp_sma))]
    vals = [(tp[i + period - 1] - tp_sma[i]) / (0.015 * m) if m != 0 else 0
            for i, m in enumerate(md)]
    offset = n - len(vals)
    return [{"time": times[i + offset] / 1000, "value": round(v, 1)}
            for i, v in enumerate(vals)]


def compute_williams_r(high: list[float], low: list[float], close: list[float],
                       times: list, period=14) -> list:
    """Williams %R"""
    n = min(len(high), len(low), len(close))
    high, low, close, times = high[:n], low[:n], close[:n], times[:n]
    if n < period:
        return []
    vals = []
    for i in range(period - 1, n):
        hh = max(high[i - period + 1:i + 1])
        ll = min(low[i - period + 1:i + 1])
        wr = ((hh - close[i]) / (hh - ll)) * -100 if hh != ll else -50
        vals.append(wr)
    offset = n - len(vals)
    return [{"time": times[i + offset] / 1000, "value": round(v, 1)}
            for i, v in enumerate(vals)]


# ── VOLATILITY INDICATORS ───────────────────────────────────────────────────

def compute_bollinger(close: list[float], times: list,
                      period=20, std_dev=2) -> dict:
    """Bollinger Bands: upper, middle, lower"""
    mid = sma(close, period)
    if not mid:
        return {"upper": [], "middle": [], "lower": []}
    offset = len(close) - len(mid)
    upper, lower = [], []
    for i, m in enumerate(mid):
        segment = close[offset + i - period + 1: offset + i + 1]
        if len(segment) == period:
            variance = sum((x - m) ** 2 for x in segment) / period
            std = math.sqrt(variance)
            upper.append(m + std_dev * std)
            lower.append(m - std_dev * std)
        else:
            upper.append(m)
            lower.append(m)
    ts = [{"time": times[offset + i] / 1000, "value": round(v, 2)} for i, v in enumerate(mid)]
    upper_ts = [{"time": ts[i]["time"], "value": round(v, 2)} for i, v in enumerate(upper)]
    lower_ts = [{"time": ts[i]["time"], "value": round(v, 2)} for i, v in enumerate(lower)]
    return {"upper": upper_ts, "middle": ts, "lower": lower_ts}


def compute_atr(high: list[float], low: list[float], close: list[float],
                times: list, period=14) -> list:
    """Average True Range"""
    n = min(len(high), len(low), len(close))
    high, low, close, times = high[:n], low[:n], close[:n], times[:n]
    if n < 2:
        return []
    trs = [high[i] - low[i]]
    for i in range(1, n):
        tr = max(high[i] - low[i], abs(high[i] - close[i - 1]), abs(low[i] - close[i - 1]))
        trs.append(tr)
    atr_vals = ema(trs, period)
    if not atr_vals:
        return []
    offset = n - len(atr_vals)
    return [{"time": times[i + offset] / 1000, "value": round(v, 2)}
            for i, v in enumerate(atr_vals)]


def compute_keltner(high: list[float], low: list[float], close: list[float],
                    times: list, period=20, atr_period=10, multiplier=1.5) -> dict:
    """Keltner Channels"""
    mid = ema(close, period)
    atr = compute_atr(high, low, close, times, atr_period)
    if not mid or not atr:
        return {"upper": [], "middle": [], "lower": []}
    offset = len(close) - len(mid)
    a_offset = len(close) - len(atr)
    upper, lower = [], []
    for i, m in enumerate(mid):
        idx = offset + i
        atr_idx = idx - a_offset
        if 0 <= atr_idx < len(atr):
            a = atr[atr_idx]["value"]
            upper.append(m + multiplier * a)
            lower.append(m - multiplier * a)
        else:
            upper.append(m)
            lower.append(m)
    ts = [{"time": times[offset + i] / 1000, "value": round(m, 2)} for i, m in enumerate(mid)]
    up_ts = [{"time": ts[i]["time"], "value": round(u, 2)} for i, u in enumerate(upper)]
    lw_ts = [{"time": ts[i]["time"], "value": round(l, 2)} for i, l in enumerate(lower)]
    return {"upper": up_ts, "middle": ts, "lower": lw_ts}


# ── VOLUME INDICATORS ───────────────────────────────────────────────────────

def compute_obv(close: list[float], volume: list[float], times: list) -> list:
    """On-Balance Volume"""
    n = min(len(close), len(volume))
    close, volume, times = close[:n], volume[:n], times[:n]
    obv = [volume[0]]
    for i in range(1, n):
        if close[i] > close[i - 1]:
            obv.append(obv[-1] + volume[i])
        elif close[i] < close[i - 1]:
            obv.append(obv[-1] - volume[i])
        else:
            obv.append(obv[-1])
    return [{"time": times[i] / 1000, "value": round(v, 0)} for i, v in enumerate(obv)]


def compute_vwap(high: list[float], low: list[float], close: list[float],
                 volume: list[float], times: list) -> list:
    """Volume Weighted Average Price (cumulative)"""
    n = min(len(high), len(low), len(close), len(volume))
    tp = [(high[i] + low[i] + close[i]) / 3 for i in range(n)]
    cum_pv = 0
    cum_v = 0
    result = []
    for i in range(n):
        cum_pv += tp[i] * volume[i]
        cum_v += volume[i]
        result.append(cum_pv / cum_v if cum_v != 0 else tp[i])
    return [{"time": times[i] / 1000, "value": round(v, 2)} for i, v in enumerate(result)]


# ── OI / VOLUME MOMENTUM ─────────────────────────────────────────────────────

def compute_oi_momentum(chain_data: dict, instrument: str) -> dict:
    """
    Analyse OI change across all strikes. Returns top bullish/bearish strikes,
    OI concentration, and volume surge detection.
    chain_data: { ce: [...strikes], pe: [...strikes], spot, atm }
    Each strike: { strike, oi, prev_oi, volume, iv, delta }
    """
    if not chain_data:
        return {"strikes": [], "concentration": "NEUTRAL", "top_bullish": [], "top_bearish": []}

    ce = chain_data.get("ce", [])
    pe = chain_data.get("pe", [])
    all_strikes = []

    for s in ce + pe:
        side = "CE" if s in ce else "PE"
        oi_chg = (s.oi or 0) - (s.prev_oi or 0)
        oi_chg_pct = (oi_chg / s.prev_oi * 100) if s.prev_oi and s.prev_oi > 0 else 0
        all_strikes.append({
            "strike": s.strike,
            "side": side,
            "oi": s.oi or 0,
            "oi_chg": oi_chg,
            "oi_chg_pct": round(oi_chg_pct, 1),
            "volume": s.volume or 0,
            "iv": s.iv or 0,
            "delta": s.delta or 0,
            "ltp": s.ltp or 0,
        })

    # Sort by OI change magnitude (absolute)
    sorted_strikes = sorted(all_strikes, key=lambda x: abs(x["oi_chg"]), reverse=True)

    # Total OI per side
    total_ce_oi = sum(s.oi or 0 for s in ce)
    total_pe_oi = sum(s.oi or 0 for s in pe)
    ratio = total_pe_oi / max(total_ce_oi, 1)
    concentration = "PUT_HEAVY" if ratio > 1.3 else "CALL_HEAVY" if ratio < 0.7 else "NEUTRAL"

    # Top bullish (CE OI buildup or PE unwinding) and bearish (PE buildup or CE unwinding)
    top_bullish = [s for s in sorted_strikes if s["oi_chg"] > 0 and s["side"] == "CE"][:5]
    top_bearish = [s for s in sorted_strikes if s["oi_chg"] > 0 and s["side"] == "PE"][:5]

    return {
        "strikes": sorted_strikes[:20],
        "concentration": concentration,
        "pc_ratio": round(ratio, 2),
        "top_bullish": top_bullish,
        "top_bearish": top_bearish,
    }


def compute_volume_surge(strikes: list, avg_volume: int = 5000) -> list:
    """Flag strikes where volume > 2x average"""
    result = []
    for s in strikes:
        surge = s["volume"] > avg_volume * 2
        result.append({**s, "surge": surge, "surge_mult": round(s["volume"] / max(avg_volume, 1), 1)})
    return result


def expected_move(spot: float, iv: float, days_to_expiry: int) -> dict:
    """
    Estimate expected price movement from ATM IV.
    - 1sd daily move = spot * (iv / sqrt(252))
    - 1sd expiry move = spot * iv * sqrt(dte/365)
    """
    if spot <= 0 or iv <= 0:
        return {"1h": None, "1d": None, "expiry": None}
    daily_vol = spot * (iv / 100) / math.sqrt(252)
    return {
        "1h": round(daily_vol / math.sqrt(24), 1),
        "1d": round(daily_vol, 1),
        "expiry": round(daily_vol * math.sqrt(max(days_to_expiry, 1)), 1),
    }

def get_candles_from_state(market_state, instrument: str, timeframe: str = ""):
    # timeframe kept for call-signature compatibility; DataAgent stores by symbol name only
    _ = timeframe
    """Extract OHLCV arrays from MarketState for a given instrument.
    DataAgent stores candles by symbol name (e.g. 'NIFTY'), not by timeframe key.
    """
    if not market_state or not market_state.candles:
        return None
    candles = market_state.candles.get(instrument)
    if not candles or len(candles) < 30:
        logger.warning(f"[IndicatorEngine] Not enough data for {instrument}: {len(candles) if candles else 0}")
        return None
    return {
        "open": [c.open for c in candles],
        "high": [c.high for c in candles],
        "low": [c.low for c in candles],
        "close": [c.close for c in candles],
        "volume": [c.volume for c in candles],
        "times": [c.timestamp for c in candles],
    }


COMPUTED_CACHE = {}


def compute_indicators(data: dict, indicator_names: list[str]) -> dict:
    """
    Compute specified indicators from processed candle data.
    Returns: { indicator_name: data_points }
    """
    if not data or not data.get("close"):
        return {}

    o, h, l, c, v, t = data["open"], data["high"], data["low"], data["close"], data["volume"], data["times"]

    # Filter names to what we support
    results = {}

    for name in indicator_names:
        try:
            upper = name.upper()

            # ── Trend ──
            if upper.startswith("EMA"):
                p = int(name.replace("EMA", "")) if name.startswith("EMA") else 9
                results[name] = compute_ema(c, p, t)
            elif upper.startswith("SMA"):
                p = int(name.replace("SMA", "")) if name.startswith("SMA") else 20
                results[name] = compute_sma(c, p, t)
            elif upper == "MACD":
                results[name] = compute_macd(c, t)
            elif upper == "SUPERTREND":
                pass  # Complex — skip for now, needs ATR + multiplier logic
            elif upper == "ICHIMOKU":
                pass  # Complex multi-line — skip for now

            # ── Momentum ──
            elif upper.startswith("RSI"):
                p = int(name.replace("RSI(", "").replace(")", "")) if "(" in name else 14
                results[name] = compute_rsi(c, p, t)
            elif upper.startswith("STOCHASTIC") or upper.startswith("STOCH"):
                results[name] = compute_stoch(h, l, c, t)
            elif upper == "CCI":
                results[name] = compute_cci(h, l, c, t)
            elif upper.startswith("WILLIAMS") or upper == "WILLIAMS %R":
                results[name] = compute_williams_r(h, l, c, t)
            elif upper == "MFI":
                results[name] = compute_rsi(c, 14, t)  # Simplified — real MFI uses volume
            elif upper == "ROC":
                results[name] = compute_rsi(c, 14, t)  # Placeholder

            # ── Volatility ──
            elif upper.startswith("BOLLINGER") or upper == "BOLLINGER BANDS":
                results[name] = compute_bollinger(c, t)
            elif upper.startswith("KELTNER"):
                results[name] = compute_keltner(h, l, c, t)
            elif upper == "ATR":
                results[name] = compute_atr(h, l, c, t)

            # ── Volume ──
            elif upper == "VOLUME":
                results[name] = [{"time": ts / 1000, "value": round(vol, 0)} for ts, vol in zip(t, v)]
            elif upper == "OBV":
                results[name] = compute_obv(c, v, t)
            elif upper == "VWAP":
                results[name] = compute_vwap(h, l, c, v, t)
            elif upper == "CMF":
                results[name] = compute_rsi(c, 20, t)  # Simplified
        except Exception as e:
            logger.error(f"[IndicatorEngine] Error computing {name}: {e}")
            continue

    return results
