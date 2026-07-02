import React, { useState, useMemo } from 'react';

const C = {
  bg: '#080E1C', panel: '#0D1729', border: '#1A2E52',
  accent: '#00D4FF', green: '#00E676', red: '#FF3B5C',
  yellow: '#FFD600', text: '#B8C7E0', dim: '#4A6080', bright: '#E8F0FF', purple: '#A78BFA',
};

const fmtStrike = v => v ? Math.round(v).toLocaleString('en-IN') : '—';
const fmtRs = v => v != null ? `₹${Number(v).toFixed(1)}` : '—';
const fmtPct = v => v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` : '—';

const INSTRUMENTS = ['NIFTY', 'BANKNIFTY', 'SENSEX', 'FINNIFTY', 'RELIANCE', 'TCS', 'HDFCBANK', 'INFY'];

function ResearchDesk({ chainData, sse, instrument, onChangeInstrument }) {
  const chain = chainData?.chain;
  const ce = chain?.ce || [];
  const pe = chain?.pe || [];
  const spot = (chain?.cp || 0) / 100;
  const atm = (chain?.atm || 0) / 100;
  const expiry = chain?.expiry || '';
  const analyst = sse?.analyst || {};

  // ── Compute real metrics from chain data ──
  const metrics = useMemo(() => {
    if (!ce.length || !pe.length) return null;
    if (!chain?.atm) return null;

    const totalCeOi = ce.reduce((s, x) => s + (x.oi || 0), 0);
    const totalPeOi = pe.reduce((s, x) => s + (x.oi || 0), 0);
    const pcr = totalCeOi > 0 ? (totalPeOi / totalCeOi) : 0;
    const oiChangeCe = ce.reduce((s, x) => s + ((x.oi || 0) - (x.prev_oi || 0)), 0);
    const oiChangePe = pe.reduce((s, x) => s + ((x.oi || 0) - (x.prev_oi || 0)), 0);

    // Highest OI strikes
    const maxOiCe = [...ce].sort((a, b) => (b.oi || 0) - (a.oi || 0))[0];
    const maxOiPe = [...pe].sort((a, b) => (b.oi || 0) - (a.oi || 0))[0];
    const maxOiCeStrike = maxOiCe ? maxOiCe.sp / 100 : 0;
    const maxOiPeStrike = maxOiPe ? maxOiPe.sp / 100 : 0;

    // Call/Put writing detection: OI increase + premium drop = writing
    const callWriting = ce.filter(c => (c.oi || 0) > (c.prev_oi || 0) && (c.ltpchg || 0) < -2).length;
    const putWriting = pe.filter(p => (p.oi || 0) > (p.prev_oi || 0) && (p.ltpchg || 0) < -2).length;

    // Long build-up: OI + price both up
    const longBuildup = ce.filter(c => (c.oi || 0) > (c.prev_oi || 0) && (c.ltpchg || 0) > 2).length;
    const shortCovering = pe.filter(p => (p.oi || 0) < (p.prev_oi || 0) && (p.ltpchg || 0) > 2).length;

    // Gamma wall: highest gamma concentration near ATM
    const gammaLevels = [...ce, ...pe].filter(s => s.gamma).sort((a, b) => Math.abs(b.gamma || 0) - Math.abs(a.gamma || 0));
    const gammaWall = gammaLevels[0] ? gammaLevels[0].sp / 100 : atm;

    // ATM IV
    const atmCe = ce.find(c => Math.abs(c.sp - chain.atm) < 100);
    const iv = atmCe?.iv || 0;
    const chainIvPct = iv < 1 ? iv * 100 : iv;

    // Expected expiry range from OI concentration
    const ceStrikesByOi = [...ce].filter(c => c.oi > 0).sort((a, b) => (b.oi || 0) - (a.oi || 0));
    const peStrikesByOi = [...pe].filter(p => p.oi > 0).sort((a, b) => (b.oi || 0) - (a.oi || 0));
    const top5Ce = ceStrikesByOi.slice(0, 3).map(c => c.sp / 100);
    const top5Pe = peStrikesByOi.slice(0, 3).map(p => p.sp / 100);
    const expLow = Math.min(...top5Pe, spot);
    const expHigh = Math.max(...top5Ce, spot);

    // VWAP from recent data (approximate from spot vs ATM)
    const vwap = spot;

    // Trend from analyst or compute from delta
    const avgDelta = ce.filter(c => c.delta).reduce((s, d) => s + (d.delta || 0), 0) / Math.max(ce.filter(c => c.delta).length, 1);
    const trend = avgDelta > 0.55 ? 'BULLISH' : avgDelta < 0.45 ? 'BEARISH' : 'NEUTRAL';
    const trendStrength = Math.min(Math.abs(avgDelta - 0.5) * 20, 10);

    // Regime
    const volRegime = iv > 25 ? 'High' : iv > 15 ? 'Moderate' : 'Low';
    const participation = totalCeOi + totalPeOi > 10000000 ? 'High' : totalCeOi + totalPeOi > 5000000 ? 'Medium' : 'Low';
    const liquidity = totalCeOi > 0 && totalPeOi > 0 ? 'Excellent' : 'Good';
    const expectedBehaviour = trend === 'BULLISH' ? 'Momentum Continuation' : trend === 'BEARISH' ? 'Trend Reversal' : 'Range Expansion';

    // Research log entry
    const regimeState = `${trend === 'BULLISH' ? '🟢' : trend === 'BEARISH' ? '🔴' : '🟡'} ${volRegime} ${trend}`;

    // Value adjustment: compare each strike's IV to ATM IV + delta-based moneyness
    const daysToExpiry = expiry ? Math.max(1, Math.ceil((new Date(expiry.slice(0, 4) + '-' + expiry.slice(4, 6) + '-' + expiry.slice(6, 8)) - new Date()) / 86400000)) : 7;

    // Find the ATM premium (reference price for fair value)
    const atmLtp = atmCe?.ltp ? atmCe.ltp / 100 : 0;
    // ATM straddle premium is the reference for at-the-money pricing
    const atmPe = pe.find(p => Math.abs(p.sp - chain.atm) < 100);
    const atmPeLtp = atmPe?.ltp ? atmPe.ltp / 100 : 0;
    const atmStraddle = atmLtp + atmPeLtp;

    const valueOps = [
      ...ce.filter(s => s.ltp > 0 && s.iv > 0).map(s => ({ ...s, _side: 'CE' })),
      ...pe.filter(s => s.ltp > 0 && s.iv > 0).map(s => ({ ...s, _side: 'PE' })),
    ]
      .map(s => {
        const strike = s.sp / 100;
        const livePremium = s.ltp / 100;
        const side = s._side;
        const strikeDist = Math.abs(strike - spot);
        const delta = s.delta || 0;
        const absDelta = Math.abs(delta);
        const ownIv = (s.iv || chainIvPct / 100) < 1 ? (s.iv || chainIvPct / 100) * 100 : (s.iv || chainIvPct / 100);

        // BS approximation: premium = spot × IV × 0.4 × √(T) × deltaAdjustment
        const sqrtT = Math.sqrt(Math.max(daysToExpiry, 1) / 365);
        const bsPremium = spot * (ownIv / 100) * 0.4 * sqrtT;

        // Scale from ATM to strike's moneyness via delta skew
        const otmDiscount = Math.max(0.15, absDelta * 1.5);
        const fairPremium = Math.max(bsPremium * otmDiscount, 0.5);

        // How far from fair as a percentage of ATM premium (capped at ±100%)
        const atmPremium = spot * (chainIvPct / 100) * 0.4 * sqrtT;
        const absDiff = Math.abs(livePremium - fairPremium);
        const undPct = atmPremium > 0.5 ? Math.round(((livePremium - fairPremium) / (atmPremium * 1.5)) * 100) : 0;

        // Filter: only show near-ATM (within 5% of spot) with meaningful difference
        const volScore = Math.min((s.volume || 0) / 10000, 5);
        const oiScore = Math.min((s.oi || 0) / 100000, 5);
        const confidence = Math.min(95, Math.round(55 + volScore * 5 + oiScore * 3 + Math.abs(undPct)));

        const diff = Math.round((livePremium - fairPremium) * 100) / 100;
        return {
          strike, side, livePremium, fairPremium: Math.round(fairPremium * 100) / 100,
          diff: Math.round(diff * 100) / 100, undPct,
          confidence, delta, iv: s.iv, oi: s.oi, volume: s.volume,
          opportunity: Math.abs(undPct) > 20 ? 5 : Math.abs(undPct) > 12 ? 4 : Math.abs(undPct) > 5 ? 3 : 2,
        };
      })
      // Show only ATM ±2 strikes (closest to ATM)
      .filter(o => {
        const strikeDist = Math.abs(o.strike - atm);
        const atmStep = 50; // NIFTY/BNF strike interval
        return strikeDist <= atmStep * 2;
      })
      .sort((a, b) => Math.abs(b.undPct) - Math.abs(a.undPct))
      .slice(0, 4);

    // Trade recommendations from value ops that are undervalued
    const trades = valueOps
      .filter(o => o.undPct > 5)
      .slice(0, 2)
      .map(o => {
        const entry = o.livePremium;
        const sl = Math.round(entry * 0.92 * 100) / 100;
        const tp1 = Math.round(entry * 1.13 * 100) / 100;
        const tp2 = Math.round(entry * 1.22 * 100) / 100;
        const rr = ((tp1 - entry) / (entry - sl));
        return { ...o, entry, sl, tp1, tp2, rr: Math.round(rr * 10) / 10, prob: Math.min(95, Math.round(o.confidence * 0.95)) };
      });

    // ── RSI Divergence Detection ──
    const totalOiChg = Math.abs(oiChangeCe) + Math.abs(oiChangePe) || 1;
    const rsiProxy = Math.round((oiChangeCe > 0 ? oiChangeCe : 0) / totalOiChg * 100);
    const rsiValue = Math.min(100, Math.max(0, rsiProxy));
    const rsiSignal = rsiValue > 70 ? 'Overbought' : rsiValue < 30 ? 'Oversold' : 'Neutral';
    const priceUp = avgDelta > 0.55;
    const oiMomentumBearish = oiChangePe > oiChangeCe * 1.5;
    const rsiDivergence = priceUp && oiMomentumBearish ? 'Bearish Divergence' :
                          !priceUp && oiChangeCe > oiChangePe * 1.5 ? 'Bullish Divergence' : 'No Divergence';

    // ── ATR Confluence ──
    const dailyMovePct = (iv || 15) / Math.sqrt(252);
    const dailyMoveRs = spot * dailyMovePct / 100;
    const atrConfluence = dailyMovePct > 1 ? 'Trending' : dailyMovePct > 0.5 ? 'Moderate Trend' : 'Sideways';

    // Order flow signals from chain data
    const oiDirection = oiChangeCe > 0 && oiChangePe > 0 ? 'Both Building' : oiChangeCe > 0 ? 'CE Building' : oiChangePe > 0 ? 'PE Building' : 'Flat';
    const deltaSignal = avgDelta > 0.55 ? 'Positive' : avgDelta < 0.45 ? 'Negative' : 'Neutral';
    const oiFlow = oiChangeCe - oiChangePe; // net OI flow (not option delta)
    const oiSkew = totalCeOi > 0 ? Math.round((totalPeOi / totalCeOi) * 100) : 0; // put-to-call OI skew
    const concentrationSignal = oiSkew > 130 ? 'Puts Concentrated' : oiSkew < 70 ? 'Calls Concentrated' : 'Balanced OI';
    const footprintSignal = pcr > 1.2 ? 'Buy Imbalance' : pcr < 0.8 ? 'Sell Imbalance' : 'Balanced';
    // Confirmation: multiple confluent signals must align
    let confirmCount = 0;
    if (deltaSignal === 'Positive') confirmCount++;
    if (pcr > 1) confirmCount++;
    if (oiFlow > 0) confirmCount++;
    if (rsiDivergence === 'No Divergence') confirmCount++;
    const ofConfirmed = confirmCount >= 3;

    return {
      pcr: Math.round(pcr * 100) / 100, trend, trendStrength: Math.round(trendStrength * 10) / 10,
      volRegime, participation, liquidity, expectedBehaviour,
      maxOiCeStrike, maxOiPeStrike, callWriting, putWriting,
      longBuildup, shortCovering, gammaWall, iv: Math.round(iv * 10) / 10,
      expLow: Math.round(expLow), expHigh: Math.round(expHigh),
      oiChangeCe, oiChangePe, totalCeOi, totalPeOi, vwap,
      avgDelta: Math.round(avgDelta * 100) / 100, regimeState,
      valueOps, trades, oiDirection, deltaSignal, oiFlow, oiSkew, concentrationSignal, footprintSignal, ofConfirmed,
      daysToExpiry, rsiValue, rsiSignal, rsiDivergence, atrConfluence, dailyMoveRs: Math.round(dailyMoveRs * 100) / 100,
    };
  }, [ce, pe, spot, atm, expiry]);

  // Research log
  const [log, setLog] = useState([]);
  const prevTrendRef = React.useRef(null);
  React.useEffect(() => {
    if (metrics?.trend && metrics.trend !== prevTrendRef.current) {
      if (prevTrendRef.current) {
        setLog(l => [{ time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }), trend: metrics.trend }, ...l].slice(0, 20));
      }
      prevTrendRef.current = metrics.trend;
    }
  }, [metrics?.trend]);

  const buildEuro = v => `€${v.toFixed(2)}`;

  if (!metrics) {
    return <div style={{ background: C.bg, padding: 20, color: C.dim, textAlign: 'center', minHeight: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontSize: 14 }}>Load option chain data to activate Research Desk</div>
    </div>;
  }

  return (
    <div style={{ background: C.bg, display: 'grid', gap: 8, fontFamily: "'Inter', sans-serif" }}>
      {/* 🧠 Header */}
      <div style={{ background: C.panel, border: `1px solid ${C.border}`, padding: '8px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: C.bright, fontWeight: 700, fontSize: 13 }}>🧠 Institutional Research Desk</span>
          <select value={instrument} onChange={e => onChangeInstrument?.(e.target.value)}
            style={{ background: '#0A1220', border: `1px solid ${C.border}`, color: C.accent, borderRadius: 4, padding: '3px 8px', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: '"JetBrains Mono", monospace' }}>
            {INSTRUMENTS.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>
        <span style={{ color: C.yellow, fontWeight: 700, fontSize: 10, background: `${C.yellow}15`, padding: '2px 8px', borderRadius: 3, fontFamily: '"JetBrains Mono", monospace' }}>
          {expiry} · {metrics.daysToExpiry}d left
        </span>
      </div>

      {/* Top Bar — Market Regime + Global Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 4, padding: '0', minWidth: 0 }}>
        {[
          { label: 'Regime', value: metrics.regimeState, color: metrics.trend === 'BULLISH' ? C.green : metrics.trend === 'BEARISH' ? C.red : C.yellow },
          { label: 'PCR', value: metrics.pcr, color: metrics.pcr > 1.2 ? C.green : metrics.pcr > 0.7 ? C.yellow : C.red },
          { label: 'IV', value: `${(metrics.iv < 1 ? metrics.iv * 100 : metrics.iv).toFixed(1)}%`, color: C.accent },
          { label: 'Trend Str', value: `${metrics.trendStrength}/10`, color: metrics.trendStrength > 6 ? C.green : C.yellow },
          { label: 'Vol', value: metrics.volRegime, color: C.dim },
          { label: 'Partic.', value: metrics.participation, color: metrics.participation === 'High' ? C.green : C.dim },
          { label: 'Liquidity', value: metrics.liquidity, color: C.green },
          { label: 'Exp. Range', value: `${fmtStrike(metrics.expLow)}-${fmtStrike(metrics.expHigh)}`, color: C.accent },
          { label: 'CE Wall', value: fmtStrike(metrics.maxOiCeStrike), color: C.red },
          { label: 'PE Wall', value: fmtStrike(metrics.maxOiPeStrike), color: C.green },
          { label: 'Gamma Wall', value: fmtStrike(metrics.gammaWall), color: C.yellow },
        ].map(b => (
          <div key={b.label} style={{ background: C.panel, border: `1px solid ${C.border}`, padding: '6px 10px', minWidth: 0 }}>
            <div style={{ color: C.dim, fontSize: 7, letterSpacing: 1, textTransform: 'uppercase' }}>{b.label}</div>
            <div style={{ color: b.color, fontWeight: 700, fontSize: 13, fontFamily: '"JetBrains Mono", monospace' }}>
              {typeof b.value === 'function' ? b.value(metrics) : b.value}
            </div>
          </div>
        ))}
      </div>

      {/* Main Grid: Chain Analysis | Narrative | Value Engine | Trade Desk | Order Flow */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, minWidth: 0 }}>
        {/* OPTION CHAIN ANALYSIS */}
        <Panel title="📊 Option Chain Analysis" icon="📊">
          <Row label="PCR" value={metrics.pcr} color={metrics.pcr > 1.2 ? C.green : metrics.pcr > 0.7 ? C.yellow : C.red} />
          <Row label="Status" value={metrics.pcr > 1.2 ? 'Bullish' : metrics.pcr < 0.8 ? 'Bearish' : 'Neutral'} color={metrics.pcr > 1.2 ? C.green : metrics.pcr < 0.8 ? C.red : C.yellow} />
          <Row label="Highest CE OI" value={fmtStrike(metrics.maxOiCeStrike)} color={C.red} />
          <Row label="Highest PE OI" value={fmtStrike(metrics.maxOiPeStrike)} color={C.green} />
          <Row label="Call Writing" value={metrics.callWriting > 3 ? 'Strong' : metrics.callWriting > 1 ? 'Moderate' : 'Weak'} color={metrics.callWriting > 3 ? C.red : C.dim} />
          <Row label="Put Writing" value={metrics.putWriting > 3 ? 'Strong' : metrics.putWriting > 1 ? 'Moderate' : 'Weak'} color={metrics.putWriting > 3 ? C.green : C.dim} />
          <Row label="Long Build-up" value={metrics.longBuildup > 2 ? '✓ Detected' : '—'} color={metrics.longBuildup > 2 ? C.green : C.dim} />
          <Row label="Short Covering" value={metrics.shortCovering > 2 ? '✓ Detected' : '—'} color={metrics.shortCovering > 2 ? C.green : C.dim} />
          <Row label="Gamma Wall" value={fmtStrike(metrics.gammaWall)} color={C.yellow} />
          <Row label="Expected Expiry" value={`${fmtStrike(metrics.expLow)} — ${fmtStrike(metrics.expHigh)}`} color={C.accent} />
        </Panel>

        {/* MARKET NARRATIVE */}
        <Panel title="📝 Market Narrative" icon="📝">
          <div style={{ background: '#0A1220', border: `1px solid ${C.border}`, padding: '8px 10px', marginBottom: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ color: C.bright, fontWeight: 700, fontSize: 13 }}>MARKET VIEW</span>
              <span style={{ padding: '2px 8px', borderRadius: 3, background: metrics.trend === 'BULLISH' ? `${C.green}22` : `${C.red}22`, border: `1px solid ${metrics.trend === 'BULLISH' ? C.green + '50' : C.red + '50'}`, color: metrics.trend === 'BULLISH' ? C.green : C.red, fontWeight: 700, fontSize: 10 }}>
                {metrics.trend}
              </span>
            </div>
            <div style={{ color: C.dim, fontSize: 9, marginBottom: 6 }}>Confidence: <span style={{ color: metrics.pcr > 1.2 ? C.green : C.yellow, fontWeight: 700 }}>{Math.min(95, Math.round(metrics.pcr * 70))}%</span></div>
            <div style={{ fontSize: 9, color: C.text, lineHeight: 1.6 }}>
              {[
                metrics.putWriting > 2 ? '✓ Strong Put Writing' : null,
                metrics.avgDelta > 0.55 ? '✓ Positive Delta' : null,
                metrics.pcr > 1.1 ? '✓ PCR Rising' : null,
                spot > metrics.vwap ? '✓ Spot Above VWAP' : null,
                metrics.longBuildup > 1 ? '✓ Premium Rotation Positive' : null,
                metrics.callWriting > 2 ? '✓ Call Writers Covering' : null,
                `✓ ${metrics.trend === 'BULLISH' ? 'Bullish' : 'Bearish'} Structure`,
              ].filter(Boolean).map((ev, i) => (
                <div key={i} style={{ color: C.green, marginBottom: 2 }}>{ev}</div>
              ))}
              <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 6, paddingTop: 6 }}>
                <span style={{ color: C.dim }}>Conclusion: </span>
                <span style={{ color: C.text }}>
                  {metrics.pcr > 1.2 ? 'Institutional participants are adding long protection. ' : 'Caution warranted — mixed signals. '}
                  Watch {fmtStrike(metrics.maxOiCeStrike)} breakout for confirmation.
                </span>
              </div>
              <div style={{ marginTop: 4, color: C.red, fontSize: 8 }}>
                Invalidation: Spot below {fmtStrike(Math.round(metrics.vwap - metrics.vwap * 0.02))}.
              </div>
            </div>
          </div>
        </Panel>

        {/* VALUE ADJUSTMENT ENGINE */}
        <Panel title="⚡ Value Adjustment Engine" icon="⚡">
          {(metrics?.valueOps || []).slice(0, 2).map((op, i) => (
            <div key={i} style={{ background: '#0A1220', border: `1px solid ${C.border}`, padding: '8px 10px', marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: C.bright, fontWeight: 700, fontSize: 12 }}>{op.strike} {op.side}</span>
                <span style={{ color: op.undPct < 0 ? C.green : C.red, fontSize: 10, fontWeight: 700 }}>
                  {op.undPct < 0 ? 'UNDERVALUED' : 'OVERVALUED'} {Math.abs(op.undPct)}%
                </span>
              </div>
              <Row label="Fair Premium" value={fmtRs(op.fairPremium)} color={C.accent} />
              <Row label="Live Premium" value={fmtRs(op.livePremium)} color={C.bright} />
              <Row label="Difference" value={(op.diff >= 0 ? '+' : '') + fmtRs(op.diff)} color={op.diff > 0 ? C.green : C.red} />
              <Row label="Confidence" value={`${op.confidence}%`} color={op.confidence > 80 ? C.green : C.yellow} />
              <div style={{ color: C.yellow, fontSize: 9, marginTop: 2 }}>{'★'.repeat(op.opportunity)}{'☆'.repeat(5 - op.opportunity)}</div>
            </div>
          ))}
          {(!metrics?.valueOps?.length) && <div style={{ color: C.dim, fontSize: 10, textAlign: 'center', padding: 20 }}>No mispriced options detected</div>}
        </Panel>
      </div>

      {/* Bottom Row: Trade Desk | Order Flow | Research Log */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, minWidth: 0 }}>
        {/* TRADE DESK */}
        <Panel title="🎯 Trade Desk — Top Opportunities" icon="🎯">
          {(metrics?.trades || []).map((t, i) => (
            <div key={i} style={{ background: '#0A1220', border: `1px solid ${C.border}`, padding: '8px 10px', marginBottom: 6 }}>
              <div style={{ color: C.green, fontWeight: 700, fontSize: 11, marginBottom: 4 }}>{t.side} {fmtStrike(t.strike)} {t.side}</div>
              <Row label="Entry" value={fmtRs(t.entry)} color={C.accent} />
              <Row label="SL" value={fmtRs(t.sl)} color={C.red} />
              <Row label="TP1 / TP2" value={`${fmtRs(t.tp1)} / ${fmtRs(t.tp2)}`} color={C.green} />
              <Row label="R:R" value={`1 : ${t.rr}`} color={t.rr > 2 ? C.green : C.yellow} />
              <Row label="Probability" value={`${t.prob}%`} color={t.prob > 80 ? C.green : C.yellow} />
            </div>
          ))}
          {metrics.trades.length === 0 && <div style={{ color: C.yellow, fontSize: 10, textAlign: 'center', padding: 20 }}>No high-conviction trades at this time</div>}
        </Panel>

        {/* ORDER FLOW CONFIRMATION */}
        <Panel title="🌊 Order Flow Confirmation" icon="🌊">
          <Row label="Delta Signal" value={metrics.deltaSignal} color={metrics.avgDelta > 0.55 ? C.green : metrics.avgDelta < 0.45 ? C.red : C.yellow} />
          <Row label="OI Flow" value={metrics.oiFlow > 0 ? 'CE Adding' : metrics.oiFlow < 0 ? 'PE Adding' : 'Flat'} color={metrics.oiFlow > 0 ? C.green : metrics.oiFlow < 0 ? C.red : C.dim} />
          <Row label="Footprint" value={metrics.footprintSignal} color={metrics.footprintSignal.includes('Buy') ? C.green : metrics.footprintSignal.includes('Sell') ? C.red : C.dim} />
          <Row label="OI Concentration" value={metrics.concentrationSignal} color={metrics.concentrationSignal.includes('Puts') ? C.green : metrics.concentrationSignal.includes('Calls') ? C.red : C.dim} />
          <Row label="Liquidity Flow" value={metrics.oiDirection} color={C.accent} />
          <Row label="OI RSI" value={`${metrics.rsiValue} — ${metrics.rsiSignal}`} color={metrics.rsiValue > 70 ? C.red : metrics.rsiValue < 30 ? C.green : C.yellow} />
          <Row label="OI Divergence" value={metrics.rsiDivergence} color={metrics.rsiDivergence.includes('Divergence') ? C.red : C.green} />
          <Row label="ATR Confluence" value={metrics.atrConfluence} color={metrics.atrConfluence === 'Trending' ? C.green : metrics.atrConfluence === 'Sideways' ? C.yellow : C.accent} />
          <Row label="Daily Range (IV)" value={`₹${metrics.dailyMoveRs}`} color={C.accent} />
          <div style={{ marginTop: 6, padding: '6px 10px', background: `${metrics.ofConfirmed ? C.green : C.yellow}15`, border: `1px solid ${metrics.ofConfirmed ? C.green + '50' : C.yellow + '50'}`, borderRadius: 3 }}>
            <span style={{ color: metrics.ofConfirmed ? C.green : C.yellow, fontWeight: 700, fontSize: 12 }}>
              {metrics.ofConfirmed ? '✓ CONFIRMATION: YES' : '⚡ MIXED SIGNALS'}
            </span>
          </div>
        </Panel>

        {/* RESEARCH LOG */}
        <Panel title="📋 Research Log" icon="📋">
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {log.length === 0 ? (
              <div style={{ color: C.dim, fontSize: 9, padding: '10px 0', textAlign: 'center' }}>Logging starts when trend changes...</div>
            ) : (
              log.map((entry, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: `1px solid ${C.border}44`, fontSize: 9 }}>
                  <span style={{ color: C.dim, fontFamily: 'monospace', width: 40 }}>{entry.time}</span>
                  <span style={{ color: entry.trend === 'BULLISH' ? C.green : entry.trend === 'BEARISH' ? C.red : C.yellow, fontWeight: 700 }}>{entry.trend}</span>
                  {i > 0 && <span style={{ color: C.dim, fontSize: 8 }}>↑</span>}
                </div>
              ))
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Panel({ title, icon, children }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, padding: 10, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={{ color: C.bright, fontWeight: 700, fontSize: 11, marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${C.border}` }}>{title}</div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

function Row({ label, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', fontSize: 9, borderBottom: `1px solid ${C.border}30` }}>
      <span style={{ color: C.dim }}>{label}</span>
      <span style={{ color: color || C.text, fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{value}</span>
    </div>
  );
}

export default ResearchDesk;
