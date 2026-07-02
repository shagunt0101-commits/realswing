import React, { useRef, useEffect } from 'react';
import FootprintEngine from '../engines/FootprintEngine.js';

export default function FootprintChart({ footprint }) {
    const elRef = useRef(null);
    const engRef = useRef(null);

    useEffect(() => {
        const el = elRef.current;
        if (!el) return;

        const canvas = document.createElement('canvas');
        canvas.style.display = 'block';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.tabIndex = 0;
        canvas.style.outline = 'none';
        el.appendChild(canvas);

        const engine = new FootprintEngine(canvas);
        engine.attach(el);
        engRef.current = engine;

        const wheel = (e) => { e.preventDefault(); engine.onWheel(e.deltaY); };
        const key = (e) => engine.onKey(e.key);
        canvas.addEventListener('wheel', wheel, { passive: false });
        canvas.addEventListener('keydown', key);

        return () => {
            engine.detach();
            try { canvas.remove(); } catch {}
            engRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (engRef.current) engRef.current.setData(footprint || []);
    }, [footprint]);

    return <div ref={elRef} style={{ width: '100%', height: '100%', minHeight: 200 }} />;
}
