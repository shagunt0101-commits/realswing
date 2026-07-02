import React from 'react';
import { scoreColor } from '../utils/formatters.js';

const C = {
  border: '#1A2E52', text: '#B8C7E0', dim: '#4A6080', bright: '#E8F0FF',
  accent: '#00D4FF', green: '#00E676', red: '#FF3B5C', yellow: '#FFD600',
};

function valColor(label, value) {
  const lc = label.toLowerCase();
  if (value == null || isNaN(value)) return C.dim;
  // Risk metrics — red when high
  if (['drawdown', 'loss', 'ruin', 'risk', 'ulcer'].some(k => lc.includes(k))) {
    return value > 0 ? C.red : C.green;
  }
  // Positive metrics — green when positive
  if (['return', 'profit', 'pnl', 'win', 'sharpe', 'sortino', 'calmar', 'factor', 'score', 'kelly', 'ratio'].some(k => lc.includes(k))) {
    if (typeof value === 'number') {
      if (value >= 0) return C.green;
      return C.red;
    }
  }
  return C.accent;
}

export default function MetricItem({ label, value, sub, color: forcedColor }) {
  const displayValue = value != null && !isNaN(value) ? value : '—';
  const color = forcedColor || valColor(label, typeof value === 'string' ? parseFloat(value) : value);

  return (
    <div style={{
      background: '#0A1220',
      border: `1px solid ${C.border}`,
      padding: '8px 12px',
      minHeight: 56,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
    }}>
      <div style={{
        color: C.dim,
        fontSize: 8,
        letterSpacing: 1,
        textTransform: 'uppercase',
        marginBottom: 4,
        fontFamily: "'Inter', sans-serif",
      }}>
        {label}
      </div>
      <div style={{
        color,
        fontWeight: 700,
        fontSize: 15,
        fontFamily: "'JetBrains Mono', monospace",
        lineHeight: 1.2,
      }}>
        {displayValue}
      </div>
      {sub != null && (
        <div style={{
          color: C.dim,
          fontSize: 9,
          marginTop: 2,
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          {sub}
        </div>
      )}
    </div>
  );
}
