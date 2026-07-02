import { create } from 'zustand';

const genEquity = () => {
  const curve = [];
  let v = 100000;
  for (let i = 0; i < 252; i++) {
    const t = new Date(2025, 6, 1);
    t.setDate(t.getDate() + i);
    v += (Math.random() - 0.45) * 2000;
    curve.push({ time: t.toISOString().slice(0, 10), value: Math.round(v) });
  }
  return curve;
};

const genDD = (equity) => {
  if (!equity || equity.length === 0) return [];
  let peak = equity[0].value;
  return equity.map(e => {
    if (e.value > peak) peak = e.value;
    return { time: e.time, value: Math.round(((e.value - peak) / peak) * 10000) / 100 };
  });
};

const genMonthlyReturns = () => {
  const months = [];
  for (let m = 0; m < 12; m++) {
    months.push({
      year: 2025,
      month: m + 1,
      return: (Math.random() - 0.4) * 8,
      trades_count: Math.floor(Math.random() * 50 + 10),
    });
  }
  return months;
};

const genTrades = (count = 100) => {
  const trades = [];
  const start = new Date(2025, 0, 1).getTime();
  for (let i = 0; i < count; i++) {
    const entry = start + i * 86400000 * 2 + Math.random() * 86400000;
    const held = Math.floor(Math.random() * 10 + 1);
    const exit = entry + held * 86400000;
    const pnl = (Math.random() - 0.45) * 15000;
    trades.push({
      entry_time: entry,
      exit_time: exit,
      pnl: Math.round(pnl),
      direction: Math.random() > 0.5 ? 'long' : 'short',
      bars_held: held,
    });
  }
  return trades;
};

const genDailyReturns = () => {
  const returns = [];
  for (let i = 0; i < 252; i++) {
    const d = new Date(2025, 6, 1);
    d.setDate(d.getDate() + i);
    returns.push({ date: d.toISOString().slice(0, 10), return: (Math.random() - 0.48) * 3 });
  }
  return returns;
};

function computeFromTrades(trades) {
  if (!trades || trades.length === 0) return {};
  const winning = trades.filter(t => t.pnl > 0);
  const losing = trades.filter(t => t.pnl < 0);
  const longs = trades.filter(t => t.direction === 'long');
  const shorts = trades.filter(t => t.direction === 'short');
  const winWinners = winning.filter(t => t.direction === 'long');
  const winLosers = losing.filter(t => t.direction === 'long');

  const netPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const grossProfit = winning.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = losing.reduce((s, t) => s + t.pnl, 0);
  const avgWin = winning.length > 0 ? grossProfit / winning.length : 0;
  const avgLoss = losing.length > 0 ? Math.abs(grossLoss) / losing.length : 0;
  const winRate = trades.length > 0 ? (winning.length / trades.length) * 100 : 0;

  return {
    total_trades: trades.length,
    winning_trades: winning.length,
    losing_trades: losing.length,
    long_trades: longs.length,
    short_trades: shorts.length,
    win_rate: Math.round(winRate * 10) / 10,
    long_win_rate: longs.length > 0 ? Math.round((winWinners.length / longs.length) * 1000) / 10 : 0,
    short_win_rate: shorts.length > 0 ? Math.round(((shorts.length - losing.filter(t => t.direction === 'short').length) / shorts.length) * 1000) / 10 : 0,
    net_pnl: netPnl,
    gross_profit: grossProfit,
    gross_loss: grossLoss,
    avg_trade: trades.length > 0 ? netPnl / trades.length : 0,
    avg_winning_trade: avgWin,
    avg_losing_trade: -avgLoss,
    largest_winner: winning.length > 0 ? Math.max(...winning.map(t => t.pnl)) : 0,
    largest_loser: losing.length > 0 ? Math.min(...losing.map(t => t.pnl)) : 0,
    avg_bars_in_trade: trades.reduce((s, t) => s + t.bars_held, 0) / trades.length,
    avg_holding_time_ms: trades.reduce((s, t) => s + (t.exit_time - t.entry_time), 0) / trades.length,
    profit_factor: Math.abs(grossLoss) > 0 ? grossProfit / Math.abs(grossLoss) : grossProfit > 0 ? 999 : 0,
  };
}

const generateDemoData = () => {
  const trades = genTrades(120);
  const base = computeFromTrades(trades);
  const equity = genEquity();
  const dd = genDD(equity);
  const dailyRet = genDailyReturns();
  const monthly = genMonthlyReturns();
  const winRate = base.win_rate / 100;
  const avgWin = base.avg_winning_trade || 5000;
  const avgLoss = base.avg_losing_trade || 3000;

  return {
    results: {
      ...base,
      total_return_pct: ((base.net_pnl / 100000) * 100),
      annual_return_pct: ((base.net_pnl / 100000) * 100) * (252 / trades.length),
      profit_factor: base.profit_factor,
      expectancy: computeExpectancy(avgWin, -avgLoss, winRate * 100),
      strategy_score: 0,
      // Performance
      recovery_factor: 0,
      sqn: 0,
      sharpe_ratio: 0,
      sortino_ratio: 0,
      calmar_ratio: 0,
      omega_ratio: 0,
      // Risk
      max_drawdown: Math.min(...dd.map(d => d.value)),
      avg_drawdown: dd.reduce((s, d) => s + d.value, 0) / dd.length,
      consecutive_losses: 0,
      consecutive_wins: 0,
      ulcer_index: 0,
      volatility_annual: 0,
      risk_reward_ratio: Math.abs(avgWin / avgLoss) || 0,
      kelly_pct: 0,
      risk_of_ruin: 0,
      // Quality
      overall_score: 0,
      trend_score: 72,
      mean_reversion_score: 65,
      consistency_score: 78,
      robustness_score: 70,
      stability_score: 68,
      risk_score: 75,
      live_readiness_score: 62,
      monte_carlo_confidence: 71,
      // Stress
      worst_month_pnl: -18500,
      worst_week_pnl: -8200,
      worst_day_pnl: -4500,
      worst_trade_pnl: base.largest_loser,
      best_trade_pnl: base.largest_winner,
      longest_drawdown_days: 45,
      recovery_time_days: 18,
      stress_test_score: 0,
      // Execution
      avg_entry_slippage: 0.15,
      avg_exit_slippage: 0.12,
      total_commissions: 4850,
      total_fees: 1250,
      avg_position_size: 75000,
      // Chart data
      equity_curve: equity,
      drawdown_curve: dd,
      trades,
      monthly_returns: monthly,
      daily_returns: dailyRet,
    },
  };
};

function computeExpectancy(avgWin, avgLoss, winRate) {
  const wr = winRate / 100;
  return (wr * avgWin) - ((1 - wr) * Math.abs(avgLoss));
}

export const useBacktestStore = create((set, get) => ({
  results: null,
  loading: false,
  expandedGroups: {
    performance: true,
    risk: false,
    trades: false,
    execution: false,
    quality: false,
    stress: false,
  },

  initializeDemo: () => {
    const data = generateDemoData();
    set(data);
  },

  setResults: (results) => {
    set({ results, loading: false });
  },

  setLoading: (loading) => set({ loading }),

  toggleGroup: (group) => {
    set((state) => ({
      expandedGroups: {
        ...state.expandedGroups,
        [group]: !state.expandedGroups[group],
      },
    }));
  },

  expandAll: () => {
    const all = {};
    for (const key of Object.keys(get().expandedGroups)) all[key] = true;
    set({ expandedGroups: all });
  },

  collapseAll: () => {
    const all = {};
    for (const key of Object.keys(get().expandedGroups)) all[key] = false;
    set({ expandedGroups: all });
  },

  reset: () => set({ results: null, loading: false }),
}));
