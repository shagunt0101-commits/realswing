import React from 'react';

const C = {
    bg: "#080E1C", panel: "#0D1729", border: "#1A2E52",
    accent: "#00D4FF", green: "#00E676", red: "#FF3B5C",
    yellow: "#FFD600", text: "#B8C7E0", dim: "#4A6080", bright: "#E8F0FF",
};

function VolatilityAnalysis({ data }) {
    const isMobile = window.innerWidth < 768;
    return (
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: isMobile ? 12 : 20 }}>
            <div style={{ color: C.bright, fontWeight: 700, fontSize: isMobile ? 14 : 15, marginBottom: 16 }}>📈 Volatility Analysis</div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 12 }}>
                <div style={{ background: '#0A1220', borderRadius: 8, padding: 12 }}>
                    <div style={{ color: C.dim, fontSize: 10 }}>ATM IV</div>
                    <div style={{ fontSize: 18.5, fontWeight: 700, color: C.text }}>{data?.atm_iv?.toFixed(2) || '-'}%</div>
                </div>
                <div style={{ background: '#0A1220', borderRadius: 8, padding: 12 }}>
                    <div style={{ color: C.dim, fontSize: 10 }}>Expected Move</div>
                    <div style={{ fontSize: 18.5, fontWeight: 700, color: C.text }}>₹{data?.expected_move?.toFixed(2) || '-'}</div>
                </div>
                <div style={{ background: '#0A1220', borderRadius: 8, padding: 12 }}>
                    <div style={{ color: C.dim, fontSize: 10 }}>IV Skew</div>
                    <div style={{ fontSize: 18.5, fontWeight: 700, color: C.text }}>{data?.iv_skew != null ? (typeof data.iv_skew === 'string' ? data.iv_skew : data.iv_skew.toFixed(2)) : '-'}</div>
                </div>
                <div style={{ background: '#0A1220', borderRadius: 8, padding: 12 }}>
                    <div style={{ color: C.dim, fontSize: 10 }}>Move %</div>
                    <div style={{ fontSize: 18.5, fontWeight: 700, color: C.text }}>{data?.move_percentage?.toFixed(2) || '-'}%</div>
                </div>
            </div>
        </div>
    );
}

export default VolatilityAnalysis;
