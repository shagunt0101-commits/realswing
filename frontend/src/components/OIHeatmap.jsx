import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const formatYAxis = (value) => {
    if (value >= 10000000) return `${(value / 10000000).toFixed(1)}Cr`;
    if (value >= 100000) return `${(value / 100000).toFixed(1)}L`;
    if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
    return value.toString();
};

export default function OIHeatmap({ data = [] }) {
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

    return (
        <div style={{ background: C.panel, borderRadius: 10, border: `1px solid ${C.border}`, padding: 16, minHeight: 400 }}>
            <div style={{ marginBottom: 16 }}>
                <div style={{ color: C.bright, fontWeight: 700, fontSize: 14 }}>🔥 OI Heatmap & Distribution</div>
                <div style={{ color: C.dim, fontSize: 11, marginTop: 4 }}>Call vs Put Open Interest across strikes</div>
            </div>

            <div style={{ height: 320 }}>
                {data && data.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                            <XAxis dataKey="strike" stroke="#94a3b8" fontSize={11} tickLine={false} />
                            <YAxis stroke="#94a3b8" fontSize={11} tickFormatter={formatYAxis} tickLine={false} axisLine={false} />
                            <Tooltip
                                formatter={(value) => value.toLocaleString()}
                                contentStyle={{
                                    backgroundColor: '#1e293b',
                                    border: '1px solid #334155',
                                    borderRadius: '4px',
                                    fontSize: '12px',
                                    color: '#f1f5f9',
                                }}
                            />
                            <Legend verticalAlign="top" height={30} iconSize={10} wrapperStyle={{ fontSize: '12px' }} />
                            <Bar name="Call OI (CE)" dataKey="calls_oi" fill="#FF6B6B" radius={[4, 4, 0, 0]} />
                            <Bar name="Put OI (PE)" dataKey="puts_oi" fill="#4ECDC4" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: C.dim, fontSize: 12 }}>
                        No OI distribution data available
                    </div>
                )}
            </div>
        </div>
    );
}
