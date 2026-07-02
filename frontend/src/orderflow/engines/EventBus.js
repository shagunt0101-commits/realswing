/**
 * EventBus — typed pub/sub with WebSocket bridge for order flow data.
 * SINGLETON. One bus per session.
 */
class EventBus {
    constructor() {
        this._listeners = new Map();
        this._ws = null;
        this._wsUrl = '';
        this._reconnectTimer = null;
        this._reconnectAttempts = 0;
        this._maxReconnect = 10;
        this._heartbeatInterval = null;
    }

    /** Subscribe to an event type. Returns unsubscribe fn. */
    on(event, fn, ctx = null) {
        if (!this._listeners.has(event)) this._listeners.set(event, []);
        this._listeners.get(event).push({ fn, ctx });
        return () => this.off(event, fn);
    }

    off(event, fn) {
        const list = this._listeners.get(event);
        if (!list) return;
        const idx = list.findIndex(l => l.fn === fn);
        if (idx >= 0) list.splice(idx, 1);
    }

    /** Emit an event synchronously. */
    emit(event, payload) {
        const list = this._listeners.get(event);
        if (list) list.forEach(l => { try { l.fn.call(l.ctx, payload); } catch(e) { console.error(`[EventBus] ${event} error:`, e); } });
    }

    /** Connect to a WebSocket endpoint and route events by type field. */
    connectWS(url) {
        if (this._ws?.readyState === WebSocket.OPEN) return;
        this._wsUrl = url;
        this._reconnectAttempts = 0;
        this._doConnect();
    }

    _doConnect() {
        if (this._reconnectAttempts >= this._maxReconnect) return;
        try {
            this._ws = new WebSocket(this._wsUrl);
        } catch (e) { return; }

        this._ws.onopen = () => {
            this._reconnectAttempts = 0;
            this.emit('ws:connected', {});
            this._heartbeatInterval = setInterval(() => {
                try { this._ws?.send('{"type":"ping"}'); } catch {}
            }, 15000);
        };

        this._ws.onmessage = (msg) => {
            try {
                const pkt = JSON.parse(msg.data);
                const type = pkt.type || 'raw';
                this.emit(type, pkt);
                this.emit('ws:message', pkt);
            } catch {}
        };

        this._ws.onclose = () => {
            clearInterval(this._heartbeatInterval);
            this.emit('ws:disconnected', {});
            this._reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, this._reconnectAttempts), 30000);
            this._reconnectTimer = setTimeout(() => this._doConnect(), delay);
        };

        this._ws.onerror = () => { this._ws?.close(); };
    }

    disconnectWS() {
        clearInterval(this._heartbeatInterval);
        clearTimeout(this._reconnectTimer);
        this._ws?.close();
        this._ws = null;
    }

    /** Send JSON over WS. */
    send(payload) {
        try { this._ws?.send(JSON.stringify(payload)); } catch {}
    }

    destroy() {
        this.disconnectWS();
        this._listeners.clear();
    }
}

export const bus = new EventBus();
export default EventBus;
