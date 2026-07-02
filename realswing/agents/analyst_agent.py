"""
AnalystAgent - RealSwing
Computes real technical indicators, OI analysis, and candlestick patterns
from live OHLC + option chain data. Pure pandas/numpy — no pandas_ta needed.
"""
import pandas as pd
import numpy as np
from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Any


# -------------------------------------------------------------------------
# Backward-compatible types (used by signal_agent / risk_executor)
# -------------------------------------------------------------------------

@dataclass
class FVG:
    top: float = 0.0
    bottom: float = 0.0
    direction: str = ""

@dataclass
class OrderBlock:
    top: float = 0.0
    bottom: float = 0.0
    direction: str = ""

@dataclass
class AnalystReport:
    trend: str = "NEUTRAL"
    rsi: float = 50.0
    pcr: float = 1.0
    iv_atm: float = 15.0
    oi_direction: str = "FLAT"
    choch_level: Optional[float] = None
    bos_level: Optional[float] = None
    support: Optional[float] = None
    resistance: Optional[float] = None
    ema9: Optional[float] = None
    ema21: Optional[float] = None
    trend_gate_pass: bool = False
    momentum_pass: bool = False
    structure_pass: bool = False
    fvgs: list = None
    order_blocks: list = None
    spot: float = 0.0
    atm: float = 0.0
    def __post_init__(self):
        if self.fvgs is None: self.fvgs = []
        if self.order_blocks is None: self.order_blocks = []


# -------------------------------------------------------------------------
# Manual indicator functions (pandas_ta unavailable on Python 3.14)
# -------------------------------------------------------------------------

def _rsi(series: pd.Series, length: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.where(delta > 0, 0.0).rolling(length).mean()
    loss = (-delta.where(delta < 0, 0.0)).rolling(length).mean()
    rs = gain / loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def _ema(series: pd.Series, length: int) -> pd.Series:
    return series.ewm(span=length, adjust=False).mean()


def _sma(series: pd.Series, length: int) -> pd.Series:
    return series.rolling(length).mean()


def _macd(series: pd.Series) -> pd.DataFrame:
    ema12 = _ema(series, 12)
    ema26 = _ema(series, 26)
    macd_line = ema12 - ema26
    signal = _ema(macd_line, 9)
    hist = macd_line - signal
    df = pd.DataFrame({"macd": macd_line, "signal": signal, "hist": hist})
    return df


def _supertrend(high: pd.Series, low: pd.Series, close: pd.Series, length: int = 10, multiplier: float = 3.0) -> pd.DataFrame:
    tr = pd.concat([
        high - low,
        (high - close.shift()).abs(),
        (low - close.shift()).abs(),
    ], axis=1).max(axis=1)
    atr = tr.rolling(length).mean()
    hl_avg = (high + low) / 2
    upper = hl_avg + multiplier * atr
    lower = hl_avg - multiplier * atr
    st_dir = pd.Series(1, index=close.index, dtype=int)
    st_val = pd.Series(0.0, index=close.index)
    for i in range(length, len(close)):
        if close.iloc[i] > upper.iloc[i - 1]:
            st_dir.iloc[i] = 1
        elif close.iloc[i] < lower.iloc[i - 1]:
            st_dir.iloc[i] = -1
        else:
            st_dir.iloc[i] = st_dir.iloc[i - 1]
        st_val.iloc[i] = lower.iloc[i] if st_dir.iloc[i] == 1 else upper.iloc[i]
    return pd.DataFrame({"SUPERTd": st_dir, "SUPERT": st_val})


def _adx(high: pd.Series, low: pd.Series, close: pd.Series, length: int = 14) -> pd.DataFrame:
    up = high.diff()
    down = -low.diff()
    plus_dm = pd.Series(0.0, index=close.index)
    minus_dm = pd.Series(0.0, index=close.index)
    plus_dm[(up > down) & (up > 0)] = up
    minus_dm[(down > up) & (down > 0)] = down

    tr = pd.concat([high - low, (high - close.shift()).abs(), (low - close.shift()).abs()], axis=1).max(axis=1)
    atr = tr.rolling(length).mean()
    plus_di = 100 * plus_dm.rolling(length).mean() / atr.replace(0, np.nan)
    minus_di = 100 * minus_dm.rolling(length).mean() / atr.replace(0, np.nan)
    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan)
    adx_val = dx.rolling(length).mean()
    return pd.DataFrame({"ADX_14": adx_val, "DMP_14": plus_di, "DMN_14": minus_di})


def _bbands(series: pd.Series, length: int = 20) -> pd.DataFrame:
    ma = _sma(series, length)
    std = series.rolling(length).std()
    return pd.DataFrame({
        "BBL": ma - 2 * std,
        "BBM": ma,
        "BBU": ma + 2 * std,
    })


# -------------------------------------------------------------------------
# 1. RESAMPLING
# -------------------------------------------------------------------------

def resample_ohlc(df_1m: pd.DataFrame, rule: str) -> pd.DataFrame:
    agg = {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}
    out = df_1m.resample(rule).agg(agg).dropna()
    return out


# -------------------------------------------------------------------------
# 2. INDICATORS
# -------------------------------------------------------------------------

@dataclass
class TimeframeSignal:
    timeframe: str
    rsi: Optional[float] = None
    macd: Optional[float] = None
    macd_hist: Optional[float] = None
    sma50: Optional[float] = None
    ema20: Optional[float] = None
    supertrend_dir: Optional[int] = None
    supertrend_val: Optional[float] = None
    adx: Optional[float] = None
    plus_di: Optional[float] = None
    minus_di: Optional[float] = None
    bb_upper: Optional[float] = None
    bb_lower: Optional[float] = None
    verdict: str = "NEUTRAL"


def compute_indicators(df: pd.DataFrame, timeframe: str) -> TimeframeSignal:
    if len(df) < 60:
        return TimeframeSignal(timeframe=timeframe, verdict="INSUFFICIENT_DATA")

    rsi = _rsi(df["close"], 14)
    macd_df = _macd(df["close"])
    sma50 = _sma(df["close"], 50)
    ema20 = _ema(df["close"], 20)
    st = _supertrend(df["high"], df["low"], df["close"])
    adx_df = _adx(df["high"], df["low"], df["close"])
    bb = _bbands(df["close"])

    sig = TimeframeSignal(
        timeframe=timeframe,
        rsi=round(float(rsi.iloc[-1]), 2),
        macd=round(float(macd_df["macd"].iloc[-1]), 2),
        macd_hist=round(float(macd_df["hist"].iloc[-1]), 2),
        sma50=round(float(sma50.iloc[-1]), 2),
        ema20=round(float(ema20.iloc[-1]), 2),
        supertrend_dir=int(st["SUPERTd"].iloc[-1]),
        supertrend_val=round(float(st["SUPERT"].iloc[-1]), 2),
        adx=round(float(adx_df["ADX_14"].iloc[-1]), 2),
        plus_di=round(float(adx_df["DMP_14"].iloc[-1]), 2),
        minus_di=round(float(adx_df["DMN_14"].iloc[-1]), 2),
        bb_upper=round(float(bb["BBU"].iloc[-1]), 2),
        bb_lower=round(float(bb["BBL"].iloc[-1]), 2),
    )

    bullish = sum([
        sig.supertrend_dir == 1,
        sig.macd_hist > 0,
        df["close"].iloc[-1] > sig.sma50 if sig.sma50 else False,
        df["close"].iloc[-1] > sig.ema20 if sig.ema20 else False,
        sig.plus_di > sig.minus_di,
    ])
    sig.verdict = "BULLISH" if bullish >= 4 else "BEARISH" if bullish <= 1 else "NEUTRAL"
    return sig


def multi_timeframe_analysis(df_1m: pd.DataFrame) -> dict:
    daily = resample_ohlc(df_1m, "1D")
    m15 = resample_ohlc(df_1m, "15min")
    m75 = resample_ohlc(df_1m, "75min")
    return {
        "daily": compute_indicators(daily, "daily"),
        "15m": compute_indicators(m15, "15m"),
        "75m": compute_indicators(m75, "75m"),
    }


# -------------------------------------------------------------------------
# 3. CANDLESTICK PATTERNS (simple heuristic — no TA-Lib)
# -------------------------------------------------------------------------

def detect_candlestick_patterns(df: pd.DataFrame, lookback: int = 20) -> list[dict]:
    recent = df.tail(lookback).copy()
    patterns = []
    for i in range(1, len(recent)):
        row = recent.iloc[i]
        prev = recent.iloc[i - 1]
        body = abs(row["close"] - row["open"])
        upper = row["high"] - max(row["close"], row["open"])
        lower = min(row["close"], row["open"]) - row["low"]
        prev_body = abs(prev["close"] - prev["open"])

        # Engulfing
        if (row["close"] > row["open"] and prev["close"] < prev["open"]
                and row["open"] < prev["close"] and row["close"] > prev["open"]):
            patterns.append({"timestamp": str(row.name), "pattern": "ENGULFING", "direction": "bullish"})
        elif (row["close"] < row["open"] and prev["close"] > prev["open"]
              and row["open"] > prev["close"] and row["close"] < prev["open"]):
            patterns.append({"timestamp": str(row.name), "pattern": "ENGULFING", "direction": "bearish"})

        # Doji
        if body < (row["high"] - row["low"]) * 0.1:
            patterns.append({"timestamp": str(row.name), "pattern": "DOJI", "direction": "neutral"})

        # Hammer (lower wick >= 2x body, small upper wick)
        if body > 0 and lower >= 2 * body and upper <= body * 0.5:
            patterns.append({"timestamp": str(row.name), "pattern": "HAMMER", "direction": "bullish"})

        # Shooting star (upper wick >= 2x body, small lower wick)
        if body > 0 and upper >= 2 * body and lower <= body * 0.5 and row["close"] < row["open"]:
            patterns.append({"timestamp": str(row.name), "pattern": "SHOOTING_STAR", "direction": "bearish"})
    return patterns


# -------------------------------------------------------------------------
# 4. OI ANALYSIS
# -------------------------------------------------------------------------

def analyze_oi(chain_now: pd.DataFrame, chain_prev: Optional[pd.DataFrame], spot: float, top_n: int = 3) -> dict:
    df = chain_now.copy()
    if chain_prev is not None:
        merged = df.merge(
            chain_prev[["strike", "type", "oi"]].rename(columns={"oi": "oi_prev"}),
            on=["strike", "type"], how="left"
        )
        merged["oi_chg_pct"] = ((merged["oi"] - merged["oi_prev"]) / merged["oi_prev"].replace(0, np.nan)) * 100
    else:
        merged = df.copy()
        merged["oi_chg_pct"] = None

    ce = merged[merged["type"] == "CE"].sort_values("oi", ascending=False)
    pe = merged[merged["type"] == "PE"].sort_values("oi", ascending=False)
    return {
        "resistance_walls": ce[ce["strike"] >= spot].head(top_n)[["strike", "oi", "oi_chg_pct", "ltp"]].to_dict("records"),
        "support_walls": pe[pe["strike"] <= spot].head(top_n)[["strike", "oi", "oi_chg_pct", "ltp"]].to_dict("records"),
        "max_ce_oi_strike": float(ce.iloc[0]["strike"]) if not ce.empty else None,
        "max_pe_oi_strike": float(pe.iloc[0]["strike"]) if not pe.empty else None,
    }


# -------------------------------------------------------------------------
# 5. TOP-LEVEL AGENT
# -------------------------------------------------------------------------

class AnalystAgent:
    def __init__(self, nubra_client):
        self.client = nubra_client
        self._prev_chain: dict[str, pd.DataFrame] = {}

    async def run(self, underlying: str, expiry: str, index_symbol: str) -> dict:
        df_1m = await self._fetch_ohlc(index_symbol, interval="1m", lookback=2000)
        spot = float(df_1m["close"].iloc[-1])
        tf_signals = multi_timeframe_analysis(df_1m)
        m15 = resample_ohlc(df_1m, "15min")
        patterns = detect_candlestick_patterns(m15)
        chain_now = await self._fetch_chain(underlying, expiry)
        key = f"{underlying}:{expiry}"
        oi = analyze_oi(chain_now, self._prev_chain.get(key), spot)
        self._prev_chain[key] = chain_now
        return {
            "timestamp": datetime.utcnow().isoformat(),
            "spot": spot,
            "timeframes": {k: v.__dict__ for k, v in tf_signals.items()},
            "patterns": patterns,
            "oi": oi,
        }

    async def _fetch_ohlc(self, symbol: str, interval: str = "1m", lookback: int = 200) -> pd.DataFrame:
        """Pull candles from Nubra timeseries endpoint."""
        raw = await self.client.get(f"/market/timeseries/{symbol}?interval={interval}&limit={lookback}")
        if not raw or not isinstance(raw, list):
            return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
        df = pd.DataFrame(raw)
        df["timestamp"] = pd.to_datetime(df["ts"] if "ts" in df.columns else df.get("time", range(len(df))), unit="s")
        for col_src, col_dst in [("o", "open"), ("h", "high"), ("l", "low"), ("c", "close")]:
            df[col_dst] = df.get(col_src, 0).astype(float) / 100.0
        df["volume"] = df.get("v", 0).astype(int)
        df = df.set_index("timestamp")[["open", "high", "low", "close", "volume"]]
        return df.sort_index()

    async def _fetch_chain(self, underlying: str, expiry: str) -> pd.DataFrame:
        raw = await self.client.get(f"/market/optionchain/{underlying}?expiry={expiry}")
        if not raw or not isinstance(raw, dict) or "ce" not in raw:
            return pd.DataFrame(columns=["strike", "type", "oi", "ltp", "iv", "volume"])
        rows = []
        for s in raw.get("ce", []):
            rows.append({"strike": float(s.get("sp", 0) / 100), "type": "CE", "oi": s.get("oi", 0), "ltp": s.get("ltp", 0) / 100, "iv": s.get("iv", 0), "volume": s.get("volume", 0)})
        for s in raw.get("pe", []):
            rows.append({"strike": float(s.get("sp", 0) / 100), "type": "PE", "oi": s.get("oi", 0), "ltp": s.get("ltp", 0) / 100, "iv": s.get("iv", 0), "volume": s.get("volume", 0)})
        return pd.DataFrame(rows)
