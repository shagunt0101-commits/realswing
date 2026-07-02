import React from 'react';
import MetricGrid from './MetricGrid.jsx';
import MetricItem from './MetricItem.jsx';
import { inrRaw, pct, ratio, ratio3 } from '../utils/formatters.js';

export default function PerformanceMetrics({ r }) {
  if (!r) return null;
  return (
    <MetricGrid cols={4} gap={6}>
      <MetricItem label="Gross Profit" value={inrRaw(r.gross_profit)} />
      <MetricItem label="Gross Loss" value={inrRaw(Math.abs(r.gross_loss))} />
      <MetricItem label="Net Profit" value={inrRaw(r.net_pnl)} />
      <MetricItem label="Avg Trade" value={inrRaw(r.avg_trade)} />
      <MetricItem label="Avg Winning Trade" value={inrRaw(r.avg_winning_trade)} />
      <MetricItem label="Avg Losing Trade" value={inrRaw(Math.abs(r.avg_losing_trade))} />
      <MetricItem label="Largest Winner" value={inrRaw(r.largest_winner)} />
      <MetricItem label="Largest Loser" value={inrRaw(Math.abs(r.largest_loser))} />
      <MetricItem label="Profit Factor" value={ratio(r.profit_factor)} sub="> 2.0 = excellent" />
      <MetricItem label="Recovery Factor" value={ratio(r.recovery_factor)} sub="> 5 = strong" />
      <MetricItem label="Expectancy" value={inrRaw(r.expectancy)} sub="per trade" />
      <MetricItem label="SQN" value={ratio(r.sqn)} sub="> 3 = robust" />
      <MetricItem label="Sharpe Ratio" value={ratio(r.sharpe_ratio)} sub="> 2 = excellent" />
      <MetricItem label="Sortino Ratio" value={ratio(r.sortino_ratio)} sub="> 3 = strong" />
      <MetricItem label="Calmar Ratio" value={ratio(r.calmar_ratio)} sub="> 3 = good" />
      <MetricItem label="Omega Ratio" value={ratio(r.omega_ratio)} sub="> 1.5 = attractive" />
    </MetricGrid>
  );
}
