import React from 'react';
import MetricGroup from './MetricGroup.jsx';
import MetricGrid from './MetricGrid.jsx';
import MetricItem from './MetricItem.jsx';
import { inr, pct, ratio, fmtDuration, scoreColor } from '../utils/formatters.js';

const C = {
  bg: '#080E1C', panel: '#0D1729', border: '#1A2E52',
  accent: '#00D4FF', green: '#00E676', red: '#FF3B5C',
  yellow: '#FFD600', text: '#B8C7E0', dim: '#4A6080', bright: '#E8F0FF',
};

export default function StressTestPanel({ r }) {
  if (!r) return null;

  return (
    <MetricGroup groupKey="stress" title="Stress Tests" subtitle="Worst/best case analysis">
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 12,
      }}>
        {/* Left Column — Worst Case */}
        <div>
          <div style={{
            color: C.red,
            fontSize: 10,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: 1,
            marginBottom: 8,
            paddingLeft: 4,
          }}>
            Worst Case
          </div>
          <MetricGrid cols={2} gap={6}>
            <MetricItem label="Worst Month" value={inr(r.worst_month_pnl)} />
            <MetricItem label="Worst Week" value={inr(r.worst_week_pnl)} />
            <MetricItem label="Worst Day" value={inr(r.worst_day_pnl)} />
            <MetricItem label="Worst Trade" value={inr(r.worst_trade_pnl)} />
            <MetricItem label="Longest Drawdown" value={fmtDuration(r.longest_drawdown_days * 24 * 60)} />
            <MetricItem label="Recovery Time" value={fmtDuration(r.recovery_time_days * 24 * 60)} />
            <MetricItem
              label="Stress Score"
              value={r.strategy_score >= 0 ? `${r.strategy_score}/100` : '—'}
              color={scoreColor(r.strategy_score)}
            />
          </MetricGrid>
        </div>

        {/* Right Column — Best Case */}
        <div>
          <div style={{
            color: C.green,
            fontSize: 10,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: 1,
            marginBottom: 8,
            paddingLeft: 4,
          }}>
            Best Case
          </div>
          <MetricGrid cols={2} gap={6}>
            <MetricItem label="Best Trade" value={inr(r.best_trade_pnl)} />
            <MetricItem label="Total Return" value={pct(r.total_return_pct)} />
            <MetricItem label="Profit Factor" value={ratio(r.profit_factor)} />
            <MetricItem label="Sharpe Ratio" value={ratio(r.sharpe_ratio)} />
          </MetricGrid>
        </div>
      </div>
    </MetricGroup>
  );
}