# Institutional Order Flow Workstation — Architecture

## Data Flow

```
Nubra API/WS → EventBus → State (Zustand) → Rendering Engines → Canvas DOM
                    ↕                        ↕
              Detection Engines        React Components (panels)
```

## Module Map

| Module | File | Responsibility |
|--------|------|----------------|
| EventBus | engines/EventBus.js | typed pub/sub, WS bridge, heartbeat |
| Store | stores/orderflowStore.js | session state, config, panel layout |
| Footprint Engine | engines/FootprintEngine.js | Canvas footprint bars (bid/ask vol, delta) |
| DOM Engine | engies/DOMEngine.js | Depth-of-Market ladder rendering |
| TimeSales | engines/TimeSalesEngine.js | Tick-by-tick tape |
| Heatmap Engine | engines/HeatmapEngine.js | Bookmap-style liquidity grid |
| Vol Profile Engine | engines/VolumeProfileEngine.js | VPVR with HVN/LVN/POC/VA |
| Delta Engine | engines/DeltaEngine.js | Cumulative delta, delta divergences |
| Liquidity Engine | engines/LiquidityEngine.js | Iceberg/spoof/sweep/absorption detect |
| AI Panel | components/AIPanel.jsx | LLM-based market interpretation |
| Metrics | components/InstitutionalMetrics.jsx | Imbalance ratios, key levels |

## File Layout

```
orderflow/
├── stores/
│   └── orderflowStore.js         ← Zustand store
├── engines/
│   ├── EventBus.js               ← Pub/sub event system
│   ├── FootprintEngine.js        ← Canvas footprint chart
│   ├── DOMEngine.js              ← Depth of market
│   ├── TimeSalesEngine.js        ← Time & sales
│   ├── HeatmapEngine.js          ← Bookmap-style heatmap
│   ├── VolumeProfileEngine.js    ← VPVR calculations
│   ├── DeltaEngine.js            ← Delta computations
│   └── LiquidityEngine.js        ← Pattern detection
├── components/
│   ├── OrderFlowWorkstation.jsx  ← Main multi-panel layout
│   ├── FootprintChart.jsx        ← React wrapper
│   ├── DOMView.jsx               ← DOM ladder panel
│   ├── TimeSalesView.jsx         ← Time & sales panel
│   ├── LiquidityHeatmap.jsx      ← Heatmap panel
│   ├── VolumeProfileView.jsx     ← Volume profile panel
│   ├── AIPanel.jsx               ← AI interpretation
│   └── InstitutionalMetrics.jsx  ← Metrics dashboard
└── utils/
    └── calculations.js           ← Shared math/detect fns
```
