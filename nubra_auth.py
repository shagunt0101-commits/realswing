"""
Nubra Auth Helper — Login and get a fresh session_token.
Uses credentials from ~/.nubra_credentials.json
"""
import json, httpx, asyncio, os, time

CRED_FILE = os.path.expanduser("~/.nubra_credentials.json")
TOKEN_FILE = os.path.expanduser("~/.nubra_session.json")
UAT = "https://uatapi.nubra.io"
DEVICE_ID = "TS123"

async def login():
    with open(CRED_FILE) as f:
        creds = json.load(f)
    phone = creds["phone"]
    mpin = creds["mpin"]
    env = creds.get("env", "UAT")
    base = UAT if env.upper() == "UAT" else "https://api.nubra.io"

    async with httpx.AsyncClient(timeout=15) as c:
        # Step 1: Send phone OTP
        print("[1/4] Sending phone OTP...")
        r1 = await c.post(f"{base}/sendphoneotp", json={"phone": phone, "skip_totp": False})
        assert r1.status_code == 200, f"Step 1 failed: {r1.text}"
        temp_token = r1.json()["temp_token"]
        print(f"  temp_token: {temp_token[:20]}...")

        # Step 2: Resend with temp_token (skip TOTP)
        print("[2/4] Confirming phone...")
        r2 = await c.post(f"{base}/sendphoneotp",
            headers={"x-temp-token": temp_token},
            json={"phone": phone, "skip_totp": True})
        assert r2.status_code == 200, f"Step 2 failed: {r2.text}"
        temp_token = r2.json()["temp_token"]
        print(f"  temp_token: {temp_token[:20]}...")

        # Step 3: OTP — try stored or prompt
        # Check for cached OTP or prompt user
        otp_cache = os.path.expanduser("~/.nubra_otp.txt")
        otp = ""
        if os.path.exists(otp_cache):
            with open(otp_cache) as f:
                otp = f.read().strip()
        if not otp:
            print(f"[3/4] SMS sent to {phone}. Enter OTP:")
            otp = input("OTP: ").strip()
            # Cache it for 2 minutes
            with open(otp_cache, "w") as f:
                f.write(otp)

        r3 = await c.post(f"{base}/verifyphoneotp",
            headers={"x-temp-token": temp_token, "x-device-id": DEVICE_ID},
            json={"phone": phone, "otp": otp})
        if r3.status_code != 200:
            print(f"  OTP failed: {r3.text[:200]}")
            return None
        auth_token = r3.json()["auth_token"]
        print(f"  auth_token: {auth_token[:20]}...")

        # Step 4: Verify MPIN → session_token
        print("[4/4] Verifying MPIN...")
        r4 = await c.post(f"{base}/verifypin",
            headers={"x-device-id": DEVICE_ID, "Authorization": f"Bearer {auth_token}"},
            json={"pin": mpin})
        assert r4.status_code == 200, f"Step 4 failed: {r4.text}"
        data = r4.json()
        session_token = data["session_token"]
        print(f"  session_token: {session_token[:30]}...")
        print(f"  Login: {data.get('message')} ✓")

        # Save token
        session_data = {
            "session_token": session_token,
            "phone": phone,
            "env": env,
            "logged_in_at": time.time(),
            "device_id": DEVICE_ID,
        }
        with open(TOKEN_FILE, "w") as f:
            json.dump(session_data, f)
        print(f"\nToken saved to {TOKEN_FILE}")
        return session_data

def get_session():
    """Get cached session or None if expired."""
    try:
        with open(TOKEN_FILE) as f:
            data = json.load(f)
        # Tokens expire after ~24h
        if time.time() - data.get("logged_in_at", 0) < 82800:
            return data
    except:
        pass
    return None

if __name__ == "__main__":
    session = get_session()
    if session:
        print(f"Using cached session_token (logged in {int((time.time()-session['logged_in_at'])/60)}m ago)")
        print(f"Token: {session['session_token'][:30]}...")
    else:
        print("No valid session. Logging in...")
        asyncio.run(login())
