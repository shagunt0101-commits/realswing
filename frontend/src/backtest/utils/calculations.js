/**
 * Institutional backtest calculation engine.
 * All functions are pure — take numbers, return numbers.
 */

/** System Quality Number — Van Tharp's SQN */
export function computeSQN(trades, avgTrade, stdDevTrades) {
  if (!trades || !avgTrade || !stdDevTrades || stdDevTrades === 0) return 0;
  return (avgTrade / stdDevTrades) * Math.sqrt(trades);
}

/** Calmar Ratio — annualised return / max drawdown */
export function computeCalmar(annualReturnPct, maxDrawdownPct) {
  if (!maxDrawdownPct || maxDrawdownPct === 0) return 0;
  return annualReturnPct / Math.abs(maxDrawdownPct);
}

/** Omega Ratio — probability-weighted ratio of gains vs losses */
export function computeOmega(returns, threshold = 0) {
  if (!returns || returns.length < 2) return 1;
  const gains = returns.filter(r => r > threshold);
  const losses = returns.filter(r => r < threshold);
  const sumGains = gains.reduce((s, r) => s + (r - threshold), 0);
  const sumLosses = losses.reduce((s, r) => s + Math.abs(r - threshold), 0);
  if (sumLosses === 0) return sumGains > 0 ? 999 : 1;
  return sumGains / sumLosses;
}

/** Kelly % — optimal bet sizing */
export function computeKelly(winRate, avgWin, avgLoss) {
  if (!avgLoss || avgLoss === 0) return 0;
  const r = avgWin / Math.abs(avgLoss);
  return Math.max(0, Math.min(100, (winRate / 100) - ((1 - winRate / 100) / r)) * 100);
}

/** Risk of Ruin — probability of losing entire capital */
export function computeRiskOfRuin(winRate, riskPerTradePct, capital, minCapital) {
  if (!riskPerTradePct || riskPerTradePct <= 0) return 0;
  const p = winRate / 100;
  const q = 1 - p;
  if (p <= q) return 1; // always ruin if edge is negative
  const b = 1 / riskPerTradePct;
  const a = Math.pow(q / p, b);
  const ratio = minCapital / capital || 0.1;
  const exp = Math.pow(a, ratio);
  if (exp > 1 || isNaN(exp)) return 1;
  return exp;
}

/** Ulcer Index — downside risk measure based on drawdown depth and duration */
export function computeUlcerIndex(drawdownSeries) {
  if (!drawdownSeries || drawdownSeries.length < 5) return 0;
  const squared = drawdownSeries.map(d => (d.value || 0) ** 2);
  const mean = squared.reduce((s, v) => s + v, 0) / squared.length;
  return Math.sqrt(mean);
}

/** Recovery Factor — net profit / max drawdown */
export function computeRecoveryFactor(netProfit, maxDrawdownAbs) {
  if (!maxDrawdownAbs || maxDrawdownAbs === 0) return 0;
  return netProfit / Math.abs(maxDrawdownAbs);
}

/** Strategy quality score 0-100 — weighted composite */
export function computeStrategyScore(metrics) {
  const weights = {
    profitFactor: 20,
    sharpe: 20,
    winRate: 15,
    sqn: 15,
    calmar: 10,
    recoveryFactor: 10,
    consistency: 10,
  };

  let score = 0;
  let totalWeight = 0;

  const normalised = {
    profitFactor: Math.min((metrics.profitFactor || 0) / 3 * 100, 100),
    sharpe: Math.min((metrics.sharpeRatio || 0) / 3 * 100, 100),
    winRate: metrics.winRate || 50,
    sqn: Math.min((metrics.sqn || 0) / 5 * 100, 100),
    calmar: Math.min((metrics.calmarRatio || 0) / 5 * 100, 100),
    recoveryFactor: Math.min((metrics.recoveryFactor || 0) / 10 * 100, 100),
    consistency: Math.min(metrics.consistency * 100 || 50, 100),
  };

  for (const [key, weight] of Object.entries(weights)) {
    score += (normalised[key] || 0) * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? Math.round(score / totalWeight) : 0;
}

/** Stress test score — 0-100, higher = more resilient */
export function computeStressScore(worstMonthPnl, maxDD, recoveryDays, totalCapital) {
  let score = 100;
  const cap = totalCapital || 100000;
  if (worstMonthPnl && worstMonthPnl < 0) {
    const hit = Math.abs(worstMonthPnl) / cap;
    score -= hit * 50;
  }
  if (maxDD && maxDD > 15) score -= (maxDD - 15) * 2;
  if (recoveryDays > 30) score -= Math.min((recoveryDays - 30) * 0.5, 15);
  return Math.max(0, Math.min(100, Math.round(score)));
}

/** Sharpe Ratio */
export function computeSharpe(returns, riskFree = 0) {
  if (!returns || returns.length < 2) return 0;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const excess = mean - riskFree;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return excess / std;
}

/** Sortino Ratio — uses downside deviation only */
export function computeSortino(returns, riskFree = 0) {
  if (!returns || returns.length < 2) return 0;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const excess = mean - riskFree;
  const downside = returns.filter(r => r < riskFree).map(r => (r - riskFree) ** 2);
  if (downside.length === 0) return excess > 0 ? 999 : 0;
  const downsideStd = Math.sqrt(downside.reduce((s, v) => s + v, 0) / returns.length);
  if (downsideStd === 0) return 0;
  return excess / downsideStd;
}

/** Volatility (annualised) from daily returns */
export function computeAnnualVol(dailyReturns) {
  if (!dailyReturns || dailyReturns.length < 5) return 0;
  const mean = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (dailyReturns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

/** Expectancy — average PnL per trade */
export function computeExpectancy(avgWin, avgLoss, winRate) {
  const wr = winRate / 100;
  return (wr * avgWin) - ((1 - wr) * Math.abs(avgLoss));
}
