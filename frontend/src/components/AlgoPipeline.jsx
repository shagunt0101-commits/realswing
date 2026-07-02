import React from 'react';

const C = {
    bg: "#080E1C", panel: "#0D1729", border: "#1A2E52",
    accent: "#00D4FF", green: "#00E676", red: "#FF3B5C",
    yellow: "#FFD600", text: "#B8C7E0", dim: "#4A6080", bright: "#E8F0FF",
};

function AlgoPipeline({ data }) {
    const stages = ['Data', 'Analysis', 'Signal Gen', 'Risk Check', 'Order'];
    return (
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20, minHeight: 250 }}>
            <div style={{ color: C.bright, fontWeight: 700, fontSize: 15, marginBottom: 16 }}>⚙️ Algo Pipeline</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                {stages.map((s, i) => (
                    <div key={i} style={{ flex: 1, textAlign: 'center', padding: '12px 8px', border: `1px solid ${C.border}`, borderRadius: 6, background: data?.current_stage === i ? `${C.accent}22` : 'transparent' }}>
                        <div style={{ fontSize: 9, color: data?.current_stage === i ? C.accent : C.dim, fontWeight: 600 }}>{s}</div>
                        <div style={{ fontSize: 12, marginTop: 4, color: data?.current_stage === i ? C.bright : C.dim }}>
                            {data?.current_stage === i ? '⚡' : '○'}
                        </div>
                    </div>
                ))}
            </div>
            <div style={{ fontSize: 10, color: C.dim, padding: '12px', background: '#0A1220', borderRadius: 6 }}>
                <div style={{ marginBottom: 6 }}>Status: <span style={{ color: C.accent }}>{data?.status || 'Ready'}</span></div>
                <div>Orders Processed: <span style={{ color: C.bright }}>{data?.orders_processed || 0}</span></div>
                <div>Success Rate: <span style={{ color: data?.success_rate > 80 ? C.green : C.red }}>{data?.success_rate || 0}%</span></div>
            </div>
        </div>
    );
}

export default AlgoPipeline;
