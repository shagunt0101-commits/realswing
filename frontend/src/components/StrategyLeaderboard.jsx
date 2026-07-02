import React from 'react';

const C = {
    bg: "#080E1C", panel: "#0D1729", border: "#1A2E52",
    accent: "#00D4FF", green: "#00E676", red: "#FF3B5C",
    yellow: "#FFD600", text: "#B8C7E0", dim: "#4A6080", bright: "#E8F0FF",
};

function StrategyLeaderboard({ data }) {
    return (
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20, maxHeight: 400, overflow: 'auto' }}>
            <div style={{ color: C.bright, fontWeight: 700, fontSize: 15, marginBottom: 12 }}>🏆 Strategy Leaderboard</div>
            <table style={{ width: '100%', fontSize: 11 }}>
                <thead style={{ position: 'sticky', top: 0, background: C.panel, zIndex: 1 }}>
                    <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                        <th style={{ padding: 8, textAlign: 'left', color: C.dim }}>Rank</th>
                        <th style={{ padding: 8, textAlign: 'left', color: C.dim }}>Strategy</th>
                        <th style={{ padding: 8, textAlign: 'right', color: C.dim }}>Win %</th>
                        <th style={{ padding: 8, textAlign: 'right', color: C.dim }}>PnL</th>
                    </tr>
                </thead>
                <tbody>
                    {(data?.leaderboard || []).map((s, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${C.border}44` }}>
                            <td style={{ padding: 8, fontWeight: 700, color: i < 3 ? C.yellow : C.dim }}>{i + 1}</td>
                            <td style={{ padding: 8 }}>{s.name}</td>
                            <td style={{ padding: 8, textAlign: 'right', color: s.win_rate >= 50 ? C.green : C.red }}>{s.win_rate?.toFixed(1)}%</td>
                            <td style={{ padding: 8, textAlign: 'right', fontFamily: 'monospace', color: s.pnl >= 0 ? C.green : C.red, fontWeight: 600 }}>₹{s.pnl?.toFixed(2)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export default StrategyLeaderboard;
