/**
 * DOMEngine — Depth of Market ladder renderer.
 * Classic DOM view: bids on left, asks on right, spread in center.
 * Real-time updates via store, rendered on Canvas.
 *
 * Layout per price level:
 *   ┌─── BID SIDE ───┬─── SPREAD ───┬─── ASK SIDE ───┐
 *   │ size bar │size │  price  │size │ size bar │size  │
 *   └────────────────┴───────────────┴─────────────────┘
 */

const COLORS = {
    bg: '#080E1C', panel: '#0D1729', border: '#1A2E52',
    bid: '#00E676', ask: '#FF3B5C', text: '#B8C7E0', dim: '#4A6080',
    bright: '#E8F0FF', accent: '#00D4FF', yellow: '#FFD600',
};

export default class DOMEngine {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.dpr = window.devicePixelRatio || 1;

        this.bidLevels = [];
        this.askLevels = [];
        this.bestBid = null;
        this.bestAsk = null;
        this.lastPrice = null;
        this.width = 0;
        this.height = 0;
        this.rowHeight = 22;
        this.maxLevels = 20;
        this.maxSize = 0;
        this.pendingLevelPrice = null; // pending order cursor
    }

    attach(container) {
        this.container = container;
        this._ro = new ResizeObserver(entries => {
            for (const e of entries) {
                this.width = e.contentRect.width;
                this.height = e.contentRect.height;
                this._resize();
            }
        });
        this._ro.observe(container);
        this._resize();
    }

    detach() {
        this._ro?.disconnect();
        cancelAnimationFrame(this._raf);
    }

    _resize() {
        const w = this.width, h = this.height;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.canvas.width = w * this.dpr;
        this.canvas.height = h * this.dpr;
        this.ctx.scale(this.dpr, this.dpr);
        this.render();
    }

    update(bidLevels, askLevels, lastPrice) {
        this.bidLevels = bidLevels || [];
        this.askLevels = askLevels || [];
        this.lastPrice = lastPrice;

        this.bestBid = this.bidLevels[0]?.price || null;
        this.bestAsk = this.askLevels[0]?.price || null;

        // Compute max size across both sides for scaling
        this.maxSize = 0;
        for (const l of this.bidLevels) this.maxSize = Math.max(this.maxSize, l.size || 0);
        for (const l of this.askLevels) this.maxSize = Math.max(this.maxSize, l.size || 0);

        this.render();
    }

    render() {
        if (this._raf) return;
        this._raf = requestAnimationFrame(() => {
            this._raf = 0;
            this._draw();
        });
    }

    _draw() {
        const ctx = this.ctx;
        const w = this.width, h = this.height;
        if (!w || !h) return;

        // Clear
        ctx.fillStyle = COLORS.bg;
        ctx.fillRect(0, 0, w, h);

        // Layout
        const levels = Math.max(this.bidLevels.length, this.askLevels.length, 1);
        const visLevels = Math.min(levels, this.maxLevels);
        const totalH = visLevels * this.rowHeight;
        const startY = Math.max(0, (h - totalH) / 2); // center vertically

        // Draw the spread indicator line
        if (this.bestBid && this.bestAsk) {
            ctx.fillStyle = COLORS.accent + '22';
            ctx.fillRect(0, startY + visLevels / 2 * this.rowHeight - this.rowHeight / 2, w, this.rowHeight);
        }

        // Draw bid levels (top half — reversed so best bid is closest to center)
        for (let i = 0; i < this.bidLevels.length && i < visLevels; i++) {
            const level = this.bidLevels[i];
            if (!level) continue;
            const y = startY + (visLevels - 1 - i) * this.rowHeight;
            this._drawBidLevel(ctx, level, y, w);
        }

        // Draw ask levels (bottom half)
        for (let i = 0; i < this.askLevels.length && i < visLevels; i++) {
            const level = this.askLevels[i];
            if (!level) continue;
            const y = startY + i * this.rowHeight;
            this._drawAskLevel(ctx, level, y, w);
        }

        // Center price / spread line
        ctx.strokeStyle = COLORS.accent;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        const centerY = startY + (visLevels / 2) * this.rowHeight;
        ctx.beginPath();
        ctx.moveTo(0, centerY);
        ctx.lineTo(w, centerY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Best bid/ask labels
        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.textBaseline = 'middle';
        if (this.bestBid) {
            ctx.fillStyle = COLORS.bid;
            ctx.textAlign = 'left';
            ctx.fillText(`BEST BID ${this._fmtPrice(this.bestBid)}`, 6, centerY - 10);
        }
        if (this.bestAsk) {
            ctx.fillStyle = COLORS.ask;
            ctx.textAlign = 'right';
            ctx.fillText(`BEST ASK ${this._fmtPrice(this.bestAsk)}`, w - 6, centerY + 10);
        }

        // Last price indicator
        if (this.lastPrice && this.lastPrice < (this.bestBid || 0)) {
            ctx.fillStyle = COLORS.ask;
            ctx.textAlign = 'right';
            ctx.font = '9px "JetBrains Mono", monospace';
            ctx.fillText(`◄ ${this._fmtPrice(this.lastPrice)}`, w - 6, h - 6);
        }
    }

    _drawBidLevel(ctx, level, y, w) {
        const half = w / 2;
        const frac = this.maxSize > 0 ? level.size / this.maxSize : 0;
        const barMax = half - 20;
        const barW = frac * barMax;

        // Background bar
        ctx.fillStyle = COLORS.bid + '22';
        ctx.fillRect(half - barW - 4, y + 2, barW, this.rowHeight - 4);

        // Thick edge
        ctx.fillStyle = COLORS.bid;
        ctx.fillRect(half - barW - 4, y + 2, 2, this.rowHeight - 4);

        // Size text
        ctx.fillStyle = COLORS.bid;
        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(this._fmtSize(level.size), half - 8, y + this.rowHeight / 2);

        // Price label
        ctx.fillStyle = COLORS.text;
        ctx.textAlign = 'center';
        ctx.fillText(this._fmtPrice(level.price), half, y + this.rowHeight / 2);

        // Orders count
        if (level.orders) {
            ctx.fillStyle = COLORS.dim;
            ctx.font = '7px "JetBrains Mono", monospace';
            ctx.textAlign = 'left';
            ctx.fillText(`${level.orders}`, half + 4, y + this.rowHeight / 2);
        }
    }

    _drawAskLevel(ctx, level, y, w) {
        const half = w / 2;
        const frac = this.maxSize > 0 ? level.size / this.maxSize : 0;
        const barMax = half - 20;
        const barW = frac * barMax;

        ctx.fillStyle = COLORS.ask + '22';
        ctx.fillRect(half + 4, y + 2, barW, this.rowHeight - 4);

        ctx.fillStyle = COLORS.ask;
        ctx.fillRect(half + 4, y + 2, 2, this.rowHeight - 4);

        // Orders count
        if (level.orders) {
            ctx.fillStyle = COLORS.dim;
            ctx.font = '7px "JetBrains Mono", monospace';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${level.orders}`, half - 8, y + this.rowHeight / 2);
        }

        // Price label
        ctx.fillStyle = COLORS.text;
        ctx.textAlign = 'center';
        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.fillText(this._fmtPrice(level.price), half, y + this.rowHeight / 2);

        // Size text
        ctx.fillStyle = COLORS.ask;
        ctx.textAlign = 'left';
        ctx.fillText(this._fmtSize(level.size), half + 8, y + this.rowHeight / 2);
    }

    _fmtPrice(p) {
        return p != null ? p.toFixed(2) : '-';
    }

    _fmtSize(s) {
        if (s >= 1000000) return `${(s / 1000000).toFixed(1)}M`;
        if (s >= 1000) return `${(s / 1000).toFixed(1)}K`;
        return `${s}`;
    }

    // Mouse — select level
    onMouseMove(x, y) {
        // Could add hover highlight
    }

    onClick(x, y) {
        // Could add order entry at price level
    }
}
