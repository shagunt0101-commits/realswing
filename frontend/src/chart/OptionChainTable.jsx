import { useState, useMemo } from "react";

const C = {
    bg: "#080E1C", panel: "#0D1729", border: "#1A2E52",
    accent: "#00D4FF", green: "#00E676", red: "#FF3B5C",
    text: "#B8C7E0", dim: "#4A6080", bright: "#E8F0FF",
    yellow: "#FFD600", amber: "#F59E0B",
};

// Old project's OptionChain ported to RealSwing styling
// Accepts: { data: [{ type, strike, oi, oi_change, volume, iv, delta, gamma, theta, vega, ltp, ltp_change }], spot }

function fmt(v) {
    if (v == null || isNaN(v)) return "-";
    if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1) + "K";
    return v.toLocaleString();
}
function fdec(v, p) {
    if (v == null || isNaN(v)) return "-";
    return v.toFixed(p);
}
function chgColor(v) {
    if (v == null || isNaN(v)) return C.dim;
    return v >= 0 ? C.green : C.red;
}
function chgSign(v) {
    if (v == null || isNaN(v) || v === 0) return "";
    return v > 0 ? "+" : "";
}
function chgPct(ltp, chg) {
    if (ltp == null || chg == null || isNaN(ltp) || isNaN(chg)) return 0;
    const prev = ltp - chg;
    if (prev <= 0) return 0;
    return (chg / prev) * 100;
}

export default function OptionChainTable({ data, spotPrice, onSelectOption, instrument }) {
    const [filterMode, setFilterMode] = useState("focus");
    const spot = spotPrice || data?.spot || 24000;

    // Transform flat list to symmetric rows
    const { allRows, atmIndex } = useMemo(() => {
        const map = {};
        (data?.data || data || []).forEach(item => {
            const s = item.strike || (item.sp ? item.sp/100 : null);
            if (s == null) return;
            if (!map[s]) map[s] = { strike: s };
            if (item.type === "CE") map[s].call = item;
            else if (item.type === "PE") map[s].put = item;
        });
        const rows = Object.values(map).sort((a, b) => a.strike - b.strike);
        let idx = -1, minD = Infinity;
        rows.forEach((r, i) => {
            const d = Math.abs(r.strike - spot);
            if (d < minD) { minD = d; idx = i; }
        });
        return { allRows: rows, atmIndex: idx };
    }, [data, spot]);

    const rendered = useMemo(() => {
        if (filterMode === "focus" && atmIndex >= 0) {
            const start = Math.max(0, atmIndex - 10);
            const end = Math.min(allRows.length, atmIndex + 11);
            return allRows.slice(start, end);
        }
        return allRows;
    }, [filterMode, allRows, atmIndex]);

    const cellStyle = (isITM) => ({
        padding: "4px 6px", textAlign: "right",
        fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
        color: C.dim,
        background: isITM ? "#78350F33" : "transparent",
    });
    const cellLtpStyle = (isITM) => ({
        padding: "4px 8px", textAlign: "right",
        fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
        borderRight: `1px solid ${C.border}`,
        background: isITM ? "#78350F44" : "transparent",
    });

    return (
        <div style={{
            background: C.panel, border: `1px solid ${C.border}`,
            borderRadius: 8, padding: 16, height: 650,
            display: "flex", flexDirection: "column",
        }}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexShrink: 0 }}>
                <div>
                    <div style={{ color: C.bright, fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                        📋 Symmetric Option Chain
                    </div>
                    <div style={{ color: C.dim, fontSize: 10 }}>Live Greeks & OI Distribution</div>
                </div>
                <div style={{ display: "flex", gap: 4, background: "#0A1220", borderRadius: 6, padding: 3 }}>
                    {[
                        { key: "focus", label: "🎯 Focus (±10)" },
                        { key: "complete", label: `🌐 Complete (${allRows.length})` },
                    ].map(b => (
                        <button key={b.key} onClick={() => setFilterMode(b.key)}
                            style={{
                                background: filterMode === b.key ? C.panel : "none",
                                color: filterMode === b.key ? C.accent : C.dim,
                                border: "none", borderRadius: 4, padding: "4px 10px",
                                fontSize: 10, fontWeight: 600, cursor: "pointer",
                            }}>{b.label}</button>
                    ))}
                </div>
            </div>

            {/* Table */}
            <div style={{ overflow: "auto", flex: 1, border: `1px solid ${C.border}`, borderRadius: 6 }}>
                <table style={{ width: "100%", fontSize: 10, color: C.text, borderCollapse: "collapse", minWidth: 1100 }}>
                    <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
                        {/* Section headers */}
                        <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                            <th colSpan={8} style={{ padding: "5px 8px", textAlign: "center", background: "#7F1D1D44", color: C.red, borderRight: `1px solid ${C.border}`, fontSize: 10 }}>
                                CALL OPTIONS (CE)
                            </th>
                            <th colSpan={1} style={{ padding: "5px 8px", textAlign: "center", background: C.panel, color: C.bright, borderRight: `1px solid ${C.border}`, fontWeight: 700, fontSize: 10 }}>
                                STRIKE
                            </th>
                            <th colSpan={8} style={{ padding: "5px 8px", textAlign: "center", background: "#14532D44", color: C.green, fontSize: 10 }}>
                                PUT OPTIONS (PE)
                            </th>
                        </tr>
                        {/* Column headers */}
                        <tr style={{ borderBottom: `1px solid ${C.border}`, fontSize: 9, color: C.dim }}>
                            {["Vega", "Gamma", "IV", "Theta", "Delta", "TV", "Int Val", "OI"].map(h => (
                                <th key={`ce-${h}`} style={{ padding: "4px 4px", textAlign: "right", background: "#7F1D1D22" }}>{h}</th>
                            ))}
                            <th style={{ padding: "4px 6px", textAlign: "right", background: "#7F1D1D22", borderRight: `1px solid ${C.border}` }}>CE LTP</th>
                            <th style={{ padding: "4px 6px", textAlign: "center", background: C.panel, color: C.yellow }}>Strike</th>
                            <th style={{ padding: "4px 6px", textAlign: "left", background: "#14532D22", borderLeft: `1px solid ${C.border}` }}>PE LTP</th>
                            {["OI", "Int Val", "TV", "Delta", "Theta", "IV", "Gamma", "Vega"].map(h => (
                                <th key={`pe-${h}`} style={{ padding: "4px 4px", textAlign: "left", background: "#14532D22" }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rendered.map((row, i) => {
                            const s = row.strike;
                            const call = row.call || {};
                            const put = row.put || {};
                            const callLtp = call.ltp || 0;
                            const putLtp = put.ltp || 0;
                            const callLtpChg = call.ltp_change || 0;
                            const putLtpChg = put.ltp_change || 0;
                            const callInt = Math.max(0, spot - s);
                            const putInt = Math.max(0, s - spot);
                            const callTV = Math.max(0, callLtp - callInt);
                            const putTV = Math.max(0, putLtp - putInt);
                            const callOi = call.oi || 0;
                            const putOi = put.oi || 0;
                            const totalOi = callOi + putOi;
                            const callPct = totalOi > 0 ? (callOi / totalOi) * 100 : 50;
                            const putPct = totalOi > 0 ? (putOi / totalOi) * 100 : 50;
                            const isCallITM = s < spot;
                            const isPutITM = s > spot;
                            const isATM = Math.abs(s - spot) < 50;

                            // Spot banner between strikes
                            const nextRow = rendered[i + 1];
                            const showSpot = nextRow && s <= spot && nextRow.strike > spot;

                            return (
                                <>
                                    <tr key={s} className="row-hover" style={{ borderBottom: `1px solid ${C.border}44`, cursor: "pointer" }}>
                                        {/* CE greeks */}
                                        <td style={cellStyle(isCallITM)}>{fdec(call.vega, 2)}</td>
                                        <td style={cellStyle(isCallITM)}>{fdec(call.gamma, 4)}</td>
                                        <td style={{ ...cellStyle(isCallITM), color: C.text }}>{fdec(call.iv, 2)}%</td>
                                        <td style={cellStyle(isCallITM)}>{fdec(call.theta, 2)}</td>
                                        <td style={{ ...cellStyle(isCallITM), color: C.text, fontWeight: 500 }}>{fdec(call.delta, 2)}</td>
                                        <td style={cellStyle(isCallITM)}>{fdec(callTV, 2)}</td>
                                        <td style={cellStyle(isCallITM)}>{fdec(callInt, 2)}</td>
                                        <td style={{ ...cellStyle(isCallITM), textAlign: "right" }}>
                                            <div style={{ color: C.bright, fontWeight: 600 }}>{fmt(callOi)}</div>
                                            <div style={{ color: chgColor(call.oi_change), fontSize: 9 }}>
                                                {chgSign(call.oi_change)}{fdec(chgPct(callOi, call.oi_change), 1)}%
                                            </div>
                                        </td>
                                        {/* CE LTP */}
                                        <td style={{ ...cellLtpStyle(isCallITM), color: chgColor(callLtpChg), fontWeight: 700, cursor: "pointer", fontSize: 11 }}
                                            onClick={() => onSelectOption?.({ ...call, side: "CE", strike: s }, instrument)}>
                                            <div>₹{fdec(callLtp, 2)}</div>
                                            <div style={{ fontSize: 9, color: chgColor(callLtpChg) }}>
                                                {chgSign(callLtpChg)}{fdec(chgPct(callLtp, callLtpChg), 1)}%
                                            </div>
                                        </td>
                                        {/* STRIKE */}
                                        <td style={{
                                            padding: "4px 6px", textAlign: "center",
                                            background: isATM ? `${C.yellow}15` : C.panel,
                                            borderRight: `1px solid ${C.border}`,
                                            fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
                                            fontSize: 11, color: isATM ? C.yellow : C.text,
                                        }}>
                                            <div>{s.toLocaleString()}</div>
                                            {totalOi > 0 && (
                                                <div style={{ width: 40, height: 3, background: C.border, borderRadius: 2, overflow: "hidden", margin: "2px auto" }}>
                                                    <div style={{ float: "left", height: "100%", background: C.red, width: `${callPct}%` }} />
                                                    <div style={{ float: "right", height: "100%", background: C.green, width: `${putPct}%` }} />
                                                </div>
                                            )}
                                        </td>
                                        {/* PE LTP */}
                                        <td style={{
                                            padding: "4px 8px", textAlign: "left",
                                            fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
                                            borderLeft: `1px solid ${C.border}`,
                                            background: isPutITM ? "#78350F44" : "transparent",
                                            cursor: "pointer",
                                        }}
                                            onClick={() => onSelectOption?.({ ...put, side: "PE", strike: s }, instrument)}>
                                            <div style={{ color: chgColor(putLtpChg), fontWeight: 700 }}>₹{fdec(putLtp, 2)}</div>
                                            <div style={{ fontSize: 9, color: chgColor(putLtpChg) }}>
                                                {chgSign(putLtpChg)}{fdec(chgPct(putLtp, putLtpChg), 1)}%
                                            </div>
                                        </td>
                                        {/* PE columns */}
                                        <td style={{ padding: "4px 6px", textAlign: "left", background: isPutITM ? "#78350F33" : "transparent" }}>
                                            <div style={{ color: C.bright, fontWeight: 600 }}>{fmt(putOi)}</div>
                                            <div style={{ color: chgColor(put.oi_change), fontSize: 9 }}>
                                                {chgSign(put.oi_change)}{fdec(chgPct(putOi, put.oi_change), 1)}%
                                            </div>
                                        </td>
                                        <td style={cellStyle(isPutITM)}>{fdec(putInt, 2)}</td>
                                        <td style={cellStyle(isPutITM)}>{fdec(putTV, 2)}</td>
                                        <td style={{ ...cellStyle(isPutITM), color: C.text, fontWeight: 500 }}>{fdec(put.delta, 2)}</td>
                                        <td style={cellStyle(isPutITM)}>{fdec(put.theta, 2)}</td>
                                        <td style={{ ...cellStyle(isPutITM), color: C.text }}>{fdec(put.iv, 2)}%</td>
                                        <td style={cellStyle(isPutITM)}>{fdec(put.gamma, 4)}</td>
                                        <td style={cellStyle(isPutITM)}>{fdec(put.vega, 2)}</td>
                                    </tr>
                                    {showSpot && (
                                        <tr key="spot-banner" style={{
                                            background: "#1E1B4B", borderTop: `2px solid ${C.accent}`,
                                            borderBottom: `2px solid ${C.accent}`,
                                        }}>
                                            <td colSpan={8} style={{ textAlign: "right", padding: "3px 12px", color: C.dim, fontSize: 9 }}>
                                                Spot Price
                                            </td>
                                            <td colSpan={1} style={{
                                                textAlign: "center", padding: "4px 8px",
                                                background: C.accent + "22", fontWeight: 800,
                                                fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
                                                color: C.bright,
                                            }}>
                                                ₹{spot.toFixed(2)}
                                            </td>
                                            <td colSpan={8} style={{ textAlign: "left", padding: "3px 12px", color: C.dim, fontSize: 9 }}>
                                                Options Boundary
                                            </td>
                                        </tr>
                                    )}
                                </>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Legend */}
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 10, color: C.dim, flexShrink: 0, borderTop: `1px solid ${C.border}44`, paddingTop: 8 }}>
                <div style={{ display: "flex", gap: 12 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ width: 10, height: 10, background: "#78350F44", border: `1px solid ${C.yellow}55`, borderRadius: 2 }} />
                        ITM (shaded)
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ width: 10, height: 10, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 2 }} />
                        OTM (clean)
                    </span>
                </div>
                <span style={{ color: C.accent }}>Spot: ₹{spot.toFixed(2)}</span>
            </div>
        </div>
    );
}
