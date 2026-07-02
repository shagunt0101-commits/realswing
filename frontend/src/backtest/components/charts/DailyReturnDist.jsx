import { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useBacktestStore } from '../../stores/backtestStore';

const C = {
  bg: '#080E1C', panel: '#0D1729', border: '#1A2E52',
  accent: '#00D4FF', green: '#00E676', red: '#FF3B5C',
  yellow: '#FFD600', text: '#B8C7E0', dim: '#4A6080', bright: '#E8F0FF',
};

export default function DailyReturnDist() {
  const results = useBacktestStore(s => s.results);

  const bins = useMemo(() => {
    if (!results?.daily_returns || results.daily_returns.length === 0) return [];
    const returns = results.daily_returns.map(d => d.return);
    const min = Math.min(...returns);
    const max = Math.max(...returns);
    const bucketCount = 20;
    const step = (max - min) / bucketCount || 1;
    const binData = [];

    for (let i = 0; i < bucketCount; i++) {
      const lo = min + i * step;
      const hi = lo + step;
      const count = returns.filter(r => r >= lo && r < hi).length;
      binData.push({ return: (lo + hi) / 2, count, isPositive: (lo + hi) / 2 >= 0 });
    }
    return binData;
  }, [results?.daily_returns]);

  if (!bins.length) {
    return (
      <div style={{ background: C.panel, border: `1px solid ${C.border}`, padding: 12 }}>
        <div style={{ color: C.dim, fontSize: 14, textAlign: 'center' }}>No daily return data</div>
      </div>
    );
  }

  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, padding: 12 }}>
      <div style={{ color: C.text, fontSize: 13, marginBottom: 8 }}>Daily Return Distribution</div>
      <div width="100%">
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={bins} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
            <XAxis dataKey="return" tick={{ fill: C.dim, fontSize: 10 }} axisLine={{ stroke: C.border }} tickFormatter={v => v.toFixed(1)} />
            <YAxis tick={{ fill: C.dim, fontSize: 11 }} axisLine={{ stroke: C.border }} />
            <Tooltip
              contentStyle={{ background: C.panel, border: `1px solid ${C.border}`, color: C.text }}
              formatter={(val) => [val, 'Days']}
              labelStyle={{ color: C.text }}
            />
            <defs>
              <linearGradient id="posGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.green} stopOpacity={0.5} />
                <stop offset="100%" stopColor={C.green} stopOpacity={0.1} />
              </linearGradient>
              <linearGradient id="negGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.red} stopOpacity={0.5} />
                <stop offset="100%" stopColor={C.red} stopOpacity={0.1} />
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey="count" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}