import React, { useState, useMemo, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { usePaperTradeStore } from '../stores/paperTradeStore';

const C = {
  bg: "#080E1C", panel: "#0D1729", border: "#1A2E52",
  accent: "#00D4FF", green: "#00E676", red: "#FF3B5C",
  yellow: "#FFD600", text: "#B8C7E0", dim: "#4A6080", bright: "#E8F0FF",
};

const fmtRs = v => v != null ? `₹${Number(v).toFixed(1)}` : '—';
const fmtPct = v => v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '—';

// ─── TEMPLATE DEFINITIONS ───
const TEMPLATES = {
  'Bull Call Spread': {
    legs: [
      { side: 'BUY', type: 'CE', offsetStrike: 0, label: 'Long Call' },
      { side: 'SELL', type: 'CE', offsetStrike: 1, label: 'Short Call' },
    ],
    params: { width: 1 },
  },
  'Bear Put Spread': {
    legs: [
      { side: 'SELL', type: 'PE', offsetStrike: 0, label: 'Short Put' },
      { side: 'BUY', type: 'PE', offsetStrike: -1, label: 'Long Put' },
    ],
    params: { width: 1 },
  },
  'Straddle': {
    legs: [
      { side: 'BUY', type: 'CE', offsetStrike: 0, label: 'Long Call' },
      { side: 'BUY', type: 'PE', offsetStrike: 0, label: 'Long Put' },
    ],
    params: {},
  },
  'Strangle': {
    legs: [
      { side: 'BUY', type: 'CE', offsetStrike: 1, label: 'Long Call (OTM)' },
      { side: 'BUY', type: 'PE', offsetStrike: -1, label: 'Long Put (OTM)' },
    ],
    params: { width: 1 },
  },
  'Iron Condor': {
    legs: [
      { side: 'SELL', type: 'CE', offsetStrike: 1, label: 'Short Call' },
      { side: 'BUY', type: 'CE', offsetStrike: 2, label: 'Long Call' },
      { side: 'SELL', type: 'PE', offsetStrike: -1, label: 'Short Put' },
      { side: 'BUY', type: 'PE', offsetStrike: -2, label: 'Long Put' },
    ],
    params: { width: 1 },
  },
  'Iron Butterfly': {
    legs: [
      { side: 'SELL', type: 'CE', offsetStrike: 0, label: 'Short Call (ATM)' },
      { side: 'BUY', type: 'CE', offsetStrike: 1, label: 'Long Call (OTM)' },
      { side: 'SELL', type: 'PE', offsetStrike: 0, label: 'Short Put (ATM)' },
      { side: 'BUY', type: 'PE', offsetStrike: -1, label: 'Long Put (OTM)' },
    ],
    params: { width: 1 },
  },
  'Covered Call': {
    legs: [
      { side: 'BUY', type: 'STOCK', offsetStrike: 0, label: 'Buy Stock' },
      { side: 'SELL', type: 'CE', offsetStrike: 1, label: 'Short Call' },
    ],
    params: { width: 1 },
  },
  'Bull Put Spread': {
    legs: [
      { side: 'SELL', type: 'PE', offsetStrike: 0, label: 'Short Put' },
      { side: 'BUY', type: 'PE', offsetStrike: -1, label: 'Long Put' },
    ],
    params: { width: 1 },
  },
  'Bear Call Spread': {
    legs: [
      { side: 'SELL', type: 'CE', offsetStrike: 0, label: 'Short Call' },
      { side: 'BUY', type: 'CE', offsetStrike: 1, label: 'Long Call' },
    ],
    params: { width: 1 },
  },
  'Jade Lizard': {
    legs: [
      { side: 'SELL', type: 'CE', offsetStrike: 0, label: 'Short Call' },
      { side: 'BUY', type: 'CE', offsetStrike: 1, label: 'Long Call' },
      { side: 'SELL', type: 'PE', offsetStrike: -1, label: 'Short Put' },
    ],
    params: { wingWidth: 1 },
  },
};

// ─── BLACK-SCHOLES APPROXIMATION ───
function approximateBS(spot, strike, daysToExpiry, iv, optionType) {
  const timeValue = Math.sqrt(daysToExpiry / 365);
  const intrinsic = optionType === 'CE' ? Math.max(0, spot - strike) : Math.max(0, strike - spot);

  // Simple approximation: premium ≈ IV * spot * 0.4 * time * delta_factor
  let deltaFactor = 0.5; // ATM
  if (optionType === 'CE' && spot > strike) deltaFactor = 0.7; // ITM call
  if (optionType === 'CE' && spot < strike) deltaFactor = 0.3; // OTM call
  if (optionType === 'PE' && spot < strike) deltaFactor = 0.7; // ITM put
  if (optionType === 'PE' && spot > strike) deltaFactor = 0.3; // OTM put

  const timeDecay = (iv / 100) * spot * 0.4 * timeValue * deltaFactor;
  return Math.max(intrinsic, timeDecay);
}

// ─── GREEKS CALCULATION (SIMPLIFIED) ───
function calculateGreeks(legs, spot, daysToExpiry, iv) {
  let delta = 0, gamma = 0, theta = 0, vega = 0;

  for (const leg of legs) {
    if (leg.type === 'STOCK') continue;

    const strike = leg.strike || spot;
    const moneyness = spot / strike;
    const timeValue = Math.sqrt(daysToExpiry / 365);

    // Delta approximation
    let legDelta = 0.5;
    if (leg.type === 'CE') {
      legDelta = Math.min(1, Math.max(0, 0.5 + 0.4 * Math.log(moneyness) / (iv / 100)));
    } else {
      legDelta = Math.min(0, Math.max(-1, -0.5 + 0.4 * Math.log(moneyness) / (iv / 100)));
    }

    // Gamma & Vega (simplified)
    const legGamma = (0.1 / (strike * iv / 100 * timeValue)) * (leg.type === 'CE' ? 1 : 1);
    const legVega = spot * 0.2 * timeValue * 0.01;
    const legTheta = -spot * iv / 100 * 0.2 / Math.sqrt(365 * daysToExpiry + 1);

    const sign = leg.side === 'BUY' ? 1 : -1;
    delta += legDelta * leg.qty * sign;
    gamma += legGamma * leg.qty * sign;
    theta += legTheta * leg.qty * sign;
    vega += legVega * leg.qty * sign;
  }

  return { delta: delta.toFixed(3), gamma: gamma.toFixed(4), theta: theta.toFixed(2), vega: vega.toFixed(2) };
}

// ─── PAYOFF CALCULATION ───
function calculatePayoff(legs, spotAtExpiry, spot, daysToExpiry, iv) {
  let payoff = 0, currentValue = 0;

  for (const leg of legs) {
    if (leg.type === 'STOCK') {
      const pnl = (spotAtExpiry - leg.entryPrice) * leg.qty;
      const current = (spot - leg.entryPrice) * leg.qty;
      payoff += leg.side === 'BUY' ? pnl : -pnl;
      currentValue += leg.side === 'BUY' ? current : -current;
    } else {
      const strike = leg.strike || spot;
      const intrinsicAtExpiry = leg.type === 'CE'
        ? Math.max(0, spotAtExpiry - strike)
        : Math.max(0, strike - spotAtExpiry);

      const daysRemaining = Math.max(1, daysToExpiry - 1);
      const currentBS = approximateBS(spot, strike, daysRemaining, iv, leg.type);

      const pnl = leg.side === 'BUY'
        ? (intrinsicAtExpiry - leg.entryPrice) * leg.qty
        : (leg.entryPrice - intrinsicAtExpiry) * leg.qty;

      const current = leg.side === 'BUY'
        ? (currentBS - leg.entryPrice) * leg.qty
        : (leg.entryPrice - currentBS) * leg.qty;

      payoff += pnl;
      currentValue += current;
    }
  }

  return { payoff, currentValue };
}

// ─── MAIN COMPONENT ───
function StrategyEngine({ chainData, sse, instrument, onExecutePaper, onInstrumentChange, loadTemplate, onClearLoadTemplate }) {
  const paperTrade = usePaperTradeStore();

  const [templateName, setTemplateName] = useState('');
  const [legs, setLegs] = useState([]);
  const [templateParams, setTemplateParams] = useState({});
  const [strategyName, setStrategyName] = useState('');
  const [spotSlider, setSpotSlider] = useState(0);
  const [ivSlider, setIvSlider] = useState(20);
  const [daysSlider, setDaysSlider] = useState(1);
  const [notes, setNotes] = useState('');

  const spot = useMemo(() => (chainData?.chain?.cp || 0) / 100, [chainData]);
  const atmStrike = useMemo(() => Math.round((chainData?.chain?.atm || 0) / 100), [chainData]);

  // Extract strikes from chain
  const strikes = useMemo(() => {
    if (!chainData?.chain) return [];
    const ceStrikes = (chainData.chain.ce || []).map(c => Math.round((c.sp || 0) / 100));
    const peStrikes = (chainData.chain.pe || []).map(p => Math.round((p.sp || 0) / 100));
    return [...new Set([...ceStrikes, ...peStrikes])].sort((a, b) => a - b);
  }, [chainData]);

  // Get option LTP from chain
  const getOptionLTP = useCallback((strike, type) => {
    if (!chainData?.chain) return 0;
    const arr = type === 'CE' ? chainData.chain.ce : chainData.chain.pe;
    const opt = arr?.find(o => Math.round((o.sp || 0) / 100) === strike);
    return opt ? (opt.ltp || 0) / 100 : 0;
  }, [chainData]);

  const daysToExpiry = useMemo(() => {
    if (!chainData?.chain?.expiry) return 7;
    const now = new Date();
    const expiry = new Date(chainData.chain.expiry);
    return Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
  }, [chainData]);

  // Sync daysSlider to actual daysToExpiry when it changes
  React.useEffect(() => {
    setDaysSlider(daysToExpiry);
  }, [daysToExpiry]);

  // Auto-load template when loadTemplate prop changes (from SpreadOptimizer)
  // Also retry when chainData loads (so strikes are available)
  const pendingTemplate = React.useRef(null);
  React.useEffect(() => {
    if (loadTemplate && TEMPLATES[loadTemplate]) {
      pendingTemplate.current = loadTemplate;
      applyTemplate(loadTemplate);
      onClearLoadTemplate?.();
    }
  }, [loadTemplate]);

  // Retry template application when chain data arrives (strikes populated)
  React.useEffect(() => {
    if (pendingTemplate.current && atmStrike > 0 && strikes.length > 0 && legs.length === 0) {
      const tpl = pendingTemplate.current;
      pendingTemplate.current = null;
      applyTemplate(tpl);
    }
  }, [chainData, atmStrike]);

  // Apply template
  const applyTemplate = useCallback((tpl) => {
    const template = TEMPLATES[tpl];
    if (!template) return;

    setTemplateName(tpl);
    setTemplateParams(template.params || {});

    const newLegs = template.legs.map((leg, idx) => {
      let strike = atmStrike;
      const chain = chainData?.chain;
      if (leg.offsetStrike !== 0 && chain) {
        const strikeIndex = strikes.indexOf(atmStrike) + leg.offsetStrike;
        strike = strikes[Math.max(0, Math.min(strikes.length - 1, strikeIndex))] || atmStrike;
      }

      return {
        id: `leg_${Date.now()}_${idx}`,
        side: leg.side,
        type: leg.type,
        strike,
        qty: 1,
        entryPrice: leg.type === 'STOCK' ? spot : getOptionLTP(strike, leg.type),
        expiry: chainData?.chain?.expiry || '',
        label: leg.label,
      };
    });

    setLegs(newLegs);
    setStrategyName(tpl);
  }, [atmStrike, strikes, spot, chainData, getOptionLTP]);

  // Add blank leg
  const addLeg = useCallback(() => {
    setLegs(prev => [...prev, {
      id: `leg_${Date.now()}`,
      side: 'BUY',
      type: 'CE',
      strike: atmStrike,
      qty: 1,
      entryPrice: getOptionLTP(atmStrike, 'CE'),
      expiry: chainData?.chain?.expiry || '',
      label: '',
    }]);
  }, [atmStrike, chainData, getOptionLTP]);

  // Remove leg
  const removeLeg = useCallback((id) => {
    setLegs(prev => prev.filter(l => l.id !== id));
  }, []);

  // Update leg
  const updateLeg = useCallback((id, field, value) => {
    setLegs(prev => prev.map(leg =>
      leg.id === id
        ? { ...leg, [field]: value }
        : leg
    ));
  }, []);

  // Calculate Greeks
  const greeks = useMemo(() => {
    return calculateGreeks(legs, spot, daysToExpiry, ivSlider);
  }, [legs, spot, daysToExpiry, ivSlider]);

  // Calculate payoff chart data
  const chartData = useMemo(() => {
    const data = [];
    const range = spot * 0.03;
    const step = range / 15;
    const spotRange = Math.max(100, step);

    for (let s = spot - range; s <= spot + range; s += spotRange) {
      const { payoff, currentValue } = calculatePayoff(
        legs,
        s,
        spot + spotSlider,
        daysToExpiry,
        ivSlider
      );
      const pnl = Math.round(payoff * 100) / 100;
      data.push({
        spot: s.toFixed(0),
        atExpiry: pnl,
        today: Math.round(currentValue * 100) / 100,
        profitLine: pnl > 0 ? pnl : null,
        lossLine: pnl < 0 ? Math.abs(pnl) : null,
      });
    }
    return data;
  }, [legs, spot, spotSlider, daysToExpiry, ivSlider]);

  // Calculate summary + find y-axis bounds for gradient
  const summary = useMemo(() => {
    if (!chartData.length) return { maxProfit: 0, maxLoss: 0, breakevens: [], yMin: -1, yMax: 1 };

    const payoffs = chartData.map(d => parseFloat(d.atExpiry));
    const maxProfit = Math.max(...payoffs);
    const maxLoss = Math.min(...payoffs);

    const breakevens = [];
    for (let i = 0; i < chartData.length - 1; i++) {
      const curr = parseFloat(chartData[i].atExpiry);
      const next = parseFloat(chartData[i + 1].atExpiry);
      if ((curr < 0 && next > 0) || (curr > 0 && next < 0)) {
        breakevens.push(chartData[i].spot);
      }
    }

    const yMin = maxLoss < 0 ? maxLoss * 1.1 : -1;
    const yMax = maxProfit > 0 ? maxProfit * 1.1 : 1;
    return { maxProfit, maxLoss, breakevens, yMin, yMax };
  }, [chartData]);

  // Gradient stop at y=0 as percentage of chart height
  const zeroPct = useMemo(() => {
    const range = summary.yMax - summary.yMin;
    return range > 0 ? ((summary.yMax / range) * 100) : 50;
  }, [summary.yMax, summary.yMin]);

  // Save strategy
  const saveStrategy = useCallback(() => {
    if (!strategyName.trim()) {
      alert('Enter strategy name');
      return;
    }

    const strategy = {
      name: strategyName,
      instrument,
      templateName,
      legs,
      templateParams,
      notes,
      savedAt: new Date().toISOString(),
      daysToExpiry,
    };

    const saved = JSON.parse(localStorage.getItem('strategies') || '[]');
    saved.push(strategy);
    localStorage.setItem('strategies', JSON.stringify(saved));
    alert('Strategy saved');
  }, [strategyName, instrument, templateName, legs, templateParams, notes, daysToExpiry]);

  // Execute paper trade
  const executePaper = useCallback(() => {
    if (!legs.length) {
      alert('Add legs to execute');
      return;
    }

    paperTrade.setStrategy({
      name: strategyName || templateName,
      legs: legs.map(leg => ({
        instrument: leg.type === 'STOCK' ? instrument : `${leg.strike} ${leg.type}`,
        side: leg.side,
        entryPrice: leg.entryPrice,
        qty: leg.qty,
      })),
    });

    for (const leg of legs) {
      paperTrade.evaluateSignal({
        instrument: leg.type === 'STOCK' ? instrument : `${leg.strike} ${leg.type}`,
        side: leg.side,
        entryPrice: leg.entryPrice,
        qty: leg.qty,
        reason: `${templateName} - ${leg.label}`,
      });
    }

    alert(`Executed ${legs.length} legs as paper trades`);
  }, [legs, templateName, strategyName, paperTrade, instrument]);

  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 }}>
      <div style={{ color: C.bright, fontWeight: 700, fontSize: 15, marginBottom: 16 }}>🎮 Strategy Engine</div>

      {/* Instrument Selector */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ color: C.text, fontSize: 12, fontWeight: 600 }}>Instrument</label>
        <select value={instrument} onChange={e => onInstrumentChange?.(e.target.value)}
          style={{
            width: '100%', padding: '8px 12px', marginTop: 4, borderRadius: 6,
            background: C.bg, border: `1px solid ${C.border}`, color: C.accent,
            fontSize: 12, cursor: 'pointer', fontWeight: 600,
          }}
        >
          {['NIFTY', 'BANKNIFTY', 'SENSEX', 'FINNIFTY'].map(i => (
            <option key={i} value={i}>{i}</option>
          ))}
        </select>
      </div>

      {/* Template Selector */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ color: C.text, fontSize: 12, fontWeight: 600 }}>Select Template</label>
        <select
          value={templateName}
          onChange={e => applyTemplate(e.target.value)}
          style={{
            width: '100%', padding: '8px 12px', marginTop: 4, borderRadius: 6,
            background: C.bg, border: `1px solid ${C.border}`, color: C.bright,
            fontSize: 12, cursor: 'pointer',
          }}
        >
          <option value="">-- Choose Template --</option>
          {Object.keys(TEMPLATES).map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {/* Template Parameters */}
      {(templateParams.width !== undefined || templateParams.wingWidth !== undefined) && (
        <div style={{ marginBottom: 20, padding: 12, background: C.bg, borderRadius: 6, border: `1px solid ${C.border}` }}>
          <div style={{ color: C.text, fontSize: 11, fontWeight: 600, marginBottom: 8 }}>Template Parameters</div>
          {templateParams.width !== undefined && (
            <div style={{ marginBottom: 8 }}>
              <label style={{ color: C.dim, fontSize: 11 }}>Width (strike intervals)</label>
              <input
                type="number"
                value={templateParams.width}
                onChange={e => setTemplateParams({ ...templateParams, width: parseInt(e.target.value) || 1 })}
                style={{
                  width: '100%', padding: '6px 8px', marginTop: 4, borderRadius: 4,
                  background: C.panel, border: `1px solid ${C.border}`, color: C.bright, fontSize: 11,
                }}
              />
            </div>
          )}
          {templateParams.wingWidth !== undefined && (
            <div>
              <label style={{ color: C.dim, fontSize: 11 }}>Wing Width</label>
              <input
                type="number"
                value={templateParams.wingWidth}
                onChange={e => setTemplateParams({ ...templateParams, wingWidth: parseInt(e.target.value) || 1 })}
                style={{
                  width: '100%', padding: '6px 8px', marginTop: 4, borderRadius: 4,
                  background: C.panel, border: `1px solid ${C.border}`, color: C.bright, fontSize: 11,
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Leg Builder Table */}
      {legs.length > 0 && (
        <div style={{ marginBottom: 20, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10, color: C.text }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}`, background: C.bg }}>
                <th style={{ padding: 8, textAlign: 'left' }}>Label</th>
                <th style={{ padding: 8, textAlign: 'center' }}>Side</th>
                <th style={{ padding: 8, textAlign: 'center' }}>Type</th>
                <th style={{ padding: 8, textAlign: 'center' }}>Strike</th>
                <th style={{ padding: 8, textAlign: 'center' }}>Qty</th>
                <th style={{ padding: 8, textAlign: 'right' }}>Entry Price</th>
                <th style={{ padding: 8, textAlign: 'center' }}>Remove</th>
              </tr>
            </thead>
            <tbody>
              {legs.map((leg) => (
                <tr key={leg.id} style={{ borderBottom: `1px solid ${C.border}22` }}>
                  <td style={{ padding: 8 }}>
                    <input type="text" value={leg.label || ''} onChange={e => updateLeg(leg.id, 'label', e.target.value)} placeholder="e.g., Long Call" style={{ width: '100%', padding: '4px 6px', borderRadius: 3, background: C.bg, border: `1px solid ${C.border}`, color: C.text, fontSize: 10 }} />
                  </td>
                  <td style={{ padding: 8, textAlign: 'center' }}>
                    <select value={leg.side} onChange={e => updateLeg(leg.id, 'side', e.target.value)} style={{ padding: '4px 6px', borderRadius: 3, background: C.bg, border: `1px solid ${C.border}`, color: C.text, fontSize: 10 }}>
                      <option>BUY</option>
                      <option>SELL</option>
                    </select>
                  </td>
                  <td style={{ padding: 8, textAlign: 'center' }}>
                    <select value={leg.type} onChange={e => updateLeg(leg.id, 'type', e.target.value)} style={{ padding: '4px 6px', borderRadius: 3, background: C.bg, border: `1px solid ${C.border}`, color: C.text, fontSize: 10 }}>
                      <option>CE</option>
                      <option>PE</option>
                      <option>STOCK</option>
                    </select>
                  </td>
                  <td style={{ padding: 8, textAlign: 'center' }}>
                    <select value={leg.strike} onChange={e => updateLeg(leg.id, 'strike', parseInt(e.target.value))} style={{ padding: '4px 6px', borderRadius: 3, background: C.bg, border: `1px solid ${C.border}`, color: C.text, fontSize: 10, width: '80px' }}>
                      {strikes.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: 8, textAlign: 'center' }}>
                    <input type="number" value={leg.qty} onChange={e => updateLeg(leg.id, 'qty', parseInt(e.target.value) || 1)} min="1" style={{ width: '50px', padding: '4px 6px', borderRadius: 3, background: C.bg, border: `1px solid ${C.border}`, color: C.text, fontSize: 10 }} />
                  </td>
                  <td style={{ padding: 8, textAlign: 'right' }}>
                    <input type="number" value={leg.entryPrice} onChange={e => updateLeg(leg.id, 'entryPrice', parseFloat(e.target.value) || 0)} step="0.05" style={{ width: '70px', padding: '4px 6px', borderRadius: 3, background: C.bg, border: `1px solid ${C.border}`, color: C.text, fontSize: 10 }} />
                  </td>
                  <td style={{ padding: 8, textAlign: 'center' }}>
                    <button onClick={() => removeLeg(leg.id)} style={{ background: C.red, color: C.bright, border: 'none', borderRadius: 3, padding: '4px 8px', cursor: 'pointer', fontSize: 10, fontWeight: 600 }}>x</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={addLeg} style={{ marginTop: 8, padding: '6px 12px', borderRadius: 4, background: C.accent, color: C.bg, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>+ Add Leg</button>
        </div>
      )}

      {/* Payoff Chart */}
      {chartData.length > 0 && (
        <div style={{ marginBottom: 20, height: 300, padding: 12, background: C.bg, borderRadius: 6, border: `1px solid ${C.border}` }}>
          <div style={{ color: C.text, fontSize: 11, fontWeight: 600, marginBottom: 8 }}>Payoff Diagram</div>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 30 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="spot" stroke={C.dim} style={{ fontSize: 9 }} />
              <YAxis stroke={C.dim} style={{ fontSize: 9 }} />
              <Tooltip contentStyle={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 4, color: C.bright }} labelStyle={{ color: C.dim }} />
              <defs>
                <linearGradient id="payoffGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset={`${Math.max(0, zeroPct - 0.1)}%`} stopColor={C.green} stopOpacity={0.3} />
                  <stop offset={`${zeroPct}%`} stopColor={C.green} stopOpacity={0.0} />
                  <stop offset={`${zeroPct}%`} stopColor={C.red} stopOpacity={0.0} />
                  <stop offset={`${Math.min(100, zeroPct + 0.1)}%`} stopColor={C.red} stopOpacity={0.3} />
                </linearGradient>
              </defs>
              {/* Single continuous Area — gradient handles color at y=0 */}
              <Area type="monotone" dataKey="atExpiry" stroke={C.bright} fill="url(#payoffGrad)" strokeWidth={2} name="At Expiry" dot={false} />
              {/* Today's value line */}
              <Area type="monotone" dataKey="today" stroke={C.accent} fill="none" strokeWidth={1.5} name="Today (BS)" strokeDasharray="4 2" dot={false} />
              {summary.breakevens.map((be, i) => <ReferenceLine key={i} x={be} stroke={C.yellow} strokeDasharray="3 3" />)}
              <ReferenceLine y={0} stroke={C.text} strokeDasharray="3 3" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Net Greeks */}
      <div style={{ marginBottom: 20, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
        <div style={{ padding: 12, background: C.bg, borderRadius: 6, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 10, color: C.dim }}>Net Delta</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: greeks.delta >= 0 ? C.green : C.red, marginTop: 4 }}>{greeks.delta}</div>
        </div>
        <div style={{ padding: 12, background: C.bg, borderRadius: 6, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 10, color: C.dim }}>Net Gamma</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: greeks.gamma >= 0 ? C.green : C.red, marginTop: 4 }}>{greeks.gamma}</div>
        </div>
        <div style={{ padding: 12, background: C.bg, borderRadius: 6, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 10, color: C.dim }}>Net Theta</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: greeks.theta >= 0 ? C.green : C.red, marginTop: 4 }}>{greeks.theta}</div>
        </div>
        <div style={{ padding: 12, background: C.bg, borderRadius: 6, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 10, color: C.dim }}>Net Vega</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: greeks.vega >= 0 ? C.green : C.red, marginTop: 4 }}>{greeks.vega}</div>
        </div>
      </div>

      {/* Strategy Summary */}
      {chartData.length > 0 && (
        <div style={{ marginBottom: 20, padding: 12, background: C.bg, borderRadius: 6, border: `1px solid ${C.border}` }}>
          <div style={{ color: C.text, fontSize: 11, fontWeight: 600, marginBottom: 8 }}>Strategy Summary</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, fontSize: 11 }}>
            <div><span style={{ color: C.dim }}>Max Profit:</span><div style={{ color: C.green, fontWeight: 600 }}>{fmtRs(summary.maxProfit)}</div></div>
            <div><span style={{ color: C.dim }}>Max Loss:</span><div style={{ color: C.red, fontWeight: 600 }}>{fmtRs(summary.maxLoss)}</div></div>
            <div><span style={{ color: C.dim }}>Breakeven(s):</span><div style={{ color: C.yellow, fontWeight: 600 }}>{summary.breakevens.length > 0 ? summary.breakevens.join(', ') : 'N/A'}</div></div>
          </div>
        </div>
      )}

      {/* What-If Sliders */}
      <div style={{ marginBottom: 20, padding: 12, background: C.bg, borderRadius: 6, border: `1px solid ${C.border}` }}>
        <div style={{ color: C.text, fontSize: 11, fontWeight: 600, marginBottom: 12 }}>What-If Analysis</div>
        <div style={{ marginBottom: 10 }}>
          <div style={{ color: C.dim, fontSize: 10 }}>Spot: {fmtRs(spot + spotSlider)} (±{fmtPct((spotSlider / spot) * 100)})</div>
          <input type="range" min={-Math.round(spot * 0.05)} max={Math.round(spot * 0.05)} step="10" value={spotSlider} onChange={e => setSpotSlider(parseInt(e.target.value))} style={{ width: '100%', marginTop: 4 }} />
        </div>
        <div style={{ marginBottom: 10 }}>
          <div style={{ color: C.dim, fontSize: 10 }}>IV: {ivSlider}%</div>
          <input type="range" min="5" max="100" step="1" value={ivSlider} onChange={e => setIvSlider(parseInt(e.target.value))} style={{ width: '100%', marginTop: 4 }} />
        </div>
        <div>
          <div style={{ color: C.dim, fontSize: 10 }}>Days to Expiry: {daysSlider}</div>
          <input type="range" min="1" max={daysToExpiry} step="1" value={daysSlider} onChange={e => setDaysSlider(parseInt(e.target.value))} style={{ width: '100%', marginTop: 4 }} />
        </div>
      </div>

      {/* Strategy Details */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ color: C.text, fontSize: 11, fontWeight: 600 }}>Strategy Name</label>
        <input type="text" value={strategyName} onChange={e => setStrategyName(e.target.value)} placeholder="e.g., My Bull Call" style={{ width: '100%', padding: '8px 12px', marginTop: 4, borderRadius: 6, background: C.bg, border: `1px solid ${C.border}`, color: C.bright, fontSize: 11 }} />
        <label style={{ color: C.text, fontSize: 11, fontWeight: 600, marginTop: 12, display: 'block' }}>Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add strategy notes..." style={{ width: '100%', padding: '8px 12px', marginTop: 4, borderRadius: 6, background: C.bg, border: `1px solid ${C.border}`, color: C.bright, fontSize: 10, minHeight: 60, fontFamily: 'monospace', resize: 'none' }} />
      </div>

      {/* Action Buttons */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <button onClick={saveStrategy} style={{ padding: '10px 16px', borderRadius: 6, background: C.accent, color: C.bg, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>Save Strategy</button>
        <button onClick={executePaper} style={{ padding: '10px 16px', borderRadius: 6, background: C.green, color: C.bg, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>Execute as Paper Trade</button>
      </div>
    </div>
  );
}

export default StrategyEngine;
