#!/usr/bin/env python3
"""
RealSwing Demo Mode Helper
Simple script to manage demo mode without manual process killing
"""

import requests
import time
import subprocess
import sys
import os
from pathlib import Path

ORCH_URL = "http://localhost:9010"
FRONTEND_URL = "http://localhost:5173"

def check_orchestrator():
    """Check if orchestrator is running"""
    try:
        r = requests.get(f"{ORCH_URL}/health", timeout=2)
        return r.status_code == 200
    except:
        return False

def start_demo():
    """Start demo mode"""
    print("\n🚀 Starting RealSwing Demo Mode...")
    print("=" * 60)

    if not check_orchestrator():
        print("❌ Orchestrator not responding on :9010")
        print("   Make sure it's running: python orchestrator.py")
        return False

    try:
        r = requests.post(f"{ORCH_URL}/demo/start", timeout=5)
        if r.status_code == 200:
            data = r.json()
            print(f"✅ Demo started: {data}")
            return True
        else:
            print(f"❌ Failed to start demo: {r.status_code}")
            print(f"   Response: {r.text}")
            return False
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

def monitor_stream(duration=30):
    """Monitor SSE stream for a bit"""
    print(f"\n📡 Monitoring SSE stream for {duration} seconds...")
    print("-" * 60)

    import sseclient
    try:
        url = f"{ORCH_URL}/stream"
        response = requests.get(url, stream=True, timeout=duration+5)
        client = sseclient.SSEClient(response)

        count = 0
        start = time.time()
        for event in client.events():
            elapsed = time.time() - start
            if elapsed > duration:
                break
            if event.data and event.data != ": heartbeat":
                count += 1
                print(f"[{elapsed:.1f}s] {event.data[:80]}...")

        print(f"\n✓ Received {count} events in {duration}s")
        return True
    except ImportError:
        print("(sseclient not installed - skipping stream monitoring)")
        return True
    except Exception as e:
        print(f"⚠ Stream error: {e}")
        return False

def get_state():
    """Get current market state"""
    try:
        r = requests.get(f"{ORCH_URL}/state", timeout=2)
        if r.status_code == 200:
            data = r.json()
            print("\n📊 Current Market State:")
            print("-" * 60)
            print(f"Connected: {data['connected']}")
            print(f"NIFTY:     {data['nifty']}")
            print(f"BANKNIFTY: {data['banknifty']}")
            print(f"SENSEX:    {data['sensex']}")
            return True
    except Exception as e:
        print(f"⚠ Error: {e}")
    return False

def stop_demo():
    """Stop demo mode"""
    try:
        r = requests.post(f"{ORCH_URL}/demo/stop", timeout=2)
        print(f"✅ Demo stopped")
        return True
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "start"

    if cmd == "start":
        if start_demo():
            time.sleep(2)
            get_state()
            print(f"\n🎯 Dashboard: {FRONTEND_URL}")
            print("   (Auto-connecting to SSE stream...)")
    elif cmd == "stop":
        stop_demo()
    elif cmd == "status":
        get_state()
    elif cmd == "monitor":
        monitor_stream(duration=60)
    else:
        print(f"Usage: {sys.argv[0]} [start|stop|status|monitor]")
