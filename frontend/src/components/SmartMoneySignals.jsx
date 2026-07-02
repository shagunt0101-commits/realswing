import React, { useState, useMemo } from 'react';

const C = {
    bg: "#080E1C", panel: "#0D1729", border: "#1A2E52",
    accent: "#00D4FF", green: "#00E676", red: "#FF3B5C",
    yellow: "#FFD600", text: "#B8C7E0", dim: "#4A6080", bright: "#E8F0FF",
    purple: "#A78BFA",
};

function SmartMoneySignals({ data }) {
    const [positioningSortKey, setPositioningSortKey] = useState('oi_change');
    const [positioningSortDir, setPositioningSortDir] = useState('desc');
    const [flowSortKey, setFlowSortKey] = useState('volume');
    const [flowSortDir, setFlowSortDir] = useState('desc');

    const fmtK = (v) => v > 0 ? `${(v / 1000).toFixed(0)}K` : '0';
    const fmtStrike = (v) => v ? Math.round(v).toLocaleString('en-IN') : '-';

    const handlePositioningSort = (key) => {
        if (positioningSortKey === key) {
            setPositioningSortDir(positioningSortDir === 'asc' ? 'desc' : 'asc');
        } else {
            setPositioningSortKey(key);
            setPositioningSortDir('desc');
        }
    };

    const handleFlowSort = (key) => {
        if (flowSortKey === key) {
            setFlowSortDir(flowSortDir === 'asc' ? 'desc' : 'asc');
        } else {
            setFlowSortKey(key);
            setFlowSortDir('desc');
        }
    };

    const SortHeader = ({ label, field, sortKey, sortDir, onSort }) => (
        <th
            style={{
                textAlign: 'right',
                padding: 4,
                cursor: 'pointer',
                color: sortKey === field ? C.accent : C.dim,
                fontWeight: sortKey === field ? 700 : 400
            }}
            onClick={() => onSort(field)}
        >
            {label} {sortKey === field && (sortDir === 'asc' ? '↑' : '↓')}
        </th>
    );

    const sortedPositioning = useMemo(() => {
        if (!data?.positioning) return [];
        return [...data.positioning].sort((a, b) => {
            const aVal = a[positioningSortKey] || 0;
            const bVal = b[positioningSortKey] || 0;
            return positioningSortDir === 'asc' ? aVal - bVal : bVal - aVal;
        });
    }, [data?.positioning, positioningSortKey, positioningSortDir]);

    const sortedFlow = useMemo(() => {
        if (!data?.flow) return [];
        return [...data.flow].sort((a, b) => {
            const aVal = a[flowSortKey] || 0;
            const bVal = b[flowSortKey] || 0;
            return flowSortDir === 'asc' ? aVal - bVal : bVal - aVal;
        });
    }, [data?.flow, flowSortKey, flowSortDir]);

    return (
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 }}>
            <div style={{ color: C.bright, fontWeight: 700, fontSize: 15, marginBottom: 16 }}>🕵️‍♂️ Signal Engine & Smart Money Detection</div>
            {(data?.signals?.length > 0) && (
                <div style={{ marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {data.signals.map((s, i) => (
                        <div key={i} style={{ background: `${C.accent}22`, borderLeft: `3px solid ${C.accent}`, padding: '6px 10px', borderRadius: 4, fontSize: 10, color: C.accent }}>
                            ⚡ {s}
                        </div>
                    ))}
                </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {/* Institutional Positioning */}
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
                    <div style={{ color: C.accent, fontWeight: 600, fontSize: 11, marginBottom: 8 }}>🎯 Institutional Positioning</div>
                    <table style={{ width: '100%', fontSize: 10 }}>
                        <thead>
                            <tr style={{ color: C.dim }}>
                                <th style={{ textAlign: 'left', padding: 4 }}>Type</th>
                                <SortHeader
                                    label="Strike"
                                    field="strike"
                                    sortKey={positioningSortKey}
                                    sortDir={positioningSortDir}
                                    onSort={handlePositioningSort}
                                />
                                <SortHeader
                                    label="OI Chg"
                                    field="oi_change"
                                    sortKey={positioningSortKey}
                                    sortDir={positioningSortDir}
                                    onSort={handlePositioningSort}
                                />
                            </tr>
                        </thead>
                        <tbody>
                            {sortedPositioning.slice(0, 8).map((r, i) => (
                                <tr key={i} style={{ borderTop: `1px solid ${C.border}44` }}>
                                    <td style={{ padding: 4, fontWeight: 700, color: r.type === 'CE' ? C.red : C.green }}>{r.type}</td>
                                    <td style={{ padding: 4, textAlign: 'right', fontFamily: 'monospace' }}>{fmtStrike(r.strike)}</td>
                                    <td style={{ padding: 4, textAlign: 'right', fontFamily: 'monospace', color: r.oi_change >= 0 ? C.green : C.red }}>
                                        {r.oi_change >= 0 ? '+' : ''}{fmtK(r.oi_change)}
                                    </td>
                                </tr>
                            ))}
                            {sortedPositioning.length === 0 && (
                                <tr><td colSpan="3" style={{ padding: 8, textAlign: 'center', color: C.dim, fontSize: 10 }}>No data</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Institutional Flow Scanner */}
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
                    <div style={{ color: C.purple, fontWeight: 600, fontSize: 11, marginBottom: 8 }}>🚀 Institutional Flow Scanner</div>
                    <table style={{ width: '100%', fontSize: 10 }}>
                        <thead>
                            <tr style={{ color: C.dim }}>
                                <th style={{ textAlign: 'left', padding: 4 }}>Type</th>
                                <SortHeader
                                    label="Strike"
                                    field="strike"
                                    sortKey={flowSortKey}
                                    sortDir={flowSortDir}
                                    onSort={handleFlowSort}
                                />
                                <SortHeader
                                    label="Volume"
                                    field="volume"
                                    sortKey={flowSortKey}
                                    sortDir={flowSortDir}
                                    onSort={handleFlowSort}
                                />
                            </tr>
                        </thead>
                        <tbody>
                            {sortedFlow.slice(0, 8).map((r, i) => (
                                <tr key={i} style={{ borderTop: `1px solid ${C.border}44` }}>
                                    <td style={{ padding: 4, fontWeight: 700, color: r.type === 'CE' ? C.red : C.green }}>{r.type}</td>
                                    <td style={{ padding: 4, textAlign: 'right', fontFamily: 'monospace' }}>{fmtStrike(r.strike)}</td>
                                    <td style={{ padding: 4, textAlign: 'right', fontFamily: 'monospace', color: C.dim }}>{fmtK(r.volume)}</td>
                                </tr>
                            ))}
                            {sortedFlow.length === 0 && (
                                <tr><td colSpan="3" style={{ padding: 8, textAlign: 'center', color: C.dim, fontSize: 10 }}>No data</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

export default SmartMoneySignals;
