import React, { useRef, useEffect, useState } from 'react';
import TimeSalesEngine from '../engines/TimeSalesEngine.js';

const COLORS = {
    bg: '#080E1C', panel: '#0D1729', border: '#1A2E52',
    bid: '#00E676', ask: '#FF3B5C', dim: '#4A6080',
    accent: '#00D4FF', text: '#B8C7E0',
};

export default function TimeSalesView({ ticks }) {
    const containerRef = useRef(null);
    const engineRef = useRef(null);
    const [filter, setFilter] = useState('all');

    useEffect(() => {
        const canvas = document.createElement('canvas');
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        containerRef.current.appendChild(canvas);
        containerRef.current.style.position = 'relative';
        containerRef.current.style.overflow = 'hidden';

        const engine = new TimeSalesEngine(canvas);
        engine.attach(containerRef.current);
        engineRef.current = engine;

        return () => { engine.detach(); canvas.remove(); };
    }, []);

    useEffect(() => {
        if (engineRef.current) engineRef.current.setFilter(filter);
    }, [filter]);

    useEffect(() => {
        if (engineRef.current && ticks) engineRef.current.setTicks(ticks);
    }, [ticks]);

    return (
        <div style={{ width: '100%', height: '100%', minHeight: 200, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', gap: 4, padding: '4px 8px', borderBottom: `1px solid ${COLORS.border}`, background: COLORS.bg }}>
                {[
                    { id: 'all', label: 'ALL' },
                    { id: 'buys', label: 'BUYS' },
                    { id: 'sells', label: 'SELLS' },
                ].map(f => (
                    <button key={f.id} onClick={() => setFilter(f.id)}
                        style={{
                            padding: '2px 10px', fontSize: 9, fontWeight: 600, borderRadius: 3, cursor: 'pointer',
                            background: filter === f.id ? `${COLORS.accent}22` : 'none',
                            border: `1px solid ${filter === f.id ? COLORS.accent + '50' : COLORS.border}`,
                            color: filter === f.id ? COLORS.accent : COLORS.dim,
                        }}>{f.label}</button>
                ))}
            </div>
            <div ref={containerRef} style={{ flex: 1 }} />
        </div>
    );
}
