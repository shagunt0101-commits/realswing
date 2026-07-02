import React, { useState, useMemo } from 'react';
import { usePaperTradeStore } from '../stores/paperTradeStore';

const C = {
    bg: "#080E1C", panel: "#0D1729", border: "#1A2E52",
    accent: "#00D4FF", green: "#00E676", red: "#FF3B5C",
    yellow: "#FFD600", text: "#B8C7E0", dim: "#4A6080", bright: "#E8F0FF",
    purple: "#A78BFA",
};

const fmt = {};
fmt.k = v => v > 0 ? `${(v / 1000).toFixed(0)}K` : '0';
fmt.strike = v => v ? Math.round(v).toLocaleString('en-IN') : '-';
fmt.ltp = v => v > 0 ? `₹${(v / 100).toFixed(2)}` : '—';
fmt.rs = v => `₹${Number(v).toLocaleString('en-IN')}`;

export default function OptionBuyingPanel({ data, session, liveMode, onLiveOrder }) {
    const [activeSide, setActiveSide] = useState('CE'); // CE | PE
    const [selStrike, setSelStrike] = useState(null);
    const [qty, setQty] = useState(1);
    const [toast, setToast] = useState('');
    const paperStore = usePaperTradeStore();

    // Compute everything from chain data
    const chain = useMemo(() => {
        if (!data?.ce || !data?.pe) return null;
        const spot = data.cp / 100;
        const atm = data.atm / 100;
        const daysLeft = data.expiry ? Math.max(0, Math.ceil((new Date(
            data.expiry.slice(0,4)+'-'+data.expiry.slice(4,6)+'-'+data.expiry.slice(6,8)
        ) - new Date()) / 86400000)) : 0;

        // Score each strike for buying suitability
        const scoreOption = (s) => {
            const ltp = s.ltp || 0;
            const volume = s.volume || 0;
            const oi = s.oi || 0;
            const iv = s.iv || 0;
            const delta = Math.abs(s.delta || 0);
            // Score: volume liquidity + OI depth + ATM proximity + IV attractiveness
            const volScore = Math.min(volume / 1000, 5);
            const oiScore = Math.min(oi / 10000, 5);
            const moneyScore = delta > 0.15 && delta < 0.85 ? 3 : 1; // Skip deep ITM/OTM
            const ivPct = iv < 1 ? iv * 100 : iv; // normalize: nubra sends decimal
            const ivScore = ivPct > 0 && ivPct < 40 ? 2 : ivPct < 60 ? 1 : 0; // Cheaper IV better
            const total = volScore * 2 + oiScore * 1.5 + moneyScore + ivScore;
            return Math.round(total * 10) / 10;
        };

        const ceRanked = (data.ce || []).filter(s => s.ltp > 0).map(s => ({ ...s, _score: scoreOption(s), _side: 'CE' }))
            .sort((a, b) => b._score - a._score).slice(0, 8);
        const peRanked = (data.pe || []).filter(s => s.ltp > 0).map(s => ({ ...s, _score: scoreOption(s), _side: 'PE' }))
            .sort((a, b) => b._score - a._score).slice(0, 8);

        // Compute PCR, max OI strikes for context
        const totalCeOi = data.ce.reduce((s, x) => s + (x.oi || 0), 0);
        const totalPeOi = data.pe.reduce((s, x) => s + (x.oi || 0), 0);
        const pcr = totalCeOi > 0 ? (totalPeOi / totalCeOi).toFixed(2) : '—';
        const maxOiCe = [...data.ce].sort((a, b) => (b.oi || 0) - (a.oi || 0))[0];
        const maxOiPe = [...data.pe].sort((a, b) => (b.oi || 0) - (a.oi || 0))[0];

        return { spot, atm, daysLeft, pcr, ceRanked, peRanked, maxOiCe, maxOiPe, expiry: data.expiry };
    }, [data]);

    const options = activeSide === 'CE' ? chain?.ceRanked : chain?.peRanked;
    const selected = options?.find(s => Math.round(s.sp / 100) === Math.round(selStrike)) || options?.[0];

    const totalPremium = selected ? (selected.ltp || 0) * (selected.ls || 75) * qty : 0;

    const placeOrder = (actionSide) => {
        if (!selected) { setToast('Select an option first'); return; }
        const ltp = (selected.ltp || 0) / 100;
        const strike = Math.round((selected.sp || 0) / 100);
        const optSide = selected.side || activeSide;
        const side = actionSide || (optSide === 'CE' ? 'BUY' : 'SELL');
        if (liveMode && onLiveOrder) {
          onLiveOrder({
            ref_id: selected.ref_id, side,
            price: ltp, qty: qty * (selected.ls || 75),
          }).then(result => {
            setToast(result?.error ? `❌ Live error: ${result.error}` : `✅ Live ${side} #${result?.intentOrderId || result?.order_id || 'placed'}`);
          });
        } else {
          if (!paperStore.running) paperStore.start();
          paperStore.evaluateSignal({
            instrument: `${strike} ${optSide}`, side,
            entryPrice: ltp, qty: qty * (selected.ls || 75),
            sl: ltp * 0.9, tp: ltp * 1.2,
            reason: `Buying panel: ${strike} ${optSide}`, source: 'manual',
          });
          setToast(`✅ Paper ${side} ${strike} @ ₹${ltp.toFixed(2)}`);
        }
        setTimeout(() => setToast(''), 3000);
    };

    return (
        <div style={{ display: 'grid', gap: 16 }}>
            {toast && (
                <div style={{ position: 'fixed', top: 80, right: 24, zIndex: 9999, background: '#0A1220', border: `1px solid ${C.accent}50`, borderRadius: 8, padding: '10px 20px', color: C.accent, fontSize: 12, fontWeight: 600 }}>
                    {toast}
                </div>
            )}

            {/* ── Market Context Bar ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 6 }}>
                {[
                    { l: 'Spot', v: fmt.ltp(chain?.spot * 100 || 0), c: C.bright },
                    { l: 'ATM', v: fmt.strike(chain?.atm || 0), c: C.yellow },
                    { l: 'PCR (OI)', v: chain?.pcr || '—', c: chain?.pcr >= 1.2 ? C.green : chain?.pcr >= 0.7 ? C.yellow : C.red },
                    { l: 'Max CE OI', v: chain?.maxOiCe ? `${fmt.strike(chain.maxOiCe.sp / 100)} @ ${fmt.k(chain.maxOiCe.oi)}` : '—', c: C.red },
                    { l: 'Max PE OI', v: chain?.maxOiPe ? `${fmt.strike(chain.maxOiPe.sp / 100)} @ ${fmt.k(chain.maxOiPe.oi)}` : '—', c: C.green },
                ].map(m => (
                    <div key={m.l} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px' }}>
                        <div style={{ color: C.dim, fontSize: 8, letterSpacing: 1, textTransform: 'uppercase' }}>{m.l}</div>
                        <div style={{ color: m.c, fontWeight: 700, fontSize: 13, fontFamily: 'monospace', marginTop: 2 }}>{m.v}</div>
                    </div>
                ))}
            </div>

            {/* ── Main: Best Options + Trade Card ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, alignItems: 'start' }}>
                {/* BEST OPTIONS TO BUY — ranked list */}
                <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <div>
                            <span style={{ color: C.bright, fontWeight: 700, fontSize: 14 }}>⭐ Best Options to Buy</span>
                            <span style={{ color: C.dim, fontSize: 9, marginLeft: 8 }}>Ranked by liquidity + premium depth</span>
                        </div>
                        <div style={{ display: 'flex', gap: 4 }}>
                            {['CE', 'PE'].map(s => (
                                <button key={s} onClick={() => setActiveSide(s)}
                                    style={{
                                        padding: '4px 16px', fontSize: 10, fontWeight: 700, borderRadius: 4, cursor: 'pointer',
                                        background: activeSide === s ? `${s === 'CE' ? C.green : C.red}22` : 'none',
                                        border: `1px solid ${activeSide === s ? (s === 'CE' ? C.green : C.red) + '50' : C.border}`,
                                        color: activeSide === s ? (s === 'CE' ? C.green : C.red) : C.dim,
                                    }}>{s === 'CE' ? 'CALLS ↑' : 'PUTS ↓'}</button>
                            ))}
                        </div>
                    </div>

                    <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                        <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse' }}>
                            <thead><tr style={{ color: C.dim, fontSize: 9, position: 'sticky', top: 0, background: C.panel, zIndex: 2 }}>
                                <th style={{ textAlign: 'center', padding: '4px 6px', width: 30 }}>#</th>
                                <th style={{ textAlign: 'right', padding: '4px 6px' }}>Strike</th>
                                <th style={{ textAlign: 'right', padding: '4px 6px' }}>Score</th>
                                <th style={{ textAlign: 'right', padding: '4px 6px' }}>LTP</th>
                                <th style={{ textAlign: 'right', padding: '4px 6px' }}>LTP%</th>
                                <th style={{ textAlign: 'right', padding: '4px 6px' }}>Δ</th>
                                <th style={{ textAlign: 'right', padding: '4px 6px' }}>IV</th>
                                <th style={{ textAlign: 'right', padding: '4px 6px' }}>OI</th>
                                <th style={{ textAlign: 'right', padding: '4px 6px' }}>Vol</th>
                            </tr></thead>
                            <tbody>
                                {options?.map((s, i) => {
                                    const isSel = selected && Math.round(s.sp / 100) === Math.round(selected.sp / 100);
                                    const rankColor = i === 0 ? C.yellow : i === 1 ? C.accent : i === 2 ? C.purple : C.dim;
                                    return (
                                        <tr key={s.sp} onClick={() => setSelStrike(s.sp / 100)}
                                            style={{
                                                borderBottom: `1px solid ${C.border}30`, cursor: 'pointer',
                                                background: isSel ? `${C.accent}22` : 'none',
                                            }}>
                                            <td style={{ textAlign: 'center', padding: '6px 6px', color: rankColor, fontWeight: 700 }}>{i + 1}</td>
                                            <td style={{ textAlign: 'right', padding: '6px 6px', fontFamily: 'monospace', color: C.bright }}>{fmt.strike(s.sp / 100)}</td>
                                            <td style={{ textAlign: 'right', padding: '6px 6px', color: rankColor, fontWeight: 700 }}>{s._score}</td>
                                            <td style={{ textAlign: 'right', padding: '6px 6px', fontFamily: 'monospace', color: C.bright }}>{fmt.ltp(s.ltp)}</td>
                                            <td style={{ textAlign: 'right', padding: '6px 6px', fontFamily: 'monospace', color: (s.ltpchg || 0) >= 0 ? C.green : C.red, fontWeight: 600 }}>
                                                {(s.ltpchg || 0) >= 0 ? '+' : ''}{(s.ltpchg || 0).toFixed(1)}%
                                            </td>
                                            <td style={{ textAlign: 'right', padding: '6px 6px', fontFamily: 'monospace', color: s.delta >= 0.5 ? C.green : s.delta > 0 ? C.yellow : C.red }}>
                                                {(s.delta || 0).toFixed(2)}
                                            </td>
                                            <td style={{ textAlign: 'right', padding: '6px 6px', fontFamily: 'monospace', color: C.accent }}>{(s.iv || 0) > 0 ? `${(s.iv * 100).toFixed(0)}%` : '—'}</td>
                                            <td style={{ textAlign: 'right', padding: '6px 6px', fontFamily: 'monospace', color: C.dim }}>{fmt.k(s.oi || 0)}</td>
                                            <td style={{ textAlign: 'right', padding: '6px 6px', fontFamily: 'monospace', color: C.text }}>{fmt.k(s.volume || 0)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        {(!options || options.length === 0) && (
                            <div style={{ color: C.dim, textAlign: 'center', padding: 40, fontSize: 11 }}>No options with LTP {'>'} 0</div>
                        )}
                    </div>

                    {selected && (
                        <div style={{ display: 'flex', gap: 6, marginTop: 10, padding: '8px 0', borderTop: `1px solid ${C.border}` }}>
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ color: C.dim, fontSize: 9, textTransform: 'uppercase' }}>Lots</span>
                                <input type="number" value={qty} onChange={e => setQty(Math.max(1, Number(e.target.value)))}
                                    style={{ width: 50, padding: '4px 6px', background: '#0A1220', border: `1px solid ${C.border}`, borderRadius: 4, color: C.bright, fontSize: 12, fontFamily: 'monospace' }} />
                                <span style={{ color: C.dim, fontSize: 9 }}>× {(selected.ls || 75)}</span>
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                                <button onClick={() => placeOrder('BUY')} style={{
                                    padding: '8px 28px', border: 'none', borderRadius: 6, cursor: 'pointer',
                                    background: `linear-gradient(135deg, ${C.green}, #00B050)`,
                                    color: '#fff', fontWeight: 700, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase',
                                }}>BUY {qty}</button>
                                <button onClick={() => placeOrder('SELL')} style={{
                                    padding: '8px 28px', border: 'none', borderRadius: 6, cursor: 'pointer',
                                    background: `linear-gradient(135deg, ${C.red}, #CC0040)`,
                                    color: '#fff', fontWeight: 700, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase',
                                }}>SELL {qty}</button>
                            </div>
                        </div>
                    )}
                </div>

                {/* TRADE CARD — selected option preview */}
                <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, position: 'sticky', top: 80, height: 'fit-content' }}>
                    <div style={{ color: C.bright, fontWeight: 700, fontSize: 14, marginBottom: 14 }}>🎯 Trade Card</div>
                    {selected ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {/* Option header */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0A1220', borderRadius: 8, padding: '10px 14px' }}>
                                <div>
                                    <span style={{ color: C.bright, fontWeight: 700, fontSize: 18 }}>{activeSide}</span>
                                    <span style={{ color: C.bright, fontWeight: 700, fontSize: 18, fontFamily: 'monospace' }}> {fmt.strike(selected.sp / 100)}</span>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                    <div style={{ color: C.bright, fontWeight: 700, fontSize: 20, fontFamily: 'monospace' }}>{fmt.ltp(selected.ltp)}</div>
                                    <div style={{ color: (selected.ltpchg || 0) >= 0 ? C.green : C.red, fontSize: 10, fontFamily: 'monospace', fontWeight: 600 }}>
                                        {(selected.ltpchg || 0) >= 0 ? '▲' : '▼'} {(selected.ltpchg || 0).toFixed(2)}%
                                    </div>
                                </div>
                            </div>

                            {/* Greeks row */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                                {[
                                    { l: 'Delta', v: (selected.delta || 0).toFixed(3), c: selected.delta >= 0.5 ? C.green : selected.delta > 0.2 ? C.yellow : C.dim },
                                    { l: 'Gamma', v: (selected.gamma || 0).toFixed(5), c: C.accent },
                                    { l: 'Theta', v: (selected.theta || 0).toFixed(2), c: (selected.theta || 0) < 0 ? C.red : C.green },
                                    { l: 'Vega', v: (selected.vega || 0).toFixed(2), c: C.purple },
                                    { l: 'IV', v: (selected.iv || 0) > 0 ? `${(selected.iv < 1 ? selected.iv * 100 : selected.iv).toFixed(1)}%` : '—', c: C.accent },
                                    { l: 'Score', v: selected._score, c: selected._score >= 12 ? C.yellow : selected._score >= 8 ? C.accent : C.dim },
                                ].map(g => (
                                    <div key={g.l} style={{ background: '#0A1220', borderRadius: 4, padding: '5px 8px' }}>
                                        <div style={{ color: C.dim, fontSize: 7, textTransform: 'uppercase' }}>{g.l}</div>
                                        <div style={{ color: g.c, fontWeight: 600, fontFamily: 'monospace', fontSize: 11 }}>{g.v}</div>
                                    </div>
                                ))}
                            </div>

                            {/* Premium calculation */}
                            <div style={{ background: '#0A1220', borderRadius: 8, padding: 12 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 6 }}>
                                    <span style={{ color: C.dim }}>Lot Size</span>
                                    <span style={{ color: C.text, fontFamily: 'monospace' }}>{selected.ls || 75}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 6 }}>
                                    <span style={{ color: C.dim }}>Qty</span>
                                    <span style={{ color: C.text, fontFamily: 'monospace' }}>{qty} lot{ qty > 1 ? 's' : ''} ({(selected.ls || 75) * qty} units)</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 6 }}>
                                    <span style={{ color: C.dim }}>Total Premium</span>
                                    <span style={{ color: C.green, fontWeight: 700, fontSize: 14, fontFamily: 'monospace' }}>{fmt.rs(totalPremium / 100)}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                                    <span style={{ color: C.dim }}>Delta Exposure</span>
                                    <span style={{ color: C.accent, fontFamily: 'monospace' }}>{(selected.delta || 0).toFixed(2)} × {(selected.ls || 75) * qty}</span>
                                </div>
                            </div>

                            {/* Quick info */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 9, color: C.dim }}>
                                <div style={{ background: '#0A1220', borderRadius: 4, padding: '6px 8px' }}>
                                    <span>Vol: </span><span style={{ color: C.text, fontFamily: 'monospace' }}>{fmt.k(selected.volume || 0)}</span>
                                </div>
                                <div style={{ background: '#0A1220', borderRadius: 4, padding: '6px 8px' }}>
                                    <span>OI: </span><span style={{ color: C.text, fontFamily: 'monospace' }}>{fmt.k(selected.oi || 0)}</span>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div style={{ textAlign: 'center', padding: 40, color: C.dim, fontSize: 12 }}>
                            Click a row to preview
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
