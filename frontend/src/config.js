/**
 * RealSwing — environment-aware API config
 * In dev: proxies to localhost via Vite
 * In prod: uses VITE_API_BASE env var (set in Vercel dashboard)
 * If no backend URL is configured, falls back to empty string
 * (UI will show "Backend offline" gracefully)
 */
const DEV = typeof window !== 'undefined' && window.location.hostname === 'localhost';

export const API_BASE = import.meta.env.VITE_API_BASE || (DEV ? '' : '');
export const ORCH_BASE = import.meta.env.VITE_ORCH_BASE || (DEV ? '' : '');
export const DEVICE_ID = 'TS123';

// Helper: get full URL for an API path
export const apiUrl = (path) => API_BASE ? `${API_BASE}${path}` : path;
export const orchUrl = (path) => ORCH_BASE ? `${ORCH_BASE}${path}` : path;
