import { create } from "zustand";

/**
 * Order Flow Store — institutional state management.
 *
 * Manages:
 *   - Tick/feed data (price, bid, ask, volume, delta)
 *   - Historical footprint rows (for rendering virtualized)
 *   - Pattern detection results
 *   - Panel configuration and visibility
 *   - Session metadata
 */

const MAX_FOOTPRINT_ROWS = 100_000;
const MAX_TICK_HISTORY = 50_000;
const MAX_DEPTH_SNAPSHOTS = 500;

const initialPanels = [
    { id: 'footprint',  type: 'footprint',   label: 'Footprint',  w: 4, h: 3, visible: true },
    { id: 'dom',        type: 'dom',          label: 'DOM',       w: 2, h: 3, visible: true },
    { id: 'timesales',  type: 'timesales',    label: 'T&S',       w: 2, h: 3, visible: true },
    { id: 'heatmap',    type: 'heatmap',      label: 'Heatmap',   w: 3, h: 2, visible: false },
    { id: 'volprofile', type: 'volprofile',   label: 'Vol Profile', w: 3, h: 2, visible: false },
    { id: 'aipanel',    type: 'aipanel',      label: 'AI Interp', w: 2, h: 2, visible: false },
    { id: 'metrics',    type: 'metrics',      label: 'Metrics',   w: 2, h: 2, visible: false },
];

export const useOrderFlowStore = create((set, get) => ({
    // ── Connection ──
    connected: false,
    instrument: 'NIFTY',
    exchange: 'NSE',

    // ── Feed data ──
    lastPrice: null,
    bid: null,
    ask: null,
    spread: null,
    lastTick: null,

    // ── Depth of Market ──
    // bidLevels/askLevels = [{ price, size, orders }]
    bidLevels: [],
    askLevels: [],

    // ── Tick history ──
    // Each tick: { time, price, size, side, delta }
    ticks: [],

    // ── Footprint data ──
    // Each row: { price, bidVol, askVol, totalVol, delta, open, high, low, close, time }
    footprint: [],

    // ── Cumulative delta ──
    cumulativeDelta: 0,
    deltaHistory: [], // [{ time, delta, cumDelta }]

    // ── Volume Profile ──
    volumeProfile: null, // { poc, valueAreaHigh, valueAreaLow, hvn, lvn, distribution }

    // ── Pattern detection results ──
    patterns: {
        iceberg: [],
        spoofing: [],
        absorption: [],
        exhaustion: [],
        sweep: [],
        largeTrades: [],
        finishedAuction: [],
        stackedImbalance: [],
    },

    // ── Delta/Volume divergences ──
    divergences: [],

    // ── AI interpretation ──
    aiInterpretation: null,
    aiLoading: false,

    // ── Panel layout ──
    panels: initialPanels,
    activeLayout: 'full',       // full | footprint_only | dom_only | custom

    // ── Configuration ──
    config: {
        footprintBidColor: '#00E676',
        footprintAskColor: '#FF3B5C',
        deltaPositiveColor: '#00E676',
        deltaNegativeColor: '#FF3B5C',
        volumeProfileColors: ['#00D4FF22', '#00D4FF44', '#00D4FF66'],
        domBidColor: '#00E67633',
        domAskColor: '#FF3B5C33',
        showCumulativeDelta: true,
        showVWAP: true,
        showPOC: true,
        showValueArea: true,
        barSpacing: 8,
        maxFootprintRows: 200,
        domDepth: 20,
    },

    // ── Actions ──

    setInstrument: (instrument, exchange = 'NSE') => set({ instrument, exchange }),

    setConnection: (connected) => set({ connected }),

    /** Ingest a tick from WS or API */
    addTick: (tick) => {
        const { ticks, deltaHistory, cumulativeDelta } = get();
        const newTicks = [tick, ...ticks].slice(0, MAX_TICK_HISTORY);
        const newCumDelta = cumulativeDelta + (tick.delta || 0);
        const newDeltaHist = [...deltaHistory, { time: tick.time, delta: tick.delta || 0, cumDelta: newCumDelta }].slice(-1000);
        set({
            lastPrice: tick.price,
            lastTick: tick,
            ticks: newTicks,
            cumulativeDelta: newCumDelta,
            deltaHistory: newDeltaHist,
        });
    },

    /** Update depth (bid/ask levels) */
    setDepth: (bidLevels, askLevels) => {
        const bids = bidLevels.slice(0, 20);
        const asks = askLevels.slice(0, 20);
        const bestBid = bids[0]?.price || null;
        const bestAsk = asks[0]?.price || null;
        set({
            bidLevels: bids,
            askLevels: asks,
            bid: bestBid,
            ask: bestAsk,
            spread: bestBid && bestAsk ? bestAsk - bestBid : null,
        });
    },

    /** Append a footprint bar */
    addFootprint: (bar) => {
        const { footprint } = get();
        const newFootprint = [...footprint, bar].slice(-MAX_FOOTPRINT_ROWS);
        set({ footprint: newFootprint });
    },

    /** Set footprint batch (e.g. on initial load) */
    setFootprint: (rows) => set({ footprint: rows.slice(-MAX_FOOTPRINT_ROWS) }),

    /** Volume profile computed externally */
    setVolumeProfile: (vp) => set({ volumeProfile: vp }),

    /** Add pattern detection result */
    addPattern: (type, result) => {
        const patterns = { ...get().patterns };
        if (patterns[type]) {
            patterns[type] = [result, ...patterns[type]].slice(0, 50);
            set({ patterns });
        }
    },

    /** Add divergence */
    addDivergence: (div) => {
        const divergences = [div, ...get().divergences].slice(0, 20);
        set({ divergences });
    },

    /** AI interpretation */
    setAIInterpretation: (ai) => set({ aiInterpretation: ai, aiLoading: false }),
    setAILoading: (v) => set({ aiLoading: v }),

    /** Panel visibility */
    togglePanel: (panelId) => {
        const panels = get().panels.map(p =>
            p.id === panelId ? { ...p, visible: !p.visible } : p
        );
        set({ panels });
    },

    setPanelVisibility: (panelId, visible) => {
        const panels = get().panels.map(p =>
            p.id === panelId ? { ...p, visible } : p
        );
        set({ panels });
    },

    /** Reset all data (on disconnect / instrument change) */
    reset: () => set({
        lastPrice: null, bid: null, ask: null, spread: null, lastTick: null,
        bidLevels: [], askLevels: [], ticks: [],
        footprint: [], cumulativeDelta: 0, deltaHistory: [],
        volumeProfile: null,
        patterns: { iceberg: [], spoofing: [], absorption: [], exhaustion: [], sweep: [], largeTrades: [], finishedAuction: [], stackedImbalance: [] },
        divergences: [], aiInterpretation: null,
    }),

    updateConfig: (patch) => set({ config: { ...get().config, ...patch } }),
}));
