// ── Numeric formatters for the backtest dashboard ──

export const inr = (v) => {
  if (v == null || isNaN(v)) return '—';
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '+';
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1)}K`;
  return `${sign}₹${abs.toFixed(2)}`;
};

export const inrRaw = (v) => {
  if (v == null || isNaN(v)) return '—';
  return `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
};

export const pct = (v) => {
  if (v == null || isNaN(v)) return '—';
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}%`;
};

export const pct1 = (v) => {
  if (v == null || isNaN(v)) return '—';
  return `${v.toFixed(1)}%`;
};

export const ratio = (v) => {
  if (v == null || isNaN(v)) return '—';
  return v.toFixed(2);
};

export const ratio3 = (v) => {
  if (v == null || isNaN(v)) return '—';
  return v.toFixed(3);
};

export const count = (v) => {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toLocaleString('en-IN');
};

export const fmtDuration = (minutes) => {
  if (minutes == null || isNaN(minutes)) return '—';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`;
  return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
};

export const scoreColor = (v) => {
  if (v >= 80) return '#00E676';
  if (v >= 60) return '#00D4FF';
  if (v >= 40) return '#FFD600';
  return '#FF3B5C';
};
