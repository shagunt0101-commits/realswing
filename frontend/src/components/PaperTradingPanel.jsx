import React, { useEffect, useCallback, useState } from 'react';
import { usePaperTradeStore } from '../stores/paperTradeStore';
import { runBacktest } from '../backtest/engine/BacktestEngine';

const C = {
  bg: '#080E1C', panel: '#0D1729', border: '#1A2E52',
  accent: '#00D4FF', green: '#00E676', red: '#FF3B5C',
  yellow: '#FFD600', text: '#B8C7E0', dim: '#4A6080', bright: '#E8F0FF',
};

const fmt = {};
fmt.rs = v => v != null ? `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—';
fmt.pct = v => v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '—';
fmt.t = v => v ? new Date(v).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '—';

function PaperTradingPanel({ session, chainData, sse, strategyBuilderStrategy }) {
  const store = usePaperTradeStore();
  const [log, setLog] = useState([]);

  // ── Live price updates → paper P&L ──
  useEffect(() => {
    if (!store.running || !chainData?.chain) return;
    const ce = chainData.chain.ce || [];
    const pe = chainData.chain.pe || [];
    const spot = (chainData.chain.cp || 0) / 100;

    if (spot > 0) {
      // Update index-level positions (spot)
      let closed = store.updatePrices('NIFTY', spot);
      closed = [...(closed || []), ...(store.updatePrices('BANKNIFTY', spot) || [])];
      closed = [...(closed || []), ...(store.updatePrices('SENSEX', spot) || [])];

      // Update option positions using chain LTP data
      const allOptions = [...ce.map(c => ({ ...c, _side: 'CE' })), ...pe.map(p => ({ ...p, _side: 'PE' }))];
      for (const pos of store.positions) {
        // position.instrument will be like "NIFTY" or "23900 CE" — match by strike+side
        if (pos.instrument === 'NIFTY' || pos.instrument === 'BANKNIFTY' || pos.instrument === 'SENSEX') continue;
        const match = allOptions.find(o => {
          const optStrike = Math.round((o.sp || 0) / 100);
          const posStrike = parseInt(pos.instrument);
          return optStrike === posStrike && o._side === pos.side;
        });
        if (match) {
          const ltp = (match.ltp || 0) / 100;
          closed = [...closed, ...(store.updatePrices(pos.instrument, ltp) || [])];
        }
      }

      for (const t of closed || []) {
        setLog(l => [`[${fmt.t(Date.now())}] Closed ${t.side} ${t.instrument} — ${fmt.rs(t.pnl)} (${t.closeReason})`, ...l].slice(0, 50));
      }
    }
  }, [chainData, store.running]);

  // ── Strategy execution loop (custom strategies) ──
  const executeCustomStrategy = useCallback(async () => {
    const strategy = store.strategy;
    if (!strategy?.conditions?.entry?.length) return;

    // Use the backtest engine's candle generation from current chain
    const ce = chainData?.chain?.ce || [];
    const pe = chainData?.chain?.pe || [];
    const spot = (chainData?.chain?.cp || 0) / 100;
    if (!spot) return;

    // Build a single candle from current spot
    const candle = { open: spot, high: spot + spot * 0.005, low: spot - spot * 0.005, close: spot, volume: 10000, time: Math.floor(Date.now() / 1000) };
    const candles = [candle];

    const result = runBacktest(strategy, candles);
    if (result?.results?.trades?.length) {
      const lastTrade = result.results.trades[result.results.trades.length - 1];
      const side = lastTrade.direction === 'long' ? 'BUY' : 'SELL';
      const existing = store.positions.find(p => p.instrument === strategy.name && p.side === side);
      if (!existing && store.capital > spot * 75) {
        store.evaluateSignal({
          instrument: strategy.name || 'CUSTOM',
          side,
          entryPrice: spot,
          qty: 75, // 1 lot
          sl: null,
          tp: null,
          reason: `Strategy: ${strategy.name} — ${strategy.conditions.entry.map(c => `${c.indicator} ${c.operator} ${c.value}`).join(', ')}`,
          source: 'custom',
        });
        setLog(l => [`[${fmt.t(Date.now())}] ${side} ${strategy.name} @ ${fmt.rs(spot)} (custom strategy)`, ...l].slice(0, 50));
      }
    }
  }, [chainData, store.strategy, store.running]);

  useEffect(() => {
    if (!store.running || store.mode !== 'custom' && store.mode !== 'both') return;
    const id = setInterval(executeCustomStrategy, 10000);
    return () => clearInterval(id);
  }, [executeCustomStrategy, store.running, store.mode]);

  // ── Agent signal listener ──
  useEffect(() => {
    if (!store.running || store.mode !== 'agent' && store.mode !== 'both') return;
    if (!sse?.signals?.length) return;

    const latest = sse.signals[0];
    if (!latest || latest.processed) return;
    latest.processed = true;

    const entry = latest.entry || (latest.entry_price || 0);
    if (entry <= 0) return;

    const action = latest.action || '';
    const side = action.includes('BUY') ? 'BUY' : action.includes('SELL') ? 'SELL' : null;
    if (!side) return;

    store.evaluateSignal({
      instrument: latest.asset || 'NIFTY',
      side,
      entryPrice: entry,
      qty: 75,
      sl: latest.sl || (latest.sl_price || 0),
      tp: latest.target || (latest.target_price || 0),
      reason: `Agent: ${latest.reason?.slice(0, 80) || 'AI signal'}`,
      source: 'agent',
    });
    setLog(l => [`[${fmt.t(Date.now())}] Agent ${side} ${latest.asset || ''} @ ${fmt.rs(entry)}`, ...l].slice(0, 50));
  }, [sse?.signals, store.running, store.mode]);

  const realizedPNL = store.capital - store.initialCapital;
  const unrealizedPNL = store.positions.reduce((s, p) => s + (p.pnl || 0), 0);
  const pnl = realizedPNL + unrealizedPNL;
  const pnlPct = (pnl / store.initialCapital) * 100;
  const totalPositions = store.positions.length;
  const totalExposure = store.positions.reduce((s, p) => s + p.entryPrice * p.qty, 0);

  return (
    <div style={{ display: 'grid', gap: 12, fontFamily: "'Inter', sans-serif" }}>
      {/* Header + Controls */}
      <div style={{ background: C.panel, border: `1px solid ${C.border}`, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: C.bright, fontWeight: 700, fontSize: 14 }}>📊 Paper Trading Desk</span>
          <span style={{ color: store.running ? C.green : C.dim, fontSize: 9, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: store.running ? C.green : C.red, display: 'inline-block' }} />
            {store.running ? 'LIVE' : 'STOPPED'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {['idle', 'agent', 'custom', 'both'].map(m => (
            <button key={m} onClick={() => store.setMode(m)}
              style={{
                padding: '3px 10px', fontSize: 9, fontWeight: 600, borderRadius: 3, cursor: 'pointer',
                background: store.mode === m ? `${C.accent}22` : 'none',
                border: `1px solid ${store.mode === m ? C.accent + '50' : C.border}`,
                color: store.mode === m ? C.accent : C.dim,
              }}>{m.toUpperCase()}</button>
          ))}
          <button onClick={() => store.running ? store.stop() : store.start()}
            style={{
              padding: '3px 12px', fontSize: 9, fontWeight: 700, borderRadius: 3, cursor: 'pointer',
              background: store.running ? `${C.red}22` : `${C.green}22`,
              border: `1px solid ${store.running ? C.red + '50' : C.green + '50'}`,
              color: store.running ? C.red : C.green,
            }}>{store.running ? 'STOP' : 'START'}</button>
          <button onClick={() => { store.reset(); setLog([]); }}
            style={{ padding: '3px 8px', fontSize: 9, border: `1px solid ${C.border}`, color: C.dim, background: 'none', borderRadius: 3, cursor: 'pointer' }}>RESET</button>
          {store.positions.length > 0 && (
            <button onClick={() => store.liquidateAll()}
              style={{ padding: '3px 8px', fontSize: 9, background: `${C.red}22`, border: `1px solid ${C.red}50`, color: C.red, borderRadius: 3, cursor: 'pointer' }}>LIQUIDATE</button>
          )}
        </div>
      </div>

      {/* Account Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 6, minWidth: 0 }}>
        {[
          { l: 'Capital', v: fmt.rs(store.capital), c: C.bright },
          { l: 'P&L', v: fmt.rs(pnl), c: pnl >= 0 ? C.green : C.red },
          { l: 'Return', v: fmt.pct(pnlPct), c: pnlPct >= 0 ? C.green : C.red },
          { l: 'Positions', v: totalPositions, c: totalPositions > 0 ? C.yellow : C.dim },
          { l: 'Exposure', v: fmt.rs(totalExposure), c: totalExposure > 0 ? C.accent : C.dim },
          { l: 'Total Trades', v: store.tradeLog.length + store.positions.length, c: C.text },
          { l: 'Strategy', v: store.mode.toUpperCase(), c: store.mode === 'both' ? C.yellow : C.accent },
        ].map(m => (
          <div key={m.l} style={{ background: C.panel, border: `1px solid ${C.border}`, padding: '6px 10px', minWidth: 0 }}>
            <div style={{ color: C.dim, fontSize: 7, letterSpacing: 1, textTransform: 'uppercase' }}>{m.l}</div>
            <div style={{ color: m.c, fontWeight: 700, fontSize: 13, fontFamily: '"JetBrains Mono", monospace' }}>{m.v}</div>
          </div>
        ))}
      </div>

      {/* Positions Table + Log Side-by-Side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 8, minWidth: 0 }}>
        {/* Open Positions */}
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, padding: 10 }}>
          <div style={{ color: C.bright, fontWeight: 700, fontSize: 11, marginBottom: 8 }}>📋 Open Positions ({store.positions.length})</div>
          {store.positions.length === 0 ? (
            <div style={{ color: C.dim, fontSize: 10, textAlign: 'center', padding: 20 }}>No open positions</div>
          ) : (
            <table style={{ width: '100%', fontSize: 9, borderCollapse: 'collapse' }}>
              <thead><tr style={{ color: C.dim }}>
                <th style={{ textAlign: 'left', padding: '4px 6px' }}>Instr</th>
                <th style={{ textAlign: 'center', padding: '4px 6px' }}>Side</th>
                <th style={{ textAlign: 'right', padding: '4px 6px' }}>Qty</th>
                <th style={{ textAlign: 'right', padding: '4px 6px' }}>Entry</th>
                <th style={{ textAlign: 'right', padding: '4px 6px' }}>LTP</th>
                <th style={{ textAlign: 'right', padding: '4px 6px' }}>P&L</th>
                <th style={{ textAlign: 'right', padding: '4px 6px' }}>Src</th>
                <th style={{ textAlign: 'center', padding: '4px 6px', width: 28 }}></th>
              </tr></thead>
              <tbody>
                {store.positions.map(p => (
                  <tr key={p.id} style={{ borderTop: `1px solid ${C.border}30` }}>
                    <td style={{ padding: '6px 6px', color: C.bright, fontWeight: 600 }}>{p.instrument}</td>
                    <td style={{ textAlign: 'center', padding: '6px 6px' }}>
                      <span style={{ color: p.side === 'BUY' || p.side === 'CE' ? C.green : C.red, fontWeight: 700 }}>{p.side}</span>
                    </td>
                    <td style={{ textAlign: 'right', padding: '6px 6px', fontFamily: '"JetBrains Mono", monospace', color: C.text }}>{p.qty}</td>
                    <td style={{ textAlign: 'right', padding: '6px 6px', fontFamily: '"JetBrains Mono", monospace', color: C.text }}>{fmt.rs(p.entryPrice)}</td>
                    <td style={{ textAlign: 'right', padding: '6px 6px', fontFamily: '"JetBrains Mono", monospace', color: C.accent }}>{fmt.rs(p.currentPrice)}</td>
                    <td style={{ textAlign: 'right', padding: '6px 6px', fontFamily: '"JetBrains Mono", monospace', color: p.pnl >= 0 ? C.green : C.red, fontWeight: 700 }}>
                      {p.pnl >= 0 ? '+' : ''}{fmt.rs(p.pnl)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '6px 6px', color: p.source === 'agent' ? C.purple : p.source === 'custom' ? C.yellow : C.dim, fontSize: 8 }}>{p.source}</td>
                    <td style={{ textAlign: 'center', padding: '4px 6px' }}>
                      <button onClick={() => store.closePosition(p.id)}
                        style={{ background: `${C.red}22`, border: `1px solid ${C.red}50`, color: C.red, borderRadius: 3, padding: '2px 6px', cursor: 'pointer', fontSize: 8, fontWeight: 600 }}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Execution Log */}
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, padding: 10 }}>
          <div style={{ color: C.bright, fontWeight: 700, fontSize: 11, marginBottom: 8 }}>📝 Execution Log</div>
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {log.length === 0 ? (
              <div style={{ color: C.dim, fontSize: 9, textAlign: 'center', padding: 20 }}>Start paper trading to see executions</div>
            ) : (
              log.map((entry, i) => (
                <div key={i} style={{ fontSize: 8, color: entry.includes('Closed') ? (entry.includes('+') ? C.green : entry.includes('-') ? C.red : C.dim) : C.accent, fontFamily: '"JetBrains Mono", monospace', padding: '2px 0', borderBottom: `1px solid ${C.border}20` }}>
                  {entry}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Trade History */}
      {store.tradeLog.length > 0 && (
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, padding: 10 }}>
          <div style={{ color: C.bright, fontWeight: 700, fontSize: 11, marginBottom: 8 }}>📜 Trade History ({store.tradeLog.length})</div>
          <div style={{ maxHeight: 160, overflowY: 'auto' }}>
            <table style={{ width: '100%', fontSize: 8, borderCollapse: 'collapse' }}>
              <thead><tr style={{ color: C.dim, position: 'sticky', top: 0, background: C.panel, zIndex: 2 }}>
                <th style={{ textAlign: 'left', padding: '3px 6px' }}>Time</th>
                <th style={{ textAlign: 'center', padding: '3px 6px' }}>Side</th>
                <th style={{ textAlign: 'right', padding: '3px 6px' }}>Entry</th>
                <th style={{ textAlign: 'right', padding: '3px 6px' }}>Exit</th>
                <th style={{ textAlign: 'right', padding: '3px 6px' }}>P&L</th>
                <th style={{ textAlign: 'left', padding: '3px 6px' }}>Reason</th>
              </tr></thead>
              <tbody>
                {store.tradeLog.slice(0, 30).map(t => (
                  <tr key={t.id} style={{ borderTop: `1px solid ${C.border}20` }}>
                    <td style={{ padding: '3px 6px', color: C.dim, fontFamily: '"JetBrains Mono", monospace' }}>{fmt.t(t.closeTime)}</td>
                    <td style={{ textAlign: 'center', padding: '3px 6px', color: t.side === 'BUY' || t.side === 'CE' ? C.green : C.red }}>{t.side}</td>
                    <td style={{ textAlign: 'right', padding: '3px 6px', fontFamily: '"JetBrains Mono", monospace', color: C.text }}>{fmt.rs(t.entryPrice)}</td>
                    <td style={{ textAlign: 'right', padding: '3px 6px', fontFamily: '"JetBrains Mono", monospace', color: C.dim }}>{fmt.rs(t.exitPrice)}</td>
                    <td style={{ textAlign: 'right', padding: '3px 6px', fontFamily: '"JetBrains Mono", monospace', color: t.pnl >= 0 ? C.green : C.red, fontWeight: 600 }}>{t.pnl >= 0 ? '+' : ''}{fmt.rs(t.pnl)}</td>
                    <td style={{ padding: '3px 6px', color: C.dim, fontSize: 7 }}>{t.closeReason || t.reason?.slice(0, 40) || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default PaperTradingPanel;
