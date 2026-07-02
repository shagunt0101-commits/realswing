import { useEffect, useRef } from 'react';
import { createChart, LineSeries } from 'lightweight-charts';
import { useBacktestStore } from '../../stores/backtestStore';

const C = {
  bg: '#080E1C', panel: '#0D1729', border: '#1A2E52',
  accent: '#00D4FF', green: '#00E676', red: '#FF3B5C',
  yellow: '#FFD600', text: '#B8C7E0', dim: '#4A6080', bright: '#E8F0FF',
};

export default function EquityCurve() {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const results = useBacktestStore(s => s.results);

  useEffect(() => {
    if (!containerRef.current || !results?.equity_curve) return;
    const container = containerRef.current;
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(container, {
      width: container.offsetWidth,
      height: 300,
      layout: { background: '#080E1C', textColor: '#4A6080' },
      grid: { vertLines: { color: '#1A2E52' }, horzLines: { color: '#1A2E52' } },
      crosshair: { mode: 0 },
      timeScale: { timeVisible: true, borderColor: '#1A2E52' },
      rightPriceScale: { borderColor: '#1A2E52' },
    });

    const lineSeries = chart.addSeries(LineSeries, {
      color: '#00D4FF',
      lineWidth: 2,
    });

    lineSeries.setData(results.equity_curve);
    chart.timeScale().fitContent();
    chartRef.current = chart;

    const handleResize = () => {
      if (chartRef.current && container.offsetWidth) {
        chartRef.current.applyOptions({ width: container.offsetWidth });
      }
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [results?.equity_curve]);

  if (!results?.equity_curve) {
    return (
      <div style={{ background: C.border, border: `1px solid ${C.border}`, padding: 12 }}>
        <div style={{ color: C.dim, fontSize: 14, textAlign: 'center' }}>No equity data</div>
      </div>
    );
  }

  return (
    <div style={{ background: C.border, border: `1px solid ${C.border}`, padding: 12 }}>
      <div style={{ color: C.text, fontSize: 13, marginBottom: 8 }}>Equity Curve</div>
      <div ref={containerRef} style={{ width: '100%', height: 300 }} />
    </div>
  );
}