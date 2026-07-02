import React, { useState } from 'react';

// Helper functions
const formatNumber = (value) => {
    if (value === null || value === undefined || isNaN(value)) return '0';
    if (Math.abs(value) >= 1000) {
        return `${(value / 1000).toFixed(1)}K`;
    }
    return value.toLocaleString();
};

const formatDecimal = (value, precision = 2) => {
    if (value === null || value === undefined || isNaN(value)) return '-';
    return value.toFixed(precision);
};

const getChangeColor = (value) => {
    if (value === null || value === undefined || isNaN(value)) return '#6B7280';
    return value >= 0 ? '#10B981' : '#EF4444';
};

const getChangeSign = (value) => {
    if (value === null || value === undefined || isNaN(value) || value === 0) return '';
    return value > 0 ? '+' : '';
};

const getChangePct = (ltp, change) => {
    if (ltp === null || ltp === undefined || change === null || change === undefined || isNaN(ltp) || isNaN(change)) {
        return 0;
    }
    const prev = ltp - change;
    if (prev <= 0) return 0;
    return (change / prev) * 100;
};

export default function OptionChainTable({ data = [], spotPrice = 24000, onSelectOption, instrument = "NIFTY" }) {
    const [filterMode, setFilterMode] = useState('focus');

    // Transform flat list into symmetric rows grouped by strike price
    const strikesMap = {};
    (data || []).forEach((item) => {
        const strike = item.strike || item.sp;
        if (!strikesMap[strike]) {
            strikesMap[strike] = { strike };
        }
        if (item.type === 'CE' || item.side === 'CE') {
            strikesMap[strike].call = item;
        } else if (item.type === 'PE' || item.side === 'PE') {
            strikesMap[strike].put = item;
        }
    });

    const allSymmetricRows = Object.values(strikesMap).sort((a, b) => a.strike - b.strike);

    // Find ATM index
    let atmIndex = -1;
    let minDiff = Infinity;
    allSymmetricRows.forEach((row, idx) => {
        const diff = Math.abs(row.strike - spotPrice);
        if (diff < minDiff) {
            minDiff = diff;
            atmIndex = idx;
        }
    });

    // Filter rows based on mode
    const renderedRows = (() => {
        if (filterMode === 'focus' && atmIndex !== -1) {
            const start = Math.max(0, atmIndex - 10);
            const end = Math.min(allSymmetricRows.length, atmIndex + 11);
            return allSymmetricRows.slice(start, end);
        }
        return allSymmetricRows;
    })();

    const C = {
        bg: '#0A0E1A',
        panel: '#111D2E',
        border: '#2A3F5F',
        text: '#C4D1E0',
        dim: '#7A8FA6',
        bright: '#E8EFF7',
        red: '#FF6B6B',
        green: '#4ECDC4',
        accent: '#00D9FF',
    };

    const colStyle = { padding: '8px 4px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' };
    const strikeStyle = { ...colStyle, textAlign: 'center', fontWeight: 'bold', background: C.panel, borderLeft: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}` };

    return (
        <div style={{ background: C.panel, borderRadius: 10, border: `1px solid ${C.border}`, padding: 16, minHeight: 600 }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                    <div style={{ color: C.bright, fontWeight: 700, fontSize: 14 }}>📋 Option Chain Table</div>
                    <div style={{ color: C.dim, fontSize: 11, marginTop: 4 }}>Live Greeks & Symmetrical Call/Put OI</div>
                </div>
                <div style={{ display: 'flex', gap: 8, background: C.bg, padding: 8, borderRadius: 6 }}>
                    <button onClick={() => setFilterMode('focus')} style={{
                        background: filterMode === 'focus' ? `${C.accent}30` : 'transparent',
                        border: `1px solid ${filterMode === 'focus' ? C.accent : C.border}`,
                        color: filterMode === 'focus' ? C.accent : C.dim,
                        padding: '6px 12px',
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                    }}>🎯 Focus (±10)</button>
                    <button onClick={() => setFilterMode('complete')} style={{
                        background: filterMode === 'complete' ? `${C.accent}30` : 'transparent',
                        border: `1px solid ${filterMode === 'complete' ? C.accent : C.border}`,
                        color: filterMode === 'complete' ? C.accent : C.dim,
                        padding: '6px 12px',
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                    }}>🌐 Complete ({allSymmetricRows.length})</button>
                </div>
            </div>

            {/* Table */}
            <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 450, border: `1px solid ${C.border}`, borderRadius: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, color: C.text, minWidth: 1200 }}>
                    <thead style={{ background: C.bg, position: 'sticky', top: 0, zIndex: 10 }}>
                        <tr style={{ borderBottom: `1px solid ${C.border}`, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                            <th colSpan={8} style={{ ...colStyle, textAlign: 'center', color: C.red, borderRight: `1px solid ${C.border}` }}>Call Options (CE)</th>
                            <th style={{ ...strikeStyle }}>Strike</th>
                            <th colSpan={8} style={{ ...colStyle, textAlign: 'center', color: C.green }}>Put Options (PE)</th>
                        </tr>
                        <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                            {['IV', 'Delta', 'Theta', 'OI', 'LTP'].map(h => <th key={`ce-${h}`} style={{ ...colStyle, borderRight: `1px solid ${C.border}22` }}>{h}</th>)}
                            <th style={{ ...strikeStyle }}>Strike</th>
                            {['LTP', 'OI', 'Theta', 'Delta', 'IV'].map(h => <th key={`pe-${h}`} style={{ ...colStyle, borderLeft: `1px solid ${C.border}22` }}>{h}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {renderedRows.map((row) => {
                            const strike = row.strike;
                            const callLtp = row.call?.ltp ?? 0;
                            const callOI = row.call?.oi ?? 0;
                            const putLtp = row.put?.ltp ?? 0;
                            const putOI = row.put?.oi ?? 0;
                            const totalOI = callOI + putOI;
                            const isATM = Math.abs(strike - spotPrice) < 100;

                            return (
                                <tr key={strike} style={{ borderBottom: `1px solid ${C.border}22`, background: isATM ? `${C.accent}10` : 'transparent', hover: { background: `${C.border}22` } }}>
                                    <td style={{ ...colStyle }}>{formatDecimal(row.call?.iv, 2)}</td>
                                    <td style={{ ...colStyle }}>{formatDecimal(row.call?.delta, 2)}</td>
                                    <td style={{ ...colStyle }}>{formatDecimal(row.call?.theta, 2)}</td>
                                    <td style={{ ...colStyle, fontWeight: 600, color: C.green }}>{formatNumber(callOI)}</td>
                                    <td style={{ ...colStyle, fontWeight: 700, color: C.bright, cursor: 'pointer' }} onClick={() => onSelectOption?.(row.call || {}, instrument)}>₹{formatDecimal(callLtp, 2)}</td>
                                    <td style={{ ...strikeStyle, color: C.accent, fontSize: 12 }}>{strike}</td>
                                    <td style={{ ...colStyle, fontWeight: 700, color: C.bright, cursor: 'pointer' }} onClick={() => onSelectOption?.(row.put || {}, instrument)}>₹{formatDecimal(putLtp, 2)}</td>
                                    <td style={{ ...colStyle, fontWeight: 600, color: C.red }}>{formatNumber(putOI)}</td>
                                    <td style={{ ...colStyle }}>{formatDecimal(row.put?.theta, 2)}</td>
                                    <td style={{ ...colStyle }}>{formatDecimal(row.put?.delta, 2)}</td>
                                    <td style={{ ...colStyle }}>{formatDecimal(row.put?.iv, 2)}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Footer Info */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontSize: 10, color: C.dim, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
                <div>Spot Price: ₹{spotPrice.toLocaleString()}</div>
                <div>Total Rows: {allSymmetricRows.length}</div>
            </div>
        </div>
    );
}
