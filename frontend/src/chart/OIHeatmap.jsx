import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const C = {
    bg: "#080E1C", panel: "#0D1729", border: "#1A2E52",
    accent: "#00D4FF", green: "#00E676", red: "#FF3B5C",
    text: "#B8C7E0", dim: "#4A6080", bright: "#E8F0FF",
};

function fmtY(v) {
    if (v >= 1e7) return (v / 1e7).toFixed(1) + "Cr";
    if (v >= 1e5) return (v / 1e5).toFixed(1) + "L";
    if (v >= 1e3) return (v / 1e3).toFixed(0) + "K";
    return v.toString();
}

export default function OIHeatmap({ data }) {
    const chartData = (data || []).map(d => ({
        ...d,
        strike: d.strike ? d.strike.toLocaleString() : d.strike,
    }));

    return (
        <div style={{
            background: C.panel, border: `1px solid ${C.border}`,
            borderRadius: 8, padding: 16,
        }}>
            <div style={{ marginBottom: 12 }}>
                <div style={{ color: C.bright, fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                    🔥 OI Heatmap
                </div>
                <div style={{ color: C.dim, fontSize: 10 }}>Call vs Put OI distribution across strikes</div>
            </div>
            <div style={{ width: "100%", height: 320 }}>
                {chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                            <XAxis dataKey="strike" stroke={C.dim} fontSize={10} tickLine={false} />
                            <YAxis stroke={C.dim} fontSize={10} tickFormatter={fmtY} tickLine={false} axisLine={false} />
                            <Tooltip
                                contentStyle={{
                                    background: C.panel, border: `1px solid ${C.border}`,
                                    borderRadius: 6, fontSize: 11, color: C.text,
                                }}
                            />
                            <Legend verticalAlign="top" height={30} iconSize={10} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                            <Bar name="Call OI (CE)" dataKey="calls_oi" fill={C.red} radius={[4, 4, 0, 0]} />
                            <Bar name="Put OI (PE)" dataKey="puts_oi" fill={C.green} radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                ) : (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: C.dim, fontSize: 11 }}>
                        No OI distribution data available
                    </div>
                )}
            </div>
        </div>
    );
}
