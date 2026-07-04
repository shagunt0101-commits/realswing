import React, { useState, useMemo } from 'react';

const C = {
    bg: "#080E1C", panel: "#0D1729", border: "#1A2E52",
    accent: "#00D4FF", green: "#00E676", red: "#FF3B5C",
    yellow: "#FFD600", text: "#B8C7E0", dim: "#4A6080", bright: "#E8F0FF",
};

function OIDynamics({ data }) {
    const [sortKey, setSortKey] = useState('oi');
    const [sortDir, setSortDir] = useState('desc');

    const fmtK = (v) => v > 0 ? `${(v / 1000).toFixed(0)}K` : '0';
    const fmtStrike = (v) => v ? Math.round(v).toLocaleString('en-IN') : '-';
    const fmtLtp = (v) => v ? v.toFixed(2) : '-';

    const handleSort = (key) => {
        if (sortKey === key) {
            setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortDir('desc');
        }
    };

    const SortHeader = ({ label, field, align = 'right' }) => (
        <th
            style={{
                textAlign: align,
                padding: 4,
                cursor: 'pointer',
                color: sortKey === field ? C.accent : C.dim,
                fontWeight: sortKey === field ? 700 : 400
            }}
            onClick={() => handleSort(field)}
        >
            {label} {sortKey === field && (sortDir === 'asc' ? '↑' : '↓')}
        </th>
    );

    // Get all strikes and sort them
    const allStrikes = useMemo(() => {
        if (!data?.buildup && !data?.unwind) return [];

        const all = [...(data?.buildup || []), ...(data?.unwind || [])];

        return all.sort((a, b) => {
            const aVal = a[sortKey] || 0;
            const bVal = b[sortKey] || 0;
            return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
        });
    }, [data?.buildup, data?.unwind, sortKey, sortDir]);

    // Split into CE and PE for display
    const ceStrikes = useMemo(() => allStrikes.filter(s => s.type === 'CE'), [allStrikes]);
    const peStrikes = useMemo(() => allStrikes.filter(s => s.type === 'PE'), [allStrikes]);

    return (
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 }}>
            <div style={{ color: C.bright, fontWeight: 700, fontSize: 15, marginBottom: 16 }}>📊 Open Interest Dynamics</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {/* CALLS TABLE */}
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
                    <div style={{ color: C.green, fontWeight: 600, fontSize: 11, marginBottom: 8 }}>● Call Options (CE)</div>
                    <table style={{ width: '100%', fontSize: 10 }}>
                        <thead>
                            <tr style={{ color: C.dim }}>
                                <SortHeader label="Strike" field="strike" align="right" />
                                <SortHeader label="LTP" field="ltp" />
                                <SortHeader label="LTP %" field="ltp_chg_pct" />
                                <SortHeader label="Total OI" field="oi" />
                                <SortHeader label="Volume" field="volume" />
                                <SortHeader label="IV" field="iv" />
                            </tr>
                        </thead>
                        <tbody>
                            {ceStrikes.slice(0, 10).map((r, i) => (
                                <tr key={i} style={{ borderTop: `1px solid ${C.border}44` }}>
                                    <td style={{ padding: 4, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{fmtStrike(r.strike)}</td>
                                    <td style={{ padding: 4, textAlign: 'right', fontFamily: 'monospace', color: C.text }}>{fmtLtp(r.ltp)}</td>
                                    <td style={{ padding: 4, textAlign: 'right', fontFamily: 'monospace', color: (r.ltp_chg_pct || 0) >= 0 ? C.green : C.red, fontSize: 9 }}>
                                        {(r.ltp_chg_pct || 0) >= 0 ? '+' : ''}{(r.ltp_chg_pct || 0).toFixed(1)}%
                                    </td>
                                    <td style={{ padding: 4, textAlign: 'right', color: C.green, fontFamily: 'monospace' }}>{fmtK(r.oi)}</td>
                                    <td style={{ padding: 4, textAlign: 'right', color: C.accent, fontFamily: 'monospace' }}>{fmtK(r.volume)}</td>
                                    <td style={{ padding: 4, textAlign: 'right', color: C.dim, fontFamily: 'monospace', fontSize: 9 }}>{((r.iv || 0) < 1 ? (r.iv || 0) * 100 : (r.iv || 0)).toFixed(0)}%</td>
                                </tr>
                            ))}
                            {ceStrikes.length === 0 && (
                                <tr><td colSpan="6" style={{ padding: 8, textAlign: 'center', color: C.dim, fontSize: 10 }}>No data</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* PUTS TABLE */}
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
                    <div style={{ color: C.red, fontWeight: 600, fontSize: 11, marginBottom: 8 }}>● Put Options (PE)</div>
                    <table style={{ width: '100%', fontSize: 10 }}>
                        <thead>
                            <tr style={{ color: C.dim }}>
                                <SortHeader label="Strike" field="strike" align="right" />
                                <SortHeader label="LTP" field="ltp" />
                                <SortHeader label="LTP %" field="ltp_chg_pct" />
                                <SortHeader label="Total OI" field="oi" />
                                <SortHeader label="Volume" field="volume" />
                                <SortHeader label="IV" field="iv" />
                            </tr>
                        </thead>
                        <tbody>
                            {peStrikes.slice(0, 10).map((r, i) => (
                                <tr key={i} style={{ borderTop: `1px solid ${C.border}44` }}>
                                    <td style={{ padding: 4, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{fmtStrike(r.strike)}</td>
                                    <td style={{ padding: 4, textAlign: 'right', fontFamily: 'monospace', color: C.text }}>{fmtLtp(r.ltp)}</td>
                                    <td style={{ padding: 4, textAlign: 'right', fontFamily: 'monospace', color: (r.ltp_chg_pct || 0) >= 0 ? C.green : C.red, fontSize: 9 }}>
                                        {(r.ltp_chg_pct || 0) >= 0 ? '+' : ''}{(r.ltp_chg_pct || 0).toFixed(1)}%
                                    </td>
                                    <td style={{ padding: 4, textAlign: 'right', color: C.red, fontFamily: 'monospace' }}>{fmtK(r.oi)}</td>
                                    <td style={{ padding: 4, textAlign: 'right', color: C.accent, fontFamily: 'monospace' }}>{fmtK(r.volume)}</td>
                                    <td style={{ padding: 4, textAlign: 'right', color: C.dim, fontFamily: 'monospace', fontSize: 9 }}>{((r.iv || 0) < 1 ? (r.iv || 0) * 100 : (r.iv || 0)).toFixed(0)}%</td>
                                </tr>
                            ))}
                            {peStrikes.length === 0 && (
                                <tr><td colSpan="6" style={{ padding: 8, textAlign: 'center', color: C.dim, fontSize: 10 }}>No data</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

export default OIDynamics;
