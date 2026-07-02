/**
 * TimeSalesEngine — Time & Sales (tick tape) renderer.
 * Displays individual trades as they arrive, with filter controls.
 *
 * Each row: TIME | PRICE | SIZE | SIDE (BUY/SELL/NONE)
 * Color-coded: green = aggressive buy, red = aggressive sell, gray = neutral
 */

import { bus } from './EventBus.js';

const COLORS = {
    bg: '#080E1C', panel: '#0D1729', border: '#1A2E52',
    bid: '#00E676', ask: '#FF3B5C', text: '#B8C7E0', dim: '#4A6080',
    bright: '#E8F0FF', accent: '#00D4FF',
};

export default class TimeSalesEngine {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.dpr = window.devicePixelRatio || 1;

        this.ticks = [];     // latest first
        this.filter = 'all'; // all | buys | sells
        this.width = 0;
        this.height = 0;
        this.rowHeight = 18;
        this.maxRows = 200;
        this.scrollOffset = 0;
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

    /** Add a tick (newest first) */
    addTick(tick) {
        this.ticks = [tick, ...this.ticks].slice(0, 5000);
        this.render();
    }

    setTicks(ticks) {
        this.ticks = ticks.slice(0, 5000);
        this.render();
    }

    setFilter(filter) {
        this.filter = filter;
        this.render();
    }

    render() {
        if (this._raf) return;
        this._raf = requestAnimationFrame(() => {
            this._raf = 0;
            this._draw();
        });
    }

    _getFilteredTicks() {
        switch (this.filter) {
            case 'buys': return this.ticks.filter(t => t.side === 'B' || (t.side === 'N' && (t.delta || 0) > 0));
            case 'sells': return this.ticks.filter(t => t.side === 'S' || (t.side === 'N' && (t.delta || 0) < 0));
            default: return this.ticks;
        }
    }

    _draw() {
        const ctx = this.ctx;
        const w = this.width, h = this.height;
        if (!w || !h) return;

        ctx.fillStyle = COLORS.bg;
        ctx.fillRect(0, 0, w, h);

        const filtered = this._getFilteredTicks();
        const visRows = Math.min(Math.floor((h - 24) / this.rowHeight), this.maxRows);
        const start = this.scrollOffset;
        const visible = filtered.slice(start, start + visRows);

        // Header
        ctx.fillStyle = COLORS.dim;
        ctx.font = '8px "Inter", system-ui, sans-serif';
        ctx.fillText('TIME', 6, 10);
        ctx.textAlign = 'right';
        ctx.fillText('PRICE', 130, 10);
        ctx.fillText('SIZE', 200, 10);
        ctx.fillText('DELTA', 260, 10);
        ctx.textAlign = 'left';

        ctx.strokeStyle = COLORS.border;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, 14);
        ctx.lineTo(w, 14);
        ctx.stroke();

        // Rows
        ctx.textBaseline = 'middle';
        for (let i = 0; i < visible.length; i++) {
            const t = visible[i];
            const y = 18 + i * this.rowHeight;
            if (y + this.rowHeight > h) break;

            const side = t.side || (t.delta > 0 ? 'B' : t.delta < 0 ? 'S' : 'N');
            const color = side === 'B' ? COLORS.bid : side === 'S' ? COLORS.ask : COLORS.dim;

            // Side indicator
            ctx.fillStyle = color;
            ctx.font = '10px "JetBrains Mono", monospace';
            ctx.textAlign = 'left';
            ctx.fillText(side === 'B' ? '▲' : side === 'S' ? '▼' : '—', 4, y + this.rowHeight / 2);

            // Time
            ctx.fillStyle = COLORS.dim;
            ctx.font = '9px "JetBrains Mono", monospace';
            ctx.fillText(this._fmtTime(t.time), 16, y + this.rowHeight / 2);

            // Price
            ctx.fillStyle = COLORS.bright;
            ctx.textAlign = 'right';
            ctx.fillText(this._fmtPrice(t.price), 130, y + this.rowHeight / 2);

            // Size
            ctx.fillStyle = COLORS.text;
            ctx.fillText(this._fmtSize(t.size || t.volume || 0), 200, y + this.rowHeight / 2);

            // Delta
            const delta = t.delta || 0;
            ctx.fillStyle = delta > 0 ? COLORS.bid : delta < 0 ? COLORS.ask : COLORS.dim;
            ctx.fillText((delta > 0 ? '+' : '') + this._fmtSize(delta), 260, y + this.rowHeight / 2);

            // Row separator
            ctx.fillStyle = COLORS.border + '44';
            ctx.fillRect(0, y + this.rowHeight - 1, w, 1);
        }

        if (visible.length === 0) {
            ctx.fillStyle = COLORS.dim;
            ctx.font = '12px "Inter", system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('No trades yet', w / 2, h / 2);
        }

        // Scroll indicator
        if (filtered.length > visRows) {
            const scrollFrac = this.scrollOffset / Math.max(filtered.length - visRows, 1);
            const barH = Math.max(20, (visRows / filtered.length) * (h - 14));
            ctx.fillStyle = '#FFFFFF22';
            const sx = w - 6, sy = 14 + scrollFrac * (h - 14 - barH), sw = 4, sh = barH, sr = 2;
            ctx.beginPath();
            ctx.moveTo(sx + sr, sy);
            ctx.lineTo(sx + sw - sr, sy);
            ctx.quadraticCurveTo(sx + sw, sy, sx + sw, sy + sr);
            ctx.lineTo(sx + sw, sy + sh - sr);
            ctx.quadraticCurveTo(sx + sw, sy + sh, sx + sw - sr, sy + sh);
            ctx.lineTo(sx + sr, sy + sh);
            ctx.quadraticCurveTo(sx, sy + sh, sx, sy + sh - sr);
            ctx.lineTo(sx, sy + sr);
            ctx.quadraticCurveTo(sx, sy, sx + sr, sy);
            ctx.closePath();
            ctx.fill();
        }
    }

    _fmtTime(ts) {
        if (!ts) return '--:--:--';
        const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
        if (isNaN(d.getTime())) return '--:--:--';
        return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    }

    _fmtPrice(p) {
        return p != null ? p.toFixed(2) : '-';
    }

    _fmtSize(s) {
        if (s >= 1000000) return `${(s / 1000000).toFixed(1)}M`;
        if (s >= 1000) return `${(s / 1000).toFixed(1)}K`;
        return `${s}`;
    }
}
