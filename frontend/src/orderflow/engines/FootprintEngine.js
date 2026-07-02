/**
 * FootprintEngine — simplified vertical footprint list.
 * Each row = one price level with bid/ask bars and delta.
 */

const C = {
    bg: '#080E1C', panel: '#0D1729', border: '#1A2E52',
    green: '#00E676', red: '#FF3B5C', text: '#B8C7E0', dim: '#4A6080',
    bright: '#E8F0FF', accent: '#00D4FF', yellow: '#FFD600',
};

export default class FootprintEngine {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.dpr = window.devicePixelRatio || 1;
        this.data = [];
        this.width = 0;
        this.height = 0;
        this.rowH = 20;
        this.maxVol = 1;
        this.scroll = 0;
        this.container = null;
        this._ro = null;
        this._raf = null;
    }

    attach(el) {
        if (!el || !this.canvas || !this.ctx) return;
        this.container = el;
        const rect = el.getBoundingClientRect();
        this.width = rect.width || 600;
        this.height = rect.height || 400;
        this._updateCanvasSize();
        this._ro = new ResizeObserver(entries => {
            const entry = entries[0];
            if (!entry) return;
            this.width = entry.contentRect.width || 600;
            this.height = entry.contentRect.height || 400;
            this._updateCanvasSize();
            this.draw();
        });
        this._ro.observe(el);
    }

    detach() {
        if (this._ro) try { this._ro.disconnect(); } catch {}
        this._ro = null;
        if (this._raf) cancelAnimationFrame(this._raf);
        this._raf = null;
    }

    _updateCanvasSize() {
        try {
            this.canvas.style.width = this.width + 'px';
            this.canvas.style.height = this.height + 'px';
            this.canvas.width = this.width * this.dpr;
            this.canvas.height = this.height * this.dpr;
            this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        } catch {}
    }

    setData(rows) {
        this.data = Array.isArray(rows) ? rows : [];
        if (this.data.length > 0) {
            this.maxVol = this.data.reduce((m, r) => Math.max(m, r.bidVol || 0, r.askVol || 0), 0) || 1;
        }
        this.draw();
    }

    draw() {
        if (this._raf) return;
        this._raf = requestAnimationFrame(() => {
            this._raf = 0;
            this._render();
        });
    }

    _render() {
        const ctx = this.ctx;
        const w = this.width, h = this.height;
        if (!ctx || !w || !h) return;

        ctx.fillStyle = C.bg;
        ctx.fillRect(0, 0, w, h);

        if (this.data.length === 0) {
            ctx.fillStyle = C.dim;
            ctx.font = '12px "Inter", system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('⬡ Waiting for footprint data...', w / 2, h / 2);
            return;
        }

        // Compute visible rows
        const headerH = 22;
        const visRows = Math.max(1, Math.floor((h - headerH) / this.rowH));
        const maxScroll = Math.max(0, this.data.length - visRows);
        this.scroll = Math.min(this.scroll, maxScroll);
        const visible = this.data.slice(this.scroll, this.scroll + visRows);
        const leftLabelW = 85;
        const barAreaW = w - leftLabelW - 8;

        // Header
        ctx.fillStyle = C.dim;
        ctx.font = '9px "Inter", sans-serif';
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        ctx.fillText('STRIKE', 4, 4);
        ctx.textAlign = 'right';
        ctx.fillText('BID', leftLabelW - 4, 4);
        ctx.fillText('ASK', leftLabelW + barAreaW / 2 + 20, 4);
        ctx.fillText('DELTA', w - 8, 4);

        ctx.strokeStyle = C.border;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, headerH);
        ctx.lineTo(w, headerH);
        ctx.stroke();

        // Rows
        const halfBarW = (barAreaW / 2) - 8;

        for (let i = 0; i < visible.length; i++) {
            const r = visible[i];
            const y = headerH + i * this.rowH;
            if (y + this.rowH > h) break;

            const bidVol = r.bidVol || 0;
            const askVol = r.askVol || 0;
            const delta = r.delta !== undefined ? r.delta : bidVol - askVol;
            const price = r.price || 0;
            const fracBid = Math.min(bidVol / this.maxVol, 1);
            const fracAsk = Math.min(askVol / this.maxVol, 1);

            // Row bg
            if (i % 2 === 0) {
                ctx.fillStyle = '#0A1220';
                ctx.fillRect(0, y, w, this.rowH);
            }

            // Price label
            ctx.fillStyle = C.text;
            ctx.font = '9px "JetBrains Mono", monospace';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(price.toFixed(2), leftLabelW - 6, y + this.rowH / 2);

            // Bid bar (left half)
            const bidW = fracBid * halfBarW;
            ctx.fillStyle = C.green + '22';
            ctx.fillRect(leftLabelW + 4 + (halfBarW - bidW), y + 2, bidW, this.rowH - 4);
            ctx.fillStyle = C.green;
            ctx.fillRect(leftLabelW + 4 + (halfBarW - bidW), y + 2, 2, this.rowH - 4);
            if (bidVol > 0) {
                ctx.fillStyle = C.green;
                ctx.font = '8px "JetBrains Mono", monospace';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(bidVol >= 1000 ? `${(bidVol/1000).toFixed(0)}K` : String(bidVol), leftLabelW + 8, y + this.rowH / 2);
            }

            // Ask bar (right half)
            const askW = fracAsk * halfBarW;
            ctx.fillStyle = C.red + '22';
            ctx.fillRect(leftLabelW + 4 + halfBarW, y + 2, askW, this.rowH - 4);
            ctx.fillStyle = C.red;
            ctx.fillRect(leftLabelW + 4 + halfBarW, y + 2, 2, this.rowH - 4);
            if (askVol > 0) {
                ctx.fillStyle = C.red;
                ctx.font = '8px "JetBrains Mono", monospace';
                ctx.textAlign = 'right';
                ctx.textBaseline = 'middle';
                ctx.fillText(askVol >= 1000 ? `${(askVol/1000).toFixed(0)}K` : String(askVol), leftLabelW + 4 + halfBarW + askW - 4, y + this.rowH / 2);
            }

            // Delta
            ctx.fillStyle = delta > 0 ? C.green : delta < 0 ? C.red : C.dim;
            ctx.font = '8px "JetBrains Mono", monospace';
            ctx.textAlign = 'right';
            ctx.fillText((delta >= 0 ? '+' : '') + (delta >= 1000 ? `${(delta/1000).toFixed(0)}K` : String(Math.round(delta))), w - 4, y + this.rowH / 2);
        }

        // Scrollbar
        if (this.data.length > visRows) {
            const scrollH = Math.max(20, (visRows / this.data.length) * (h - headerH));
            const scrollY = headerH + (this.scroll / maxScroll) * ((h - headerH) - scrollH);
            ctx.fillStyle = '#FFFFFF33';
            ctx.fillRect(w - 5, scrollY, 3, scrollH);
        }
    }

    onWheel(deltaY) {
        this.scroll += Math.sign(deltaY) * 3;
        this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, this.data.length - Math.floor(this.height / this.rowH))));
        this.draw();
    }

    onKey(key) {
        const step = key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : key === 'PageUp' ? -15 : key === 'PageDown' ? 15 : 0;
        this.scroll = Math.max(0, Math.min(this.scroll + step, Math.max(0, this.data.length - Math.floor(this.height / this.rowH))));
        this.draw();
    }
}
