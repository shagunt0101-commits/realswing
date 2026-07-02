import React, { useState, useMemo } from 'react';

const C = {
    bg: "#080E1C", panel: "#0D1729", border: "#1A2E52",
    accent: "#00D4FF", green: "#00E676", red: "#FF3B5C",
    yellow: "#FFD600", text: "#B8C7E0", dim: "#4A6080", bright: "#E8F0FF",
};

function ProbabilityTouch({ data }) {
    const [sortKey, setSortKey] = useState('strike');
    const [sortDir, setSortDir] = useState('asc');

    const fmtStrike = (v) => v ? Math.round(v).toLocaleString('en-IN') : '-';

    const handleSort = (key) => {
        if (sortKey === key) {
            setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortDir('asc');
        }
    };

    const SortHeader = ({ label, field }) => (
        <th
            style={{
                padding: 8,
                textAlign: 'right',
                cursor: 'pointer',
                color: sortKey === field ? C.accent : C.dim,
                fontWeight: sortKey === field ? 700 : 400
            }}
            onClick={() => handleSort(field)}
        >
            {label} {sortKey === field && (sortDir === 'asc' ? '↑' : '↓')}
        </th>
    );

    const sortedData = useMemo(() => {
        if (!data?.data) return [];
        return [...data.data].sort((a, b) => {
            const aVal = a[sortKey] || 0;
            const bVal = b[sortKey] || 0;
            return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
        });
    }, [data?.data, sortKey, sortDir]);

    return (
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20, maxHeight: 400, overflow: 'auto' }}>
            <div style={{ color: C.bright, fontWeight: 700, fontSize: 15, marginBottom: 8 }}>🎯 Probability of Touch</div>
            <table style={{ width: '100%', fontSize: 11 }}>
                <thead style={{ position: 'sticky', top: 0, background: C.panel, zIndex: 1 }}>
                    <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                        <th style={{ padding: 8, textAlign: 'left', color: C.dim }}>Strike</th>
                        <SortHeader label="Prob %" field="probability_touch" />
                    </tr>
                </thead>
                <tbody>
                    {sortedData.map((r, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${C.border}44` }}>
                            <td style={{ padding: 8, fontWeight: 600, fontFamily: 'monospace' }}>{fmtStrike(r.strike)}</td>
                            <td style={{ padding: 8, textAlign: 'right', fontFamily: 'monospace', color: C.accent, fontWeight: 700 }}>
                                {r.probability_touch?.toFixed(1) || '-'}%
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export default ProbabilityTouch;