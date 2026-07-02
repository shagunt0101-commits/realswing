/**
 * PainEngine — institutional Max Pain, support/resistance, and pain curve analysis.
 *
 * All functions take raw chain data ({ ce: [...], pe: [...], cp, atm }) and return
 * computed structures. No mock data, no placeholders.
 */

/** Normalize a value to [0, 1] range within an array */
function normalize(arr, key) {
  const vals = arr.map(v => v[key] ?? 0);
  const max = Math.max(...vals, 1);
  return arr.map(v => ({ ...v, [`_${key}_norm`]: ((v[key] ?? 0) / max) }));
}

/**
 * True Max Pain — strike where total option writer payout is minimum.
 * Formula: for each settlement S, pain = Σ max(0, S-K) * CE_OI + Σ max(0, K-S) * PE_OI
 */
export function computeMaxPain(ce, pe) {
  if (!ce?.length || !pe?.length) return { maxPain: 0, weightedMaxPain: 0, painCurve: [] };

  // Build strike map
  const ceMap = new Map(); ce.forEach(c => ceMap.set(c.sp, (ceMap.get(c.sp) || 0) + (c.oi || 0)));
  const peMap = new Map(); pe.forEach(p => peMap.set(p.sp, (peMap.get(p.sp) || 0) + (p.oi || 0)));
  const allStrikes = [...new Set([...ceMap.keys(), ...peMap.keys()])].sort((a, b) => a - b);

  let bestStrike = allStrikes[0] || 0;
  let lowestPayout = Infinity;
  const painCurve = [];

  for (const settlement of allStrikes) {
    let payout = 0;
    for (const [strike, oi] of ceMap) {
      if (settlement > strike) payout += (settlement - strike) * oi;
    }
    for (const [strike, oi] of peMap) {
      if (settlement < strike) payout += (strike - settlement) * oi;
    }
    painCurve.push({ strike: settlement / 100, payout: Math.round(payout / 100) });
    if (payout < lowestPayout) { lowestPayout = payout; bestStrike = settlement; }
  }

  // Weighted Max Pain — gamma-weighted version for last sessions
  const gammaCe = new Map(); ce.forEach(c => gammaCe.set(c.sp, Math.abs(c.gamma || 0.0001)));
  const gammaPe = new Map(); pe.forEach(p => gammaPe.set(p.sp, Math.abs(p.gamma || 0.0001)));
  let bestWeightedStrike = allStrikes[0] || 0;
  let lowestWeighted = Infinity;

  for (const settlement of allStrikes) {
    let wPayout = 0;
    for (const [strike, oi] of ceMap) {
      const g = gammaCe.get(strike) || 0.0001;
      if (settlement > strike) wPayout += (settlement - strike) * oi * (1 + g);
    }
    for (const [strike, oi] of peMap) {
      const g = gammaPe.get(strike) || 0.0001;
      if (settlement < strike) wPayout += (strike - settlement) * oi * (1 + g);
    }
    if (wPayout < lowestWeighted) { lowestWeighted = wPayout; bestWeightedStrike = settlement; }
  }

  return {
    maxPain: bestStrike / 100,
    weightedMaxPain: bestWeightedStrike / 100,
    painCurve,
    magnetStrength: lowestPayout > 0 ? Math.round((1 / (lowestPayout / 1e10)) * 100) / 100 : 1,
  };
}

/**
 * Institutional Support — scored zones from PUT OI + OI change + distance + gamma.
 * Returns top support zones sorted by score descending.
 */
export function computeSupportZones(ce, pe, spot) {
  if (!pe?.length) return [];
  const sp = spot || 0;

  // Only PUT strikes below spot are support
  let candidates = pe
    .map(p => ({
      strike: p.sp / 100,
      oi: p.oi || 0,
      oiChange: (p.oi || 0) - (p.prev_oi || 0),
      gamma: Math.abs(p.gamma || 0.0001),
      distance: Math.abs((p.sp / 100) - sp),
    }))
    .filter(p => p.strike < sp && p.oi > 0);

  if (!candidates.length) return [];

  const maxOi = Math.max(...candidates.map(c => c.oi), 1);
  const maxOiChg = Math.max(...candidates.map(c => Math.abs(c.oiChange)), 1);
  const maxDist = Math.max(...candidates.map(c => c.distance), 1);

  candidates = candidates.map(c => {
    const score =
      0.40 * (c.oi / maxOi) +
      0.30 * (Math.max(0, c.oiChange) / maxOiChg) +
      0.15 * (1 - c.distance / maxDist) +
      0.15 * Math.min(c.gamma * 100, 1);
    return { ...c, score: Math.round(score * 1000) / 10 };
  });

  return candidates
    .sort((a, b) => b.score - a.score)
    .filter(c => c.score > 10)
    .slice(0, 5);
}

/**
 * Institutional Resistance — scored zones from CE OI + OI change + distance + gamma.
 * Returns top resistance zones sorted by score descending.
 */
export function computeResistanceZones(ce, pe, spot) {
  if (!ce?.length) return [];
  const sp = spot || 0;

  let candidates = ce
    .map(c => ({
      strike: c.sp / 100,
      oi: c.oi || 0,
      oiChange: (c.oi || 0) - (c.prev_oi || 0),
      gamma: Math.abs(c.gamma || 0.0001),
      distance: Math.abs((c.sp / 100) - sp),
    }))
    .filter(c => c.strike > sp && c.oi > 0);

  if (!candidates.length) return [];

  const maxOi = Math.max(...candidates.map(c => c.oi), 1);
  const maxOiChg = Math.max(...candidates.map(c => Math.abs(c.oiChange)), 1);
  const maxDist = Math.max(...candidates.map(c => c.distance), 1);

  candidates = candidates.map(c => {
    const score =
      0.40 * (c.oi / maxOi) +
      0.30 * (Math.max(0, c.oiChange) / maxOiChg) +
      0.15 * (1 - c.distance / maxDist) +
      0.15 * Math.min(c.gamma * 100, 1);
    return { ...c, score: Math.round(score * 1000) / 10 };
  });

  return candidates
    .sort((a, b) => b.score - a.score)
    .filter(c => c.score > 10)
    .slice(0, 5);
}

/**
 * Wall Strength — strongest individual OI levels weighted by proximity.
 * Returns { support: strike, resistance: strike }
 */
export function computeWallStrength(ce, pe, spot) {
  const sp = spot || 0;
  const all = [];

  for (const c of ce) {
    const strike = (c.sp || 0) / 100;
    if (strike <= sp) continue;
    const oi = c.oi || 0;
    const oiChg = Math.abs((c.oi || 0) - (c.prev_oi || 0));
    const gamma = Math.abs(c.gamma || 0.0001);
    const distW = 1 / (1 + Math.abs(strike - sp));
    all.push({ strike, strength: oi * (oiChg || 1) * gamma * distW, type: 'resistance' });
  }

  for (const p of pe) {
    const strike = (p.sp || 0) / 100;
    if (strike >= sp) continue;
    const oi = p.oi || 0;
    const oiChg = Math.abs((p.oi || 0) - (p.prev_oi || 0));
    const gamma = Math.abs(p.gamma || 0.0001);
    const distW = 1 / (1 + Math.abs(strike - sp));
    all.push({ strike, strength: oi * (oiChg || 1) * gamma * distW, type: 'support' });
  }

  const supports = all.filter(a => a.type === 'support').sort((a, b) => b.strength - a.strength);
  const resistances = all.filter(a => a.type === 'resistance').sort((a, b) => b.strength - a.strength);

  return {
    support: supports[0]?.strike || 0,
    resistance: resistances[0]?.strike || 0,
    zones: all.sort((a, b) => b.strength - a.strength).slice(0, 5),
  };
}

/**
 * Full analysis — runs all engines and returns the rich payload.
 */
export function analyzeChain(chain) {
  if (!chain?.ce?.length || !chain?.pe?.length) {
    return { maxPain: 0, weightedMaxPain: 0, painCurve: [], supportZones: [], resistanceZones: [], wallStrength: { support: 0, resistance: 0 }, magnetStrength: 0 };
  }

  const spot = (chain.cp || 0) / 100;
  const pain = computeMaxPain(chain.ce, chain.pe);
  const supportZones = computeSupportZones(chain.ce, chain.pe, spot);
  const resistanceZones = computeResistanceZones(chain.ce, chain.pe, spot);
  const wallStrength = computeWallStrength(chain.ce, chain.pe, spot);

  return {
    ...pain,
    supportZones,
    resistanceZones,
    wallStrength,
  };
}
