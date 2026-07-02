import React from 'react';

const C = {
    bg: "#080E1C", panel: "#0D1729", border: "#1A2E52",
    accent: "#00D4FF", green: "#00E676", red: "#FF3B5C",
    yellow: "#FFD600", text: "#B8C7E0", dim: "#4A6080", bright: "#E8F0FF",
};

function OrderFlowSection({ data }) {
    return (
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20, minHeight: 300 }}>
            <div style={{ color: C.bright, fontWeight: 700, fontSize: 15, marginBottom: 16 }}>📊 Order Flow Analysis</div>
            {data?.flow && data.flow.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
                        <div style={{ color: C.green, fontWeight: 600, fontSize: 11, marginBottom: 8 }}>● Buy Orders</div>
                        {data.flow.filter(f => f.type === 'BUY').map((f, i) => (
                            <div key={i} style={{ fontSize: 10, padding: '4px 0', borderBottom: `1px solid ${C.border}44` }}>
                                <span style={{ color: C.dim }}>{f.strike}</span>
                                <span style={{ float: 'right', color: C.green, fontFamily: 'monospace' }}>+{f.volume}</span>
                            </div>
                        ))}
                    </div>
                    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
                        <div style={{ color: C.red, fontWeight: 600, fontSize: 11, marginBottom: 8 }}>● Sell Orders</div>
                        {data.flow.filter(f => f.type === 'SELL').map((f, i) => (
                            <div key={i} style={{ fontSize: 10, padding: '4px 0', borderBottom: `1px solid ${C.border}44` }}>
                                <span style={{ color: C.dim }}>{f.strike}</span>
                                <span style={{ float: 'right', color: C.red, fontFamily: 'monospace' }}>-{f.volume}</span>
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <div style={{ color: C.dim, fontSize: 12, textAlign: 'center', padding: '40px 20px' }}>
                    No order flow data available
                </div>
            )}
        </div>
    );
}

export default OrderFlowSection;
