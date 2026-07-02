/**
 * BacktestEngine — simulates a trading strategy against historical candle data.
 *
 * Strategy definition:
 * {
 *   name: string,
 *   conditions: {
 *     entry: Array<{ indicator: string, operator: string, value: number, logic: 'AND'|'OR' }>,
 *     exit: Array<{ indicator: string, operator: string, value: number }>,
 *   },
 *   positionSize: { type: 'fixed'|'percent', value: number },
 *   maxPositions: number,
 *   slippage: number,
 * }
 *
 * Input: candles = [{ open, high, low, close, volume, time }]
 * Output: { trades, equityCurve, drawdownCurve, metrics }
 */
export function runBacktest(strategy, candles) {
  if (!candles?.length || !strategy) return null;

  const trades = [];
  const equity = [{ time: candles[0]?.time || Date.now(), value: 100000 }];
  const results = [];
  let capital = 100000;
  let position = null;
  const peakVal = { current: 100000 };
  const maxCapital = { current: 100000 };
  const drawdownSeries = [{ time: candles[0]?.time || Date.now(), value: 0 }];
  const dailyReturns = [];
  let currentDay = null;

  // ── Common indicator calculations ──
  const cache = {};

  const ema = (period, idx) => {
    const key = `ema${period}`;
    if (!cache[key]) cache[key] = [];
    if (cache[key][idx] != null) return cache[key][idx];
    if (idx < period) { cache[key][idx] = candles[idx]?.close || 0; return cache[key][idx]; }
    const prev = ema(period, idx - 1);
    const k = 2 / (period + 1);
    cache[key][idx] = (candles[idx]?.close || 0) * k + prev * (1 - k);
    return cache[key][idx];
  };

  const rsi = (period, idx) => {
    const key = `rsi${period}`;
    if (!cache[key]) cache[key] = [];
    if (cache[key][idx] != null) return cache[key][idx];
    if (idx < period + 1) { cache[key][idx] = 50; return 50; }
    let gains = 0, losses = 0;
    for (let i = idx - period + 1; i <= idx; i++) {
      const ch = (candles[i]?.close || 0) - (candles[i - 1]?.close || 0);
      if (ch > 0) gains += ch; else losses -= ch;
    }
    const avgG = gains / period, avgL = losses / period;
    const rs = avgL > 0 ? avgG / avgL : 100;
    cache[key][idx] = 100 - 100 / (1 + rs);
    return cache[key][idx];
  };

  const sma = (period, idx, field = 'close') => {
    const key = `sma${period}f${field}`;
    if (!cache[key]) cache[key] = [];
    if (cache[key][idx] != null) return cache[key][idx];
    if (idx < period - 1) { cache[key][idx] = candles[idx]?.[field] || 0; return cache[key][idx]; }
    let sum = 0;
    for (let i = idx - period + 1; i <= idx; i++) sum += candles[i]?.[field] || 0;
    cache[key][idx] = sum / period;
    return cache[key][idx];
  };

  const bb = (period, idx) => {
    const middle = sma(period, idx);
    const key = `bb${period}`;
    if (!cache[key]) cache[key] = [];
    if (cache[key][idx] != null) return cache[key][idx];
    let sumSq = 0;
    for (let i = idx - period + 1; i <= idx; i++) {
      const d = (candles[i]?.close || 0) - middle;
      sumSq += d * d;
    }
    const std = Math.sqrt(sumSq / period);
    cache[key][idx] = { middle, upper: middle + 2 * std, lower: middle - 2 * std };
    return cache[key][idx];
  };

  const atr = (period, idx) => {
    const key = `atr${period}`;
    if (!cache[key]) cache[key] = [];
    if (cache[key][idx] != null) return cache[key][idx];
    if (idx < period) { cache[key][idx] = (candles[idx]?.high || 0) - (candles[idx]?.low || 0); return cache[key][idx]; }
    const tr = Math.max(
      (candles[idx]?.high || 0) - (candles[idx]?.low || 0),
      Math.abs((candles[idx]?.high || 0) - (candles[idx - 1]?.close || 0)),
      Math.abs((candles[idx]?.low || 0) - (candles[idx - 1]?.close || 0))
    );
    const prev = atr(period, idx - 1);
    cache[key][idx] = (prev * (period - 1) + tr) / period;
    return cache[key][idx];
  };

  const getIndicator = (indicator, idx) => {
    switch (true) {
      case /^EMA(\d+)$/i.test(indicator): return ema(parseInt(indicator.match(/\d+/)[0]), idx);
      case /^SMA(\d+)$/i.test(indicator): return sma(parseInt(indicator.match(/\d+/)[0]), idx);
      case /^RSI(\d+)$/i.test(indicator): return rsi(parseInt(indicator.match(/\d+/)[0]), idx);
      case /^BB(\d+)$/i.test(indicator): return bb(parseInt(indicator.match(/\d+/)[0]), idx);
      case indicator === 'CLOSE': return candles[idx]?.close || 0;
      case indicator === 'OPEN': return candles[idx]?.open || 0;
      case indicator === 'HIGH': return candles[idx]?.high || 0;
      case indicator === 'LOW': return candles[idx]?.low || 0;
      case indicator === 'VOLUME': return candles[idx]?.volume || 0;
      default: return 0;
    }
  };

  const evaluateCondition = (cond, idx) => {
    const val = getIndicator(cond.indicator, idx);
    if (cond.indicator.startsWith('BB')) {
      const b = val;
      if (cond.operator === '>') return b.upper;
      if (cond.operator === '<') return b.lower;
      return b.middle;
    }
    switch (cond.operator) {
      case '>': return val > cond.value;
      case '<': return val < cond.value;
      case '>=': return val >= cond.value;
      case '<=': return val <= cond.value;
      case '==': return Math.abs(val - cond.value) < 0.001;
      case 'crosses_above': return idx > 0 && getIndicator(cond.indicator, idx - 1) <= cond.value && val > cond.value;
      case 'crosses_below': return idx > 0 && getIndicator(cond.indicator, idx - 1) >= cond.value && val < cond.value;
      default: return false;
    }
  };

  const checkEntry = (idx) => {
    const conditions = strategy.conditions?.entry || [];
    if (!conditions.length) return idx > 0; // enter on first bar if no conditions
    const results = conditions.map(c => evaluateCondition(c, idx));
    // AND logic by default
    return results.every(Boolean);
  };

  const checkExit = (idx) => {
    const conditions = strategy.conditions?.exit || [];
    if (!conditions.length) return false; // hold till end
    return conditions.some(c => evaluateCondition(c, idx));
  };

  // ═══════ MAIN LOOP ═══════
  for (let i = Math.max(0, candles.length > 60 ? 30 : 1); i < candles.length; i++) {
    const c = candles[i];
    const date = new Date(c.time * 1000);
    const dayKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

    // Track daily returns
    if (dayKey !== currentDay) {
      currentDay = dayKey;
      if (i > 1) {
        const prevE = equity[equity.length - 2]?.value || capital;
        const ret = ((capital - prevE) / prevE) * 100;
        dailyReturns.push({ date: new Date(c.time * 1000).toISOString().slice(0, 10), return: ret });
      }
    }

    // Update equity
    const currentVal = position ? capital + position.qty * (c.close - position.entryPrice) : capital;
    if (currentVal > maxCapital.current) maxCapital.current = currentVal;
    const dd = ((currentVal - maxCapital.current) / maxCapital.current) * 100;
    drawdownSeries.push({ time: c.time, value: Math.round(dd * 100) / 100 });

    // Position management
    if (position) {
      // Check exit
      const shouldExit = checkExit(i);
      if (shouldExit || i === candles.length - 1) {
        const exitPrice = c.close;
        const pnl = position.qty * (exitPrice - position.entryPrice);
        const slippage = strategy.slippage || 0.05;
        const netPnl = pnl - Math.abs(pnl) * slippage / 100;
        trades.push({
          entry_time: position.entryTime,
          exit_time: c.time,
          pnl: Math.round(netPnl),
          direction: position.qty > 0 ? 'long' : 'short',
          bars_held: i - position.entryBar,
          entryPrice: position.entryPrice,
          exitPrice,
        });
        capital += netPnl;
        position = null;
      }
    } else {
      // Check entry
      if (checkEntry(i)) {
        const sizePct = strategy.positionSize?.type === 'percent' ? (strategy.positionSize.value || 20) / 100 : 0.2;
        const investAmount = capital * sizePct;
        const qty = Math.max(1, Math.floor(investAmount / c.close));
        position = {
          qty, entryPrice: c.close, entryTime: c.time, entryBar: i,
        };
      }
    }

    equity.push({ time: c.time, value: Math.round(currentVal) });
  }

  // Close final position
  if (position) {
    const lastC = candles[candles.length - 1];
    const pnl = position.qty * (lastC.close - position.entryPrice);
    trades.push({
      entry_time: position.entryTime, exit_time: lastC.time,
      pnl: Math.round(pnl), direction: position.qty > 0 ? 'long' : 'short',
      bars_held: candles.length - position.entryBar,
    });
    capital += pnl;
  }

  // ── Compute metrics ──
  const winning = trades.filter(t => t.pnl > 0);
  const losing = trades.filter(t => t.pnl < 0);
  const grossProfit = winning.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losing.reduce((s, t) => s + t.pnl, 0));
  const netProfit = grossProfit - grossLoss;
  const winRate = trades.length ? winning.length / trades.length : 0;
  const avgWin = winning.length ? grossProfit / winning.length : 0;
  const avgLoss = losing.length ? grossLoss / losing.length : 0;
  const maxDd = Math.min(...drawdownSeries.map(d => d.value));
  const totalReturn = ((capital - 100000) / 100000) * 100;
  const totalDays = candles.length;
  const annualReturn = totalReturn * (365 / totalDays);

  // Compute ratios
  const returns = dailyReturns.map(d => d.return);
  const avgRet = returns.reduce((s, v) => s + v, 0) / (returns.length || 1);
  const variance = returns.reduce((s, v) => s + (v - avgRet) ** 2, 0) / (returns.length || 1);
  const std = Math.sqrt(variance);
  const sharpe = std > 0 ? (avgRet - 0.05 / 252) / std * Math.sqrt(252) : 0;

  const downside = returns.filter(r => r < 0);
  const dVariance = downside.reduce((s, v) => s + (v - 0) ** 2, 0) / (returns.length || 1);
  const dStd = Math.sqrt(dVariance);
  const sortino = dStd > 0 ? (avgRet - 0.05 / 252) / dStd * Math.sqrt(252) : 0;

  const calmar = maxDd !== 0 ? annualReturn / Math.abs(maxDd) : 0;

  const avgTrade = trades.length ? netProfit / trades.length : 0;
  const sqn = (() => {
    if (trades.length < 10) return 0;
    const pnls = trades.map(t => t.pnl);
    const m = pnls.reduce((s, v) => s + v, 0) / pnls.length;
    const v = pnls.reduce((s, v) => s + (v - m) ** 2, 0) / pnls.length;
    return v > 0 ? (m / Math.sqrt(v)) * Math.sqrt(pnls.length) : 0;
  })();

  const pf = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;
  const expectancy = trades.length ? netProfit / trades.length : 0;
  const kellyPct = (() => {
    if (!avgLoss) return 0;
    const r = avgWin / avgLoss;
    return Math.max(0, (winRate * r - (1 - winRate)) / r * 100);
  })();

  // Monthly returns
  const monthlyMap = {};
  trades.forEach(t => {
    const d = new Date(t.entry_time * 1000);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    if (!monthlyMap[key]) monthlyMap[key] = { year: d.getFullYear(), month: d.getMonth() + 1, return: 0, trades_count: 0 };
    monthlyMap[key].return += t.pnl;
    monthlyMap[key].trades_count++;
  });
  const monthlyReturns = Object.values(monthlyMap).map(m => ({
    ...m, return: (m.return / 100000) * 100,
  }));

  const equityCurve = equity.map(e => ({ time: e.time, value: e.value }));
  const drawdownCurve = drawdownSeries;

  return {
    results: {
      net_pnl: netProfit,
      total_return_pct: Math.round(totalReturn * 100) / 100,
      annual_return_pct: Math.round(annualReturn * 100) / 100,
      profit_factor: Math.round(pf * 100) / 100,
      expectancy: Math.round(expectancy * 100) / 100,
      gross_profit: grossProfit, gross_loss: grossLoss, net_profit: netProfit,
      avg_trade: Math.round(avgTrade * 100) / 100,
      avg_winning_trade: Math.round(avgWin * 100) / 100,
      avg_losing_trade: -Math.round(avgLoss * 100) / 100,
      largest_winner: Math.max(...trades.map(t => t.pnl), 0),
      largest_loser: Math.min(...trades.map(t => t.pnl), 0),
      profit_factor: pf,
      recovery_factor: maxDd ? Math.round((netProfit / Math.abs(maxDd)) * 100) / 100 : 0,
      sqn: Math.round(sqn * 100) / 100,
      sharpe_ratio: Math.round(sharpe * 100) / 100,
      sortino_ratio: Math.round(sortino * 100) / 100,
      calmar_ratio: Math.round(calmar * 100) / 100,
      max_drawdown: Math.round(maxDd * 100) / 100,
      avg_drawdown: Math.round((drawdownSeries.reduce((s, d) => s + d.value, 0) / (drawdownSeries.length || 1)) * 100) / 100,
      consecutive_losses: (() => { let m = 0, c = 0; for (const t of trades) { if (t.pnl < 0) { c++; m = Math.max(m, c); } else c = 0; } return m; })(),
      consecutive_wins: (() => { let m = 0, c = 0; for (const t of trades) { if (t.pnl > 0) { c++; m = Math.max(m, c); } else c = 0; } return m; })(),
      win_rate: Math.round(winRate * 10000) / 100,
      total_trades: trades.length,
      winning_trades: winning.length,
      losing_trades: losing.length,
      long_trades: trades.filter(t => t.direction === 'long').length,
      short_trades: trades.filter(t => t.direction === 'short').length,
      kelly_pct: Math.round(kellyPct * 100) / 100,
      avg_bars_in_trade: trades.length ? Math.round(trades.reduce((s, t) => s + t.bars_held, 0) / trades.length) : 0,
      volatility_annual: Math.round(std * Math.sqrt(252) * 100) / 100,
      risk_reward_ratio: avgLoss ? Math.round((avgWin / avgLoss) * 100) / 100 : 0,
      total_commissions: Math.round(netProfit * 0.02),
      total_fees: Math.round(netProfit * 0.005),
      avg_position_size: Math.round(trades.reduce((s, t) => s + Math.abs(t.pnl), 0) / (trades.length || 1)),
      equity_curve: equityCurve,
      drawdown_curve: drawdownCurve,
      trades,
      monthly_returns: monthlyReturns,
      daily_returns: dailyReturns,
    },
  };
}
