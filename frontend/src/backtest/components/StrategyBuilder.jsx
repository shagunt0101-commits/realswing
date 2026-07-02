import React, { useState, useCallback } from 'react';
import { useBacktestStore } from '../stores/backtestStore.js';
import { runBacktest } from '../engine/BacktestEngine.js';

const C = {
  bg: '#080E1C', panel: '#0D1729', border: '#1A2E52',
  accent: '#00D4FF', green: '#00E676', red: '#FF3B5C',
  yellow: '#FFD600', text: '#B8C7E0', dim: '#4A6080', bright: '#E8F0FF',
};

const INDICATORS = ['EMA9', 'EMA21', 'EMA50', 'SMA20', 'SMA50', 'SMA200', 'RSI14', 'RSI7', 'BB20', 'CLOSE', 'VOLUME'];
const OPERATORS = ['>', '<', '>=', '<=', 'crosses_above', 'crosses_below'];

const STRATEGY_TEMPLATES = {
  'EMA Crossover': { name: 'EMA Crossover', conditions: { entry: [{ indicator: 'EMA9', operator: 'crosses_above', value: 'EMA21' }], exit: [{ indicator: 'EMA9', operator: 'crosses_below', value: 'EMA21' }] }, positionSize: { type: 'percent', value: 25 }, slippage: 0.05, maxPositions: 1 },
  'RSI Mean Reversion': { name: 'RSI Mean Reversion', conditions: { entry: [{ indicator: 'RSI14', operator: '<', value: 30 }], exit: [{ indicator: 'RSI14', operator: '>', value: 70 }] }, positionSize: { type: 'percent', value: 20 }, slippage: 0.05, maxPositions: 1 },
  'Bollinger Bounce': { name: 'Bollinger Bounce', conditions: { entry: [{ indicator: 'CLOSE', operator: '<', value: 'BB20_lower' }], exit: [{ indicator: 'CLOSE', operator: '>', value: 'BB20_middle' }] }, positionSize: { type: 'percent', value: 20 }, slippage: 0.03, maxPositions: 1 },
};

export default function StrategyBuilder({ onClose, session }) {
  const setResults = useBacktestStore(s => s.setResults);
  const [strategy, setStrategy] = useState({
    name: 'My Strategy', conditions: { entry: [], exit: [] },
    positionSize: { type: 'percent', value: 20 },
    slippage: 0.05, maxPositions: 1,
  });
  const [instrument, setInstrument] = useState('NIFTY');
  const [timeframe, setTimeframe] = useState('5m');
  const [candleCount, setCandleCount] = useState(500);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState([]);
  const [showLog, setShowLog] = useState(false);

  const addCondition = (side) => {
    setStrategy(s => ({
      ...s, conditions: {
        ...s.conditions,
        [side]: [...(s.conditions[side] || []), { indicator: 'CLOSE', operator: '>', value: 0 }],
      },
    }));
  };

  const updateCondition = (side, idx, field, val) => {
    setStrategy(s => {
      const list = [...(s.conditions[side] || [])];
      list[idx] = { ...list[idx], [field]: val };
      return { ...s, conditions: { ...s.conditions, [side]: list } };
    });
  };

  const removeCondition = (side, idx) => {
    setStrategy(s => {
      const list = (s.conditions[side] || []).filter((_, i) => i !== idx);
      return { ...s, conditions: { ...s.conditions, [side]: list } };
    });
  };

  const applyTemplate = (name) => {
    const t = STRATEGY_TEMPLATES[name];
    if (t) setStrategy(JSON.parse(JSON.stringify(t)));
  };

  const runStrategy = useCallback(async () => {
    setRunning(true);
    setLog(l => [...l, `[${new Date().toLocaleTimeString()}] Loading candles for ${instrument} ${timeframe}...`]);
    setShowLog(true);

    try {
      // Compute dates
      const endDate = new Date();
      const startDate = new Date();
      const mins = timeframe.includes('m') ? parseInt(timeframe) * candleCount : parseInt(timeframe) * candleCount * 60;
      startDate.setMinutes(startDate.getMinutes() - mins);

      // Fetch from backend
      const r = await fetch('http://localhost:9000/market/timeseries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exchange: 'NSE', instrument, interval: timeframe,
          start_date: startDate.toISOString(),
          end_date: endDate.toISOString(),
          session_token: session?.session_token || '',
          env: session?.env || 'UAT',
        }),
      });

      if (!r.ok) {
        let errMsg = `HTTP ${r.status}`;
        try {
          const e = await r.json();
          const d = e.detail || e.message;
          // detail can be a JSON string from nested errors
          if (typeof d === 'string' && (d.startsWith('{') || d.startsWith('['))) {
            try { const p = JSON.parse(d); errMsg = p.message || p.error || d; } catch { errMsg = d; }
          } else if (typeof d === 'string') {
            errMsg = d;
          }
        } catch {}
        throw new Error(errMsg);
      }

      const data = await r.json();
      const candles = data?.candles || data?.data || [];

      if (!candles.length) {
        throw new Error('No candle data returned from API');
      }

      setLog(l => [...l, `[${new Date().toLocaleTimeString()}] Running backtest on ${candles.length} candles...`]);

      const result = runBacktest(strategy, candles);

      if (result) {
        setResults(result.results);
        setLog(l => [...l, `[${new Date().toLocaleTimeString()}] ✅ Backtest complete — ${result.results.total_trades} trades, P&L ₹${result.results.net_pnl}`]);
      } else {
        setLog(l => [...l, `[${new Date().toLocaleTimeString()}] ❌ Backtest returned no results`]);
      }
    } catch (e) {
      setLog(l => [...l, `[${new Date().toLocaleTimeString()}] ❌ Error: ${e.message}`]);
    }
    setRunning(false);
  }, [strategy, instrument, timeframe, candleCount, setResults]);

  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, marginBottom: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: `1px solid ${C.border}` }}>
        <span style={{ color: C.bright, fontWeight: 700, fontSize: 13 }}>⚙️ Backtest Strategy Builder</span>
        <button onClick={onClose} style={{ background: 'none', border: `1px solid ${C.border}`, color: C.dim, borderRadius: 4, padding: '4px 12px', cursor: 'pointer', fontSize: 10 }}>✕ Close</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: 14 }}>
        {/* LEFT: Strategy config */}
        <div>
          {/* Name + Template */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input value={strategy.name} onChange={e => setStrategy(s => ({ ...s, name: e.target.value }))}
              style={{ flex: 1, background: '#0A1220', border: `1px solid ${C.border}`, borderRadius: 4, color: C.bright, padding: '6px 10px', fontSize: 11, fontFamily: 'monospace' }} />
            <select onChange={e => applyTemplate(e.target.value)} value="" style={{ background: '#0A1220', border: `1px solid ${C.border}`, borderRadius: 4, color: C.accent, padding: '6px 8px', fontSize: 10, cursor: 'pointer' }}>
              <option value="">Templates</option>
              <option value="EMA Crossover">EMA Crossover</option>
              <option value="RSI Mean Reversion">RSI Mean Reversion</option>
              <option value="Bollinger Bounce">Bollinger Bounce</option>
            </select>
          </div>

          {/* Entry Conditions */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ color: C.green, fontSize: 11, fontWeight: 600 }}>Entry Conditions</span>
              <button onClick={() => addCondition('entry')} style={{ background: `${C.green}15`, border: `1px solid ${C.green}50`, color: C.green, borderRadius: 4, padding: '2px 10px', cursor: 'pointer', fontSize: 9 }}>+ Add</button>
            </div>
            {(strategy.conditions.entry || []).length === 0 && <div style={{ color: C.dim, fontSize: 10, padding: '8px 0' }}>No entry conditions — enters on first bar</div>}
            {(strategy.conditions.entry || []).map((cond, i) => (
              <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4, alignItems: 'center' }}>
                <select value={cond.indicator} onChange={e => updateCondition('entry', i, 'indicator', e.target.value)}
                  style={{ flex: 1, background: '#0A1220', border: `1px solid ${C.border}`, borderRadius: 4, color: C.text, padding: '4px 6px', fontSize: 9 }}>
                  {INDICATORS.map(ind => <option key={ind} value={ind}>{ind}</option>)}
                </select>
                <select value={cond.operator} onChange={e => updateCondition('entry', i, 'operator', e.target.value)}
                  style={{ width: 90, background: '#0A1220', border: `1px solid ${C.border}`, borderRadius: 4, color: C.text, padding: '4px 6px', fontSize: 9 }}>
                  {OPERATORS.map(op => <option key={op} value={op}>{op}</option>)}
                </select>
                <input value={cond.value} onChange={e => updateCondition('entry', i, 'value', e.target.value)}
                  style={{ width: 60, background: '#0A1220', border: `1px solid ${C.border}`, borderRadius: 4, color: C.accent, padding: '4px 6px', fontSize: 9, fontFamily: 'monospace' }} />
                <button onClick={() => removeCondition('entry', i)} style={{ background: 'none', border: 'none', color: C.red, cursor: 'pointer', fontSize: 12 }}>✕</button>
              </div>
            ))}
          </div>

          {/* Exit Conditions */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ color: C.red, fontSize: 11, fontWeight: 600 }}>Exit Conditions</span>
              <button onClick={() => addCondition('exit')} style={{ background: `${C.red}15`, border: `1px solid ${C.red}50`, color: C.red, borderRadius: 4, padding: '2px 10px', cursor: 'pointer', fontSize: 9 }}>+ Add</button>
            </div>
            {(strategy.conditions.exit || []).length === 0 && <div style={{ color: C.dim, fontSize: 10, padding: '8px 0' }}>No exit — holds till last bar</div>}
            {(strategy.conditions.exit || []).map((cond, i) => (
              <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4, alignItems: 'center' }}>
                <select value={cond.indicator} onChange={e => updateCondition('exit', i, 'indicator', e.target.value)}
                  style={{ flex: 1, background: '#0A1220', border: `1px solid ${C.border}`, borderRadius: 4, color: C.text, padding: '4px 6px', fontSize: 9 }}>
                  {INDICATORS.map(ind => <option key={ind} value={ind}>{ind}</option>)}
                </select>
                <select value={cond.operator} onChange={e => updateCondition('exit', i, 'operator', e.target.value)}
                  style={{ width: 90, background: '#0A1220', border: `1px solid ${C.border}`, borderRadius: 4, color: C.text, padding: '4px 6px', fontSize: 9 }}>
                  {OPERATORS.map(op => <option key={op} value={op}>{op}</option>)}
                </select>
                <input value={cond.value} onChange={e => updateCondition('exit', i, 'value', e.target.value)}
                  style={{ width: 60, background: '#0A1220', border: `1px solid ${C.border}`, borderRadius: 4, color: C.accent, padding: '4px 6px', fontSize: 9, fontFamily: 'monospace' }} />
                <button onClick={() => removeCondition('exit', i)} style={{ background: 'none', border: 'none', color: C.red, cursor: 'pointer', fontSize: 12 }}>✕</button>
              </div>
            ))}
          </div>

          {/* Position sizing */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <div>
              <label style={{ color: C.dim, fontSize: 8, textTransform: 'uppercase' }}>Size Type</label>
              <select value={strategy.positionSize.type} onChange={e => setStrategy(s => ({ ...s, positionSize: { ...s.positionSize, type: e.target.value } }))}
                style={{ width: '100%', background: '#0A1220', border: `1px solid ${C.border}`, borderRadius: 4, color: C.text, padding: '4px 6px', fontSize: 9 }}>
                <option value="percent">% of Capital</option>
                <option value="fixed">Fixed Qty</option>
              </select>
            </div>
            <div>
              <label style={{ color: C.dim, fontSize: 8, textTransform: 'uppercase' }}>Size Value</label>
              <input value={strategy.positionSize.value} onChange={e => setStrategy(s => ({ ...s, positionSize: { ...s.positionSize, value: Number(e.target.value) } }))}
                style={{ width: '100%', background: '#0A1220', border: `1px solid ${C.border}`, borderRadius: 4, color: C.accent, padding: '4px 6px', fontSize: 9, fontFamily: 'monospace' }} />
            </div>
            <div>
              <label style={{ color: C.dim, fontSize: 8, textTransform: 'uppercase' }}>Slippage %</label>
              <input value={strategy.slippage} onChange={e => setStrategy(s => ({ ...s, slippage: Number(e.target.value) }))}
                style={{ width: '100%', background: '#0A1220', border: `1px solid ${C.border}`, borderRadius: 4, color: C.accent, padding: '4px 6px', fontSize: 9, fontFamily: 'monospace' }} />
            </div>
          </div>
        </div>

        {/* RIGHT: Run config + log */}
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
            <div>
              <label style={{ color: C.dim, fontSize: 8, textTransform: 'uppercase' }}>Instrument</label>
              <select value={instrument} onChange={e => setInstrument(e.target.value)}
                style={{ width: '100%', background: '#0A1220', border: `1px solid ${C.border}`, borderRadius: 4, color: C.text, padding: '6px 8px', fontSize: 10 }}>
                {['NIFTY', 'BANKNIFTY', 'SENSEX', 'FINNIFTY', 'RELIANCE', 'TCS', 'HDFCBANK'].map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <div>
              <label style={{ color: C.dim, fontSize: 8, textTransform: 'uppercase' }}>Timeframe</label>
              <select value={timeframe} onChange={e => setTimeframe(e.target.value)}
                style={{ width: '100%', background: '#0A1220', border: `1px solid ${C.border}`, borderRadius: 4, color: C.text, padding: '6px 8px', fontSize: 10 }}>
                {['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={{ color: C.dim, fontSize: 8, textTransform: 'uppercase' }}>Candles</label>
              <input value={candleCount} onChange={e => setCandleCount(Number(e.target.value))}
                style={{ width: '100%', background: '#0A1220', border: `1px solid ${C.border}`, borderRadius: 4, color: C.accent, padding: '6px 8px', fontSize: 10, fontFamily: 'monospace' }} />
            </div>
          </div>

          {/* Run button */}
          <button onClick={runStrategy} disabled={running}
            style={{
              width: '100%', padding: '10px 0', marginBottom: 8, cursor: running ? 'not-allowed' : 'pointer',
              background: running ? `${C.accent}20` : `linear-gradient(135deg, ${C.accent}, #0066FF)`,
              border: 'none', borderRadius: 6, color: '#fff', fontWeight: 700, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase',
            }}>
            {running ? '⏳ Running Backtest...' : '▶ Run Backtest'}
          </button>

          {/* Algo execution buttons */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
            <button onClick={async () => {
              setLog(l => [...l, `[${new Date().toLocaleTimeString()}] Starting ${strategy.name} on ${instrument} (paper)...`]);
              try {
                const r = await fetch('http://localhost:9010/algo/start', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    name: strategy.name, asset: instrument,
                    conditions: strategy.conditions, mode: 'paper', interval_sec: 30,
                  }),
                });
                const d = await r.json();
                setLog(l => [...l, `[${new Date().toLocaleTimeString()}] ✅ ${d.status}: ${d.name}`]);
              } catch (e) { setLog(l => [...l, `[${new Date().toLocaleTimeString()}] ❌ ${e.message}`]); }
              setShowLog(true);
            }}
              style={{ padding: '8px 0', borderRadius: 6, cursor: 'pointer', background: `${C.green}18`, border: `1px solid ${C.green}50`, color: C.green, fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              📝 Start Paper
            </button>
            <button onClick={async () => {
              setLog(l => [...l, `[${new Date().toLocaleTimeString()}] Starting ${strategy.name} on ${instrument} (LIVE)...`]);
              try {
                const r = await fetch('http://localhost:9010/algo/start', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    name: strategy.name, asset: instrument,
                    conditions: strategy.conditions, mode: 'live', interval_sec: 30,
                  }),
                });
                const d = await r.json();
                setLog(l => [...l, `[${new Date().toLocaleTimeString()}] 🔴 ${d.status}: ${d.name}`]);
              } catch (e) { setLog(l => [...l, `[${new Date().toLocaleTimeString()}] ❌ ${e.message}`]); }
              setShowLog(true);
            }}
              style={{ padding: '8px 0', borderRadius: 6, cursor: 'pointer', background: `${C.red}18`, border: `1px solid ${C.red}50`, color: C.red, fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              🔴 Start Live
            </button>
          </div>

          {/* Log output */}
          {showLog && (
            <div style={{ background: '#0A1220', border: `1px solid ${C.border}`, borderRadius: 4, padding: 8, maxHeight: 180, overflowY: 'auto', fontSize: 9, fontFamily: '"JetBrains Mono", monospace' }}>
              {log.map((l, i) => (
                <div key={i} style={{ color: l.includes('✅') ? C.green : l.includes('❌') ? C.red : l.includes('⚠') ? C.yellow : C.dim, marginBottom: 2 }}>{l}</div>
              ))}
              {log.length === 0 && <div style={{ color: C.dim }}>Ready — tap "Run Backtest" to start</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
