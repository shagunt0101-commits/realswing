import React from 'react';

const C = {
    bg: "#080E1C", panel: "#0D1729", border: "#1A2E52",
    accent: "#00D4FF", green: "#00E676", red: "#FF3B5C",
    yellow: "#FFD600", text: "#B8C7E0", dim: "#4A6080", bright: "#E8F0FF",
};

function SystemHealth({ data }) {
    const getHealthColor = (h) => h > 80 ? C.green : h > 50 ? C.yellow : C.red;
    return (
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20, minHeight: 250 }}>
            <div style={{ color: C.bright, fontWeight: 700, fontSize: 15, marginBottom: 16 }}>💚 System Health</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
                    <div style={{ color: C.dim, fontSize: 10, marginBottom: 8 }}>Overall Health</div>
                    <div style={{ fontSize: 32, fontWeight: 700, color: getHealthColor(data?.overall_health || 0) }}>{data?.overall_health || 0}%</div>
                    <div style={{ fontSize: 9, color: C.dim, marginTop: 4 }}>
                        {data?.overall_health > 80 ? '✓ Optimal' : data?.overall_health > 50 ? '⚠ Degraded' : '✗ Critical'}
                    </div>
                </div>
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
                    <div style={{ color: C.dim, fontSize: 10, marginBottom: 8 }}>Uptime</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: C.green }}>{data?.uptime || '0'}h</div>
                    <div style={{ fontSize: 9, color: C.dim, marginTop: 4 }}>Last Issue: {data?.last_issue || 'None'}</div>
                </div>
            </div>
        </div>
    );
}

export default SystemHealth;
