import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useBacktestStore } from '../../stores/backtestStore';

const C = {
  bg: '#080E1C', panel: '#0D1729', border: '#1A2E52',
  accent: '#00D4FF', green: '#00E676', red: '#FF3B5C',
  yellow: '#FFD600', text: '#B8C7E0', dim: '#4A6080', bright: '#E8F0FF',
};

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function MonthlyReturns() {
  const results = useBacktestStore(s => s.results);

  if (!results?.monthly_returns) {
    return (
      <div style={{ background: C.panel, border: `1px solid ${C.border}`, padding: 12 }}>
        <div style={{ color: C.dim, fontSize: 14, textAlign: 'center' }}>No monthly data</div>
      </div>
    );
  }

  const data = results.monthly_returns.map(m => ({
    month: monthNames[m.month - 1],
    return: m.return,
    trades_count: m.trades_count,
  }));

  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, padding: 12 }}>
      <div style={{ color: C.text, fontSize: 13, marginBottom: 8 }}>Monthly Returns</div>
      <div width="100%">
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
            <XAxis dataKey="month" tick={{ fill: C.dim, fontSize: 11 }} axisLine={{ stroke: C.border }} />
            <YAxis tick={{ fill: C.dim, fontSize: 11 }} axisLine={{ stroke: C.border }} />
            <Tooltip
              contentStyle={{ background: C.panel, border: `1px solid ${C.border}`, color: C.text }}
              formatter={(val) => [`${val.toFixed(2)}%`, 'Return']}
              labelStyle={{ color: C.text }}
            />
            <Bar dataKey="return" radius={[3, 3, 0, 0]}>
              {data.map((entry, index) => (
                <Cell key={index} fill={entry.return >= 0 ? C.green : C.red} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}