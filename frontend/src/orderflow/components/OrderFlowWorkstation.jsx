import React, { useEffect, useCallback, useRef, useMemo, useState } from 'react';
import { useOrderFlowStore } from '../stores/orderflowStore.js';

const C = { bg: '#080E1C', panel: '#0D1729', border: '#1A2E52', accent: '#00D4FF', green: '#00E676', red: '#FF3B5C', yellow: '#FFD600', dim: '#4A6080', bright: '#E8F0FF' };
const DEV = window.location.hostname === 'localhost';
const API_BASE = import.meta.env?.VITE_API_BASE || (DEV ? 'http://localhost:9000' : '');
const ORCH_BASE = import.meta.env?.VITE_ORCH_BASE || (DEV ? 'http://localhost:9010' : '');
const DEVICE_ID = 'TS123';

function fmt(v) { return v != null ? Number(v.toFixed(2)).toLocaleString('en-IN') : '—'; }

export default function OrderFlowWorkstation({ session }) {
  const store = useOrderFlowStore();
  const [instrument, setInstrument] = useState('NIFTY');
  const [chain, setChain] = useState(null);
  const [orderFlowData, setOrderFlowData] = useState(null);
  const [error, setError] = useState('');
  const exch = ['SENSEX', 'BANKEX'].includes(instrument) ? 'BSE' : 'NSE';

  const fetchData = useCallback(async () => {
    if (!session?.session_token) return;
    try {
      // Fetch chain
      const r = await fetch(`${API_BASE}/market/optionchain/${instrument}?exchange=${exch}&session_token=${session.session_token}&device_id=${DEVICE_ID}&env=${session.env}`);
      const d = await r.json();
      if (d?.chain) {
        setChain(d.chain);
        store.setConnection(true);
        // Update price tick
        const spot = (d.chain.cp || 0) / 100;
        if (spot > 0) store.addTick({ price: spot, size: 0, side: 'N', delta: 0, time: Date.now() });
        // Build footprint from chain
        const rows = [];
        const ce = d.chain.ce || []; const pe = d.chain.pe || [];
        for (let i = 0; i < ce.length; i++) {
          const c = ce[i]; const strike = (c.sp || 0) / 100;
          const mp = pe.find(p => Math.abs(p.sp - c.sp) <= 100);
          const cv = c.volume || 0; const pv = mp?.volume || 0;
          const co = c.oi || 0; const po = mp?.oi || 0;
          const cl = (c.ltp || 0) / 100; const pl = mp?.ltp ? mp.ltp / 100 : 0;
          rows.push({
            price: strike, bidVol: Math.max(0, co - po), askVol: Math.max(0, po - co),
            delta: (c.delta || 0) * co + (mp?.delta || 0) * po,
            totalVol: cv + pv + co + po, volume: cv + pv, oi: co + po,
            open: cl || pl, high: Math.max(cl, pl), low: Math.min(cl || 99999, pl || 99999), close: cl || pl,
            time: Date.now(),
          });
        }
        store.setFootprint(rows);
        // Depth
        const all = [...ce.map(c => ({ p: (c.sp || 0) / 100, o: c.oi || 0, s: 'CE' })), ...pe.map(p => ({ p: (p.sp || 0) / 100, o: p.oi || 0, s: 'PE' }))].filter(x => x.o > 0).sort((a, b) => b.o - a.o);
        store.setDepth(
          all.filter(l => l.s === 'CE').slice(0, 15).map(l => ({ price: l.p, size: l.o, orders: 1 })),
          all.filter(l => l.s === 'PE').slice(0, 15).map(l => ({ price: l.p, size: l.o, orders: 1 }))
        );
      }
    } catch {}
    // Fetch orderflow from orchestrator
    try {
      const r = await fetch(`${ORCH_BASE}/orderflow/${instrument}`);
      if (r.ok) setOrderFlowData(await r.json());
    } catch {}
  }, [session, instrument, exch]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 1000);
    return () => { clearInterval(id); store.reset(); };
  }, [fetchData]);

  const spot = chain ? (chain.cp || 0) / 100 : 0;
  const atm = chain ? (chain.atm || 0) / 100 : 0;
  const pcRatio = orderFlowData?.pc_ratio || null;
  const topBullish = orderFlowData?.top_bullish || [];
  const topBearish = orderFlowData?.top_bearish || [];
  const atmLtp = chain?.ce?.find(c => Math.abs(c.sp - (chain.atm || 0)) < 100)?.ltp / 100 || 0;
  const atmPeLtp = chain?.pe?.find(p => Math.abs(p.sp - (chain.atm || 0)) < 100)?.ltp / 100 || 0;
  const straddlePrice = atmLtp + atmPeLtp;

  return (
    <div style={{ background: C.bg, display: 'grid', gap: 12, padding: 16, fontFamily: "'Inter', sans-serif" }}>
      {/* Header Bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ color: C.bright, fontWeight: 700, fontSize: 14 }}>Order Flow</span>
        <select value={instrument} onChange={e => { setInstrument(e.target.value); setChain(null); store.reset(); }}
          style={{ background: C.panel, border: `1px solid ${C.border}`, color: C.accent, borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
          {['NIFTY', 'BANKNIFTY', 'SENSEX', 'FINNIFTY'].map(i => <option key={i} value={i}>{i}</option>)}
        </select>
        <span style={{ color: chain ? C.green : C.red, fontSize: 10 }}>{chain ? 'Connected' : 'No Data'}</span>
        {spot > 0 && <span style={{ color: C.bright, fontFamily: 'monospace', fontWeight: 700, fontSize: 16 }}>₹{fmt(spot)}</span>}
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
        {[
          { l: 'ATM Strike', v: atm ? Math.round(atm).toLocaleString('en-IN') : '—', c: C.yellow },
          { l: 'ATM Straddle', v: straddlePrice > 0 ? `₹${straddlePrice.toFixed(2)}` : '—', c: C.accent },
          { l: 'Put/Call Ratio', v: pcRatio != null ? pcRatio.toFixed(2) : '—', c: pcRatio > 1.2 ? C.green : pcRatio > 0.7 ? C.yellow : C.red },
          { l: 'Total Strikes', v: chain ? `${(chain.ce?.length || 0)}` : '—', c: C.dim },
        ].map(m => (
          <div key={m.l} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px' }}>
            <div style={{ color: C.dim, fontSize: 9, textTransform: 'uppercase', letterSpacing: 1 }}>{m.l}</div>
            <div style={{ color: m.c, fontWeight: 700, fontSize: 15, fontFamily: 'monospace', marginTop: 2 }}>{m.v}</div>
          </div>
        ))}
      </div>

      {/* Main Grid: OI Walls + Footprint + DOM */}
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr', minHeight: 300 }}>
        {/* OI Concentration (Institutional Flow) */}
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
          <div style={{ color: C.bright, fontWeight: 600, fontSize: 12, marginBottom: 10 }}>OI Concentration — Institutional Activity</div>
          {topBullish.length > 0 || topBearish.length > 0 ? (
            <div style={{ display: 'grid', gap: 8 }}>
              {topBullish.slice(0, 5).map((s, i) => (
                <div key={`b${i}`} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: '#0A1220', borderRadius: 6, fontSize: 11 }}>
                  <span style={{ color: C.green, fontWeight: 700 }}>
                    {s.type || 'CE'} @ {fmt(s.strike)}
                  </span>
                  <span style={{ color: C.green }}>+{(s.oi_chg_pct || 0).toFixed(1)}%</span>
                </div>
              ))}
              {topBearish.slice(0, 5).map((s, i) => (
                <div key={`r${i}`} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: '#0A1220', borderRadius: 6, fontSize: 11 }}>
                  <span style={{ color: C.red, fontWeight: 700 }}>
                    {s.type || 'PE'} @ {fmt(s.strike)}
                  </span>
                  <span style={{ color: C.red }}>{(s.oi_chg_pct || 0).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: C.dim, fontSize: 11, textAlign: 'center', padding: 30 }}>
              {chain ? 'No significant OI movement detected' : 'Load chain data to see institutional flow'}
            </div>
          )}
        </div>

        {/* Depth of Market (CE/PE OI walls) */}
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
          <div style={{ color: C.bright, fontWeight: 600, fontSize: 12, marginBottom: 10 }}>OI Walls — Support & Resistance</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {/* Resistance (CE OI walls above spot) */}
            <div style={{ color: C.red, fontSize: 10, fontWeight: 600, marginBottom: 4 }}>Resistance (CE OI above spot)</div>
            {chain?.ce?.filter(c => (c.sp / 100) > spot).sort((a, b) => (b.oi || 0) - (a.oi || 0)).slice(0, 5).map((c, i) => (
              <div key={`cr${i}`} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', background: `${C.red}10`, borderRadius: 4, fontSize: 10 }}>
                <span style={{ color: C.text, fontFamily: 'monospace' }}>{(c.sp / 100).toFixed(0)}</span>
                <span style={{ color: C.dim }}>OI: {(c.oi || 0).toLocaleString()}</span>
              </div>
            ))}
            {/* Support (PE OI walls below spot) */}
            <div style={{ color: C.green, fontSize: 10, fontWeight: 600, marginTop: 8, marginBottom: 4 }}>Support (PE OI below spot)</div>
            {chain?.pe?.filter(p => (p.sp / 100) < spot).sort((a, b) => (b.oi || 0) - (a.oi || 0)).slice(0, 5).map((p, i) => (
              <div key={`ps${i}`} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', background: `${C.green}10`, borderRadius: 4, fontSize: 10 }}>
                <span style={{ color: C.text, fontFamily: 'monospace' }}>{(p.sp / 100).toFixed(0)}</span>
                <span style={{ color: C.dim }}>OI: {(p.oi || 0).toLocaleString()}</span>
              </div>
            ))}
            {(!chain?.ce?.length && !chain?.pe?.length) && (
              <div style={{ color: C.dim, fontSize: 11, textAlign: 'center', padding: 20 }}>No OI wall data — load option chain</div>
            )}
          </div>
        </div>
      </div>

      {/* Strikes Activity Table */}
      {chain?.ce?.length > 0 && (
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
          <div style={{ color: C.bright, fontWeight: 600, fontSize: 12, marginBottom: 8 }}>Option Chain — Volume & OI Heatmap</div>
          <div style={{ maxHeight: 250, overflowY: 'auto', fontSize: 10 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ color: C.dim, position: 'sticky', top: 0, background: C.panel, zIndex: 2, fontSize: 9 }}>
                <th style={{ textAlign: 'right', padding: '3px 6px' }}>CE Vol</th>
                <th style={{ textAlign: 'right', padding: '3px 6px' }}>CE OI</th>
                <th style={{ textAlign: 'right', padding: '3px 6px' }}>CE LTP</th>
                <th style={{ textAlign: 'center', padding: '3px 6px', color: C.yellow }}>Strike</th>
                <th style={{ textAlign: 'left', padding: '3px 6px' }}>PE LTP</th>
                <th style={{ textAlign: 'left', padding: '3px 6px' }}>PE OI</th>
                <th style={{ textAlign: 'left', padding: '3px 6px' }}>PE Vol</th>
              </tr></thead>
              <tbody>
                {chain.ce.slice(0, 30).map((c, i) => {
                  const pe = chain.pe?.[i];
                  const strike = Math.round(c.sp / 100);
                  const isATM = Math.abs(strike - atm) < 5;
                  return (
                    <tr key={i} style={{ borderTop: `1px solid ${C.border}20`, background: isATM ? `${C.yellow}10` : 'none' }}>
                      <td style={{ textAlign: 'right', padding: '3px 6px', color: C.dim }}>{c.volume || 0}</td>
                      <td style={{ textAlign: 'right', padding: '3px 6px', fontFamily: 'monospace', color: C.text }}>{(c.oi || 0).toLocaleString()}</td>
                      <td style={{ textAlign: 'right', padding: '3px 6px', fontFamily: 'monospace', color: C.green }}>{c.ltp > 0 ? (c.ltp / 100).toFixed(2) : '—'}</td>
                      <td style={{ textAlign: 'center', padding: '3px 6px', fontFamily: 'monospace', color: isATM ? C.yellow : C.text, fontWeight: isATM ? 800 : 600 }}>{strike}</td>
                      <td style={{ textAlign: 'left', padding: '3px 6px', fontFamily: 'monospace', color: C.red }}>{pe?.ltp > 0 ? (pe.ltp / 100).toFixed(2) : '—'}</td>
                      <td style={{ textAlign: 'left', padding: '3px 6px', fontFamily: 'monospace', color: C.text }}>{(pe?.oi || 0).toLocaleString()}</td>
                      <td style={{ textAlign: 'left', padding: '3px 6px', color: C.dim }}>{pe?.volume || 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Connection status */}
      {error && <div style={{ color: C.red, fontSize: 10, textAlign: 'center' }}>{error}</div>}
    </div>
  );
}
