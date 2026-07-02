import { useMemo } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useBacktestStore } from '../../stores/backtestStore';

const C = {
  bg: '#080E1C', panel: '#0D1729', border: '#1A2E52',
  accent: '#00D4FF', green: '#00E676', red: '#FF3B5C',
  yellow: '#FFD600', text: '#B8C7E0', dim: '#4A6080', bright: '#E8F0FF',
};

export default function TradeScatter() {
  const results = useBacktestStore(s => s.results);

  const { positive, negative } = useMemo(() => {
    if (!results?.trades || results.trades.length === 0) return { positive: [], negative: [] };
    const pos = results.trades.filter(t => t.pnl > 0).map(t => ({ x: t.bars_held, y: t.pnl }));
    const neg = results.trades.filter(t => t.pnl < 0).map(t => ({ x: t.bars_held, y: t.pnl }));
    return { positive: pos, negative: neg };
  }, [results?.trades]);

  if (!positive.length && !negative.length) {
    return (
      <div style={{ background: C.panel, border: `1px solid ${C.border}`, padding: 12 }}>
        <div style={{ color: C.dim, fontSize: 14, textAlign: 'center' }}>No trade data</div>
      </div>
    );
  }

  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, padding: 12 }}>
      <div style={{ color: C.text, fontSize: 13, marginBottom: 8 }}>Trade Scatter</div>
      <div width="100%">
        <ResponsiveContainer width="100%" height={250}>
          <ScatterChart margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
            <XAxis type="number" dataKey="x" name="Bars Held" tick={{ fill: C.dim, fontSize: 11 }} axisLine={{ stroke: C.border }} />
            <YAxis type="number" dataKey="y" name="PnL" tick={{ fill: C.dim, fontSize: 11 }} axisLine={{ stroke: C.border }} />
            <Tooltip
              contentStyle={{ background: C.panel, border: `1px solid ${C.border}`, color: C.text }}
              cursor={{ stroke: C.dim }}
            />
            <Scatter data={positive} fill={C.green} />
            <Scatter data={negative} fill={C.red} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}