import React, { useMemo } from 'react';

const C = {
    bg: '#080E1C', panel: '#0D1729', border: '#1A2E52',
    accent: '#00D4FF', green: '#00E676', red: '#FF3B5C',
    yellow: '#FFD600', text: '#B8C7E0', dim: '#4A6080', bright: '#E8F0FF',
    purple: '#A78BFA',
};

/**
 * AI Institutional Interpretation Panel.
 * Analyzes order flow data in real-time and produces natural-language
 * interpretations of market structure, liquidity, and trading opportunities.
 *
 * Detection-driven: each alert has a type, severity, price level, and confidence score.
 * No mock data — all entries are computed from real detection engine output.
 */
export default function AIPanel({ patterns, divergences, volumeProfile, lastPrice, cumulativeDelta }) {
    // Build interpretation entries from detection results
    const entries = useMemo(() => {
        const result = [];

        // Pattern entries
        if (patterns) {
            for (const [type, detections] of Object.entries(patterns)) {
                if (!detections || detections.length === 0) continue;
                const recent = detections.slice(0, 3);
                for (const d of recent) {
                    if (d.type === 'iceberg') {
                        result.push({
                            icon: '🧊',
                            severity: d.confidence > 0.7 ? 'high' : d.confidence > 0.4 ? 'medium' : 'low',
                            message: `Iceberg detected at ${d.price?.toFixed(2)} — ${d.cumulativeVolume?.toLocaleString()} units across ${d.tradeCount} small trades`,
                            level: d.price,
                            time: 'now',
                        });
                    } else if (d.type === 'spoofing') {
                        result.push({
                            icon: '🎭',
                            severity: d.confidence > 0.7 ? 'high' : 'medium',
                            message: `Spoofing ${d.side === 'ask' ? 'sell' : 'buy'} wall at ${d.price?.toFixed(2)} — ${d.size?.toLocaleString()} units vanished without execution`,
                            level: d.price,
                            time: 'now',
                        });
                    } else if (d.type === 'absorption') {
                        result.push({
                            icon: '🧽',
                            severity: d.confidence > 0.7 ? 'high' : 'medium',
                            message: `Absorption at ${d.price?.toFixed(2)} — ${d.volume?.toLocaleString()} vol with ${(d.confidence * 100).toFixed(0)}% confidence`,
                            level: d.price,
                            time: 'now',
                        });
                    } else if (d.type === 'exhaustion') {
                        result.push({
                            icon: '💨',
                            severity: d.confidence > 0.7 ? 'high' : 'medium',
                            message: `${d.direction === 'buying' ? 'Buying' : 'Selling'} exhaustion at ${d.price?.toFixed(2)} — high vol narrow range with reversal`,
                            level: d.price,
                            time: 'now',
                        });
                    } else if (d.type === 'liquidity_sweep') {
                        result.push({
                            icon: '🌪️',
                            severity: 'high',
                            message: `Liquidity sweep through ${d.side === 'bid' ? 'bid' : 'ask'} wall at ${d.price?.toFixed(2)} — ${d.wallSize?.toLocaleString()} cleared`,
                            level: d.price,
                            time: 'now',
                        });
                    } else if (d.type === 'large_trade') {
                        result.push({
                            icon: '🐋',
                            severity: 'medium',
                            message: `Large trade: ${d.side === 'B' ? 'BUY' : d.side === 'S' ? 'SELL' : 'NEUTRAL'} ${(d.size)?.toLocaleString()} units at ${d.price?.toFixed(2)}`,
                            level: d.price,
                            time: 'now',
                        });
                    } else if (d.type === 'finished_auction_high' || d.type === 'finished_auction_low') {
                        result.push({
                            icon: '🏁',
                            severity: 'medium',
                            message: `Finished auction at value area ${d.type === 'finished_auction_high' ? 'high' : 'low'} — ${d.direction === 'reject_high' ? 'price rejected upper range' : 'price rejected lower range'}`,
                            level: d.price,
                            time: 'now',
                        });
                    } else if (d.type === 'bullish_divergence' || d.type === 'bearish_divergence') {
                        result.push({
                            icon: '📐',
                            severity: 'high',
                            message: `${d.type === 'bullish_divergence' ? 'Bullish' : 'Bearish'} ${d.divergenceLevel} divergence at ${d.priceLevel?.toFixed(2)} — price/${d.divergenceLevel} disagreement`,
                            level: d.priceLevel,
                            time: 'now',
                        });
                    } else if (d.type === 'stacked_imbalance') {
                        result.push({
                            icon: '⚡',
                            severity: 'medium',
                            message: `Stacked ${d.direction === 'bid_heavy' ? 'bid' : 'ask'} imbalance — ${d.count} consecutive bars, ratio ${d.avgRatio?.toFixed(1)}x`,
                            level: null,
                            time: 'now',
                        });
                    }
                }
            }
        }

        // Delta interpretation
        if (typeof cumulativeDelta === 'number') {
            const deltaSignal = cumulativeDelta > 5000 ? 'aggressive buying pressure' :
                cumulativeDelta > 2000 ? 'moderate buying pressure' :
                cumulativeDelta < -5000 ? 'aggressive selling pressure' :
                cumulativeDelta < -2000 ? 'moderate selling pressure' : 'balanced flow';
            result.push({
                icon: '📊',
                severity: Math.abs(cumulativeDelta) > 5000 ? 'high' : 'medium',
                message: `Cumulative Delta: ${cumulativeDelta >= 0 ? '+' : ''}${(cumulativeDelta / 1000).toFixed(0)}K — ${deltaSignal}`,
                level: lastPrice,
                time: 'now',
            });
        }

        // Volume profile context
        if (volumeProfile) {
            const spotRelPoc = lastPrice ? ((lastPrice - volumeProfile.poc) / volumeProfile.poc * 100).toFixed(1) : null;
            if (spotRelPoc) {
                const pocNote = Math.abs(spotRelPoc) < 0.3 ? 'price at POC — equilibrium' :
                    spotRelPoc > 0 ? `price ${spotRelPoc}% above POC — premium zone` :
                    `price ${Math.abs(spotRelPoc)}% below POC — discount zone`;
                result.push({
                    icon: '🎯',
                    severity: Math.abs(parseFloat(spotRelPoc)) > 1 ? 'medium' : 'low',
                    message: pocNote,
                    level: volumeProfile.poc,
                    time: 'now',
                });
            }
        }

        // Sort by severity
        const order = { high: 0, medium: 1, low: 2 };
        result.sort((a, b) => (order[a.severity] ?? 2) - (order[b.severity] ?? 2));

        return result.slice(0, 15);
    }, [patterns, divergences, volumeProfile, lastPrice, cumulativeDelta]);

    const severityColor = (s) => s === 'high' ? C.red : s === 'medium' ? C.yellow : C.dim;

    return (
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, height: '100%', minHeight: 200, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '6px 10px', borderBottom: `1px solid ${C.border}`, fontSize: 9, color: C.dim }}>
                <span style={{ color: C.bright, fontWeight: 600 }}>🧠 Institutional AI Interpretation</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 4 }}>
                {entries.length === 0 ? (
                    <div style={{ color: C.dim, textAlign: 'center', padding: '20px', fontSize: 10 }}>
                        No detection data yet. Generate volume profile and enable detection engines.
                    </div>
                ) : (
                    entries.map((e, i) => (
                        <div key={i} style={{
                            padding: '5px 8px', marginBottom: 4,
                            borderLeft: `2px solid ${severityColor(e.severity)}`,
                            background: `${severityColor(e.severity)}08`,
                            borderRadius: 0, fontSize: 9,
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                                <span style={{ color: C.bright, fontWeight: 600 }}>
                                    {e.icon} {e.severity === 'high' ? '🔴' : e.severity === 'medium' ? '🟡' : '⚪'} Alert
                                </span>
                                {e.level && <span style={{ color: C.accent, fontFamily: 'monospace' }}>{e.level.toFixed(2)}</span>}
                            </div>
                            <div style={{ color: C.text, lineHeight: 1.4 }}>{e.message}</div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
