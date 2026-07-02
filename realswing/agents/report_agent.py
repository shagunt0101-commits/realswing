"""
ReportAgent - RealSwing
Takes AnalystAgent output + option chain, computes real entry/SL/target levels
via Black-Scholes, then asks local LLM (9Router) for Scenario A/B/C narrative.
"""
import json
from datetime import datetime, date
from typing import Optional
from vollib.black_scholes.greeks.analytical import delta as bs_delta
from vollib.black_scholes import black_scholes as bs_price
from openai import OpenAI

RISK_FREE_RATE = 0.065


def _tte(expiry_date: date) -> float:
    days = (expiry_date - date.today()).days
    return max(days, 0.5) / 365.0


def compute_strike_levels(
    strike: float, opt_type: str, spot: float, ltp: float,
    iv: float, expiry_date: date,
    target_spot_moves: Optional[list[float]] = None,
    sl_spot_move: Optional[float] = None,
) -> dict:
    flag = opt_type.lower()[0]
    t = _tte(expiry_date)
    targets = target_spot_moves or [200, 450]
    sl_move = sl_spot_move or 300

    sl_spot = spot + sl_move if flag == "c" else spot - sl_move
    sl_price = round(bs_price(flag, sl_spot, strike, t, RISK_FREE_RATE, iv), 2)

    tgt = []
    for move in targets:
        proj_spot = spot + move if flag == "c" else spot - move
        proj_price = round(bs_price(flag, proj_spot, strike, t, RISK_FREE_RATE, iv), 2)
        tgt.append({"spot_level": round(proj_spot, 2), "option_price": proj_price})

    d = round(bs_delta(flag, spot, strike, t, RISK_FREE_RATE, iv), 3)
    moneyness = "ITM" if (flag == "c" and strike < spot) or (flag == "p" and strike > spot) else \
                "OTM" if (flag == "c" and strike > spot) or (flag == "p" and strike < spot) else "ATM"

    return {
        "strike": strike, "type": "CE" if flag == "c" else "PE",
        "ltp": ltp, "delta": d,
        "entry_zone": [round(ltp * 0.93, 2), round(ltp * 1.02, 2)],
        "stop_loss": {"trigger_spot": round(sl_spot, 2), "option_price": sl_price},
        "targets": tgt, "moneyness": moneyness,
    }


def build_levels_table(chain_df, spot: float, expiry_date: date, candidate_strikes: list[float]) -> list[dict]:
    rows = []
    for strike in candidate_strikes:
        for opt_type, flag in [("CE", "c"), ("PE", "p")]:
            match = chain_df[(chain_df["type"] == opt_type) & (chain_df["strike"] == strike)]
            if match.empty:
                continue
            row = match.iloc[0]
            iv = float(row.get("iv", 0)) or 0.15
            rows.append(compute_strike_levels(
                strike=strike, opt_type=flag, spot=spot,
                ltp=float(row["ltp"]), iv=iv, expiry_date=expiry_date,
            ))
    return rows


SYSTEM_PROMPT = """You are a trading desk analyst writing a concise Scenario A/B/C \
decision tree for an options trader. You will be given real computed indicator \
values, OI data, candlestick patterns, and pre-computed entry/SL/target levels \
as JSON.

STRICT RULES:
- Use ONLY the numbers provided. Never invent a price, strike, or level.
- If data is insufficient, say so instead of guessing.
- Output valid JSON. No prose outside the JSON.
- Keep language terse and directive."""

OUTPUT_SCHEMA = """
Respond with JSON only:
{"bias":"BULLISH"/"BEARISH"/"NEUTRAL",
"scenario_a":{"condition":"...","action":"...","strike":"...","entry":"...","sl":"...","target":"..."},
"scenario_b":{...},
"scenario_c":{...},
"key_risk":"..."}
"""


class ReportAgent:
    def __init__(self, base_url: str = "http://localhost:20128/v1", model: str = "local-model", api_key: str = "not-needed"):
        self.client = OpenAI(base_url=base_url, api_key=api_key)
        self.model = model

    def generate(self, analyst_output: dict, levels_table: list[dict], oi_summary: dict) -> dict:
        payload = {
            "spot": analyst_output.get("spot"),
            "timeframes": analyst_output.get("timeframes", {}),
            "patterns": analyst_output.get("patterns", [])[-5:],
            "oi": oi_summary,
            "levels": levels_table,
        }
        try:
            resp = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT + OUTPUT_SCHEMA},
                    {"role": "user", "content": json.dumps(payload, default=str)},
                ],
                temperature=0.2, max_tokens=800, timeout=20,
            )
            raw = resp.choices[0].message.content.strip()
            raw = raw.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
            parsed = json.loads(raw)
        except Exception as e:
            parsed = {"error": str(e), "raw": raw if 'raw' in dir() else ""}
        return {"report": parsed, "source": payload}
