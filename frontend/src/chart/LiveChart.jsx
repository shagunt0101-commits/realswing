import { useState, useEffect, useRef, useCallback } from "react";
import { createChart, CandlestickSeries, LineSeries } from "lightweight-charts";
import { useWorkspace } from "../stores/workspace";

const ORCH_BASE = "http://localhost:9010";

const TF_MS = {
    "1m": 15_000, "3m": 30_000, "5m": 60_000, "15m": 120_000,
    "30m": 180_000, "1h": 300_000, "4h": 600_000, "1d": 3_600_000,
};

const C = {
    panel: "#0D1729",
    border: "#1A2E52",
    accent: "#00D4FF",
    green: "#00E676",
    red: "#FF3B5C",
    dim: "#4A6080",
};

// TradingView-style color for up/down candles
const UP = "#22AB94";
const DN = "#F23645";

export default function LiveChart({ chartId }) {
    const containerRef = useRef(null);
    const chartRef = useRef(null);
    const seriesRef = useRef(null);
    const pollRef = useRef(null);
    const roRef = useRef(null);
    const indicatorSeriesRef = useRef({});

    const chart = useWorkspace(s => s.charts[chartId]);

    const [lastPrice, setLastPrice] = useState(null);
    const [source, setSource] = useState(null);
    const [loading, setLoading] = useState(true);

    const barUrl = useCallback(
        (limit = 200) =>
            `${ORCH_BASE}/history/${chart?.instrument}?timeframe=${chart?.timeframe}&limit=${limit}`,
        [chart?.instrument, chart?.timeframe]
    );

    // ── Init chart once ──
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const c = createChart(el, {
            layout: {
                background: { color: "#0D1729" },
                textColor: "#4A6080",
                fontSize: 10,
            },
            grid: {
                vertLines: { color: "#1A2540" },
                horzLines: { color: "#1A2540" },
            },
            crosshair: {
                mode: 0,
                vertLine: { color: "#00D4FF", width: 1, style: 2, labelBackgroundColor: "#00D4FF" },
                horzLine: { color: "#00D4FF", width: 1, style: 2, labelBackgroundColor: "#00D4FF" },
            },
            timeScale: {
                borderColor: "#1A2E52",
                timeVisible: true,
                secondsVisible: false,
            },
            rightPriceScale: {
                borderColor: "#1A2E52",
                alignLabels: true,
            },
            width: el.clientWidth,
            height: el.clientHeight,
            handleScroll: true,
            handleScale: true,
        });

        const cs = c.addSeries(CandlestickSeries, {
            upColor: UP,
            downColor: DN,
            borderUpColor: UP,
            borderDownColor: DN,
            wickUpColor: UP,
            wickDownColor: DN,
        });

        chartRef.current = c;
        seriesRef.current = cs;

        // Crosshair HUD
        c.subscribeCrosshairMove(param => {
            if (!param.time || !param.point) {
                setLastPrice(null);
                return;
            }
            const data = param.seriesData.get(cs);
            if (data) setLastPrice(data.close);
        });

        // ResizeObserver
        const ro = new ResizeObserver(() => {
            if (el && c) {
                c.applyOptions({ width: el.clientWidth, height: el.clientHeight });
            }
        });
        ro.observe(el);
        roRef.current = ro;

        return () => {
            ro.disconnect();
            c.remove();
            chartRef.current = null;
            seriesRef.current = null;
        };
    }, []);

    // ── Fetch bars ──
    useEffect(() => {
        if (!seriesRef.current) return;
        setLoading(true);
        setSource(null);

        fetch(barUrl(200))
            .then(r => r.json())
            .then(data => {
                if (data.bars?.length) {
                    seriesRef.current.setData(data.bars);
                    setLastPrice(data.bars[data.bars.length - 1].close);
                    setSource(data.source || null);
                }
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [barUrl]);

    // ── Poll for updates ──
    useEffect(() => {
        if (!seriesRef.current) return;
        const pollMs = TF_MS[chart?.timeframe] || 60_000;

        const poll = setInterval(() => {
            fetch(barUrl(5))
                .then(r => r.json())
                .then(data => {
                    if (data.bars?.length) {
                        data.bars.forEach(b => seriesRef.current.update(b));
                        setLastPrice(data.bars[data.bars.length - 1].close);
                        if (data.source) setSource(data.source);
                    }
                })
                .catch(() => {});
        }, pollMs);

        pollRef.current = poll;
        return () => clearInterval(poll);
    }, [barUrl, chart?.timeframe]);

    // ── Indicators ──
    useEffect(() => {
        if (!chart || !chartRef.current) return;

        // Nuke old indicator series
        Object.values(indicatorSeriesRef.current).forEach(s => {
            try { chartRef.current?.removeSeries(s); } catch {}
        });
        indicatorSeriesRef.current = {};
        if (!chart.indicators?.length) return;

        (async () => {
            try {
                const r = await fetch(
                    `${ORCH_BASE}/indicators/${chart.instrument}?timeframe=${chart.timeframe}&indicators=${chart.indicators.join(",")}`
                );
                const data = await r.json();
                if (!data) return;

                chart.indicators.forEach(name => {
                    const indData = data[name];
                    if (!indData) return;

                    if (name.startsWith("RSI") || name.startsWith("Stoch") ||
                        name === "CCI" || name === "Williams %R" || name === "MFI") {
                        // Separate pane below chart
                        const pane = chartRef.current.addPane({ height: 60 });
                        const series = chartRef.current.addSeries(LineSeries, {
                            color: "#00D4FF", lineWidth: 1.5,
                            priceFormat: { type: "price", precision: 1 },
                            pane,
                        });
                        series.setData(Array.isArray(indData) ? indData : []);
                        indicatorSeriesRef.current[name] = series;

                    } else if (name.startsWith("Bollinger") && data.Bollinger?.upper) {
                        const up = chartRef.current.addSeries(LineSeries, {
                            color: "#A78BFA", lineWidth: 1,
                        });
                        up.setData(data.Bollinger.upper);
                        indicatorSeriesRef.current[`Bollinger_upper`] = up;

                        const mid = chartRef.current.addSeries(LineSeries, {
                            color: "#FF9800", lineWidth: 1,
                        });
                        mid.setData(data.Bollinger.middle);
                        indicatorSeriesRef.current[`Bollinger_middle`] = mid;

                        const low = chartRef.current.addSeries(LineSeries, {
                            color: "#A78BFA", lineWidth: 1,
                        });
                        low.setData(data.Bollinger.lower);
                        indicatorSeriesRef.current[`Bollinger_lower`] = low;

                    } else {
                        const series = chartRef.current.addSeries(LineSeries, {
                            color: name.includes("EMA") ? "#FF9800" : "#A78BFA",
                            lineWidth: 1,
                        });
                        series.setData(Array.isArray(indData) ? indData : []);
                        indicatorSeriesRef.current[name] = series;
                    }
                });

                // Re-fit after adding indicators
                setTimeout(() => chartRef.current?.timeScale().fitContent(), 100);
            } catch {}
        })();
    }, [chart?.indicators?.join(","), chart?.instrument, chart?.timeframe]);

    // ── Fit content on timeframe change ──
    useEffect(() => {
        if (chartRef.current) {
            setTimeout(() => chartRef.current.timeScale().fitContent(), 150);
        }
    }, [chart?.instrument, chart?.timeframe]);

    const isUp = lastPrice !== null;

    return (
        <div style={{ width: "100%", height: "100%", position: "relative" }}>
            {/* Chart container */}
            <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

            {/* Top-left: source badge */}
            {loading && (
                <div style={{
                    position: "absolute", top: 8, left: 8,
                    color: C.dim, fontSize: 10, fontFamily: "monospace",
                }}>
                    Loading...
                </div>
            )}
            {source && (
                <div style={{
                    position: "absolute", top: 8, left: 8,
                    background: source === "nubra" ? "#22AB9418" : "#A78BFA18",
                    border: `1px solid ${source === "nubra" ? "#22AB9444" : "#A78BFA44"}`,
                    borderRadius: 4, padding: "2px 8px",
                    fontSize: 10, fontFamily: "monospace",
                    color: source === "nubra" ? "#22AB94" : "#A78BFA",
                    display: "flex", alignItems: "center", gap: 4,
                }}>
                    <span style={{ width: 5, height: 5, borderRadius: "50%",
                        background: source === "nubra" ? "#22AB94" : "#A78BFA" }} />
                    {source === "nubra" ? "Nubra" : "Yahoo"}
                </div>
            )}

            {/* Top-right: last price */}
            {lastPrice !== null && (
                <div style={{
                    position: "absolute", top: 6, right: 8,
                    background: "#0D1729dd",
                    borderRadius: 4, padding: "2px 10px",
                    fontSize: 13, fontFamily: "monospace", fontWeight: 700,
                    color: isUp ? UP : DN,
                }}>
                    ₹{lastPrice.toFixed(2)}
                </div>
            )}

            {/* Bottom-left: time controls hint on hover */}
            {source && (
                <div style={{
                    position: "absolute", bottom: 6, right: 8,
                    fontSize: 9, color: C.dim, fontFamily: "monospace",
                }}>
                    {chart?.instrument} · {chart?.timeframe}
                </div>
            )}
        </div>
    );
}
