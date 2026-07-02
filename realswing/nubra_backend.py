"""RealSwing Scalping Assistant — FastAPI Backend
Nubra Auth Flow (corrected per official docs):
  Step 1: POST /sendphoneotp  {phone, skip_totp:false}         → temp_token
  Step 2: POST /sendphoneotp  x-temp-token + {phone, skip_totp:true} → new temp_token
  Step 3: POST /verifyphoneotp x-temp-token + x-device-id + {phone, otp} → auth_token
  Step 4: POST /verifypin     Authorization:Bearer auth_token + x-device-id + {pin} → session_token
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from pydantic import BaseModel
from typing import Optional

from analysis.routes import router as analysis_router
import httpx

__all__ = ["app"]

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage shared httpx client lifecycle at module level."""
    global _http
    limits = httpx.Limits(max_connections=20, max_keepalive_connections=10)
    _http = httpx.AsyncClient(timeout=httpx.Timeout(15.0), limits=limits)
    yield
    await _http.aclose()
    _http = None

_http: httpx.AsyncClient | None = None

def http() -> httpx.AsyncClient:
    """Get the shared httpx client (raises if called outside lifespan)."""
    c = _http
    if c is None:
        raise RuntimeError("httpx client not initialized — call under lifespan")
    return c

app = FastAPI(title="RealSwing Backend", version="2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)

app.include_router(analysis_router)

UAT_BASE  = "https://uatapi.nubra.io"
PROD_BASE = "https://api.nubra.io"

def base(env: str = "UAT") -> str:
    return UAT_BASE if env.upper() == "UAT" else PROD_BASE

# ── AUTH MODELS ───────────────────────────────────────────────────────────────

class Step1Body(BaseModel):
    phone: str          # 10-digit mobile number
    env: str = "UAT"

class Step2Body(BaseModel):
    phone: str
    temp_token: str     # from Step 1
    env: str = "UAT"

class Step3Body(BaseModel):
    phone: str
    otp: str
    temp_token: str     # from Step 2
    device_id: str = "TS123"
    env: str = "UAT"

class Step4Body(BaseModel):
    pin: str            # MPIN
    auth_token: str     # from Step 3
    device_id: str = "TS123"
    env: str = "UAT"

# ── AUTH ENDPOINTS ────────────────────────────────────────────────────────────

@app.post("/auth/step1")
async def step1_send_otp(body: Step1Body):
    """
    POST /sendphoneotp  {phone, skip_totp: false}
    Initiates login, returns temp_token + sends OTP to mobile.
    """
    c = http()
    r = await c.post(
        f"{base(body.env)}/sendphoneotp",
        headers={"Content-Type": "application/json"},
        json={"phone": body.phone, "skip_totp": False},
    )
    data = r.json()

    print(f"[step1] status={r.status_code} response={data}", flush=True)

    if r.status_code != 200:
        raise HTTPException(r.status_code, r.text)

    return data

@app.post("/auth/step2")

async def step2_resend_otp(body: Step2Body):
    """
    POST /sendphoneotp  x-temp-token header + {phone, skip_totp: true}
    Triggers actual OTP SMS. Returns updated temp_token.
    """
    c = http()
    r = await c.post(
        f"{base(body.env)}/sendphoneotp",
        headers={
            "Content-Type": "application/json",
            "x-temp-token": body.temp_token,
        },
        json={"phone": body.phone, "skip_totp": True},
    )

    data = r.json()

    print(f"[step2] status={r.status_code} response={data}", flush=True)

    if r.status_code != 200:
        raise HTTPException(r.status_code, r.text)

    return data

@app.post("/auth/step3")

async def step3_verify_otp(body: Step3Body):
    """
    POST /verifyphoneotp  x-temp-token + x-device-id + {phone, otp}
    Returns auth_token. Next step: ENTER_MPIN.
    """
    c = http()
    r = await c.post(
        f"{base(body.env)}/verifyphoneotp",
        headers={
            "Content-Type": "application/json",
            "x-temp-token": body.temp_token,
            "x-device-id": body.device_id,
        },
        json={"phone": body.phone, "otp": body.otp},
    )

    data = r.json()

    print(f"[step3] status={r.status_code} response={data}", flush=True)

    if r.status_code != 200 and r.status_code != 201:
        raise HTTPException(r.status_code, r.text)

    return data

@app.post("/auth/step4")

async def step4_verify_pin(body: Step4Body):
    """
    POST /verifypin  Authorization:Bearer auth_token + x-device-id + {pin}
    Returns session_token. Used as Bearer for all subsequent API calls.
    """
    print(f"[step4] body={body.model_dump()}", flush=True)

    c = http()
    r = await c.post(
            f"{base(body.env)}/verifypin",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {body.auth_token}",
                "x-device-id": body.device_id,
            },
            json={"pin": body.pin},
            timeout=10,
        )

    data = r.json()

    print(f"[step4] Nubra response status={r.status_code} data={data}", flush=True)

    if r.status_code != 200:
        raise HTTPException(r.status_code, r.text)

    return data

# ── MARKET DATA ───────────────────────────────────────────────────────────────

@app.get("/market/price/{instrument}")

async def current_price(
    instrument: str, exchange: str = "NSE",
    session_token: str = "", device_id: str = "TS123", env: str = "UAT"
):
    c = http()
    r = await c.get(
        f"{base(env)}/optionchains/{instrument}/price",
        params={"exchange": exchange},
        headers={"Authorization": f"Bearer {session_token}", "x-device-id": device_id},
    )

    if r.status_code != 200:
        raise HTTPException(r.status_code, r.text)

    return r.json()


@app.get("/market/optionchain/{instrument}")

async def option_chain(
    instrument: str, expiry: str = "", exchange: str = "NSE",
    session_token: str = "", device_id: str = "TS123", env: str = "UAT"
):
    c = http()
    params = {"exchange": exchange}
    if expiry:
        params["expiry"] = expiry
    r = await c.get(
        f"{base(env)}/optionchains/{instrument}",
        params=params,
        headers={"Authorization": f"Bearer {session_token}", "x-device-id": device_id},
    )

    if r.status_code != 200:
        raise HTTPException(r.status_code, r.text)

    return r.json()


@app.get("/market/quotes/{ref_id}")

async def market_quotes(
    ref_id: int, levels: int = 5,
    session_token: str = "", device_id: str = "TS123", env: str = "UAT"
):
    c = http()
    r = await c.get(
        f"{base(env)}/orderbooks/{ref_id}",
        params={"levels": levels},
            headers={"Authorization": f"Bearer {session_token}", "x-device-id": device_id},
            timeout=10,
        )

    if r.status_code != 200:
        raise HTTPException(r.status_code, r.text)

    return r.json()


# ── PORTFOLIO ─────────────────────────────────────────────────────────────────

@app.get("/portfolio/positions")

async def positions(
    session_token: str = "", device_id: str = "TS123", env: str = "UAT"
):
    c = http()
    r = await c.get(
        f"{base(env)}/portfolio/positions",
        headers={"Authorization": f"Bearer {session_token}", "x-device-id": device_id},
    )

    if r.status_code != 200:
        raise HTTPException(r.status_code, r.text)

    return r.json()


@app.get("/portfolio/funds")

async def funds(
    session_token: str = "", device_id: str = "TS123", env: str = "UAT"
):
    c = http()
    r = await c.get(
        f"{base(env)}/portfolio/user_funds_and_margin",
        headers={"Authorization": f"Bearer {session_token}", "x-device-id": device_id},
    )

    if r.status_code != 200:
        raise HTTPException(r.status_code, r.text)

    return r.json()



@app.get("/portfolio/orders")

async def order_history(
    session_token: str = "",
    device_id: str = "TS123",
    env: str = "UAT",
):
    c = http()
    r = await c.get(
        f"{base(env)}/sentinel/orders",
        headers={"Authorization": f"Bearer {session_token}", "x-device-id": device_id},
    )

    if r.status_code != 200:
        raise HTTPException(r.status_code, r.text)

    return r.json()



# ── TRADING ───────────────────────────────────────────────────────────────────

class PlaceOrder(BaseModel):
    ref_id: int
    order_type: str = "ORDER_TYPE_REGULAR"
    order_qty: int
    order_side: str                        # ORDER_SIDE_BUY | ORDER_SIDE_SELL
    order_delivery_type: str = "ORDER_DELIVERY_TYPE_IDAY"
    validity_type: str = "DAY"
    order_price: int                       # in paise
    trigger_price: Optional[int] = None   # stoploss only, in paise
    tag: str = "realswing"
    session_token: str
    device_id: str = "TS123"
    env: str = "UAT"

@app.post("/trade/order")

async def place_order(body: PlaceOrder):
    """POST /sentinel/orders/create — OMS V3.
    Wrapped: exceptions never crash the server — they return error JSON instead."""
    try:
        entry_config = {}
        if body.trigger_price:
            entry_config["triggers"] = {"ltp": {"atOrAbove": {"value": body.trigger_price}}}

        payload = {
            "orders": [{
                "refId": body.ref_id,
                "qty": body.order_qty,
                "side": body.order_side.split("_")[-1] if "_" in body.order_side else body.order_side,
                "deliveryType": "IDAY",
                "priceType": "LIMIT",
                "validityType": "DAY",
                "isMultiLeg": False,
                "executionMode": "ENTRY",
                "entryPrice": body.order_price,
                "stratTags": [body.tag],
            }]
        }
        if body.trigger_price:
            payload["orders"][0]["entryConfig"] = entry_config

        c = http()
        r = await c.post(
            f"{base(body.env)}/sentinel/orders/create",
            headers={
                "Authorization": f"Bearer {body.session_token}",
                "x-device-id": body.device_id,
                "Content-Type": "application/json",
            },
            json=payload,
            )

        if r.status_code not in (200, 201):
            body_preview = r.text[:1000]
            print(f"[order] Nubra {r.status_code} ref_id={body.ref_id} env={body.env}: {body_preview}", flush=True)
            return {
                "error": f"Nubra returned {r.status_code}",
                "detail": body_preview,
                "request": {
                    "env": body.env, "ref_id": body.ref_id, "side": body.order_side,
                    "qty": body.order_qty, "price": body.order_price,
                },
            }
        return r.json()

    except httpx.TimeoutException:
        print(f"[order] Timeout ref_id={body.ref_id}", flush=True)
        return {"error": "Nubra API timed out. Retry?"}
    except httpx.ConnectError as e:
        print(f"[order] ConnectError: {e}", flush=True)
        return {"error": f"Cannot reach Nubra: {e}"}
    except Exception as e:
        print(f"[order] {type(e).__name__}: {e}", flush=True)
        return {"error": f"{type(e).__name__}: {e}"}


@app.get("/health")

async def health():
    return {"status": "ok", "service": "nubra-proxy"}


# ── F&O INSTRUMENT LIST ──────────────────────────────────────────────────────────

FNO_INDICES = [
    {"name": "NIFTY",     "exchange": "NSE"},
    {"name": "BANKNIFTY", "exchange": "NSE"},
    {"name": "FINNIFTY",  "exchange": "NSE"},
    {"name": "MIDCPNIFTY","exchange": "NSE"},
    {"name": "SENSEX",    "exchange": "BSE"},
    {"name": "BANKEX",    "exchange": "BSE"},
]

FNO_STOCKS = [
    "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK",
    "HINDUNILVR", "ITC", "SBIN", "BHARTIARTL", "KOTAKBANK",
    "LT", "WIPRO", "AXISBANK", "BAJFINANCE", "MARUTI",
    "TITAN", "ASIANPAINT", "NTPC", "ONGC", "POWERGRID",
    "ULTRACEMCO", "SUNPHARMA", "HCLTECH", "ADANIENT", "ADANIPORTS",
    "TATAMOTORS", "M&M", "JSWSTEEL", "TATASTEEL", "COALINDIA",
    "GRASIM", "BAJAJFINSV", "HEROMOTOCO", "NESTLEIND", "BRITANNIA",
    "DRREDDY", "CIPLA", "DIVISLAB", "SBILIFE", "ICICIPRULI",
    "HDFCLIFE", "TECHM", "INDUSINDBK", "HINDALCO",
    "EICHERMOT", "BPCL", "MARICO", "TRENT",
    "BEL", "HAL", "VEDL", "IOC", "PIDILITIND",
    "COLPAL", "DLF", "SIEMENS", "ZOMATO",
    "TVSMOTOR", "MUTHOOTFIN", "PERSISTENT",
]


@app.get("/market/instruments")

async def list_instruments():
    """Return all indices and stocks with active F&O trading."""
    return {
        "indices": FNO_INDICES,
        "stocks": [{"name": s, "exchange": "NSE"} for s in FNO_STOCKS],
    }


@app.get("/market/expiries/{instrument}")

async def get_expiries(
    instrument: str,
    exchange: str = "NSE",
    session_token: str = "",
    device_id: str = "TS123",
    env: str = "UAT",
):
    """Fetch available expiry dates for a given F&O instrument from Nubra."""
    c = http()
    r = await c.get(
        f"{base(env)}/optionchains/{instrument}",
        params={"exchange": exchange},
        headers={
            "Authorization": f"Bearer {session_token}",
            "x-device-id": device_id,
        },
    )

    if r.status_code != 200:
        raise HTTPException(r.status_code, r.text)

    data = r.json()

    chain = data.get("chain", {})

    expiries = chain.get("all_expiries", [])

    current = chain.get("expiry", "")

    return {"expiries": expiries, "current_expiry": current}


# ── AI MOMENTUM ANALYSIS ──────────────────────────────────────────────────────
# Uses 9Router (free AI via local endpoint at http://localhost:20128/v1)

# Loads config from env vars (set in .env)


import os

NINE_ROUTER_BASE = os.getenv("NINE_ROUTER_BASE", "http://localhost:20128/v1")

NINE_ROUTER_KEY  = os.getenv("NINE_ROUTER_API_KEY", "")

NINE_ROUTER_MODEL = os.getenv("NINE_ROUTER_MODEL", "cc/claude-opus-4-5")



class HistoryRequest(BaseModel):
    exchange: str = "NSE"
    instrument: str = "NIFTY"
    interval: str = "5m"
    start_date: str = ""
    end_date: str = ""
    session_token: str = ""
    env: str = "UAT"


@app.post("/market/timeseries")
async def market_timeseries(body: HistoryRequest):
    """Proxy for Nubra POST /charts/timeseries — historical candle data."""
    b = base(body.env)
    headers = {"x-device-id": "TS123", "Content-Type": "text/plain"}
    if body.session_token:
        headers["Authorization"] = f"Bearer {body.session_token}"

    # Ensure proper ISO date format for Nubra
    sd = body.start_date
    ed = body.end_date
    # FastAPI may strip the .000Z — restore it
    import re
    if sd:
        sd = sd[:23] if len(sd) > 23 else sd
        if not sd.endswith('Z'): sd += '.000Z'
    else:
        from datetime import datetime, timedelta
        sd = (datetime.utcnow() - timedelta(days=7)).strftime('%Y-%m-%dT%H:%M:%S.000Z')
    if ed:
        ed = ed[:23] if len(ed) > 23 else ed
        if not ed.endswith('Z'): ed += '.000Z'
    else:
        from datetime import datetime
        ed = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.000Z')

    payload = {
        "query": [{
            "exchange": body.exchange,
            "type": "INDEX" if body.instrument in ["NIFTY","BANKNIFTY","SENSEX","FINNIFTY"] else "STOCK",
            "values": [body.instrument],
            "fields": ["open","high","low","close","tick_volume","cumulative_volume"],
            "startDate": sd,
            "endDate": ed,
            "interval": body.interval,
            "intraDay": True,
            "realTime": False,
        }]
    }

    import json
    body_str = json.dumps(payload)
    print(f"[timeseries] POST {b}/charts/timeseries env={body.env}", flush=True)
    print(f"[timeseries] headers={ {k:v[:30] for k,v in headers.items()} }", flush=True)
    print(f"[timeseries] body={body_str[:300]}", flush=True)
    c = http()
    r = await c.post(
        f"{b}/charts/timeseries",
        headers=headers,
        content=body_str,
    )
    resp_text = r.text[:2000]
    print(f"[timeseries] Nubra status={r.status_code} resp={resp_text}", flush=True)
    if r.status_code != 200:
        try:
            err_detail = r.json()
        except Exception:
            err_detail = resp_text
        raise HTTPException(status_code=r.status_code, detail=err_detail)
    data = r.json()

    # Transform to flat candle array for frontend
    candles = []
    try:
        values = data.get("result", [{}])[0].get("values", [{}])[0]
        symbol = list(values.keys())[0]
        fields = values[symbol]
        opens = fields.get("open", [])
        for i, o in enumerate(opens):
            candles.append({
                "time": o["ts"] // 1000000000 if o["ts"] > 1e12 else o["ts"],
                "open": o["v"],
                "high": fields.get("high", [{}] * len(opens))[i].get("v", o["v"]),
                "low": fields.get("low", [{}] * len(opens))[i].get("v", o["v"]),
                "close": fields.get("close", [{}] * len(opens))[i].get("v", o["v"]),
                "volume": fields.get("tick_volume", [{}] * len(opens))[i].get("v", 0),
            })
    except (KeyError, IndexError, TypeError):
        pass

    return {"candles": candles, "symbol": body.instrument}


class MomentumRequest(BaseModel):
    instrument: str
    spot: float = 0
    atm: float = 0
    ce: list = []
    pe: list = []
    query: str = ""


@app.post("/ai/momentum")

async def ai_momentum_analysis(req: MomentumRequest):
    """Call 9Router to analyse option chain data and return momentum insights."""
    if not NINE_ROUTER_KEY:
        return {"analysis": "9Router not configured. Set NINE_ROUTER_API_KEY in .env"}

    # Build a concise prompt with top strikes
    ce_sorted = sorted(req.ce, key=lambda x: abs(x.get("strike", 0) - req.atm * 100))[:8]
    pe_sorted = sorted(req.pe, key=lambda x: abs(x.get("strike", 0) - req.atm * 100))[:8]

    # Build the prompt, optionally including web search context
    web_context = ""
    if req.query:
        web_context = f"\n\nUSER QUERY / CONTEXT: {req.query}\n\nConsider this information in your analysis and list any key events, dates, and levels mentioned."

    prompt = f"""You are an expert Indian F&O momentum analyst. Analyse this {req.instrument} option chain.{web_context}

Spot: ₹{req.spot}
ATM: ₹{req.atm}

CE STRIKES (strike, OI, OI chg, IV, delta):
{chr(10).join(f"{s.get('strike',0)/100:.0f} OI={s.get('oi',0):,} Chg={s.get('oi',0)-(s.get('prev_oi',0) or 0):+} IV={s.get('iv',0)}% Delta={s.get('delta',0)}" for s in ce_sorted)}

PE STRIKES (strike, OI, OI chg, IV, delta):
{chr(10).join(f"{s.get('strike',0)/100:.0f} OI={s.get('oi',0):,} Chg={s.get('oi',0)-(s.get('prev_oi',0) or 0):+} IV={s.get('iv',0)}% Delta={s.get('delta',0)}" for s in pe_sorted)}

Respond in this exact format (no markdown):
MOMENTUM: [BULLISH|BEARISH|SIDEWAYS]
CONFIDENCE: [HIGH|MEDIUM|LOW]
KEY_LEVELS: [key support/resistance with price levels]
KEY_EVENTS: [list any upcoming events/dates that could affect price]
ANALYSIS: [2-3 sentence explanation integrating option chain data]
TRADE_IDEA: [1 sentence actionable idea]"""

    try:
        ai_client = httpx.AsyncClient(timeout=30.0)
        r = await ai_client.post(
            f"{NINE_ROUTER_BASE}/chat/completions",
            headers={"Authorization": f"Bearer {NINE_ROUTER_KEY}", "Content-Type": "application/json"},
            json={
                "model": NINE_ROUTER_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.2,
                "max_tokens": 500,
            },
        )
        await ai_client.aclose()
        r.raise_for_status()
        content = r.json()["choices"][0]["message"]["content"]
        return {"analysis": content.strip()}
    except Exception as e:
        return {"analysis": f"AI unavailable: {type(e).__name__}"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=9000, reload=False)

