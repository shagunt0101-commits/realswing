import React from 'react';

export default function MetricGrid({ cols = 4, gap = 6, children }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gap,
    }}>
      {children}
    </div>
  );
}
