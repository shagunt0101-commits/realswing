import React from 'react';
import MetricGrid from './MetricGrid.jsx';
import MetricItem from './MetricItem.jsx';
import { pct, ratio, ratio3, count, fmtDuration } from '../utils/formatters.js';

export default function RiskMetrics({ r }) {
  if (!r) return null;
  return (
    <MetricGrid cols={3} gap={6}>
      <MetricItem label="Max Drawdown" value={pct(r.max_drawdown)} sub="peak-to-trough" />
      <MetricItem label="Avg Drawdown" value={pct(r.avg_drawdown)} />
      <MetricItem label="Max Consec Losses" value={count(r.consecutive_losses)} sub="# in a row" />
      <MetricItem label="Max Consec Wins" value={count(r.consecutive_wins)} sub="# in a row" />
      <MetricItem label="Ulcer Index" value={ratio3(r.ulcer_index)} sub="downside risk" />
      <MetricItem label="Volatility (ann)" value={pct(r.volatility_annual)} />
      <MetricItem label="Risk/Reward Ratio" value={ratio(r.risk_reward_ratio)} />
      <MetricItem label="Kelly %" value={pct(r.kelly_pct)} sub="optimal sizing" />
      <MetricItem label="Risk of Ruin" value={pct(r.risk_of_ruin)} sub="lifetime prob" />
    </MetricGrid>
  );
}
