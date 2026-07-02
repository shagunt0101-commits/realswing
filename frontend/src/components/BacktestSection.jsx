import React from 'react';

const C = {
    bg: "#080E1C", panel: "#0D1729", border: "#1A2E52",
    accent: "#00D4FF", green: "#00E676", red: "#FF3B5C",
    yellow: "#FFD600", text: "#B8C7E0", dim: "#4A6080", bright: "#E8F0FF",
};

function BacktestSection({ data }) {
    return (
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20, minHeight: 300 }}>
            <div style={{ color: C.bright, fontWeight: 700, fontSize: 15, marginBottom: 16 }}>📊 Backtest Results</div>
            {data?.results ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                    <div style={{ background: '#0A1220', borderRadius: 8, padding: 12 }}>
                        <div style={{ color: C.dim, fontSize: 9, marginBottom: 6 }}>Total Return</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: data.results.total_return >= 0 ? C.green : C.red }}>{data.results.total_return?.toFixed(2)}%</div>
                    </div>
                    <div style={{ background: '#0A1220', borderRadius: 8, padding: 12 }}>
                        <div style={{ color: C.dim, fontSize: 9, marginBottom: 6 }}>Sharpe Ratio</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: C.accent }}>{data.results.sharpe_ratio?.toFixed(2)}</div>
                    </div>
                    <div style={{ background: '#0A1220', borderRadius: 8, padding: 12 }}>
                        <div style={{ color: C.dim, fontSize: 9, marginBottom: 6 }}>Max Drawdown</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: C.red }}>{data.results.max_drawdown?.toFixed(2)}%</div>
                    </div>
                    <div style={{ background: '#0A1220', borderRadius: 8, padding: 12 }}>
                        <div style={{ color: C.dim, fontSize: 9, marginBottom: 6 }}>Win Rate</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: data.results.win_rate >= 50 ? C.green : C.red }}>{data.results.win_rate?.toFixed(1)}%</div>
                    </div>
                </div>
            ) : (
                <div style={{ color: C.dim, fontSize: 12, textAlign: 'center', padding: '40px 20px' }}>
                    No backtest data available
                </div>
            )}
        </div>
    );
}

export default BacktestSection;
