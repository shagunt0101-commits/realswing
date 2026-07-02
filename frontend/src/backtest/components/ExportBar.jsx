import React from 'react';
import { useBacktestStore } from '../stores/backtestStore.js';

const C = {
  bg: '#080E1C', panel: '#0D1729', border: '#1A2E52',
  accent: '#00D4FF', green: '#00E676', text: '#B8C7E0', dim: '#4A6080',
};

function generateCSV(trades) {
  if (!trades || trades.length === 0) return '';
  const headers = ['Entry Time', 'Exit Time', 'Direction', 'PnL', 'Bars Held'];
  const rows = trades.map(t => [
    new Date(t.entry_time).toISOString(),
    new Date(t.exit_time).toISOString(),
    t.direction,
    t.pnl,
    t.bars_held,
  ]);
  return [headers, ...rows].map(row => row.join(',')).join('\n');
}

function downloadCSV(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function ExportBar() {
  const results = useBacktestStore(s => s.results);
  const expandAll = useBacktestStore(s => s.expandAll);
  const collapseAll = useBacktestStore(s => s.collapseAll);

  const handleExportCSV = () => {
    if (!results?.trades) return;
    const csv = generateCSV(results.trades);
    const date = new Date().toISOString().slice(0, 10);
    downloadCSV(csv, `backtest_trades_${date}.csv`);
  };

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      background: C.panel,
      borderTop: `1px solid ${C.border}`,
      padding: '10px 20px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      zIndex: 100,
    }}>
      <div style={{ color: C.dim, fontSize: 11 }}>
        Backtest Results
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={handleExportCSV}
          style={{
            background: 'transparent',
            border: `1px solid ${C.accent}`,
            color: C.accent,
            borderRadius: 6,
            padding: '6px 14px',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: "'Inter', sans-serif",
          }}
        >
          Export CSV
        </button>
        <button
          onClick={expandAll}
          style={{
            background: 'transparent',
            border: `1px solid ${C.dim}`,
            color: C.dim,
            borderRadius: 6,
            padding: '6px 14px',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: "'Inter', sans-serif",
          }}
        >
          Expand All
        </button>
        <button
          onClick={collapseAll}
          style={{
            background: 'transparent',
            border: `1px solid ${C.dim}`,
            color: C.dim,
            borderRadius: 6,
            padding: '6px 14px',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: "'Inter', sans-serif",
          }}
        >
          Collapse All
        </button>
      </div>
    </div>
  );
}