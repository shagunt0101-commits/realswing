import React, { Component, useEffect, useRef, useState } from 'react';
import { useBacktestStore } from './stores/backtestStore.js';
import SummaryBar from './components/SummaryBar.jsx';
import PerformanceMetrics from './components/PerformanceMetrics.jsx';
import RiskMetrics from './components/RiskMetrics.jsx';
import TradeStatistics from './components/TradeStatistics.jsx';
import ExecutionMetrics from './components/ExecutionMetrics.jsx';
import StrategyQuality from './components/StrategyQuality.jsx';
import StressTestPanel from './components/StressTestPanel.jsx';
import StrategyBuilder from './components/StrategyBuilder.jsx';
import MetricGroup from './components/MetricGroup.jsx';
import ExportBar from './components/ExportBar.jsx';
import EquityCurve from './components/charts/EquityCurve.jsx';
import DrawdownCurve from './components/charts/DrawdownCurve.jsx';
import MonthlyReturns from './components/charts/MonthlyReturns.jsx';
import ProfitDistChart from './components/charts/ProfitDistChart.jsx';
import TradeScatter from './components/charts/TradeScatter.jsx';
import WinLossHist from './components/charts/WinLossHist.jsx';
import TradeDurationHist from './components/charts/TradeDurationHist.jsx';
import RollingSharpe from './components/charts/RollingSharpe.jsx';
import DailyReturnDist from './components/charts/DailyReturnDist.jsx';

const C = {
  bg: '#080E1C', panel: '#0D1729', border: '#1A2E52',
  accent: '#00D4FF', green: '#00E676', red: '#FF3B5C',
  yellow: '#FFD600', text: '#B8C7E0', dim: '#4A6080', bright: '#E8F0FF',
};

// Error Boundary — catches render errors
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: 40, textAlign: 'center', color: C.red,
          background: C.panel, borderRadius: 10, minHeight: 400,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
          <div style={{ fontSize: 13, marginBottom: 8 }}>Dashboard component crashed</div>
          <div style={{ fontSize: 11, color: C.dim, marginBottom: 16, maxWidth: 400 }}>
            {this.state.error?.message || 'Unknown error'}
          </div>
          <button onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              background: `${C.accent}15`, border: `1px solid ${C.accent}44`,
              color: C.accent, borderRadius: 6, padding: '8px 20px', cursor: 'pointer',
            }}>
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function BacktestDashboardInner({ session }) {
  const results = useBacktestStore(s => s.results);
  const initializeDemo = useBacktestStore(s => s.initializeDemo);
  const [showBuilder, setShowBuilder] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      initializeDemo();
    }
  }, [initializeDemo]);

  return (
    <div style={{
      minHeight: '100vh',
      background: C.bg,
      padding: 16,
      paddingBottom: 60,
      fontFamily: "'Inter', sans-serif",
    }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div />
        <button onClick={() => setShowBuilder(s => !s)}
          style={{
            background: showBuilder ? `${C.red}15` : `${C.accent}15`,
            border: `1px solid ${showBuilder ? C.red + '50' : C.accent + '50'}`,
            borderRadius: 4, color: showBuilder ? C.red : C.accent,
            padding: '6px 16px', cursor: 'pointer', fontSize: 11, fontWeight: 600,
          }}>
          {showBuilder ? '✕ Close Builder' : '⚙️ Strategy Builder'}
        </button>
      </div>

      {showBuilder && <StrategyBuilder onClose={() => setShowBuilder(false)} session={session} />}

      <SummaryBar r={results} />

      {/* Metric Groups in scrollable layout */}
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <PerformanceMetrics r={results} />

        <RiskMetrics r={results} />

        <TradeStatistics />

        <ExecutionMetrics />

        <StrategyQuality />

        <StressTestPanel r={results} />

        {/* Charts Section */}
        <MetricGroup title="Charts & Distributions" groupKey="charts" defaultExpanded={false}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4 }}>
            <div style={{ gridColumn: '1 / -1' }}><EquityCurve /></div>
            <div style={{ gridColumn: '1 / -1' }}><DrawdownCurve /></div>
            <MonthlyReturns />
            <ProfitDistChart />
            <TradeScatter />
            <WinLossHist />
            <TradeDurationHist />
            <RollingSharpe />
            <DailyReturnDist />
          </div>
        </MetricGroup>
      </div>

      <ExportBar />
    </div>
  );
}

export default React.memo(function BacktestDashboard({ session }) {
  return (
    <ErrorBoundary>
      <BacktestDashboardInner session={session} />
    </ErrorBoundary>
  );
});