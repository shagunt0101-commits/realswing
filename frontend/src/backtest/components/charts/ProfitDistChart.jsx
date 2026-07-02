import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useBacktestStore } from '../../stores/backtestStore';

const C = {
  bg: '#080E1C', panel: '#0D1729', border: '#1A2E52',
  accent: '#00D4FF', green: '#00E676', red: '#FF3B5C',
  yellow: '#FFD600', text: '#B8C7E0', dim: '#4A6080', bright: '#E8F0FF',
};

export default function ProfitDistChart() {
  const results = useBacktestStore(s => s.results);

  const bins = useMemo(() => {
    if (!results?.trades || results.trades.length === 0) return [];
    const pnls = results.trades.map(t => t.pnl);
    const min = Math.min(...pnls);
    const max = Math.max(...pnls);
    const bucketCount = 20;
    const step = (max - min) / bucketCount || 1;
    const binData = [];

    for (let i = 0; i < bucketCount; i++) {
      const lo = min + i * step;
      const hi = lo + step;
      const count = pnls.filter(p => p >= lo && p < hi).length;
      binData.push({
        range: `${lo.toFixed(0)}-${hi.toFixed(0)}`,
        count,
        mid: (lo + hi) / 2,
      });
    }
    return binData;
  }, [results?.trades]);

  if (!bins.length) {
    return (
      <div style={{ background: C.panel, border: `1px solid ${C.border}`, padding: 12 }}>
        <div style={{ color: C.dim, fontSize: 14, textAlign: 'center' }}>No trade data</div>
      </div>
    );
  }

  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, padding: 12 }}>
      <div style={{ color: C.text, fontSize: 13, marginBottom: 8 }}>Profit Distribution</div>
      <div width="100%">
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={bins} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
            <XAxis dataKey="range" tick={{ fill: C.dim, fontSize: 10 }} axisLine={{ stroke: C.border }} interval={2} />
            <YAxis tick={{ fill: C.dim, fontSize: 11 }} axisLine={{ stroke: C.border }} />
            <Tooltip
              contentStyle={{ background: C.panel, border: `1px solid ${C.border}`, color: C.text }}
              formatter={(val) => [val, 'Trades']}
              labelStyle={{ color: C.text }}
            />
            <Bar dataKey="count" radius={[3, 3, 0, 0]}>
              {bins.map((entry, index) => (
                <Cell key={index} fill={entry.mid >= 0 ? C.green : C.red} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}