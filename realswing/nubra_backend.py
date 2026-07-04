"""RealSwing Scalping Assistant — FastAPI Backend
Nubra Auth Flow (corrected per official docs):
  Step 1: POST /sendphoneotp  {phone, skip_totp:false}         → temp_token
  Step 2: POST /sendphoneotp  x-temp-token + {phone, skip_totp:true} → new temp_token
  Step 3: POST /verifyphoneotp x-temp-token + x-device-id + {phone, otp} → auth_token
  Step 4: POST /verifypin     Authorization:Bearer auth_token + x-device-id + {pin} → session_token
"""

from dotenv import load_dotenv
load_dotenv()

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
    """Proxy for Nubra POST /charts/timeseries — historical candle data.
    Falls back to Yahoo Finance if Nubra fails (no auth, rate limited, etc.)."""
    b = base(body.env)
    headers = {"x-device-id": "TS123", "Content-Type": "application/json"}
    if body.session_token:
        headers["Authorization"] = f"Bearer {body.session_token}"

    import re
    sd = body.start_date
    ed = body.end_date
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
            "startDate": sd, "endDate": ed, "interval": body.interval,
            "intraDay": True, "realTime": False,
        }]
    }

    c = http()
    r = await c.post(f"{b}/v3/charts/timeseries", headers=headers, json=payload)

    if r.status_code == 200 and r.text.strip():
        data = r.json()
        candles = []
        try:
            values = data.get("result", [{}])[0].get("values", [{}])[0]
            symbol = list(values.keys())[0]
            fields = values[symbol]
            opens = fields.get("open", [])
            for i, o in enumerate(opens):
                candles.append({
                    "time": o["ts"] // 1000000000 if o["ts"] > 1e12 else o["ts"],
                    "open": o["v"] / 100,
                    "high": fields.get("high", [{}] * len(opens))[i].get("v", o["v"]) / 100,
                    "low": fields.get("low", [{}] * len(opens))[i].get("v", o["v"]) / 100,
                    "close": fields.get("close", [{}] * len(opens))[i].get("v", o["v"]) / 100,
                    "volume": fields.get("tick_volume", [{}] * len(opens))[i].get("v", 0),
                })
        except (KeyError, IndexError, TypeError):
            pass
        return {"candles": candles, "symbol": body.instrument}

    # Fallback: Yahoo Finance (no auth needed)
    print(f"[timeseries] Nubra returned {r.status_code}, falling back to Yahoo Finance", flush=True)
    yahoo_candles = await _fetch_yahoo_fallback(body.instrument, body.interval, 200)
    if yahoo_candles:
        return {"candles": yahoo_candles, "symbol": body.instrument, "source": "yahoo"}
    raise HTTPException(400, f"Nubra: {r.text[:200]}, Yahoo: no data")


class MomentumRequest(BaseModel):
    instrument: str
    spot: float = 0
    atm: float = 0
    prev_close: float = 0
    expiry: str = ""
    ce: list = []
    pe: list = []
    query: str = ""


@app.post("/ai/momentum")

async def ai_momentum_analysis(req: MomentumRequest):
    """Call 9Router to analyse option chain data and return momentum insights."""
    if not NINE_ROUTER_KEY:
        return {"analysis": "9Router not configured. Set NINE_ROUTER_API_KEY in .env"}

    # Build a concise prompt with top strikes
    ce_list = req.ce or []
    pe_list = req.pe or []
    if not ce_list and not pe_list:
        return {"analysis": "No option chain data provided. Load a chain first."}
    ce_sorted = sorted(ce_list, key=lambda x: abs(float(x.get("strike", x.get("sp", 0))) - req.atm))[:8]
    pe_sorted = sorted(pe_list, key=lambda x: abs(float(x.get("strike", x.get("sp", 0))) - req.atm))[:8]

    web_context = ""
    if req.query:
        web_context = f"\n\nUSER QUERY: {req.query}"

    chg_pct = ((req.spot - req.prev_close) / max(req.prev_close, 1)) * 100 if req.prev_close else 0

    def fmt_strike(s):
        raw = float(s.get("strike", s.get("sp", 0)))
        return raw / 100 if raw > 10000 else raw

    oi_rows = []
    for s in ce_sorted:
        chg = (s.get("oi", 0) or 0) - (s.get("prev_oi", 0) or 0)
        iv = s.get("iv", 0)
        oi_rows.append((abs(chg), f"CE {fmt_strike(s):.0f} OI_chg={chg:+} IV={iv}%"))
    for s in pe_sorted:
        chg = (s.get("oi", 0) or 0) - (s.get("prev_oi", 0) or 0)
        iv = s.get("iv", 0)
        oi_rows.append((abs(chg), f"PE {fmt_strike(s):.0f} OI_chg={chg:+} IV={iv}%"))
    oi_rows.sort(key=lambda x: -x[0])
    oi_table = "\n".join(r[1] for r in oi_rows[:5])

    expiry_note = ""
    if req.expiry:
        from datetime import datetime, timezone
        try:
            exp = datetime.strptime(req.expiry, "%Y%m%d").replace(tzinfo=timezone.utc)
            dte = (exp - datetime.now(timezone.utc)).days
            if dte <= 1:
                expiry_note = "\nEXPIRY DAY - check max pain and short covering as competing force."
        except: pass

    prompt = f"""Analyse this {req.instrument} option chain snapshot.

Spot: {req.spot/100:.0f} | Prev Close: {req.prev_close/100:.0f} | Change: {chg_pct:+.2f}%
ATM: {req.atm/100:.0f}{expiry_note}{web_context}

OI changes sorted by magnitude (largest first):
{oi_table}

Rules (follow strictly):
1. Compute change % from spot vs prev_close. Classify momentum from OI symmetry + change %.
2. Key levels: support = nearest strike below spot with highest OI; resistance = nearest above.
3. Rank OI by change magnitude (already sorted), not absolute OI.
4. Price-OI correlation: OI up + price up = shorts covering/writing; OI up + price down = fresh buying. Say if you can't determine initiation.
5. If expiry within 1 day, check short-covering / max-pain as competing force.
6. Confidence: HIGH if price-OI, IV, OI concentration all agree. MEDIUM if 2 of 3. LOW if conflicting.

Output exactly these sections, in order:

HEADER: {req.spot/100:.0f} | Change {chg_pct:+.2f}% | Momentum | Confidence | S/R range: Support-Resistance
LEVELS: Support: value | Spot: value | Resistance: value
OI_TABLE: (strike, type, OI change in contracts, OI_change_rupees, direction read)
PRIMARY: Instrument + direction | Delta | Reason (tied to OI table) | Risk (what invalidates) | Exit (profit target or time)
ALTERNATIVE: Opposite case | Shorter format
CAUTION: Strike to avoid | Blind spot (e.g. "can't confirm buyer vs seller from this data")
RESPONSIBILITY: Analysis only — decision rests with trader"""

    try:
        ai_client = httpx.AsyncClient(timeout=30.0)
        r = await ai_client.post(
            f"{NINE_ROUTER_BASE}/chat/completions",
            headers={"Authorization": f"Bearer {NINE_ROUTER_KEY}", "Content-Type": "application/json"},
            json={
                "model": NINE_ROUTER_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
                "temperature": 0.2,
                "max_tokens": 500,
            },
        )
        await ai_client.aclose()
        r.raise_for_status()
        # Handle streaming (SSE) responses — 9Router streams by default
        raw = r.text
        if raw.startswith("data: "):
            # SSE streaming format — extract chunks
            import re
            chunks = re.findall(r'data: ({.*?})\n\n', raw, re.DOTALL)
            content = ""
            for c in chunks:
                try:
                    j = json.loads(c)
                    delta = j.get("choices", [{}])[0].get("delta", {})
                    content += delta.get("content", "")
                except: pass
        else:
            content = r.json()["choices"][0]["message"]["content"]
        return {"analysis": content.strip()}
    except Exception as e:
        import traceback
        print(f"[AI] Error: {type(e).__name__}: {e}", flush=True)
        traceback.print_exc()
        return {"analysis": f"AI unavailable: {type(e).__name__}: {str(e)[:100]}"}


# ── YAHOO FINANCE FALLBACK ───────────────────────────────────────────────

YAHOO_SYMBOLS = {
    "NIFTY": "%5ENSEI", "BANKNIFTY": "%5ENSEBANK",
    "SENSEX": "%5EBSESN", "FINNIFTY": "%5ECNXMID",
    "RELIANCE": "RELIANCE.NS", "TCS": "TCS.NS",
    "HDFCBANK": "HDFCBANK.NS", "INFY": "INFY.NS",
}
YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart"
YAHOO_UA   = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
TF_YAHOO = {"1m":"1m","3m":"2m","5m":"5m","15m":"15m","30m":"30m","1h":"1h","4h":"1h","1d":"1d"}
YAHOO_RANGE = {"5m":"5d","15m":"5d","30m":"5d","1h":"5d","1d":"5d"}

def _fetch_yahoo_sync(instrument: str, timeframe: str, limit: int = 200) -> list:
    """Sync fetch OHLCV from Yahoo Finance."""
    import urllib.request, json, ssl
    sym = YAHOO_SYMBOLS.get(instrument.upper())
    if not sym:
        return []
    yahoo_tf = TF_YAHOO.get(timeframe, "5m")
    yahoo_range = YAHOO_RANGE.get(timeframe, "5d")
    url = f"{YAHOO_BASE}/{sym}?interval={yahoo_tf}&range={yahoo_range}&includePrePost=False"
    req = urllib.request.Request(url, headers={"User-Agent": YAHOO_UA})
    ctx = ssl.create_default_context()
    try:
        resp = urllib.request.urlopen(req, context=ctx, timeout=10)
        data = json.loads(resp.read())
        result = data["chart"]["result"][0]
        ts = result.get("timestamp", [])
        if not ts:
            return []
        quotes = result["indicators"]["quote"][0]
        bars = []
        for t, o, h, l, c, v in zip(ts, quotes["open"], quotes["high"],
                                     quotes["low"], quotes["close"], quotes["volume"]):
            if c is not None:
                bars.append({
                    "time": t, "open": round(o, 2), "high": round(h, 2),
                    "low": round(l, 2), "close": round(c, 2), "volume": v or 0,
                })
        return bars[-limit:]
    except Exception as e:
        print(f"[yahoo] Failed for {instrument}: {e}", flush=True)
        return []

async def _fetch_yahoo_fallback(instrument: str, timeframe: str, limit: int = 200) -> list:
    """Fetch OHLCV from Yahoo Finance (no auth needed)."""
    import asyncio
    return await asyncio.to_thread(_fetch_yahoo_sync, instrument, timeframe, limit)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=9000, reload=False)

