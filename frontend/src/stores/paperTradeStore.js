import { create } from 'zustand';

/**
 * Paper Trade Store — tracks positions, P&L, and strategy execution in real-time.
 * No real money — all trades are simulated.
 */

const INITIAL_CAPITAL = 100000;

export const usePaperTradeStore = create((set, get) => ({
  // ── Account ──
  capital: INITIAL_CAPITAL,
  initialCapital: INITIAL_CAPITAL,
  positions: [],     // { id, instrument, side, entryPrice, qty, entryTime, currentPrice, pnl }
  orders: [],        // { id, instrument, side, type, price, qty, status, time, reason }
  tradeLog: [],      // historical closed trades
  running: false,
  strategy: null,    // the active strategy config from StrategyBuilder
  mode: 'idle',      // 'idle' | 'agent' | 'custom' | 'both'
  startTime: null,

  // ── Actions ──
  setStrategy: (strategy) => set({ strategy }),

  setMode: (mode) => set({ mode }),

  start: () => set({ running: true, startTime: Date.now(), mode: get().mode || 'both' }),

  stop: () => set({ running: false }),

  reset: () => set({
    capital: INITIAL_CAPITAL,
    positions: [],
    orders: [],
    tradeLog: [],
    running: false,
    startTime: null,
  }),

  /** Evaluate a trade signal from any source (agent or strategy) */
  evaluateSignal: (signal) => {
    const state = get();
    if (!state.running) return;

    const { instrument, side, entryPrice, qty, sl, tp, reason, source } = signal;

    // Open position — capital stays fixed (P&L = entry vs current, not deducted)
    const id = `paper_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const position = {
      id, instrument, side, entryPrice, qty,
      sl, tp, entryTime: Date.now(),
      currentPrice: entryPrice, pnl: 0, source: source || 'custom',
      reason: reason || '',
    };

    set(s => ({
      positions: [...s.positions, position],
      orders: [{ id, instrument, side, type: 'BUY', price: entryPrice, qty, status: 'FILLED', time: Date.now(), reason }, ...s.orders].slice(0, 200),
    }));
  },

  /** Update positions with current market price — called every tick */
  updatePrices: (instrument, price) => {
    const state = get();
    if (!state.positions.length) return;

    let newCapital = state.capital;
    const updatedPositions = [];
    const closedTrades = [];

    for (const pos of state.positions) {
      if (pos.instrument !== instrument) {
        updatedPositions.push(pos);
        continue;
      }

      const isLong = pos.side === 'BUY' || pos.side === 'CE';
      const pnl = isLong ? (price - pos.entryPrice) * pos.qty : (pos.entryPrice - price) * pos.qty;
      const currentPrice = price;
      let closed = false;
      let closeReason = '';

      // Check SL/TP
      if (isLong) {
        if (pos.sl && price <= pos.sl) { closed = true; closeReason = 'SL Hit'; }
        if (pos.tp && price >= pos.tp) { closed = true; closeReason = 'TP Hit'; }
      } else {
        if (pos.sl && price >= pos.sl) { closed = true; closeReason = 'SL Hit'; }
        if (pos.tp && price <= pos.tp) { closed = true; closeReason = 'TP Hit'; }
      }

      if (closed) {
        newCapital += pnl; // P&L only — no premium deduction on open
        closedTrades.push({ ...pos, exitPrice: currentPrice, pnl, closeReason, closeTime: Date.now() });
      } else {
        updatedPositions.push({ ...pos, currentPrice, pnl });
      }
    }

    set(s => ({
      capital: newCapital,
      positions: updatedPositions,
      tradeLog: [...closedTrades, ...s.tradeLog].slice(0, 500),
    }));

    return closedTrades;
  },

  /** Cancel all positions at market price (for stop) */
  liquidateAll: () => {
    const state = get();
    let totalPNL = 0;
    const closed = [];
    for (const pos of state.positions) {
      const isLong = pos.side === 'BUY' || pos.side === 'CE';
      const pnl = isLong ? (pos.currentPrice - pos.entryPrice) * pos.qty : (pos.entryPrice - pos.currentPrice) * pos.qty;
      totalPNL += pnl;
      closed.push({ ...pos, exitPrice: pos.currentPrice, pnl, closeReason: 'Manual Close', closeTime: Date.now() });
    }
    set(s => ({
      capital: s.initialCapital + totalPNL,
      positions: [],
      tradeLog: [...closed, ...s.tradeLog].slice(0, 500),
      running: false,
    }));
  },

  /** Close a single position by id */
  closePosition: (positionId) => {
    const state = get();
    const pos = state.positions.find(p => p.id === positionId);
    if (!pos) return;

    const isLong = pos.side === 'BUY' || pos.side === 'CE';
    const pnl = isLong ? (pos.currentPrice - pos.entryPrice) * pos.qty : (pos.entryPrice - pos.currentPrice) * pos.qty;
    const closed = { ...pos, exitPrice: pos.currentPrice, pnl, closeReason: 'Manual Close', closeTime: Date.now() };

    set(s => ({
      capital: s.capital + pnl,
      positions: s.positions.filter(p => p.id !== positionId),
      tradeLog: [closed, ...s.tradeLog].slice(0, 500),
    }));
  },
}));
