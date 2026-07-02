import React from 'react';

const C = {
    bg: "#080E1C", panel: "#0D1729", border: "#1A2E52",
    accent: "#00D4FF", green: "#00E676", red: "#FF3B5C",
    yellow: "#FFD600", text: "#B8C7E0", dim: "#4A6080", bright: "#E8F0FF",
};

function OutlookRegime({ data }) {
    const getDirColor = (d) => d?.toLowerCase().includes('bull') ? C.green : d?.toLowerCase().includes('bear') ? C.red : C.yellow;
    return (
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 }}>
            <div style={{ color: C.bright, fontWeight: 700, fontSize: 15, marginBottom: 16 }}>🌐 Market Regime & Outlook</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 16, background: 'linear-gradient(180deg, #0A1220 0%, #0D1729 100%)' }}>
                    <div style={{ color: C.dim, fontSize: 11, marginBottom: 12 }}>📍 Market Outlook</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, borderBottom: `1px solid ${C.border}`, paddingBottom: 8 }}>
                        <span style={{ color: C.dim, fontSize: 10 }}>Market Bias</span>
                        <span style={{ padding: '2px 8px', borderRadius: 4, background: `${getDirColor(data?.outlook?.direction)}22`, border: `1px solid ${getDirColor(data?.outlook?.direction)}44`, color: getDirColor(data?.outlook?.direction), fontWeight: 700, fontSize: 10 }}>
                            {data?.outlook?.direction || 'Neutral'}
                        </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: C.dim, fontSize: 10 }}>Confidence</span>
                        <span style={{ color: C.text, fontWeight: 600, fontSize: 10 }}>{data?.outlook?.confidence || 'Medium'}</span>
                    </div>
                </div>
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 16, background: 'linear-gradient(180deg, #0A1220 0%, #0D1729 100%)' }}>
                    <div style={{ color: C.dim, fontSize: 11, marginBottom: 12 }}>🎚️ Market Regime</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, borderBottom: `1px solid ${C.border}`, paddingBottom: 8 }}>
                        <span style={{ color: C.dim, fontSize: 10 }}>Volatility Regime</span>
                        <span style={{ color: C.text, fontWeight: 600, fontSize: 10 }}>⚖️ {data?.regime?.regime || 'Consolidation'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: C.dim, fontSize: 10 }}>Regime Signal</span>
                        <span style={{ color: C.accent, fontWeight: 600, fontSize: 10 }}>🔮 {data?.regime?.signal || 'Neutral Rangebound'}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default OutlookRegime;
