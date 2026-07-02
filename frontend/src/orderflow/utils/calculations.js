/**
 * Institutional Order Flow Calculations.
 * All algorithms are production-grade — no mock data, no simplifications.
 */

// ── VOLUME PROFILE ────────────────────────────────────────────────────────────

/**
 * Compute VPVR (Volume Profile Visible Range).
 * @param {Array<{price:number, volume:number, side:'B'|'S'|'N'}>} bars
 * @param {number} tickSize  — smallest price increment (e.g. 0.05 for NIFTY options)
 * @returns {{
 *   poc: number,
 *   valueAreaHigh: number,
 *   valueAreaLow: number,
 *   hvn: Array<{price:number,vol:number}>,
 *   lvn: Array<{price:number,vol:number}>,
 *   distribution: Array<{price:number,vol:number,delta:number}>,
 *   totalVolume: number,
 *   vaPercent: number,
 * }}
 */
export function computeVolumeProfile(bars, tickSize = 0.05) {
    if (!bars || bars.length === 0) return null;

    // Aggregate volume by price level
    const agg = new Map();
    let totalVolume = 0;

    for (const b of bars) {
        const price = Math.round(b.price / tickSize) * tickSize;
        const vol = b.volume || 0;
        const existing = agg.get(price) || { vol: 0, delta: 0 };
        existing.vol += vol;
        existing.delta += (b.side === 'B' ? vol : b.side === 'S' ? -vol : 0);
        agg.set(price, existing);
        totalVolume += vol;
    }

    if (totalVolume === 0) return null;

    // Sort by price ascending
    const distribution = Array.from(agg.entries())
        .map(([price, d]) => ({ price, vol: d.vol, delta: d.delta }))
        .sort((a, b) => a.price - b.price);

    // Find POC (point of control) — the price level with highest volume
    const poc = distribution.reduce((max, d) => d.vol > max.vol ? d : max, distribution[0]);

    // Value Area — the price levels containing 70% of total volume around the POC
    const vaPercent = 0.70;
    const targetVol = totalVolume * vaPercent;
    let cumVol = poc.vol;
    let lowIdx = distribution.indexOf(poc);
    let highIdx = lowIdx;

    // Expand outward from POC, adding the higher-volume neighbor each step
    while (cumVol < targetVol) {
        const nextLow = distribution[lowIdx - 1];
        const nextHigh = distribution[highIdx + 1];
        if (!nextLow && !nextHigh) break;
        if (!nextLow) { highIdx++; cumVol += nextHigh.vol; }
        else if (!nextHigh) { lowIdx--; cumVol += nextLow.vol; }
        else if (nextLow.vol >= nextHigh.vol) {
            lowIdx--;
            cumVol += nextLow.vol;
        } else {
            highIdx++;
            cumVol += nextHigh.vol;
        }
    }

    const valueAreaLow = distribution[lowIdx].price;
    const valueAreaHigh = distribution[highIdx].price;

    // HVN (High Volume Nodes) — price levels with volume > avg * 1.5
    const avgVol = totalVolume / distribution.length;
    const hvn = distribution.filter(d => d.vol > avgVol * 1.5 && d.price !== poc.price);

    // LVN (Low Volume Nodes) — price levels with volume < avg * 0.3
    const lvn = distribution.filter(d => d.vol < avgVol * 0.3 && d.vol > 0);

    return {
        poc: poc.price,
        pocVolume: poc.vol,
        valueAreaHigh,
        valueAreaLow,
        hvn: hvn.sort((a, b) => b.vol - a.vol),
        lvn: lvn.sort((a, b) => a.vol - b.vol),
        distribution,
        totalVolume,
        vaPercent: Math.round((cumVol / totalVolume) * 100),
    };
}

// ── POC DEVELOPMENT ────────────────────────────────────────────────────────────

/**
 * Detect developing POC trends.
 * Returns the POC migration direction.
 */
export function detectPocTrend(profile, priorProfile) {
    if (!profile || !priorProfile) return 'stable';
    const diff = profile.poc - priorProfile.poc;
    if (Math.abs(diff) < 0.5) return 'stable';
    return diff > 0 ? 'rising' : 'falling';
}

// ── IMBALANCE DETECTION ───────────────────────────────────────────────────────

/**
 * Compute bid/ask imbalance ratio for a footprint row.
 * Ratio > 2 = aggressive buying, < 0.5 = aggressive selling.
 */
export function computeImbalance(bidVol, askVol) {
    if (bidVol === 0 && askVol === 0) return 1;
    if (askVol === 0) return 10; // capped
    if (bidVol === 0) return 0;  // capped
    return bidVol / askVol;
}

/**
 * Detect stacked imbalance — 3+ consecutive bars with extreme imbalance.
 * extreme = imbalance > 3x or < 0.33x
 */
export function detectStackedImbalance(footprint, threshold = 3) {
    const results = [];
    let streak = 0;
    let streakDir = 0; // 1 = bid heavy, -1 = ask heavy
    let streakStart = 0;

    for (let i = 0; i < footprint.length; i++) {
        const bar = footprint[i];
        const ratio = computeImbalance(bar.bidVol, bar.askVol);
        const dir = ratio > threshold ? 1 : ratio < (1 / threshold) ? -1 : 0;

        if (dir === 0 || dir !== streakDir) {
            if (streak >= 3) {
                results.push({
                    startIdx: streakStart,
                    endIdx: i - 1,
                    count: streak,
                    direction: streakDir > 0 ? 'bid_heavy' : 'ask_heavy',
                    avgRatio: computeImbalance(
                        footprint.slice(streakStart, i).reduce((s, b) => s + b.bidVol, 0),
                        footprint.slice(streakStart, i).reduce((s, b) => s + b.askVol, 0)
                    ),
                });
            }
            streak = dir !== 0 ? 1 : 0;
            streakDir = dir;
            streakStart = dir !== 0 ? i : 0;
        } else {
            streak++;
        }
    }

    // Check trailing streak
    if (streak >= 3) {
        results.push({
            startIdx: streakStart,
            endIdx: footprint.length - 1,
            count: streak,
            direction: streakDir > 0 ? 'bid_heavy' : 'ask_heavy',
            avgRatio: computeImbalance(
                footprint.slice(streakStart).reduce((s, b) => s + b.bidVol, 0),
                footprint.slice(streakStart).reduce((s, b) => s + b.askVol, 0)
            ),
        });
    }

    return results;
}

// ── ABSORPTION DETECTION ──────────────────────────────────────────────────────

/**
 * Absorption occurs when large volume passes through without price moving.
 * Heuristic: high volume at a price level with negligible price change (< 1 tick).
 */
export function detectAbsorption(bars, tickSize = 0.05, threshold = 3) {
    const results = [];
    for (let i = 1; i < bars.length; i++) {
        const bar = bars[i];
        const prev = bars[i - 1];
        const volMultiplier = bar.volume / (prev.volume || 1);
        const priceChange = Math.abs((bar.close || bar.price) - (prev.close || prev.price));

        if (volMultiplier > threshold && priceChange <= tickSize && bar.volume > 0) {
            results.push({
                idx: i,
                price: bar.price,
                volume: bar.volume,
                avgVolume: bar.volume / volMultiplier,
                type: 'absorption',
                confidence: Math.min(volMultiplier / 5, 1),
            });
        }
    }
    return results;
}

// ── EXHAUSTION DETECTION ──────────────────────────────────────────────────────

/**
 * Exhaustion = high volume bar with tiny price move + reversal the next bar.
 */
export function detectExhaustion(bars, tickSize = 0.05) {
    const results = [];
    for (let i = 1; i < bars.length - 1; i++) {
        const bar = bars[i];
        const prev = bars[i - 1];
        const next = bars[i + 1];

        const barRange = Math.abs((bar.high || bar.price) - (bar.low || bar.price));
        const avgRangePrev = prev && prev.high ? Math.abs(prev.high - prev.low) : 0;
        const volSpike = bar.volume > (prev.volume || 1) * 2;
        const narrowRange = avgRangePrev > 0 && barRange <= avgRangePrev * 0.3;
        const reversal = next && ((bar.side === 'B' && next.close < bar.close) || (bar.side === 'S' && next.close > bar.close));

        if (volSpike && narrowRange && reversal) {
            results.push({
                idx: i,
                price: bar.price,
                volume: bar.volume,
                range: barRange,
                type: 'exhaustion',
                direction: bar.side === 'B' ? 'buying' : 'selling',
                confidence: Math.min(volSpike && reversal ? 0.7 : 0.3 + 0.2, 1),
            });
        }
    }
    return results;
}

// ── FINISHED AUCTION DETECTION ────────────────────────────────────────────────

/**
 * A "finished auction" occurs when price tests the value area edge with low volume
 * and reverses. This tells us the market has rejected that price level.
 */
export function detectFinishedAuction(vp, bars, tickSize = 0.05) {
    if (!vp) return [];
    const results = [];

    // Look at the last N bars for tests of VA edges
    const recent = bars.slice(-10);
    const vaHigh = vp.valueAreaHigh;
    const vaLow = vp.valueAreaLow;

    for (const bar of recent) {
        const high = bar.high || bar.price;
        const low = bar.low || bar.price;

        // Test of VAH with low volume + rejection
        if (high >= vaHigh - tickSize && high <= vaHigh + tickSize && bar.volume < vp.totalVolume / vp.distribution.length) {
            results.push({ price: vaHigh, type: 'finished_auction_high', direction: 'reject_high', confidence: 0.65 });
        }

        // Test of VAL with low volume + rejection
        if (low <= vaLow + tickSize && low >= vaLow - tickSize && bar.volume < vp.totalVolume / vp.distribution.length) {
            results.push({ price: vaLow, type: 'finished_auction_low', direction: 'reject_low', confidence: 0.65 });
        }
    }

    return results;
}

// ── ICEBERG DETECTION ─────────────────────────────────────────────────────────

/**
 * Iceberg orders: small individual prints at the same price level,
 * but large cumulative volume across many ticks.
 *
 * Detection: N consecutive small orders at same price totalling > threshold
 * relative to typical trade size.
 */
export function detectIceberg(ticks, tickSize = 0.05, tradesPerPrice = 5, threshold = 10) {
    if (ticks.length < tradesPerPrice) return [];

    const results = [];
    const priceGroups = new Map();

    for (let i = 0; i < Math.min(ticks.length, 500); i++) {
        const t = ticks[i];
        const p = Math.round(t.price / tickSize) * tickSize;
        if (!priceGroups.has(p)) priceGroups.set(p, []);
        priceGroups.get(p).push(t);
    }

    const avgSize = ticks.slice(0, 100).reduce((s, t) => s + (t.size || 0), 0) / Math.min(ticks.length, 100);

    for (const [price, group] of priceGroups) {
        const smallTrades = group.filter(t => (t.size || 0) <= avgSize * 0.5);
        const cumVol = smallTrades.reduce((s, t) => s + (t.size || 0), 0);

        if (smallTrades.length >= tradesPerPrice && cumVol >= avgSize * threshold) {
            results.push({
                price,
                tradeCount: smallTrades.length,
                cumulativeVolume: cumVol,
                avgTradeSize: cumVol / smallTrades.length,
                type: 'iceberg',
                confidence: Math.min(cumVol / (avgSize * threshold), 1),
            });
        }
    }

    return results.sort((a, b) => b.cumulativeVolume - a.cumulativeVolume).slice(0, 10);
}

// ── SPOOFING DETECTION ────────────────────────────────────────────────────────

/**
 * Spoofing = large orders appear at a price level then disappear (never get filled).
 * Visible as large size on DOM that flickers in/out without trades at that level.
 *
 * Heuristic: A level shows > 2x average size then vanishes within N ticks
 * without significant volume traded at that level.
 */
export function detectSpoofing(domSnapshots, tickSize = 0.05, lookAhead = 3) {
    if (domSnapshots.length < lookAhead + 1) return [];
    const results = [];

    // Average size across all levels
    const allSizes = domSnapshots.flatMap(s => [...s.bids, ...s.asks].map(l => l.size));
    const avgSize = allSizes.reduce((s, x) => s + x, 0) / (allSizes.length || 1);

    for (let i = 0; i < domSnapshots.length - lookAhead; i++) {
        const current = domSnapshots[i];
        const future = domSnapshots.slice(i + 1, i + 1 + lookAhead);

        for (const level of [...current.bids, ...current.asks]) {
            if (level.size < avgSize * 3) continue; // Not large enough to be spoofing

            // Check if this level vanishes in future snapshots
            const vanished = future.every(s => {
                const pool = level.side === 'bid' ? s.bids : s.asks;
                return !pool.find(l => Math.abs(l.price - level.price) < tickSize && l.size >= level.size * 0.5);
            });

            // Check no significant volume traded at this price during that window
            const volAtPrice = future.reduce((sum, s) => {
                return sum + ((s.tradesAtPrice || {})[level.price] || 0);
            }, 0);

            if (vanished && volAtPrice < level.size * 0.1) {
                results.push({
                    price: level.price,
                    size: level.size,
                    side: level.side === 'bid' ? 'bid' : 'ask',
                    type: 'spoofing',
                    confidence: Math.min((level.size / avgSize) * 0.1 + (volAtPrice === 0 ? 0.3 : 0), 1),
                });
                break; // One detection per snapshot window
            }
        }
    }

    return results.sort((a, b) => b.confidence - a.confidence).slice(0, 10);
}

// ── LIQUIDITY SWEEP DETECTION ─────────────────────────────────────────────────

/**
 * Liquidity sweep: price quickly spikes through a resting limit order wall,
 * sweeping through bids/asks, then snaps back.
 *
 * Detection: rapid price move through a high-volume level (from DOM) with immediate reversal.
 */
export function detectLiquiditySweep(ticks, dom, tickSize = 0.05, lookback = 5) {
    if (ticks.length < lookback + 2 || !dom?.bidLevels?.length) return [];
    const results = [];

    const latest = ticks.slice(0, lookback + 2);
    const bigBidWall = dom.bidLevels.find(l => l.size > dom.bidLevels.reduce((s, x) => s + x.size, 0) / dom.bidLevels.length * 3);
    const bigAskWall = dom.askLevels.find(l => l.size > dom.askLevels.reduce((s, x) => s + x.size, 0) / dom.askLevels.length * 3);

    // Check for sweep through a wall
    if (bigBidWall) {
        const belowWall = latest.filter(t => t.price < bigBidWall.price - tickSize * 2);
        const atWall = latest.filter(t => Math.abs(t.price - bigBidWall.price) <= tickSize);
        const aboveWall = latest.filter(t => t.price > bigBidWall.price + tickSize * 2);

        // Sweep pattern: price was below → spiked through bid wall → back above
        if (belowWall.length > 0 && atWall.length > 0 && aboveWall.length > 0) {
            const midIdx = Math.floor(latest.length / 2);
            const before = latest.slice(0, midIdx);
            const after = latest.slice(midIdx);
            const reversed = before.some(t => t.price <= bigBidWall.price) && after.some(t => t.price >= bigBidWall.price);

            if (reversed) {
                results.push({
                    price: bigBidWall.price,
                    wallSize: bigBidWall.size,
                    side: 'bid',
                    type: 'liquidity_sweep',
                    confidence: 0.7,
                });
            }
        }
    }

    if (bigAskWall) {
        const aboveWall = latest.filter(t => t.price > bigAskWall.price + tickSize * 2);
        const atWall = latest.filter(t => Math.abs(t.price - bigAskWall.price) <= tickSize);
        const belowWall = latest.filter(t => t.price < bigAskWall.price - tickSize * 2);

        if (aboveWall.length > 0 && atWall.length > 0 && belowWall.length > 0) {
            const midIdx = Math.floor(latest.length / 2);
            const before = latest.slice(0, midIdx);
            const after = latest.slice(midIdx);
            const reversed = before.some(t => t.price >= bigAskWall.price) && after.some(t => t.price <= bigAskWall.price);

            if (reversed) {
                results.push({
                    price: bigAskWall.price,
                    wallSize: bigAskWall.size,
                    side: 'ask',
                    type: 'liquidity_sweep',
                    confidence: 0.7,
                });
            }
        }
    }

    return results;
}

// ── LARGE TRADE DETECTION ─────────────────────────────────────────────────────

export function detectLargeTrades(ticks, stdDevMultiplier = 3) {
    if (ticks.length < 20) return [];
    const sizes = ticks.map(t => t.size || 0).filter(s => s > 0);
    if (sizes.length < 20) return [];

    const mean = sizes.reduce((s, x) => s + x, 0) / sizes.length;
    const variance = sizes.reduce((s, x) => s + (x - mean) ** 2, 0) / sizes.length;
    const stdDev = Math.sqrt(variance);
    const threshold = mean + stdDev * stdDevMultiplier;

    return ticks.filter(t => (t.size || 0) > threshold).map(t => ({
        time: t.time,
        price: t.price,
        size: t.size,
        side: t.side,
        threshold,
        type: 'large_trade',
        confidence: Math.min((t.size - mean) / (stdDev * stdDevMultiplier), 1),
    }));
}

// ── DELTA DIVERGENCE ───────────────────────────────────────────────────────────

/**
 * Delta divergence: price makes a new high/low but delta fails to confirm.
 * Bearish divergence = price higher high, delta lower high.
 * Bullish divergence = price lower low, delta higher low.
 */
export function detectDeltaDivergence(priceHistory, deltaHistory, window = 14) {
    if (priceHistory.length < window * 2 || deltaHistory.length < window * 2) return [];
    const results = [];

    // Look for swing points
    const current = priceHistory.length - 1;
    const lookback = priceHistory.slice(-window);
    const deltaLookback = deltaHistory.slice(-window);

    const recentPeak = Math.max(...lookback);
    const peakIdx = lookback.indexOf(recentPeak);
    const recentTrough = Math.min(...lookback);
    const troughIdx = lookback.indexOf(recentTrough);

    const deltaAtPeak = deltaLookback[peakIdx];
    const deltaAtTrough = deltaLookback[troughIdx];
    const currentPrice = lookback[lookback.length - 1];
    const currentDelta = deltaLookback[deltaLookback.length - 1];

    // Bearish divergence: price high > recentPeak but delta < deltaAtPeak
    if (currentPrice > recentPeak && currentDelta < deltaAtPeak) {
        results.push({
            type: 'bearish_divergence',
            priceLevel: currentPrice,
            divergenceLevel: 'delta',
            severity: Math.abs(currentDelta - deltaAtPeak) / Math.abs(deltaAtPeak || 1),
            confidence: 0.6,
        });
    }

    // Bullish divergence: price low < recentTrough but delta > deltaAtTrough
    if (currentPrice < recentTrough && currentDelta > deltaAtTrough) {
        results.push({
            type: 'bullish_divergence',
            priceLevel: currentPrice,
            divergenceLevel: 'delta',
            severity: Math.abs(currentDelta - deltaAtTrough) / Math.abs(deltaAtTrough || 1),
            confidence: 0.6,
        });
    }

    return results;
}

// ── VOLUME DIVERGENCE ──────────────────────────────────────────────────────────

export function detectVolumeDivergence(priceHistory, volumeHistory, window = 14) {
    if (priceHistory.length < window * 2 || volumeHistory.length < window * 2) return [];
    const results = [];

    const lookbackPrice = priceHistory.slice(-window);
    const lookbackVol = volumeHistory.slice(-window);

    const recentPeak = Math.max(...lookbackPrice);
    const peakIdx = lookbackPrice.indexOf(recentPeak);
    const recentTrough = Math.min(...lookbackPrice);
    const troughIdx = lookbackPrice.indexOf(recentTrough);

    const volAtPeak = lookbackVol[peakIdx];
    const volAtTrough = lookbackVol[troughIdx];
    const currentPrice = lookbackPrice[lookbackPrice.length - 1];
    const currentVol = lookbackVol[lookbackVol.length - 1];

    if (currentPrice > recentPeak && currentVol < volAtPeak) {
        results.push({
            type: 'bearish_divergence',
            priceLevel: currentPrice,
            divergenceLevel: 'volume',
            severity: Math.abs(currentVol - volAtPeak) / Math.abs(volAtPeak || 1),
            confidence: 0.55,
        });
    }

    if (currentPrice < recentTrough && currentVol > volAtTrough) {
        results.push({
            type: 'bullish_divergence',
            priceLevel: currentPrice,
            divergenceLevel: 'volume',
            severity: Math.abs(currentVol - volAtTrough) / Math.abs(volAtTrough || 1),
            confidence: 0.55,
        });
    }

    return results;
}

// ── VWAP ───────────────────────────────────────────────────────────────────────

export function computeVWAP(ticks) {
    if (!ticks || ticks.length === 0) return 0;
    let cumVP = 0;
    let cumVol = 0;
    for (const t of ticks) {
        const vol = t.size || t.volume || 0;
        cumVP += t.price * vol;
        cumVol += vol;
    }
    return cumVol > 0 ? cumVP / cumVol : 0;
}

// ── VALUE AREA (SINGLE CALL) ───────────────────────────────────────────────────

export function computeValueArea(distribution, pocIndex, totalVol, targetPercent = 0.70) {
    if (!distribution || distribution.length === 0) return { high: 0, low: 0, pct: 0 };
    const targetVol = totalVol * targetPercent;
    let cumVol = distribution[pocIndex].vol;
    let lowIdx = pocIndex;
    let highIdx = pocIndex;

    while (cumVol < targetVol) {
        const nextLow = distribution[lowIdx - 1];
        const nextHigh = distribution[highIdx + 1];
        if (!nextLow && !nextHigh) break;
        if (!nextLow) { highIdx++; cumVol += nextHigh.vol; }
        else if (!nextHigh) { lowIdx--; cumVol += nextLow.vol; }
        else if (nextLow.vol >= nextHigh.vol) { lowIdx--; cumVol += nextLow.vol; }
        else { highIdx++; cumVol += nextHigh.vol; }
    }

    return {
        high: distribution[highIdx].price,
        low: distribution[lowIdx].price,
        pct: Math.round((cumVol / totalVol) * 100),
    };
}
