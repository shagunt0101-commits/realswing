import React, { useRef, useEffect } from 'react';
import DOMEngine from '../engines/DOMEngine.js';

export default function DOMView({ bidLevels, askLevels, lastPrice }) {
    const containerRef = useRef(null);
    const engineRef = useRef(null);

    useEffect(() => {
        const canvas = document.createElement('canvas');
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        containerRef.current.appendChild(canvas);
        containerRef.current.style.position = 'relative';
        containerRef.current.style.overflow = 'hidden';

        const engine = new DOMEngine(canvas);
        engine.attach(containerRef.current);
        engineRef.current = engine;

        return () => { engine.detach(); canvas.remove(); };
    }, []);

    useEffect(() => {
        if (engineRef.current) {
            engineRef.current.update(bidLevels || [], askLevels || [], lastPrice);
        }
    }, [bidLevels, askLevels, lastPrice]);

    return <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: 200 }} />;
}
