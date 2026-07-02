import { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { useBacktestStore } from '../../stores/backtestStore';

const C = {
  bg: '#080E1C', panel: '#0D1729', border: '#1A2E52',
  accent: '#00D4FF', green: '#00E676', red: '#FF3B5C',
  yellow: '#FFD600', text: '#B8C7E0', dim: '#4A6080', bright: '#E8F0FF',
};

export default function RollingSharpe() {
  const results = useBacktestStore(s => s.results);

  const data = useMemo(() => {
    if (!results?.daily_returns || results.daily_returns.length < 20) return [];
    const returns = results.daily_returns.map(d => d.return);
    const windowSize = 20;
    const rolling = [];

    for (let i = windowSize - 1; i < returns.length; i++) {
      const slice = returns.slice(i - windowSize + 1, i + 1);
      const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
      const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / slice.length;
      const std = Math.sqrt(variance);
      const sharpe = std !== 0 ? (mean / std) * Math.sqrt(252) : 0;
      rolling.push({ date: results.daily_returns[i].date, sharpe });
    }
    return rolling;
  }, [results?.daily_returns]);

  if (!data.length) {
    return (
      <div style={{ background: C.panel, border: `1px solid ${C.border}`, padding: 12 }}>
        <div style={{ color: C.dim, fontSize: 14, textAlign: 'center' }}>Insufficient daily data</div>
      </div>
    );
  }

  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, padding: 12 }}>
      <div style={{ color: C.text, fontSize: 13, marginBottom: 8 }}>Rolling Sharpe (20d)</div>
      <div width="100%">
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
            <XAxis dataKey="date" tick={{ fill: C.dim, fontSize: 10 }} axisLine={{ stroke: C.border }} tickFormatter={v => v.slice(5)} />
            <YAxis tick={{ fill: C.dim, fontSize: 11 }} axisLine={{ stroke: C.border }} />
            <Tooltip
              contentStyle={{ background: C.panel, border: `1px solid ${C.border}`, color: C.text }}
              formatter={(val) => [val.toFixed(2), 'Sharpe']}
              labelStyle={{ color: C.text }}
            />
            <ReferenceLine y={0} stroke={C.dim} />
            <defs>
              <linearGradient id="sharpeGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.green} stopOpacity={0.4} />
                <stop offset="100%" stopColor={C.green} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey="sharpe" stroke={C.green} fill="url(#sharpeGrad)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}