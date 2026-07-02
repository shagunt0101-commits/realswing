import React from 'react';

const C = {
    bg: "#080E1C", panel: "#0D1729", border: "#1A2E52",
    accent: "#00D4FF", green: "#00E676", red: "#FF3B5C",
    yellow: "#FFD600", text: "#B8C7E0", dim: "#4A6080", bright: "#E8F0FF",
};

function MomentumAnalysis({ data }) {
    return (
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20, minHeight: 300 }}>
            <div style={{ color: C.bright, fontWeight: 700, fontSize: 15, marginBottom: 16 }}>📈 Momentum Analysis</div>
            {data ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
                        <div style={{ color: C.dim, fontSize: 10, marginBottom: 8 }}>RSI (14)</div>
                        <div style={{ fontSize: 24, fontWeight: 700, color: data.rsi > 70 ? C.red : data.rsi < 30 ? C.green : C.yellow }}>{data.rsi?.toFixed(2) || '-'}</div>
                        <div style={{ fontSize: 9, color: C.dim, marginTop: 4 }}>{data.rsi > 70 ? 'Overbought' : data.rsi < 30 ? 'Oversold' : 'Neutral'}</div>
                    </div>
                    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
                        <div style={{ color: C.dim, fontSize: 10, marginBottom: 8 }}>MACD Signal</div>
                        <div style={{ fontSize: 24, fontWeight: 700, color: data.macd_signal > 0 ? C.green : C.red }}>{data.macd_signal?.toFixed(2) || '-'}</div>
                        <div style={{ fontSize: 9, color: C.dim, marginTop: 4 }}>{data.macd_signal > 0 ? 'Bullish' : 'Bearish'}</div>
                    </div>
                </div>
            ) : (
                <div style={{ color: C.dim, fontSize: 12, textAlign: 'center', padding: '40px 20px' }}>
                    No momentum data available
                </div>
            )}
        </div>
    );
}

export default MomentumAnalysis;
