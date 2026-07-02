import React, { useMemo } from 'react';

const C = {
  bg: "#080E1C", panel: "#0D1729", border: "#1A2E52",
  accent: "#00D4FF", green: "#00E676", red: "#FF3B5C",
  yellow: "#FFD600", text: "#B8C7E0", dim: "#4A6080", bright: "#E8F0FF",
};

const fmt = v => v != null ? `₹${Number(v).toFixed(1)}` : '—';

function getLTP(chain, strike, type) {
  if (!chain) return 0;
  const arr = type === 'CE' ? chain.ce : chain.pe;
  const opt = arr?.find(o => Math.round((o.sp || 0) / 100) === strike);
  return opt ? (opt.ltp || 0) / 100 : 0;
}

function SpreadOptimizer({ chainData, spot, onLoadTemplate }) {
  const chain = chainData?.chain;
  const atm = Math.round((chain?.atm || 0) / 100);

  // Detect actual step from chain data
  const step = useMemo(() => {
    if (!chain?.ce?.length) return 50;
    const strikes = chain.ce.map(c => Math.round((c.sp || 0) / 100)).sort((a, b) => a - b);
    for (let i = 1; i < strikes.length; i++) {
      const diff = strikes[i] - strikes[i - 1];
      if (diff > 0) return diff;
    }
    return 50;
  }, [chain]);

  // Compute all spread combinations for each template at ±1,2,3,4 step
  const spreads = useMemo(() => {
    if (!chain || !spot || !atm) return [];
    const results = [];

    const templates = [
      {
        name: 'Bull Call Spread', risk: 'Low',
        gen: (a, s) => [
          { side: 'BUY', type: 'CE', strike: a - s },
          { side: 'SELL', type: 'CE', strike: a + s },
        ],
      },
      {
        name: 'Bear Put Spread', risk: 'Low',
        gen: (a, s) => [
          { side: 'BUY', type: 'PE', strike: a + s },
          { side: 'SELL', type: 'PE', strike: a - s },
        ],
      },
      {
        name: 'Short Straddle', risk: 'High',
        gen: (a) => [
          { side: 'SELL', type: 'CE', strike: a },
          { side: 'SELL', type: 'PE', strike: a },
        ],
      },
      {
        name: 'Iron Condor', risk: 'Medium',
        gen: (a, s) => [
          { side: 'BUY', type: 'PE', strike: a - s * 3 },
          { side: 'SELL', type: 'PE', strike: a - s },
          { side: 'SELL', type: 'CE', strike: a + s },
          { side: 'BUY', type: 'CE', strike: a + s * 3 },
        ],
      },
      {
        name: 'Bull Put Spread', risk: 'Low',
        gen: (a, s) => [
          { side: 'SELL', type: 'PE', strike: a - s },
          { side: 'BUY', type: 'PE', strike: a - s * 2 },
        ],
      },
      {
        name: 'Bear Call Spread', risk: 'Low',
        gen: (a, s) => [
          { side: 'SELL', type: 'CE', strike: a + s },
          { side: 'BUY', type: 'CE', strike: a + s * 2 },
        ],
      },
      {
        name: 'Long Straddle', risk: 'High',
        gen: (a) => [
          { side: 'BUY', type: 'CE', strike: a },
          { side: 'BUY', type: 'PE', strike: a },
        ],
      },
    ];

    for (const t of templates) {
      // Generate variations at different step widths
      const widths = t.name.includes('Straddle') ? [null] : [1, 2, 3, 4];
      for (const mult of widths) {
        const s = mult ? step * mult : step;
        const rawLegs = t.gen(atm, s);
        const legs = rawLegs.map(l => ({ ...l, premium: getLTP(chain, l.strike, l.type) }));

        // Skip if any leg has 0 premium (strike not tradeable or out of range)
        if (legs.some(l => l.premium <= 0)) continue;

        let netPremium = 0;
        for (const leg of legs) netPremium += (leg.side === 'BUY' ? -1 : 1) * leg.premium;

        let maxProfit = 0, maxLoss = 0;
        const isDebit = netPremium < 0;
        const netAbs = Math.abs(netPremium);

        if (t.name === 'Bull Call Spread' || t.name === 'Bear Put Spread') {
          // Debit spread: max loss = premium paid, max profit = width - premium
          maxLoss = netAbs;
          maxProfit = s - netAbs;
        } else if (t.name === 'Bull Put Spread' || t.name === 'Bear Call Spread') {
          // Credit spread: max profit = premium received, max loss = width - premium
          maxProfit = netAbs;
          maxLoss = s - netAbs;
        } else if (t.name === 'Iron Condor') {
          maxProfit = netAbs;
          maxLoss = s * 2 - netAbs;
        } else if (t.name === 'Short Straddle') {
          maxProfit = netAbs;
          maxLoss = Math.max(s * 3, spot * 0.05);
        } else if (t.name === 'Long Straddle') {
          maxLoss = netAbs;
          maxProfit = spot * 0.1;
        }

        const roi = maxLoss > 0 ? (maxProfit / maxLoss) * 100 : 0;

        results.push({
          name: t.name,
          risk: t.risk,
          variation: mult ? `±${mult} step (${step * mult}pts)` : 'ATM',
          legs,
          netPremium: Math.round(netPremium * 100) / 100,
          maxProfit: Math.round(maxProfit * 100) / 100,
          maxLoss: Math.round(maxLoss * 100) / 100,
          roi: Math.round(roi),
          direction: isDebit ? 'DEBIT' : 'CREDIT',
        });
      }
    }

    // Sort by ROI desc, then by name
    return results.sort((a, b) => b.roi - a.roi || a.name.localeCompare(b.name));
  }, [chain, spot, atm, step]);

  if (!chain) {
    return (
      <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20, minHeight: 300 }}>
        <div style={{ color: C.bright, fontWeight: 700, fontSize: 15, marginBottom: 16 }}>📊 Spread Optimizer</div>
        <div style={{ color: C.dim, fontSize: 12, textAlign: 'center', padding: 40 }}>Load option chain data to see live spreads</div>
      </div>
    );
  }

  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20, minHeight: 300 }}>
      <div style={{ color: C.bright, fontWeight: 700, fontSize: 15, marginBottom: 16 }}>
        📊 Spread Optimizer <span style={{ color: C.dim, fontWeight: 400, fontSize: 11 }}>— Live from chain</span>
      </div>
      <div style={{ color: C.dim, fontSize: 10, marginBottom: 12 }}>
        Spot: <span style={{ color: C.bright, fontFamily: 'monospace' }}>{fmt(spot)}</span>
        {' | '}ATM: <span style={{ color: C.yellow, fontFamily: 'monospace' }}>{atm}</span>
        {' | '}Step: <span style={{ color: C.accent }}>{step}</span>
        {' | '}Strategies: <span style={{ color: C.green }}>{spreads.length}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
        {spreads.slice(0, 20).map((s, i) => (
          <div key={i} style={{
            border: `1px solid ${i < 3 ? C.green + '60' : C.border}`,
            borderRadius: 8, padding: 12,
            background: i < 3 ? `${C.green}08` : 'none',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <div>
                <span style={{ fontWeight: 700, color: C.bright, fontSize: 12 }}>{s.name}</span>
                <span style={{ color: C.dim, fontSize: 9, marginLeft: 8 }}>{s.variation}</span>
              </div>
              <span>
                <span style={{
                  color: s.direction === 'CREDIT' ? C.green : C.red,
                  fontSize: 10, fontWeight: 700, marginRight: 8,
                  background: `${s.direction === 'CREDIT' ? C.green : C.red}18`,
                  padding: '1px 6px', borderRadius: 3,
                }}>{s.netPremium >= 0 ? '+' : ''}{fmt(s.netPremium)} {s.direction}</span>
                <span style={{ color: C.accent, fontWeight: 600, fontSize: 10, marginLeft: 4 }}>Risk: {s.risk}</span>
              </span>
            </div>

            {/* Legs table */}
            <table style={{ width: '100%', fontSize: 9, borderCollapse: 'collapse', marginBottom: 6 }}>
              <thead><tr style={{ color: C.dim, fontSize: 8 }}>
                <th style={{ textAlign: 'left', padding: '2px 6px' }}>Leg</th>
                <th style={{ textAlign: 'center', padding: '2px 6px', width: 40 }}>Side</th>
                <th style={{ textAlign: 'right', padding: '2px 6px', width: 50 }}>Strike</th>
                <th style={{ textAlign: 'right', padding: '2px 6px', width: 50 }}>Premium</th>
                <th style={{ textAlign: 'center', padding: '2px 6px', width: 30 }}>Type</th>
              </tr></thead>
              <tbody>
                {s.legs.map((leg, li) => (
                  <tr key={li} style={{ borderTop: `1px solid ${C.border}20` }}>
                    <td style={{ padding: '2px 6px', color: C.dim, fontSize: 8 }}>{leg.side === 'BUY' ? 'Long' : 'Short'}</td>
                    <td style={{ textAlign: 'center', padding: '2px 6px' }}>
                      <span style={{ color: leg.side === 'BUY' ? C.green : C.red, fontWeight: 700 }}>{leg.side}</span>
                    </td>
                    <td style={{ textAlign: 'right', padding: '2px 6px', fontFamily: 'monospace', color: C.bright }}>{leg.strike}</td>
                    <td style={{ textAlign: 'right', padding: '2px 6px', fontFamily: 'monospace', color: C.accent }}>{fmt(leg.premium)}</td>
                    <td style={{ textAlign: 'center', padding: '2px 6px', color: C.dim }}>{leg.type}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* P&L + POP row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6, fontSize: 9, padding: '4px 8px', background: C.bg, borderRadius: 4, marginBottom: 6 }}>
              <div>
                <div style={{ color: C.dim, fontSize: 7 }}>Max Profit</div>
                <div style={{ color: C.green, fontWeight: 700, fontFamily: 'monospace' }}>{fmt(s.maxProfit)}</div>
              </div>
              <div>
                <div style={{ color: C.dim, fontSize: 7 }}>Max Loss</div>
                <div style={{ color: C.red, fontWeight: 700, fontFamily: 'monospace' }}>{fmt(s.maxLoss)}</div>
              </div>
              <div>
                <div style={{ color: C.dim, fontSize: 7 }}>R:R</div>
                <div style={{ color: C.yellow, fontWeight: 700, fontFamily: 'monospace' }}>
                  {s.maxLoss > 0 ? `1:${(s.maxProfit / s.maxLoss).toFixed(1)}` : '∞'}
                </div>
              </div>
              <div>
                <div style={{ color: C.dim, fontSize: 7 }}>ROI</div>
                <div style={{
                  color: s.roi > 100 ? C.green : s.roi > 30 ? C.yellow : C.dim,
                  fontWeight: 700, fontFamily: 'monospace',
                }}>{s.roi}%</div>
              </div>
            </div>

            {onLoadTemplate && (
              <button onClick={() => onLoadTemplate?.(s.name)}
                style={{ padding: '4px 12px', borderRadius: 4, background: `${C.accent}22`, border: `1px solid ${C.accent}50`, color: C.accent, cursor: 'pointer', fontSize: 9, fontWeight: 600 }}>
                Load in Builder →
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default SpreadOptimizer;
