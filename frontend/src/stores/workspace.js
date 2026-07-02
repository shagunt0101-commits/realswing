import { create } from "zustand";
import { persist } from "zustand/middleware";

// ── DEFAULTS ────────────────────────────────────────────────────────────────

const MAX_PANELS = 9;

const makeChart = (id, instrument = "NIFTY", timeframe = "5m", indicators = []) => ({
    id,
    instrument,
    timeframe,
    indicators,       // ["EMA9", "EMA21", "RSI", "BB"]
    linked: false,
});

const defaultLayout = [
    { i: "chart-1", x: 0, y: 0, w: 6, h: 4 },
    { i: "chart-2", x: 6, y: 0, w: 6, h: 4 },
];

export const INSTRUMENTS = ["NIFTY", "BANKNIFTY", "SENSEX", "FINNIFTY"];
export const TIMEFRAMES  = ["1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d"];
export const ALL_INDICATORS = {
    trend: ["EMA9", "EMA21", "EMA50", "EMA200", "SMA20", "SMA50", "SMA200", "MACD", "SuperTrend", "Ichimoku"],
    momentum: ["RSI(14)", "Stochastic", "CCI", "Williams %R", "MFI", "ROC"],
    volatility: ["Bollinger Bands", "Keltner Channels", "ATR"],
    volume: ["Volume", "OBV", "VWAP", "CMF"],
    support: ["Pivot Daily", "Pivot Weekly", "Fibonacci"],
};

export const useWorkspace = create(
    persist(
        (set, get) => ({
            panels: ["chart-1", "chart-2"],
            charts: {
                "chart-1": makeChart("chart-1", "NIFTY", "5m", ["EMA9", "EMA21"]),
                "chart-2": makeChart("chart-2", "BANKNIFTY", "15m", ["RSI(14)"]),
            },
            layout: defaultLayout,
            linkedInstrument: null,

            // ── Actions ──

            addPanel: () => {
                const { panels, charts, layout } = get();
                if (panels.length >= MAX_PANELS) return;
                const id = `chart-${panels.length + 1}`;
                const inst = charts[panels[0]]?.instrument || "NIFTY";
                set({
                    panels: [...panels, id],
                    charts: { ...charts, [id]: makeChart(id, inst, "5m") },
                    layout: [...layout, { i: id, x: 0, y: 0, w: 6, h: 4 }],
                });
            },

            removePanel: (id) => {
                const { panels, charts, layout } = get();
                if (panels.length <= 1) return;
                const { [id]: _, ...rest } = charts;
                set({
                    panels: panels.filter(p => p !== id),
                    charts: rest,
                    layout: layout.filter(l => l.i !== id),
                });
            },

            updateChart: (id, patch) => {
                const charts = { ...get().charts };
                if (charts[id]) {
                    charts[id] = { ...charts[id], ...patch };
                    // If linked, propagate instrument/timeframe
                    const linked = get().linkedInstrument;
                    if (linked && patch.instrument) {
                        Object.keys(charts).forEach(k => {
                            if (k !== id) charts[k] = { ...charts[k], instrument: patch.instrument };
                        });
                    }
                    set({ charts });
                }
            },

            toggleIndicator: (chartId, ind) => {
                const chart = get().charts[chartId];
                if (!chart) return;
                const has = chart.indicators.includes(ind);
                const indicators = has
                    ? chart.indicators.filter(i => i !== ind)
                    : [...chart.indicators, ind];
                get().updateChart(chartId, { indicators });
            },

            setLinkedInstrument: (inst) => set({ linkedInstrument: inst }),

            resetLayout: () => set({
                panels: ["chart-1", "chart-2"],
                charts: {
                    "chart-1": makeChart("chart-1", "NIFTY", "5m", ["EMA9", "EMA21"]),
                    "chart-2": makeChart("chart-2", "BANKNIFTY", "15m", ["RSI(14)"]),
                },
                layout: defaultLayout,
                linkedInstrument: null,
            }),
        }),
        { name: "realswing_workspace" }
    )
);
