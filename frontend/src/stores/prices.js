import { create } from "zustand";
import { useRef, useEffect } from "react";

/**
 * Shared price store — single source of truth for all price data.
 * Self-polling: when any component subscribes, polling starts automatically.
 * When last subscriber leaves, polling stops (via ref counting).
 */

const API_BASE = "http://localhost:9000";
const DEVICE_ID = "TS123";

let activeSubscribers = 0;
let pollInterval = null;

export const usePrices = create((set, get) => ({
  prices: {},
  loading: false,

  setPrices: (prices) => set({ prices, loading: false }),
  setLoading: (v) => set({ loading: v }),
}));

/** Start the shared polling loop — called once regardless of subscriber count */
function startPolling(getSession) {
  if (pollInterval) return;
  const fetchAll = async () => {
    const session = getSession();
    if (!session?.session_token) return;
    const store = usePrices.getState();
    store.setLoading(true);
    const results = {};

    // Fetch indices (fixed set) + watchlist stocks (from localStorage)
    const indices = [
      { symbol: "NIFTY", exchange: "NSE" },
      { symbol: "BANKNIFTY", exchange: "NSE" },
      { symbol: "SENSEX", exchange: "BSE" },
      { symbol: "FINNIFTY", exchange: "NSE" },
    ];
    let watchSymbols = [];
    try { watchSymbols = JSON.parse(localStorage.getItem("realswing_watch") || "[]"); } catch {}

    // Symbols to fetch: deduplicate indices + watchlist items
    const seen = new Set();
    const allSymbols = [];
    for (const s of [...indices, ...watchSymbols]) {
      const key = s.symbol || s;
      if (seen.has(key)) continue;
      seen.add(key);
      allSymbols.push({ symbol: key, exchange: s.exchange || "NSE" });
    }

    await Promise.all(allSymbols.map(async ({ symbol, exchange }) => {
      try {
        const r = await fetch(
          `${API_BASE}/market/price/${symbol}?exchange=${exchange}&session_token=${session.session_token}&device_id=${DEVICE_ID}&env=${session.env}`
        );
        const d = await r.json();
        results[symbol] = d;
      } catch { results[symbol] = null; }
    }));
    usePrices.getState().setPrices(results);
  };
  fetchAll();
  pollInterval = setInterval(fetchAll, 5000);
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

/**
 * React hook: subscribe to shared prices. Begins polling on mount, stops when unmounted.
 * @param {() => any} getSession — function that returns the current session object
 */
export function usePricePolling(getSession) {
  const initialized = useRef(false);

  useEffect(() => {
    activeSubscribers++;
    startPolling(getSession);
    initialized.current = true;
    return () => {
      activeSubscribers--;
      if (activeSubscribers <= 0) stopPolling();
    };
  }, []);
}
