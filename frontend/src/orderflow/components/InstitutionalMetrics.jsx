import React from 'react';

const C = {
    bg: '#080E1C', panel: '#0D1729', border: '#1A2E52',
    accent: '#00D4FF', green: '#00E676', red: '#FF3B5C',
    yellow: '#FFD600', text: '#B8C7E0', dim: '#4A6080', bright: '#E8F0FF',
    purple: '#A78BFA',
};

const MetricBox = ({ label, value, color = C.text, sub }) => (
    <div style={{ background: '#0A1220', border: `1px solid ${C.border}`, padding: '6px 10px' }}>
        <div style={{ color: C.dim, fontSize: 8, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
        <div style={{ color, fontWeight: 700, fontSize: 14, fontFamily: '"JetBrains Mono", monospace' }}>{value}</div>
        {sub && <div style={{ color: C.dim, fontSize: 8, marginTop: 1 }}>{sub}</div>}
    </div>
);

/**
 * Institutional Metrics Dashboard.
 * Displays key order flow statistics in a compact format.
 */
export default function InstitutionalMetrics({ lastPrice, bid, ask, spread, cumulativeDelta, ticks, volumeProfile, bidLevels, askLevels, config }) {
    // Compute metrics from raw data
    const tickCount = ticks?.length || 0;
    const recentTicks = ticks?.slice(0, 100) || [];
    const avgTickSize = recentTicks.length > 0
        ? recentTicks.reduce((s, t) => s + (t.size || 0), 0) / recentTicks.length
        : 0;

    // Volume from ticks
    const totalVolume = ticks?.slice(0, 500).reduce((s, t) => s + (t.size || t.volume || 0), 0) || 0;

    // Bid/ask imbalance from depth
    const totalBidSize = bidLevels?.reduce((s, l) => s + (l.size || 0), 0) || 0;
    const totalAskSize = askLevels?.reduce((s, l) => s + (l.size || 0), 0) || 0;
    const imbalance = totalAskSize > 0 ? (totalBidSize / totalAskSize).toFixed(2) : '—';

    // VWAP from ticks
    let vwap = 0;
    if (ticks && ticks.length > 0) {
        let cvp = 0, cv = 0;
        const vwapTicks = ticks.slice(0, 500);
        for (const t of vwapTicks) { cvp += t.price * (t.size || 0); cv += (t.size || 0); }
        vwap = cv > 0 ? (cvp / cv) : 0;
    }

    const metrics = [
        { label: 'Last Price', value: lastPrice?.toFixed(2) ?? '—', color: C.bright },
        { label: 'Bid / Ask', value: bid != null && ask != null ? `${bid.toFixed(2)} / ${ask.toFixed(2)}` : '— / —', color: C.accent },
        { label: 'Spread', value: spread?.toFixed(2) ?? '—', color: spread != null && spread <= 0.1 ? C.green : C.yellow },
        { label: 'VWAP', value: vwap ? vwap.toFixed(2) : '—', color: lastPrice && vwap ? (Math.abs(lastPrice - vwap) < 0.1 ? C.green : lastPrice > vwap ? C.yellow : C.red) : C.dim },
        { label: 'Cum Δ', value: cumulativeDelta != null ? `${cumulativeDelta >= 0 ? '+' : ''}${(cumulativeDelta / 1000).toFixed(0)}K` : '—', color: cumulativeDelta > 0 ? C.green : cumulativeDelta < 0 ? C.red : C.dim },
        { label: 'Bid/Ask Imb.', value: imbalance, color: imbalance !== '—' ? (parseFloat(imbalance) > 1.5 ? C.green : parseFloat(imbalance) < 0.67 ? C.red : C.yellow) : C.dim },
        { label: 'Total Vol (500)', value: totalVolume ? `${(totalVolume / 1000).toFixed(0)}K` : '—', color: totalVolume > 0 ? C.text : C.dim },
        { label: 'Avg Tick Size', value: avgTickSize ? `${avgTickSize.toFixed(0)}` : '—', color: C.dim },
        { label: 'Trades', value: tickCount ? `${tickCount}` : '0', color: C.dim },
        { label: 'DOM Depth', value: config?.domDepth ?? 20, color: C.dim },
    ];

    // POC distance
    if (volumeProfile?.poc && lastPrice) {
        const dist = ((lastPrice - volumeProfile.poc) / volumeProfile.poc * 100);
        metrics.push({
            label: 'POC Distance',
            value: `${dist >= 0 ? '+' : ''}${dist.toFixed(2)}%`,
            color: Math.abs(dist) < 0.3 ? C.green : Math.abs(dist) < 1 ? C.yellow : C.red,
            sub: `POC @ ${volumeProfile.poc.toFixed(2)}`,
        });
    }

    return (
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, height: '100%', minHeight: 200, overflow: 'auto', padding: 8 }}>
            <div style={{ color: C.bright, fontWeight: 600, fontSize: 11, marginBottom: 6, padding: '0 2px' }}>📊 Institutional Metrics</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                {metrics.map(m => (
                    <MetricBox key={m.label} {...m} />
                ))}
            </div>
        </div>
    );
}
