"""
RealSwing Analysis API Routes — Ported from old Nubra project.
Provides 17 endpoints for options analysis using pure pandas calculations.
All endpoints accept instrument + expiry query params and return JSON.
"""

import pandas as pd
import numpy as np
from fastapi import APIRouter, Query
from typing import Optional

from .pcr import calculate_pcr
from .max_pain import calculate_max_pain
from .support_resistance import get_support_resistance
from .expected_move import expected_move
from .atm_iv import get_atm_iv
from .market_outlook import market_outlook
from .market_regime import market_regime
from .momentum_tracker import momentum_tracker
from .trade_candidates import trade_candidates
from .signal_engine import generate_signals
from .institutional_flow import institutional_flow
from .smart_money import smart_money_signals
from .confidence_engine import calculate_confidence
from .strategy_engine import suggest_strategy

router = APIRouter(prefix="/api/analysis", tags=["analysis"])


def chain_to_dataframe(chain: dict, spot: float = 0) -> pd.DataFrame:
    """Convert a Nubra option chain dict to a pandas DataFrame for analysis.

    chain: { ce: [...strikes], pe: [...strikes] }
    Each strike: { strike, sp, oi, prev_oi, volume, iv, delta, ltp, ltpchg }
    """
    rows = []
    for side, key in [("CE", "ce"), ("PE", "pe")]:
        for s in chain.get(key, []):
            rows.append({
                "type": side,
                "strike": (s.get("sp") or s.get("strike") or 0) / 100,
                "oi": s.get("oi", 0),
                "oi_change": (s.get("oi", 0) or 0) - (s.get("prev_oi", 0) or 0),
                "volume": s.get("volume", 0),
                "iv": s.get("iv", 0.0),
                "delta": s.get("delta", 0.0),
                "ltp": (s.get("ltp", 0) or 0) / 100,
                "ltp_change": s.get("ltpchg", 0) or 0,
            })
    df = pd.DataFrame(rows)
    if not df.empty:
        # Ensure numeric types
        for col in ["oi", "oi_change", "volume", "iv", "delta", "ltp", "ltp_change"]:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
        df["strike"] = pd.to_numeric(df["strike"], errors="coerce")
    return df


def _int_or_none(v):
    try:
        r = int(float(str(v).replace(",", "")))
        return r if pd.notna(r) else None
    except:
        return None


def _clean(val):
    """Replace NaN/Inf with None for JSON serialization."""
    if isinstance(val, float) and (np.isnan(val) or np.isinf(val)):
        return None
    if isinstance(val, (np.integer,)):
        return int(val)
    if isinstance(val, (np.floating,)):
        return None if np.isnan(val) or np.isinf(val) else float(val)
    if isinstance(val, pd.Series):
        return _clean(val.iloc[0]) if len(val) > 0 else None
    if isinstance(val, dict):
        return {k: _clean(v) for k, v in val.items()}
    if isinstance(val, (list, tuple)):
        return [_clean(v) for v in val]
    return val


def _jsonify(data):
    """Recursively clean and convert to JSON-safe types."""
    import json
    return json.loads(json.dumps(data, default=str))


def _get_chain(instrument: str = "NIFTY", expiry: str = None):
    """Fetch chain from Nubra via the client.
    This will be called from inside a request context that has session_token.
    For now returns None — the frontend calls nubra_backend endpoints directly.
    """
    return None


# ── Helper: build a DataFrame from Nubra option chain endpoint ────────────
# The frontend calls /market/optionchain first, then sends the result to
# these analysis endpoints. For backward compatibility, all endpoints also
# accept the chain data as POST body.


@router.get("/market-snapshot")
async def get_market_snapshot(
    instrument: str = "NIFTY",
    expiry: Optional[str] = None,
    ce: Optional[str] = Query(None, description="JSON array of CE strikes"),
    pe: Optional[str] = Query(None, description="JSON array of PE strikes"),
    spot: float = Query(0, description="Spot price"),
):
    """GET /api/analysis/market-snapshot - Key market metrics."""
    if not ce or not pe:
        return {"error": "ce and pe query params required (JSON arrays)", "spot": 0}
    import json
    chain = {"ce": json.loads(ce) if isinstance(ce, str) else ce or [],
             "pe": json.loads(pe) if isinstance(pe, str) else pe or []}
    df = chain_to_dataframe(chain)
    spot_val = spot or (df["strike"].median() if not df.empty else 24000)

    pcr_data = _clean(calculate_pcr(df))
    mp = _clean(calculate_max_pain(df))
    atm_iv_val = _clean(get_atm_iv(df, spot_val))

    return _jsonify({
        "spot": round(spot_val, 2),
        "pcr": round(pcr_data.get("PCR", 0), 2) if isinstance(pcr_data, dict) else 0,
        "pcr_interpretation": pcr_data.get("INTERPRETATION", "") if isinstance(pcr_data, dict) else "",
        "max_pain": _int_or_none(mp),
        "atm_iv": atm_iv_val,
        "timestamp": pd.Timestamp.now().isoformat(),
    })


@router.get("/support-resistance")
async def get_sr_levels(
    instrument: str = "NIFTY",
    ce: str = Query("[]"),
    pe: str = Query("[]"),
    spot: float = 0,
):
    """Support and resistance levels from OI concentration."""
    import json
    chain = {"ce": json.loads(ce), "pe": json.loads(pe)}
    df = chain_to_dataframe(chain)
    support, resistance = get_support_resistance(df)
    return _jsonify({
        "support_levels": [_int_or_none(s) for s in support[:5]],
        "resistance_levels": [_int_or_none(r) for r in resistance[:5]],
    })


@router.get("/volatility")
async def get_volatility(
    instrument: str = "NIFTY",
    ce: str = Query("[]"),
    pe: str = Query("[]"),
    spot: float = 0,
):
    """Volatility analysis: ATM IV, expected move, IV skew."""
    import json
    chain = {"ce": json.loads(ce), "pe": json.loads(pe)}
    df = chain_to_dataframe(chain)
    spot_val = spot or (df["strike"].median() if not df.empty else 24000)
    atm_iv_val = get_atm_iv(df, spot_val) or 0
    move = expected_move(spot_val, atm_iv_val)
    return _jsonify({
        "atm_iv": round(atm_iv_val, 2),
        "expected_move": move.get("expected_move", 0) if isinstance(move, dict) else move,
        "iv_skew": round((df[df.type=="PE"]["iv"].mean() - df[df.type=="CE"]["iv"].mean()), 2) if not df.empty else 0,
    })


@router.get("/momentum")
async def get_momentum(
    instrument: str = "NIFTY",
    ce: str = Query("[]"),
    pe: str = Query("[]"),
    spot: float = 0,
):
    """Momentum analysis: long/short signals from OI + volume changes."""
    import json
    chain = {"ce": json.loads(ce), "pe": json.loads(pe)}
    df = chain_to_dataframe(chain)
    if df.empty:
        return {"momentum_longs": [], "momentum_shorts": []}
    mom_df = momentum_tracker(df)
    longs = mom_df[mom_df["scalp_signal"] == "MOMENTUM LONG"].head(10)
    shorts = mom_df[mom_df["scalp_signal"] == "MOMENTUM SHORT"].head(10)
    return _jsonify({
        "momentum_longs": longs[["strike", "type", "momentum_score", "confidence"]].to_dict(orient="records"),
        "momentum_shorts": shorts[["strike", "type", "momentum_score", "confidence"]].to_dict(orient="records"),
    })


@router.get("/oi-dynamics")
async def get_oi_dynamics(
    instrument: str = "NIFTY",
    ce: str = Query("[]"),
    pe: str = Query("[]"),
):
    """OI buildup and unwinding across strikes."""
    import json
    chain = {"ce": json.loads(ce), "pe": json.loads(pe)}
    df = chain_to_dataframe(chain)
    if df.empty:
        return {"buildup": [], "unwind": []}
    buildup = df.sort_values("oi_change", ascending=False).head(10)[["type", "strike", "oi_change", "oi"]].to_dict(orient="records")
    unwind = df.sort_values("oi_change").head(10)[["type", "strike", "oi_change", "oi"]].to_dict(orient="records")
    return _jsonify({"buildup": buildup, "unwind": unwind})


@router.get("/market-outlook")
async def get_outlook(
    instrument: str = "NIFTY",
    ce: str = Query("[]"),
    pe: str = Query("[]"),
    spot: float = 0,
):
    """Market outlook + regime classification."""
    import json
    chain = {"ce": json.loads(ce), "pe": json.loads(pe)}
    df = chain_to_dataframe(chain)
    spot_val = spot or (df["strike"].median() if not df.empty else 24000)
    pcr_data = calculate_pcr(df)
    support, resistance = get_support_resistance(df)
    outlook = market_outlook(spot_val, support, resistance, pcr_data.get("PCR", 0))
    regime = market_regime(pcr_data.get("PCR", 0), spot_val, support, resistance)
    return _jsonify({"outlook": outlook, "regime": regime})


@router.get("/smart-money")
async def get_smart_money(
    instrument: str = "NIFTY",
    ce: str = Query("[]"),
    pe: str = Query("[]"),
):
    """Smart money / institutional flow signals."""
    import json
    chain = {"ce": json.loads(ce), "pe": json.loads(pe)}
    df = chain_to_dataframe(chain)
    if df.empty:
        return {"signals": [], "flow": []}
    signals = generate_signals(df)
    flow_df = institutional_flow(df)
    return _jsonify({
        "signals": signals[:8],
        "flow": flow_df.sort_values("oi_change", ascending=False).head(20)[["type", "strike", "oi_change", "volume"]].to_dict(orient="records") if not flow_df.empty else [],
    })


@router.get("/trade-candidates")
async def get_trades(
    limit: int = 20,
    ce: str = Query("[]"),
    pe: str = Query("[]"),
    spot: float = 0,
):
    """Top trade candidates ranked by OI + volume score."""
    import json
    chain = {"ce": json.loads(ce), "pe": json.loads(pe)}
    df = chain_to_dataframe(chain)
    spot_val = spot or (df["strike"].median() if not df.empty else 24000)
    if df.empty:
        return {"candidates": []}
    candidates = trade_candidates(df, spot_val)
    top = candidates.head(limit)[["type", "strike", "oi", "volume", "score"]].to_dict(orient="records")
    return _jsonify({"candidates": top})


@router.get("/strategies")
async def get_strategies(
    instrument: str = "NIFTY",
    ce: str = Query("[]"),
    pe: str = Query("[]"),
    spot: float = 0,
):
    """Strategy recommendations based on market conditions."""
    import json
    chain = {"ce": json.loads(ce), "pe": json.loads(pe)}
    df = chain_to_dataframe(chain)
    spot_val = spot or (df["strike"].median() if not df.empty else 24000)
    pcr_data = calculate_pcr(df)
    support, resistance = get_support_resistance(df)
    strategy = suggest_strategy(spot_val, pcr_data.get("PCR", 0), support, resistance)
    return _jsonify({
        "strategy": strategy,
        "market_bias": "Bullish" if pcr_data.get("PCR", 0) > 1 else "Bearish" if pcr_data.get("PCR", 0) < 0.7 else "Neutral",
    })


@router.get("/system-health")
async def get_system_health(
    instrument: str = "NIFTY",
    ce: str = Query("[]"),
    pe: str = Query("[]"),
    spot: float = 0,
):
    """System health overview with key metrics summary."""
    import json
    chain = {"ce": json.loads(ce), "pe": json.loads(pe)}
    df = chain_to_dataframe(chain)
    spot_val = spot or (df["strike"].median() if not df.empty else 24000)
    pcr_data = calculate_pcr(df)
    mp = calculate_max_pain(df)
    atm_iv_val = get_atm_iv(df, spot_val) or 0
    return _jsonify({
        "data_points": len(df),
        "max_oi_change": int(df["oi_change"].abs().max()) if not df.empty else 0,
        "market_summary": {
            "Spot": round(spot_val, 2),
            "PCR": round(pcr_data.get("PCR", 0), 2),
            "Max Pain": _int_or_none(mp),
            "ATM IV": round(atm_iv_val, 2),
        }
    })


@router.get("/oi-distribution")
async def get_oi_distribution(
    instrument: str = "NIFTY",
    ce: str = Query("[]"),
    pe: str = Query("[]"),
    spot: float = 0,
):
    """OI distribution grouped by strike (for heatmap chart)."""
    import json
    chain = {"ce": json.loads(ce), "pe": json.loads(pe)}
    df = chain_to_dataframe(chain)
    spot_val = spot or (df["strike"].median() if not df.empty else 24000)
    if df.empty:
        return []
    temp = df.groupby(["strike", "type"])["oi"].sum().reset_index()
    pivoted = temp.pivot(index="strike", columns="type", values="oi").reset_index().fillna(0)
    pivoted.columns = ["strike", "calls_oi", "puts_oi"]
    # Filter ±10% around spot
    pivoted = pivoted[(pivoted["strike"] >= spot_val * 0.9) & (pivoted["strike"] <= spot_val * 1.1)]
    return _jsonify(pivoted.sort_values("strike").to_dict(orient="records"))
