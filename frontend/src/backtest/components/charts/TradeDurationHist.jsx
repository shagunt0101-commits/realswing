import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useBacktestStore } from '../../stores/backtestStore';

const C = {
  bg: '#080E1C', panel: '#0D1729', border: '#1A2E52',
  accent: '#00D4FF', green: '#00E676', red: '#FF3B5C',
  yellow: '#FFD600', text: '#B8C7E0', dim: '#4A6080', bright: '#E8F0FF',
};

export default function TradeDurationHist() {
  const results = useBacktestStore(s => s.results);

  const data = useMemo(() => {
    if (!results?.trades || results.trades.length === 0) return [];
    const buckets = { '1-3': 0, '4-7': 0, '8-14': 0, '15+': 0 };
    results.trades.forEach(t => {
      if (t.bars_held <= 3) buckets['1-3']++;
      else if (t.bars_held <= 7) buckets['4-7']++;
      else if (t.bars_held <= 14) buckets['8-14']++;
      else buckets['15+']++;
    });
    return [
      { range: '1-3', count: buckets['1-3'] },
      { range: '4-7', count: buckets['4-7'] },
      { range: '8-14', count: buckets['8-14'] },
      { range: '15+', count: buckets['15+'] },
    ];
  }, [results?.trades]);

  if (!data.length) {
    return (
      <div style={{ background: C.panel, border: `1px solid ${C.border}`, padding: 12 }}>
        <div style={{ color: C.dim, fontSize: 14, textAlign: 'center' }}>No trade data</div>
      </div>
    );
  }

  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, padding: 12 }}>
      <div style={{ color: C.text, fontSize: 13, marginBottom: 8 }}>Trade Duration</div>
      <div width="100%">
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
            <XAxis dataKey="range" tick={{ fill: C.dim, fontSize: 11 }} axisLine={{ stroke: C.border }} />
            <YAxis tick={{ fill: C.dim, fontSize: 11 }} axisLine={{ stroke: C.border }} />
            <Tooltip
              contentStyle={{ background: C.panel, border: `1px solid ${C.border}`, color: C.text }}
              formatter={(val) => [val, 'Trades']}
              labelStyle={{ color: C.text }}
            />
            <Bar dataKey="count" fill={C.accent} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}