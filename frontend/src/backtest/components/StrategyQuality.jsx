import React from 'react';
import MetricItem from './MetricItem.jsx';
import MetricGroup from './MetricGroup.jsx';
import { useBacktestStore } from '../stores/backtestStore.js';
import { scoreColor } from '../utils/formatters.js';

const C = {
  border: '#1A2E52', text: '#B8C7E0', dim: '#4A6080', bright: '#E8F0FF',
  accent: '#00D4FF', green: '#00E676', red: '#FF3B5C', yellow: '#FFD600',
};

const subScores = [
  { label: 'Trend Score', key: 'trend_score' },
  { label: 'Mean Reversion', key: 'mean_reversion_score' },
  { label: 'Consistency', key: 'consistency_score' },
  { label: 'Robustness', key: 'robustness_score' },
  { label: 'Stability', key: 'stability_score' },
  { label: 'Risk Score', key: 'risk_score' },
  { label: 'Live Readiness', key: 'live_readiness_score' },
  { label: 'Monte Carlo Conf.', key: 'monte_carlo_confidence' },
];

export default function StrategyQuality() {
  const r = useBacktestStore(s => s.results);
  if (!r) return null;

  const overall = r.overall_score;

  return (
    <MetricGroup groupKey="quality" title="Strategy Quality">
      {/* Overall score — large hero number */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px 0 16px',
        borderBottom: `1px solid ${C.border}`,
        marginBottom: 12,
      }}>
        <div style={{
          color: C.dim,
          fontSize: 9,
          letterSpacing: 1.5,
          textTransform: 'uppercase',
          marginBottom: 6,
          fontFamily: "'Inter', sans-serif",
        }}>
          Overall Score
        </div>
        <div style={{
          color: scoreColor(overall),
          fontWeight: 700,
          fontSize: 42,
          fontFamily: "'JetBrains Mono', monospace",
          lineHeight: 1,
        }}>
          {overall != null && !isNaN(overall) ? Math.round(overall) : '—'}
        </div>
      </div>

      {/* Sub-scores in a 3-column grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 6,
      }}>
        {subScores.map(s => {
          const val = r[s.key];
          return (
            <MetricItem
              key={s.key}
              label={s.label}
              value={val != null && !isNaN(val) ? Math.round(val) : '—'}
              color={scoreColor(val)}
            />
          );
        })}
      </div>
    </MetricGroup>
  );
}
