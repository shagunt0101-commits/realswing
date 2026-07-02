import { INSTRUMENTS, TIMEFRAMES, ALL_INDICATORS, useWorkspace } from "../stores/workspace";

const C = {
    accent: "#00D4FF", border: "#1A2E52", dim: "#4A6080",
    bright: "#E8F0FF", panel: "#0D1729", green: "#00E676",
};

export default function ChartToolbar({ chartId }) {
    const chart = useWorkspace(s => s.charts[chartId]);
    const updateChart = useWorkspace(s => s.updateChart);
    const toggleIndicator = useWorkspace(s => s.toggleIndicator);
    const removePanel = useWorkspace(s => s.removePanel);
    const linkedInstrument = useWorkspace(s => s.linkedInstrument);

    if (!chart) return null;

    return (
        <div style={{
            display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
            padding: "4px 8px", borderBottom: `1px solid ${C.border}`,
            background: "#0A1220",
        }}>
            {/* Instrument */}
            <select value={chart.instrument} onChange={e => updateChart(chartId, { instrument: e.target.value })}
                style={selStyle}>
                {INSTRUMENTS.map(i => <option key={i}>{i}</option>)}
            </select>

            {/* Link icon */}
            <button onClick={() => updateChart(chartId, { linked: !chart.linked })}
                title="Link instrument across all charts"
                style={{
                    background: "none", border: `1px solid ${chart.linked ? C.accent : "transparent"}`,
                    color: chart.linked ? C.accent : C.dim, borderRadius: 4, padding: "2px 6px",
                    cursor: "pointer", fontSize: 11,
                }}>
                🔗
            </button>

            {/* Timeframe */}
            <div style={{ display: "flex", gap: 2 }}>
                {TIMEFRAMES.map(tf => (
                    <button key={tf} onClick={() => updateChart(chartId, { timeframe: tf })}
                        style={{
                            background: chart.timeframe === tf ? `${C.accent}22` : "none",
                            border: `1px solid ${chart.timeframe === tf ? C.accent + "50" : "transparent"}`,
                            color: chart.timeframe === tf ? C.accent : C.dim,
                            borderRadius: 3, padding: "2px 6px", cursor: "pointer",
                            fontSize: 10, fontWeight: 600,
                        }}>
                        {tf}
                    </button>
                ))}
            </div>

            {/* Indicators dropdown */}
            <div style={{ position: "relative", display: "inline-block" }}>
                <details style={{ position: "relative" }}>
                    <summary style={{
                        color: C.accent, fontSize: 10, cursor: "pointer",
                        padding: "2px 8px", border: `1px solid ${C.accent}44`, borderRadius: 4,
                        background: `${C.accent}08`,
                    }}>
                        📊 Indicators ({chart.indicators?.length || 0})
                    </summary>
                    <div style={{
                        position: "absolute", top: 20, right: 0, zIndex: 200,
                        background: C.panel, border: `1px solid ${C.border}`,
                        borderRadius: 6, padding: 8, minWidth: 200,
                        maxHeight: 300, overflowY: "auto",
                        boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                    }}>
                        {Object.entries(ALL_INDICATORS).map(([cat, list]) => (
                            <div key={cat} style={{ marginBottom: 6 }}>
                                <div style={{ color: C.dim, fontSize: 9, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
                                    {cat}
                                </div>
                                {list.map(ind => {
                                    const active = chart.indicators?.includes(ind);
                                    return (
                                        <label key={ind} style={{
                                            display: "flex", alignItems: "center", gap: 6,
                                            padding: "2px 4px", cursor: "pointer", borderRadius: 3,
                                            background: active ? `${C.accent}12` : "none",
                                            fontSize: 10, color: active ? C.accent : C.dim,
                                        }}>
                                            <input type="checkbox" checked={active}
                                                onChange={() => toggleIndicator(chartId, ind)}
                                                style={{ accentColor: C.accent }} />
                                            {ind}
                                        </label>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                </details>
            </div>

            {/* Close panel */}
            <button onClick={() => removePanel(chartId)}
                style={{
                    marginLeft: "auto", background: "none", border: "none",
                    color: C.dim, cursor: "pointer", fontSize: 14, padding: "2px 6px",
                }}>
                ✕
            </button>
        </div>
    );
}

const selStyle = {
    background: "#0A1220", border: `1px solid ${C.border}`, borderRadius: 4,
    color: C.bright, padding: "3px 6px", fontSize: 11, cursor: "pointer",
    outline: "none", fontFamily: "'JetBrains Mono', monospace",
};
