import { useEffect, useRef } from 'react';
import { createChart, LineSeries } from 'lightweight-charts';
import { useBacktestStore } from '../../stores/backtestStore';

const C = {
  bg: '#080E1C', panel: '#0D1729', border: '#1A2E52',
  accent: '#00D4FF', green: '#00E676', red: '#FF3B5C', dim: '#4A6080',
};

export default function DrawdownCurve() {
  const containerRef = useRef(null);
  const results = useBacktestStore(s => s.results);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !results?.drawdown_curve?.length) return;

    let chart;
    try {
      chart = createChart(el, {
        width: el.offsetWidth || 600,
        height: 280,
        layout: { background: '#080E1C', textColor: '#4A6080' },
        grid: { vertLines: { color: '#1A2E52' }, horzLines: { color: '#1A2E52' } },
        crosshair: { mode: 0 },
        timeScale: { borderColor: '#1A2E52', timeVisible: true },
        rightPriceScale: { borderColor: '#1A2E52' },
      });

      const series = chart.addSeries(LineSeries, {
        color: '#FF3B5C',
        lineWidth: 2,
        priceFormat: { type: 'custom', formatter: v => `${v.toFixed(2)}%` },
      });
      series.setData(results.drawdown_curve);
      chart.timeScale().fitContent();
    } catch (e) { console.error('[DrawdownCurve]', e); }

    return () => { if (chart) try { chart.remove(); } catch {} };
  }, [results?.drawdown_curve]);

  if (!results?.drawdown_curve?.length) {
    return <div style={{ background: C.border, border: `1px solid ${C.border}`, padding: 12, color: C.dim, textAlign: 'center', fontSize: 13 }}>No drawdown data</div>;
  }

  return (
    <div style={{ background: C.border, border: `1px solid ${C.border}`, padding: 12 }}>
      <div style={{ color: C.text, fontSize: 12, marginBottom: 6 }}>Drawdown Curve</div>
      <div ref={containerRef} style={{ width: '100%', height: 280 }} />
    </div>
  );
}
