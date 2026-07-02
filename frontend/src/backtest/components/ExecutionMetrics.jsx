import React from 'react';
import MetricGrid from './MetricGrid.jsx';
import MetricItem from './MetricItem.jsx';
import MetricGroup from './MetricGroup.jsx';
import { useBacktestStore } from '../stores/backtestStore.js';
import { ratio, inr } from '../utils/formatters.js';

const C = {
  border: '#1A2E52', text: '#B8C7E0', dim: '#4A6080', bright: '#E8F0FF',
  accent: '#00D4FF', green: '#00E676', red: '#FF3B5C', yellow: '#FFD600',
};

export default function ExecutionMetrics() {
  const r = useBacktestStore(s => s.results);
  if (!r) return null;

  const fields = [
    { label: 'Entry Slippage', value: ratio(r.avg_entry_slippage) },
    { label: 'Exit Slippage', value: ratio(r.avg_exit_slippage) },
    { label: 'Total Commissions', value: inr(r.total_commissions) },
    { label: 'Total Fees', value: inr(r.total_fees) },
    { label: 'Avg Position Size', value: inr(r.avg_position_size) },
  ];

  return (
    <MetricGroup groupKey="execution" title="Execution Metrics">
      <MetricGrid cols={5} gap={6}>
        {fields.map(f => (
          <MetricItem key={f.label} label={f.label} value={f.value} />
        ))}
      </MetricGrid>
    </MetricGroup>
  );
}
