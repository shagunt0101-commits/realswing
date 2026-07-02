"""RealSwing Multi-Agent System"""
from .data_agent import DataAgent, MarketState, IndexTick, OHLCVCandle, OptionStrike, OptionChainSnapshot
from .analyst_agent import AnalystAgent, AnalystReport, FVG, OrderBlock, TimeframeSignal, compute_indicators, resample_ohlc, detect_candlestick_patterns, analyze_oi
from .signal_agent import SignalAgent, TradeSignal
from .risk_executor import RiskAgent, RiskConfig, ExecutorAgent, OrderResult, make_risk_executor_callback
from .report_agent import ReportAgent, compute_strike_levels, build_levels_table
from .strategy_engine import (
    Leg, Strategy, OptionType, Action,
    bull_call_spread, bear_put_spread, straddle, strangle, iron_condor,
    iron_butterfly, covered_call, bull_put_spread, bear_call_spread, jade_lizard,
    compute_payoff, compute_payoff_raw, probability_of_profit, what_if,
    net_delta, net_gamma, net_theta, net_vega, STRATEGY_TEMPLATES
)
