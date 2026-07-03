"""
Test script: Fetch historical market data from Nubra API
Usage: python test_timeseries.py <session_token> [instrument=NIFTY] [interval=5m]
"""

import json, sys, httpx, asyncio
from datetime import datetime, timezone, timedelta

async def test_timeseries(session_token, instrument="NIFTY", interval="5m", env="UAT"):
    base = "https://uatapi.nubra.io" if env.upper() == "UAT" else "https://api.nubra.io"
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=5)

    headers = {
        "x-device-id": "TS123",
        "Content-Type": "application/json",
        "Authorization": f"Bearer {session_token}",
    }

    # Try a simple price endpoint first to check if token is even valid
    async with httpx.AsyncClient(timeout=15) as client:
        # Test 1: Current price (this works in our dashboard)
        print("=== TEST 1: Current Price ===")
        r1 = await client.get(
            f"{base}/optionchains/NIFTY/price",
            headers={"x-device-id": "TS123", "Authorization": f"Bearer {session_token}"},
        )
        print(f"  Status: {r1.status_code}")
        if r1.status_code == 200:
            print(f"  OK: Token is valid")
        else:
            print(f"  FAIL: {r1.text[:200]}")
            print(f"\n  --> Token invalid/expired. Log out and log back in on the dashboard.")
            return

        # Test 2: V3 endpoint with correct path
        print("\n=== TEST 2: V3 Timeseries ===")
        for ep_path in ["/v3/charts/timeseries", "/charts/timeseries"]:
            url = f"{base}{ep_path}"
            print(f"  Trying: POST {url}")
            payload = {
            "query": [{
                "exchange": "NSE",
                "type": "INDEX" if instrument in ["NIFTY","BANKNIFTY","SENSEX","FINNIFTY"] else "STOCK",
                "values": [instrument],
                "fields": ["open","high","low","close","tick_volume","cumulative_volume"],
                "startDate": start.strftime('%Y-%m-%dT%H:%M:%S.000Z'),
                "endDate": end.strftime('%Y-%m-%dT%H:%M:%S.000Z'),
                "interval": interval,
                "intraDay": False,
                "realTime": False,
            }]
        }

        print(f"  Endpoint: POST {base}/charts/timeseries")
        print(f"  Interval: {interval}")
        r2 = await client.post(f"{base}/charts/timeseries", headers=headers, json=payload)
        print(f"  Status: {r2.status_code}")

        if r2.status_code == 200:
            data = r2.json()
            values = data.get("result", [{}])[0].get("values", [{}])[0]
            symbol = list(values.keys())[0] if values else "?"
            opens = values.get(symbol, {}).get("open", []) if values else []
            candles = [o for o in opens if o.get("v") is not None]
            print(f"  SUCCESS: {len(candles)} candles for {symbol}")
            if candles:
                print(f"  Range: {datetime.fromtimestamp(candles[0]['ts']//1e9)} to {datetime.fromtimestamp(candles[-1]['ts']//1e9)}")
                print(f"  First close: {candles[0].get('v')} | Last close: {candles[-1].get('v')}")
        else:
            print(f"  FAILED: {r2.text[:300]}")

        # Test 3: Try with intraDay=True
        print("\n=== TEST 3: Timeseries (intraDay=True) ===")
        payload["query"][0]["intraDay"] = True
        r3 = await client.post(f"{base}/charts/timeseries", headers=headers, json=payload)
        print(f"  Status: {r3.status_code}")
        if r3.status_code == 200:
            data = r3.json()
            values = data.get("result", [{}])[0].get("values", [{}])[0]
            symbol = list(values.keys())[0] if values else "?"
            opens = values.get(symbol, {}).get("open", []) if values else []
            candles = [o for o in opens if o.get("v") is not None]
            print(f"  SUCCESS: {len(candles)} candles for {symbol}")
        else:
            print(f"  FAILED: {r3.text[:300]}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python test_timeseries.py <session_token> [instrument] [interval] [env]")
        print("  - Get your session_token from the dashboard after logging in")
        print("  - Or extract from localStorage: JSON.parse(localStorage.getItem('realswing_session')).session_token")
        sys.exit(1)

    asyncio.run(test_timeseries(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "NIFTY",
                                sys.argv[3] if len(sys.argv) > 3 else "5m",
                                sys.argv[4] if len(sys.argv) > 4 else "UAT"))
