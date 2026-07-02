import React from 'react';

const C = {
    bg: "#080E1C", panel: "#0D1729", border: "#1A2E52",
    accent: "#00D4FF", green: "#00E676", red: "#FF3B5C",
    yellow: "#FFD600", text: "#B8C7E0", dim: "#4A6080", bright: "#E8F0FF",
};

function SupportResistance({ data }) {
    return (
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 }}>
            <div style={{ color: C.bright, fontWeight: 700, fontSize: 15, marginBottom: 16 }}>📐 Support & Resistance</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ background: `${C.green}22`, border: `1px solid ${C.green}44`, borderRadius: 8, padding: 16 }}>
                    <div style={{ color: C.dim, fontSize: 11 }}>Strongest Support</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: C.green, marginTop: 4 }}>{data?.strongest_support || '-'}</div>
                    <div style={{ color: C.dim, fontSize: 10, marginTop: 4 }}>Score: {data?.support_score?.toFixed(2) || '-'}</div>
                </div>
                <div style={{ background: `${C.red}22`, border: `1px solid ${C.red}44`, borderRadius: 8, padding: 16 }}>
                    <div style={{ color: C.dim, fontSize: 11 }}>Strongest Resistance</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: C.red, marginTop: 4 }}>{data?.strongest_resistance || '-'}</div>
                    <div style={{ color: C.dim, fontSize: 10, marginTop: 4 }}>Score: {data?.resistance_score?.toFixed(2) || '-'}</div>
                </div>
            </div>
        </div>
    );
}

export default SupportResistance;
