import React from 'react';

const C = {
    bg: "#080E1C", panel: "#0D1729", border: "#1A2E52",
    accent: "#00D4FF", green: "#00E676", red: "#FF3B5C",
    yellow: "#FFD600", text: "#B8C7E0", dim: "#4A6080", bright: "#E8F0FF",
    purple: "#A78BFA",
};

function MarketSnapshot({ data }) {
    const pcr = data?.pcr;
    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
            <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, minWidth: 0 }}>
                <div style={{ color: C.dim, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }}>Current Spot</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: C.bright, marginTop: 4 }}>₹{data?.spot ? (data.spot / 100).toFixed(2) : '-'}</div>
            </div>
            <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, minWidth: 0 }}>
                <div style={{ color: C.dim, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }}>Put-Call Ratio</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: pcr > 1 ? C.green : pcr < 0.7 ? C.red : C.yellow, marginTop: 4 }}>{pcr?.toFixed(2) || '-'}</div>
            </div>
            <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, minWidth: 0 }}>
                <div style={{ color: C.dim, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }}>Max Pain</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: C.bright, marginTop: 4 }}>{data?.max_pain ? Math.round(data.max_pain / 100) : '-'}</div>
            </div>
            <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, minWidth: 0 }}>
                <div style={{ color: C.dim, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }}>Volatility</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: C.accent, marginTop: 4 }}>{data?.volatility_regime || '-'}</div>
            </div>
        </div>
    );
}

export default MarketSnapshot;
