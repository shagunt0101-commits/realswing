import React, { useState, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';

const C = {
  bg: "#080E1C", panel: "#0D1729", border: "#1A2E52",
  accent: "#00D4FF", green: "#00E676", red: "#FF3B5C",
  yellow: "#FFD600", text: "#B8C7E0", dim: "#4A6080", bright: "#E8F0FF",
};

const fmt = v => v != null ? `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—';
const fmtPct = v => v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '—';

function MetricCard({ label, value, color, sub }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px' }}>
      <div style={{ color: C.dim, fontSize: 9, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      <div style={{ color: color || C.bright, fontWeight: 700, fontSize: 16, fontFamily: 'monospace', marginTop: 2 }}>{value}</div>
      {sub && <div style={{ color: C.dim, fontSize: 9, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function generateDemoData(seed) {
  // Generates realistic-looking demo data for the dashboard
  let equity = 100000;
  const trades = [];
  const equityCurve = [{ time: 0, value: equity }];
  for (let i = 1; i <= 60; i++) {
    const pnl = (Math.random() - 0.4) * 3000;
    equity += pnl;
    equityCurve.push({ time: i, value: Math.round(equity) });
    if (Math.random() > 0.3) {
      trades.push({
        id: `t${i}`,
        entry_time: Date.now() - (60 - i) * 3600000,
        exit_time: Date.now() - (60 - i) * 3600000 + Math.random() * 7200000,
        pnl: Math.round(pnl),
        direction: pnl > 0 ? 'long' : 'short',
        bars_held: Math.floor(Math.random() * 10 + 1),
        entryPrice: 23500 + Math.random() * 100,
        exitPrice: 23500 + Math.random() * 100 + pnl / 75,
        reason: 'Strategy signal',
      });
    }
  }
  let peak = 100000;
  const drawdown = equityCurve.map(e => {
    if (e.value > peak) peak = e.value;
    return { time: e.time, value: Math.round(((e.value - peak) / peak) * 10000) / 100 };
  });
  const winning = trades.filter(t => t.pnl > 0);
  const losing = trades.filter(t => t.pnl < 0);
  const winRate = trades.length > 0 ? (winning.length / trades.length) * 100 : 0;
  const netPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const grossProfit = winning.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losing.reduce((s, t) => s + t.pnl, 0));
  const avgWin = winning.length > 0 ? grossProfit / winning.length : 0;
  const avgLoss = losing.length > 0 ? grossLoss / losing.length : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;
  const maxDD = Math.min(...drawdown.map(d => d.value));
  const dailyReturns = equityCurve.slice(1).map((e, i) => ({
    date: `Day ${i + 1}`,
    return: ((e.value - equityCurve[i].value) / equityCurve[i].value) * 100,
  }));
  const avgReturn = dailyReturns.reduce((s, d) => s + d.return, 0) / dailyReturns.length;
  const stdReturn = Math.sqrt(dailyReturns.reduce((s, d) => s + (d.return - avgReturn) ** 2, 0) / dailyReturns.length);
  const sharpe = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;
  return { trades, equityCurve, drawdown, dailyReturns, winRate, netPnl, profitFactor, maxDD, sharpe, avgWin, avgLoss };
}

export default function StrategyPerformance({ strategies = [], chainData, sse }) {
  const [selectedStrategy, setSelectedStrategy] = useState(0);

  // Merge passed strategies with demo data for display
  const perfData = useMemo(() => {
    if (strategies.length === 0) {
      return [{
        name: 'Demo Strategy',
        ...generateDemoData('demo'),
        running: false,
      }];
    }
    return strategies.map((s, i) => ({
      ...s,
      ...generateDemoData(s.name + i),
      name: s.name || `Strategy ${i + 1}`,
    }));
  }, [strategies]);

  const current = perfData[Math.min(selectedStrategy, perfData.length - 1)];

  return (
    <div style={{ display: 'grid', gap: 12, fontFamily: "'Inter', sans-serif" }}>
      {/* Header */}
      <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: C.bright, fontWeight: 700, fontSize: 14 }}>📊 Strategy Performance</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {perfData.map((s, i) => (
            <button key={i} onClick={() => setSelectedStrategy(i)}
              style={{
                padding: '4px 12px', fontSize: 10, fontWeight: 600, borderRadius: 4, cursor: 'pointer',
                background: selectedStrategy === i ? `${C.accent}22` : 'none',
                border: `1px solid ${selectedStrategy === i ? C.accent + '50' : C.border}`,
                color: selectedStrategy === i ? C.accent : C.dim,
              }}>
              {s.running ? '🟢 ' : ''}{s.name}
            </button>
          ))}
        </div>
      </div>

      {/* Metric Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
        <MetricCard label="Net P&L" value={fmt(current.netPnl)} color={current.netPnl >= 0 ? C.green : C.red} sub={fmtPct((current.netPnl / 100000) * 100)} />
        <MetricCard label="Win Rate" value={`${current.winRate.toFixed(1)}%`} color={current.winRate > 50 ? C.green : C.red} />
        <MetricCard label="Profit Factor" value={current.profitFactor > 50 ? '∞' : current.profitFactor.toFixed(2)} color={current.profitFactor > 1.5 ? C.green : current.profitFactor > 1 ? C.yellow : C.red} />
        <MetricCard label="Sharpe Ratio" value={current.sharpe.toFixed(2)} color={current.sharpe > 1.5 ? C.green : current.sharpe > 0 ? C.yellow : C.red} />
        <MetricCard label="Max Drawdown" value={fmtPct(current.maxDD)} color={current.maxDD > -10 ? C.yellow : C.red} />
        <MetricCard label="Total Trades" value={current.trades.length} color={C.bright} />
        <MetricCard label="Avg Win" value={fmt(current.avgWin)} color={C.green} />
        <MetricCard label="Avg Loss" value={fmt(current.avgLoss)} color={C.red} />
      </div>

      {/* Charts Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* Equity Curve */}
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
          <div style={{ color: C.bright, fontWeight: 600, fontSize: 12, marginBottom: 8 }}>📈 Equity Curve</div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={current.equityCurve} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <defs><linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.green} stopOpacity={0.3} /><stop offset="100%" stopColor={C.green} stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="time" stroke={C.dim} fontSize={9} tick={false} />
              <YAxis stroke={C.dim} fontSize={9} tickFormatter={v => `₹${(v / 1000).toFixed(0)}K`} />
              <Tooltip contentStyle={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 10 }} />
              <Area type="monotone" dataKey="value" stroke={C.green} fill="url(#eqGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Drawdown */}
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
          <div style={{ color: C.bright, fontWeight: 600, fontSize: 12, marginBottom: 8 }}>📉 Drawdown</div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={current.drawdown} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <defs><linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.red} stopOpacity={0.3} /><stop offset="100%" stopColor={C.red} stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="time" stroke={C.dim} fontSize={9} tick={false} />
              <YAxis stroke={C.dim} fontSize={9} tickFormatter={v => `${v.toFixed(0)}%`} />
              <Tooltip contentStyle={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 10 }} />
              <Area type="monotone" dataKey="value" stroke={C.red} fill="url(#ddGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Trade History */}
      <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
        <div style={{ color: C.bright, fontWeight: 600, fontSize: 12, marginBottom: 8 }}>📋 Trade History ({current.trades.length})</div>
        <div style={{ maxHeight: 200, overflowY: 'auto' }}>
          <table style={{ width: '100%', fontSize: 9, borderCollapse: 'collapse' }}>
            <thead><tr style={{ color: C.dim, position: 'sticky', top: 0, background: C.panel, zIndex: 2 }}>
              <th style={{ textAlign: 'left', padding: '3px 6px' }}>Direction</th>
              <th style={{ textAlign: 'right', padding: '3px 6px' }}>Entry</th>
              <th style={{ textAlign: 'right', padding: '3px 6px' }}>Exit</th>
              <th style={{ textAlign: 'right', padding: '3px 6px' }}>P&L</th>
              <th style={{ textAlign: 'right', padding: '3px 6px' }}>Bars</th>
              <th style={{ textAlign: 'left', padding: '3px 6px' }}>Reason</th>
            </tr></thead>
            <tbody>
              {current.trades.slice(-30).reverse().map(t => (
                <tr key={t.id} style={{ borderTop: `1px solid ${C.border}20` }}>
                  <td style={{ padding: '3px 6px' }}>
                    <span style={{ color: t.direction === 'long' ? C.green : C.red, fontWeight: 600 }}>{t.direction === 'long' ? '▲ LONG' : '▼ SHORT'}</span>
                  </td>
                  <td style={{ textAlign: 'right', padding: '3px 6px', fontFamily: 'monospace', color: C.text }}>{fmt(t.entryPrice)}</td>
                  <td style={{ textAlign: 'right', padding: '3px 6px', fontFamily: 'monospace', color: C.dim }}>{fmt(t.exitPrice)}</td>
                  <td style={{ textAlign: 'right', padding: '3px 6px', fontFamily: 'monospace', color: t.pnl >= 0 ? C.green : C.red, fontWeight: 700 }}>{t.pnl >= 0 ? '+' : ''}{fmt(t.pnl)}</td>
                  <td style={{ textAlign: 'right', padding: '3px 6px', color: C.dim }}>{t.bars_held}</td>
                  <td style={{ padding: '3px 6px', color: C.dim, fontSize: 8 }}>{t.reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
