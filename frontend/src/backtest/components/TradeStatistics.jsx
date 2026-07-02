import React from 'react';
import MetricGrid from './MetricGrid.jsx';
import MetricItem from './MetricItem.jsx';
import MetricGroup from './MetricGroup.jsx';
import { useBacktestStore } from '../stores/backtestStore.js';
import { count, pct, ratio, fmtDuration } from '../utils/formatters.js';

const C = {
  border: '#1A2E52', text: '#B8C7E0', dim: '#4A6080', bright: '#E8F0FF',
  accent: '#00D4FF', green: '#00E676', red: '#FF3B5C', yellow: '#FFD600',
};

export default function TradeStatistics() {
  const r = useBacktestStore(s => s.results);
  if (!r) return null;

  const fields = [
    { label: 'Total Trades', value: count(r.total_trades) },
    { label: 'Winning', value: count(r.winning_trades) },
    { label: 'Losing', value: count(r.losing_trades) },
    { label: 'Long Trades', value: count(r.long_trades) },
    { label: 'Short Trades', value: count(r.short_trades) },
    { label: 'Win Rate', value: pct(r.win_rate) },
    { label: 'Long Win Rate', value: pct(r.long_win_rate) },
    { label: 'Short Win Rate', value: pct(r.short_win_rate) },
    { label: 'Avg Bars', value: ratio(r.avg_bars_in_trade) },
    { label: 'Avg Hold Time', value: fmtDuration(r.avg_holding_time_ms) },
  ];

  return (
    <MetricGroup groupKey="trades" title="Trade Statistics">
      <MetricGrid cols={5} gap={6}>
        {fields.map(f => (
          <MetricItem key={f.label} label={f.label} value={f.value} />
        ))}
      </MetricGrid>
    </MetricGroup>
  );
}
