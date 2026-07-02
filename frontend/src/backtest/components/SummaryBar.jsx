import React from 'react';
import MetricItem from './MetricItem.jsx';
import { inrRaw, pct, ratio } from '../utils/formatters.js';

export default function SummaryBar({ r }) {
  if (!r) return null;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(6, 1fr)',
      gap: 6,
      background: '#0D1729',
      border: '1px solid #1A2E52',
      padding: 8,
    }}>
      <MetricItem label="Net P&L" value={inrRaw(r.net_pnl)} />
      <MetricItem label="Total Return" value={pct(r.total_return_pct)} />
      <MetricItem label="Annual Return" value={pct(r.annual_return_pct)} />
      <MetricItem label="Profit Factor" value={ratio(r.profit_factor)} />
      <MetricItem label="Expectancy" value={inrRaw(r.expectancy || r.avg_trade)} />
      <MetricItem label="Strategy Score" value={r.strategy_score >= 0 ? `${r.strategy_score}/100` : '—'} />
    </div>
  );
}
