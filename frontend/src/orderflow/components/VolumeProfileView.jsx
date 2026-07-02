import React from 'react';

const COLORS = {
    bg: '#080E1C', panel: '#0D1729', border: '#1A2E52',
    accent: '#00D4FF', green: '#00E676', red: '#FF3B5C',
    yellow: '#FFD600', text: '#B8C7E0', dim: '#4A6080', bright: '#E8F0FF',
};

export default function VolumeProfileView({ volumeProfile }) {
    if (!volumeProfile) {
        return (
            <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 0, minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ color: COLORS.dim, fontSize: 11 }}>No volume profile data</span>
            </div>
        );
    }

    const dist = volumeProfile.distribution || [];
    const maxVol = Math.max(...dist.map(d => d.vol), 1);
    const isInVA = (price) => price >= volumeProfile.valueAreaLow && price <= volumeProfile.valueAreaHigh;
    const isPOC = (price) => price === volumeProfile.poc;

    return (
        <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, height: '100%', minHeight: 200, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', borderBottom: `1px solid ${COLORS.border}`, fontSize: 9, color: COLORS.dim }}>
                <span style={{ color: COLORS.bright, fontWeight: 600 }}>📊 Volume Profile</span>
                <span>POC: {volumeProfile.poc?.toFixed(2)}</span>
                <span>VA: {volumeProfile.valueAreaLow?.toFixed(1)}–{volumeProfile.valueAreaHigh?.toFixed(1)}</span>
                <span>{volumeProfile.vaPercent}%</span>
            </div>

            {/* Horizontal bar chart */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
                {dist.slice(-120).map((d, i) => {
                    const frac = d.vol / maxVol;
                    const inVA = isInVA(d.price);
                    const poc = isPOC(d.price);

                    return (
                        <div key={i} style={{
                            display: 'flex', alignItems: 'center', gap: 4,
                            padding: '1px 4px', fontSize: 8,
                            background: poc ? `${COLORS.yellow}15` : inVA ? `${COLORS.accent}08` : 'none',
                            fontFamily: '"JetBrains Mono", monospace',
                            height: 14,
                        }}>
                            {/* Price label */}
                            <span style={{
                                width: 60, textAlign: 'right', color: poc ? COLORS.yellow : inVA ? COLORS.accent : COLORS.text,
                                fontWeight: poc ? 700 : 400, flexShrink: 0,
                            }}>
                                {d.price?.toFixed(2)}
                            </span>
                            {/* Volume bar */}
                            <div style={{ flex: 1, height: 10, position: 'relative' }}>
                                <div style={{
                                    height: '100%', width: `${frac * 100}%`,
                                    background: poc ? COLORS.yellow : inVA ? `${COLORS.accent}44` : `${COLORS.dim}33`,
                                    borderRadius: '0 2px 2px 0',
                                    position: 'relative',
                                }}>
                                    {/* Delta indicator */}
                                    {d.delta !== 0 && (
                                        <span style={{
                                            position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)',
                                            color: d.delta > 0 ? COLORS.green : COLORS.red,
                                            fontSize: 7, fontWeight: 600,
                                        }}>
                                            {d.delta > 0 ? '+' : ''}{(d.delta / 1000).toFixed(0)}K
                                        </span>
                                    )}
                                </div>
                            </div>
                            {/* Volume label */}
                            <span style={{ width: 50, textAlign: 'left', color: COLORS.dim, fontSize: 7 }}>
                                {(d.vol / 1000).toFixed(0)}K
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
