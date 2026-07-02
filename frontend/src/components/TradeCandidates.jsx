import React from 'react';

const C = {
    bg: "#080E1C", panel: "#0D1729", border: "#1A2E52",
    accent: "#00D4FF", green: "#00E676", red: "#FF3B5C",
    yellow: "#FFD600", text: "#B8C7E0", dim: "#4A6080", bright: "#E8F0FF",
};

function TradeCandidates({ data }) {
    return (
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20, maxHeight: 400, overflow: 'auto' }}>
            <div style={{ color: C.bright, fontWeight: 700, fontSize: 15, marginBottom: 12 }}>🎯 Trade Candidates</div>
            <table style={{ width: '100%', fontSize: 10 }}>
                <thead style={{ position: 'sticky', top: 0, background: C.panel, zIndex: 1 }}>
                    <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                        <th style={{ padding: 6, textAlign: 'left', color: C.dim }}>Strike</th>
                        <th style={{ padding: 6, textAlign: 'left', color: C.dim }}>Side</th>
                        <th style={{ padding: 6, textAlign: 'right', color: C.dim }}>Signal</th>
                        <th style={{ padding: 6, textAlign: 'right', color: C.dim }}>Confidence</th>
                    </tr>
                </thead>
                <tbody>
                    {(data?.candidates || []).map((c, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${C.border}44` }}>
                            <td style={{ padding: 6 }}>{c.strike}</td>
                            <td style={{ padding: 6, color: c.side === 'CE' ? C.red : C.green, fontWeight: 600 }}>{c.side}</td>
                            <td style={{ padding: 6, textAlign: 'right', color: c.signal === 'BUY' ? C.green : C.red }}>{c.signal}</td>
                            <td style={{ padding: 6, textAlign: 'right', color: C.accent }}>{c.confidence}%</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export default TradeCandidates;
