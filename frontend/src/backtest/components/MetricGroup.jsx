import React from 'react';
import { useBacktestStore } from '../stores/backtestStore.js';

const C = {
  panel: '#0D1729', border: '#1A2E52', accent: '#00D4FF',
  dim: '#4A6080', bright: '#E8F0FF', text: '#B8C7E0',
};

export default function MetricGroup({ groupKey, title, subtitle, defaultExpanded, children }) {
  const expandedGroups = useBacktestStore(s => s.expandedGroups);
  const toggleGroup = useBacktestStore(s => s.toggleGroup);

  const expanded = expandedGroups[groupKey] ?? (defaultExpanded !== false);

  return (
    <div style={{
      background: C.panel,
      border: `1px solid ${C.border}`,
    }}>
      {/* Header — clickable to expand/collapse */}
      <div
        onClick={() => toggleGroup(groupKey)}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '10px 14px',
          cursor: 'pointer',
          borderBottom: expanded ? `1px solid ${C.border}` : 'none',
          userSelect: 'none',
        }}
      >
        <div>
          <span style={{ color: C.bright, fontWeight: 600, fontSize: 12, fontFamily: "'Inter', sans-serif" }}>
            {title}
          </span>
          {subtitle && (
            <span style={{ color: C.dim, fontSize: 9, marginLeft: 8 }}>
              {subtitle}
            </span>
          )}
        </div>
        <span style={{ color: C.accent, fontSize: 11, fontWeight: 600 }}>
          {expanded ? '−' : '+'}
        </span>
      </div>

      {/* Body */}
      {expanded && (
        <div style={{ padding: '8px 8px' }}>
          {children}
        </div>
      )}
    </div>
  );
}
