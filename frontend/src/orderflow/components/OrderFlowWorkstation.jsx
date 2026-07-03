import React, { useEffect, useCallback, useRef, useMemo, useState } from 'react';
import { useOrderFlowStore } from '../stores/orderflowStore.js';
import { computeVolumeProfile, detectStackedImbalance, detectAbsorption, detectExhaustion, detectIceberg, detectLargeTrades } from '../utils/calculations.js';
import FootprintChart from './FootprintChart.jsx';
import DOMView from './DOMView.jsx';
import TimeSalesView from './TimeSalesView.jsx';
import VolumeProfileView from './VolumeProfileView.jsx';
import AIPanel from './AIPanel.jsx';
import InstitutionalMetrics from './InstitutionalMetrics.jsx';

const C = { bg: '#080E1C', panel: '#0D1729', border: '#1A2E52', accent: '#00D4FF', green: '#00E676', dim: '#4A6080', bright: '#E8F0FF' };
const DEV = window.location.hostname === 'localhost';
const API_BASE = import.meta.env?.VITE_API_BASE || (DEV ? 'http://localhost:9000' : '');
const DEVICE_ID = 'TS123';

export default function OrderFlowWorkstation({ session }) {
    const store = useOrderFlowStore();
    const { footprint, ticks, bidLevels, askLevels, lastPrice, cumulativeDelta, volumeProfile, patterns, divergences, config, panels } = store;
    const intervalRef = useRef(null);
    const [instrument, setInstrument] = useState('NIFTY');

    const exch = ['SENSEX', 'BANKEX'].includes(instrument) ? 'BSE' : 'NSE';

    // ── Fetch market prices (spot) ──
    const fetchPrices = useCallback(async () => {
        if (!session?.session_token) return;
        try {
            const r = await fetch(`${API_BASE}/market/price/${instrument}?exchange=${exch}&session_token=${session.session_token}&device_id=${DEVICE_ID}&env=${session.env}`);
            const d = await r.json();
            if (d?.price) {
                store.setConnection(true);
                // Create a tick from spot price
                store.addTick({
                    price: d.price / 100,
                    size: d.volume || 0,
                    side: (d.change || 0) >= 0 ? 'B' : 'S',
                    delta: (d.change || 0) / 100,
                    time: Date.now(),
                });
            }
        } catch {}
    }, [session, instrument]);

    // ── Fetch option chain for footprint ──
    const fetchChain = useCallback(async () => {
        if (!session?.session_token) return;
        try {
            const r = await fetch(`${API_BASE}/market/optionchain/${instrument}?exchange=${exch}&session_token=${session.session_token}&device_id=${DEVICE_ID}&env=${session.env}`);
            const d = await r.json();
            if (!d?.chain) return;

            const ce = d.chain.ce || [];
            const pe = d.chain.pe || [];
            const spot = d.chain.cp / 100 || 0;
            const atm = d.chain.atm / 100 || 0;

            // Build footprint: aggregate volume by strike level across CE+PE
            // Each row = one strike level with total activity
            const footprintRows = [];
            const ticksArr = [];

            // Match CE and PE by strike proximity
            for (let i = 0; i < ce.length; i++) {
                const c = ce[i];
                const strike = (c.sp || 0) / 100;

                // Find matching PE (same or nearest strike)
                const matchPe = pe.find(p => Math.abs(p.sp - c.sp) <= 100);

                // Volumes
                const ceVol = c.volume || 0;
                const peVol = matchPe?.volume || 0;
                const ceOi = c.oi || 0;
                const peOi = matchPe?.oi || 0;
                const ceLtp = (c.ltp || 0) / 100;
                const peLtp = matchPe?.ltp ? matchPe.ltp / 100 : 0;

                // Bid/ask interpretation:
                // - CE buyers are aggressive when delta > 0.5 (bullish)
                // - PE buyers are aggressive when delta < -0.5 (bearish)
                const ceAggression = (c.delta || 0) > 0.5 ? ceVol : 0;
                const peAggression = (matchPe?.delta || 0) < -0.5 ? peVol : 0;

                footprintRows.push({
                    price: strike,
                    bidVol: ceAggression + Math.max(0, ceOi - peOi),
                    askVol: peAggression + Math.max(0, peOi - ceOi),
                    delta: (ceAggression - peAggression) + (c.delta || 0) * ceOi + (matchPe?.delta || 0) * peOi,
                    totalVol: ceVol + peVol + ceOi + peOi,
                    volume: ceVol + peVol,
                    oi: ceOi + peOi,
                    open: ceLtp || peLtp, high: Math.max(ceLtp, peLtp), low: Math.min(ceLtp || 99999, peLtp || 99999), close: ceLtp || peLtp,
                    time: Date.now(),
                });

                if (c.ltp > 0) ticksArr.push({ price: ceLtp, size: Math.max(ceVol, 1), side: (c.delta || 0) > 0.5 ? 'B' : 'S', delta: (c.ltpchg || 0) * ceLtp / 100, time: Date.now() });
                if (matchPe?.ltp > 0) ticksArr.push({ price: peLtp, size: Math.max(peVol, 1), side: (matchPe.delta || 0) < -0.5 ? 'S' : 'B', delta: -(matchPe.ltpchg || 0) * peLtp / 100, time: Date.now() });
            }

            store.setFootprint(footprintRows);
            if (ticksArr.length > 0) {
                ticksArr.slice(0, 100).forEach(t => store.addTick(t));
            }

            // DOM: OI-sorted depth
            const allLevels = [...ce.map(c => ({ price: (c.sp || 0) / 100, oi: c.oi || 0, vol: c.volume || 0, side: 'CE' })),
                                ...pe.map(p => ({ price: (p.sp || 0) / 100, oi: p.oi || 0, vol: p.volume || 0, side: 'PE' }))]
                .filter(s => s.oi > 0).sort((a, b) => b.oi - a.oi);

            store.setDepth(
                allLevels.filter(l => l.side === 'CE').slice(0, 15).map(l => ({ price: l.price, size: l.oi, orders: Math.max(1, Math.round(l.vol / 10)) })),
                allLevels.filter(l => l.side === 'PE').slice(0, 15).map(l => ({ price: l.price, size: l.oi, orders: Math.max(1, Math.round(l.vol / 10)) }))
            );

            // Volume profile
            const vp = computeVolumeProfile(footprintRows, 5);
            if (vp) store.setVolumeProfile(vp);
        } catch {}
    }, [session, instrument]);

    // Combined polling
    useEffect(() => {
        fetchPrices();
        fetchChain();
        intervalRef.current = setInterval(() => { fetchPrices(); fetchChain(); }, 5000);
        return () => clearInterval(intervalRef.current);
    }, [fetchPrices, fetchChain]);

    // ── Detection ──
    useEffect(() => {
        if (footprint.length < 5) return;
        const stacked = detectStackedImbalance(footprint, 3);
        stacked.forEach(s => store.addPattern('stacked_imbalance', s));
        const absorption = detectAbsorption(footprint, 5, 3);
        absorption.forEach(a => store.addPattern('absorption', a));
        const exhaustion = detectExhaustion(footprint, 5);
        exhaustion.forEach(e => store.addPattern('exhaustion', e));
        const large = detectLargeTrades(ticks, 3);
        large.forEach(l => store.addPattern('large_trade', l));
    }, [footprint, ticks]);

    const visiblePanels = useMemo(() => {
        const map = {};
        for (const p of panels) if (p.visible) map[p.type] = p;
        return map;
    }, [panels]);

    return (
        <div style={{ background: C.bg, height: 'calc(100vh - 160px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Toolbar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderBottom: `1px solid ${C.border}`, background: C.panel, flexShrink: 0 }}>
                <span style={{ color: C.bright, fontWeight: 700, fontSize: 11 }}>📊 ORDER FLOW</span>
                <select value={instrument} onChange={e => { setInstrument(e.target.value); store.reset(); store.setInstrument(e.target.value); }}
                    style={{ background: '#0A1220', border: `1px solid ${C.border}`, color: C.accent, borderRadius: 0, padding: '2px 6px', fontSize: 10, fontWeight: 600 }}>
                    {['NIFTY', 'BANKNIFTY', 'SENSEX', 'FINNIFTY'].map(i => <option key={i} value={i}>{i}</option>)}
                </select>
                <span style={{ color: store.connected ? C.green : C.dim, fontSize: 9 }}>{store.connected ? '●' : '○'}</span>
                <div style={{ flex: 1 }}/>
                {panels.filter(p => p.id !== 'footprint').map(p => (
                    <button key={p.id} onClick={() => store.togglePanel(p.id)}
                        style={{ padding: '1px 8px', fontSize: 9, cursor: 'pointer',
                            background: p.visible ? `${C.accent}22` : 'none', border: `1px solid ${p.visible ? C.accent + '50' : C.border}`,
                            color: p.visible ? C.accent : C.dim }}>{p.label}</button>
                ))}
            </div>

            {/* Main: Footprint + DOM */}
            <div style={{ flex: 1, display: 'grid', gap: 1, background: C.border, padding: 1, gridTemplateColumns: visiblePanels.dom ? '2fr 1fr' : '1fr', minHeight: 0 }}>
                <div style={{ background: C.bg, overflow: 'hidden', minHeight: 0 }}>
                    <FootprintChart footprint={footprint} />
                </div>
                {visiblePanels.dom && (
                    <div style={{ background: C.bg, overflow: 'hidden', minHeight: 0 }}>
                        <DOMView bidLevels={bidLevels} askLevels={askLevels} lastPrice={lastPrice} />
                    </div>
                )}
            </div>

            {/* Bottom row */}
            <div style={{ display: 'grid', gap: 1, background: C.border, padding: 1, gridTemplateColumns: `${visiblePanels.timesales ? '1fr' : ''} ${visiblePanels.volprofile ? '1fr' : ''} ${visiblePanels.aipanel ? '1fr' : ''} ${visiblePanels.metrics ? '1fr' : ''}`.replace(/^ /, ''), height: 200, flexShrink: 0 }}>
                {visiblePanels.timesales && <div style={{ background: C.bg, overflow: 'hidden' }}><TimeSalesView ticks={ticks} /></div>}
                {visiblePanels.volprofile && <div style={{ background: C.bg, overflow: 'hidden' }}><VolumeProfileView volumeProfile={volumeProfile} /></div>}
                {visiblePanels.aipanel && <div style={{ background: C.bg, overflow: 'hidden' }}><AIPanel patterns={patterns} divergences={divergences} volumeProfile={volumeProfile} lastPrice={lastPrice} cumulativeDelta={cumulativeDelta} /></div>}
                {visiblePanels.metrics && <div style={{ background: C.bg, overflow: 'hidden' }}><InstitutionalMetrics lastPrice={lastPrice} bid={store.bid} ask={store.ask} spread={store.spread} cumulativeDelta={cumulativeDelta} ticks={ticks} volumeProfile={volumeProfile} bidLevels={bidLevels} askLevels={askLevels} config={config} /></div>}
            </div>
        </div>
    );
}
