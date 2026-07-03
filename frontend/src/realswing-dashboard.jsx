
/**
 * RealSwing Scalping Assistant — Nubra API Wired Dashboard
 *
 * AUTH FLOW (4 steps per Nubra docs):
 *   Step 1 → POST /sendphoneotp  {phone, skip_totp:false}           → temp_token
 *   Step 2 → POST /sendphoneotp  x-temp-token + {phone, skip_totp:true} → sends OTP SMS, new temp_token
 *   Step 3 → POST /verifyphoneotp x-temp-token + x-device-id + {phone, otp} → auth_token
 *   Step 4 → POST /verifypin     Bearer auth_token + x-device-id + {pin} → session_token
 *
 * LIVE DATA (requires session_token):
 *   Current price  → GET /market/price/{instrument}
 *   Option chain   → GET /market/optionchain/{instrument}?expiry=YYYYMMDD
 *   Positions      → GET /portfolio/positions
 *   Funds          → GET /portfolio/funds
 *
 * ORDER EXECUTION:
 *   Place order    → POST /trade/order  (LIMIT only — Nubra constraint)
 *
 * BACKEND: run nubra_backend.py (FastAPI) on http://localhost:8000
 *          Change API_BASE below if deployed elsewhere.
 */

import React, {
    Fragment,
    useState,
    useEffect,
    useCallback,
    useRef,
    Component,
} from "react";
import {
    AreaChart, Area, BarChart, Bar, XAxis, YAxis,
    CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine
} from "recharts";
import WorkspaceLayout from "./workspace/WorkspaceLayout";
import { usePrices, usePricePolling } from "./stores/prices";
import MarketSnapshot from "./components/MarketSnapshot";
import MarketWatch from "./components/MarketWatch";
import { analyzeChain } from "./analysis/painEngine.js";
import OIDynamics from "./components/OIDynamics";
import OutlookRegime from "./components/OutlookRegime";
import VolatilityAnalysis from "./components/VolatilityAnalysis";
import ProbabilityTouch from "./components/ProbabilityTouch";
import SmartMoneySignals from "./components/SmartMoneySignals";
import SupportResistance from "./components/SupportResistance";
import StrategyEngine from "./components/StrategyEngine";
import OrderFlowWorkstation from "./orderflow/components/OrderFlowWorkstation.jsx";
import SpreadOptimizer from "./components/SpreadOptimizer";
import StrategyLeaderboard from "./components/StrategyLeaderboard";
import MomentumAnalysis from "./components/MomentumAnalysis";
import TradeCandidates from "./components/TradeCandidates";
import OrderFlowSection from "./components/OrderFlowSection";
import OptionBuyingPanel from "./components/OptionBuyingPanel";
import AlgoPipeline from "./components/AlgoPipeline";
import SystemHealth from "./components/SystemHealth";
import BacktestDashboard from "./backtest/BacktestDashboard";
import StrategyPerformance from "./components/StrategyPerformance";
import ResearchDesk from "./components/ResearchDesk";
import PaperTradingPanel from "./components/PaperTradingPanel";
import { usePaperTradeStore } from './stores/paperTradeStore';
import SignalEngine from "./components/SignalEngine";

// ── CONFIG ────────────────────────────────────────────────────────────────────
// Auto-detect backend URL: Vite proxy in dev, or deployed URL from env
const DEV = import.meta.env.DEV;
const API_BASE = import.meta.env.VITE_API_BASE || (DEV ? "http://localhost:9000" : "");
const ORCH_BASE = import.meta.env.VITE_ORCH_BASE || (DEV ? "http://localhost:9010" : "");
const DEVICE_ID = "TS123";

// ── DESIGN TOKENS ─────────────────────────────────────────────────────────────
const C = {
    bg: "#080E1C", panel: "#0D1729", border: "#1A2E52",
    accent: "#00D4FF", green: "#00E676", red: "#FF3B5C",
    yellow: "#FFD600", text: "#B8C7E0", dim: "#4A6080", bright: "#E8F0FF",
    purple: "#A78BFA",
};

// ── HELPERS ───────────────────────────────────────────────────────────────────
const inr = v => `₹${Number(v).toLocaleString("en-IN")}`;
const paise = v => Math.round(v * 100);   // rupees → paise for Nubra API
const fromPaise = v => (v / 100).toFixed(2);

function extractErr(data) {
    if (!data) return "Unknown error";
    if (typeof data.detail === "string") return data.detail;
    if (Array.isArray(data.detail)) return data.detail.map(e => e.msg).join("; ");
    if (data.error) return data.error;
    return JSON.stringify(data);
}

async function api(path, opts = {}) {
    let r;
    try {
        r = await fetch(`${API_BASE}${path}`, {
            headers: { "Content-Type": "application/json" },
            ...opts,
        });
    } catch (e) {
        throw new Error(`Cannot connect to ${API_BASE} — is the backend running? (${e.message})`);
    }
    if (r.status === 401 || r.status === 440) {
        localStorage.removeItem("realswing_session");
        window.location.reload();
        throw new Error("Session expired — login again");
    }
    const data = await r.json();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${extractErr(data)}`);
    if (data && data.error) throw new Error(data.error);
    return data;
}

const SESSION_DURATION_MS = 15 * 60 * 1000; // 15 min
const WARN_BEFORE_MS = 2 * 60 * 1000;       // warn at 2 min

function SessionTimer({ loggedInAt }) {
    const [remaining, setRemaining] = useState(24 * 60 * 60 * 1000);

    useEffect(() => {
        const tick = () => {
            const elapsed = Date.now() - loggedInAt;
            const left = Math.max(0, 24 * 60 * 60 * 1000 - elapsed);
            setRemaining(left);
        };
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [loggedInAt]);

    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    const warn = remaining < WARN_BEFORE_MS;

    return (
        <span style={{
            color: warn ? C.yellow : C.dim,
            fontFamily: "monospace", fontSize: 12,
            animation: warn ? "pulse 1s infinite" : "none",
            border: `1px solid ${warn ? C.yellow + "40" : "transparent"}`,
            borderRadius: 4, padding: "2px 8px",
        }}>
            {warn ? "⚠ " : "⌛ "}{mins}:{secs.toString().padStart(2, "0")}
        </span>
    );
}

// ── SSE HOOK ──────────────────────────────────────────────────────────────────

function useSSE(session) {
    const [agents, setAgents] = useState({
        running: false, connected: false, marketState: null,
        analyst: {}, signals: [], orders: [], agentStatus: {},
        momentum: {},  // { NIFTY: { concentration, top_bullish, top_bearish, expected_move, strikes } }
    });
    const evRef = useRef(null);

    useEffect(() => {
        if (!session?.session_token) return;
        const es = new EventSource(`${ORCH_BASE}/stream`);
        evRef.current = es;

        es.onmessage = (e) => {
            if (e.data === ": heartbeat") return;
            try {
                const { type, data } = JSON.parse(e.data);
                setAgents(prev => {
                    switch (type) {
                        case "connected":
                            return { ...prev, running: true };
                        case "market_state":
                            return { ...prev, marketState: data };
                        case "analyst_report":
                            return { ...prev, analyst: { ...prev.analyst, [data.asset]: data } };
                        case "trade_signal":
                            return { ...prev, signals: [data, ...prev.signals].slice(0, 50) };
                        case "order_placed":
                            return { ...prev, orders: [data, ...prev.orders].slice(0, 50) };
                        case "momentum":
                            return { ...prev, momentum: { ...prev.momentum, [data.asset]: data } };
                        default:
                            return prev;
                    }
                });
            } catch { }
        };

        es.onerror = () => {
            setAgents(prev => ({ ...prev, running: false, connected: false }));
        };

        // Poll health endpoint for overall status
        const healthId = setInterval(async () => {
            try {
                const r = await fetch(`${ORCH_BASE}/health`);
                const h = await r.json();
                setAgents(prev => ({ ...prev, running: h.running, connected: h.connected, agentStatus: h.agents }));
            } catch { }
        }, 5000);

        return () => {
            es.close();
            clearInterval(healthId);
        };
    }, [session?.session_token]);

    const startAgents = async (assetConfigs, dryRun = true) => {
        try {
            const r = await fetch(`${ORCH_BASE}/start`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    session_token: session.session_token,
                    env: session.env,
                    device_id: DEVICE_ID,
                    total_capital: 100000,
                    dry_run: dryRun,
                    assets: assetConfigs,
                }),
            });
            return await r.json();
        } catch (e) { return { error: e.message }; }
    };

    const stopAgents = async () => {
        try {
            await fetch(`${ORCH_BASE}/stop`, { method: "POST" });
        } catch { }
    };

    return { ...agents, startAgents, stopAgents };
}

const Tag = ({ color, children }) => (
    <span style={{
        background: `${color}22`, color, border: `1px solid ${color}44`,
        borderRadius: 4, padding: "1px 8px", fontSize: 11, fontWeight: 700,
        fontFamily: "monospace", letterSpacing: 0.5, whiteSpace: "nowrap"
    }}>{children}</span>
);

const Metric = ({ label, value, sub, color }) => (
    <div style={{ padding: "14px 18px", background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8 }}>
        <div style={{ color: C.dim, fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
        <div style={{ color: color || C.bright, fontSize: 20, fontWeight: 700, fontFamily: "monospace" }}>{value}</div>
        {sub && <div style={{ color: C.dim, fontSize: 11, marginTop: 4 }}>{sub}</div>}
    </div>
);

const Input = ({ label, ...props }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {label && <label style={{ color: C.dim, fontSize: 10, letterSpacing: 1, textTransform: "uppercase" }}>{label}</label>}
        <input {...props} style={{
            background: "#0A1220", border: `1px solid ${C.border}`, borderRadius: 6,
            color: C.bright, padding: "8px 12px", fontSize: 13, fontFamily: "monospace",
            outline: "none", width: "100%", ...props.style
        }} />
    </div>
);

const Btn = ({ color = C.accent, disabled, loading, children, ...props }) => (
    <button {...props} disabled={disabled || loading} style={{
        background: `${color}18`, border: `1px solid ${color}50`, borderRadius: 6,
        color, padding: "9px 20px", fontSize: 12, fontWeight: 700, letterSpacing: 0.8,
        cursor: disabled || loading ? "not-allowed" : "pointer", opacity: disabled || loading ? 0.5 : 1,
        textTransform: "uppercase", transition: "all 0.15s", ...props.style
    }}>
        {loading ? "⏳ ..." : children}
    </button>
);

const Alert = ({ type, msg }) => {
    if (!msg) return null;
    const color = type === "error" ? C.red : type === "ok" ? C.green : C.yellow;
    return (
        <div style={{ background: `${color}15`, border: `1px solid ${color}40`, borderRadius: 6, padding: "8px 14px", color, fontSize: 12 }}>
            {type === "error" ? "✗ " : type === "ok" ? "✓ " : "⚡ "}{msg}
        </div>
    );
};

// ── AUTH PANEL ────────────────────────────────────────────────────────────────
/**
 * NUBRA AUTH FLOW (4 steps per official docs):
 *
 * Step 1 → POST /sendphoneotp  {phone, skip_totp:false}
 *           No headers needed. Returns temp_token. OTP NOT sent yet.
 *
 * Step 2 → POST /sendphoneotp  x-temp-token header + {phone, skip_totp:true}
 *           Actually triggers OTP SMS. Returns updated temp_token.
 *
 * Step 3 → POST /verifyphoneotp  x-temp-token + x-device-id + {phone, otp}
 *           Validates OTP. Returns auth_token. Next: ENTER_MPIN.
 *
 * Step 4 → POST /verifypin  Authorization:Bearer auth_token + x-device-id + {pin}
 *           Validates MPIN. Returns session_token → use for all API calls.
 *           NOTE: do NOT send x-temp-token in this step.
 */
function AuthPanel({ onSession }) {
    const [step, setStep] = useState(1);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    const [info, setInfo] = useState("");
    const [env, setEnv] = useState("UAT");

    // Only 2 inputs the user ever fills in across all 4 steps
    const [phone, setPhone] = useState("");
    const [otp, setOtp] = useState("");
    const [mpin, setMpin] = useState("");
    const [resendCooldown, setResendCooldown] = useState(0);

    // Tokens passed between steps — never shown to user
    const tmpRef = useRef("");   // temp_token (updated at steps 1 & 2)
    const authRef = useRef("");   // auth_token (set at step 3, used in step 4)

    const run = async (fn) => {
        setErr(""); setInfo(""); setBusy(true);
        try { await fn(); }
        catch (e) { setErr(e.message); }
        finally { setBusy(false); }
    };

    // Countdown timer for OTP resend cooldown
    useEffect(() => {
        if (resendCooldown <= 0) return;
        const id = setTimeout(() => setResendCooldown(c => c - 1), 1000);
        return () => clearTimeout(id);
    }, [resendCooldown]);

    // ── Step 1: POST /sendphoneotp  {phone, skip_totp:false} ─────────────────
    // Initiates login flow, gets first temp_token (OTP not sent yet)
    const doStep1 = () => run(async () => {
        const d = await api("/auth/step1", {
            method: "POST",
            body: JSON.stringify({ phone, env }),
        });
        tmpRef.current = d.temp_token;
        setStep(2);
        // Immediately trigger step 2 to actually send the OTP
        await doStep2Internal(d.temp_token);
    });

    // ── Step 2: POST /sendphoneotp  x-temp-token + {phone, skip_totp:true} ──
    // Actually sends OTP SMS. Returns fresh temp_token.
    const doStep2Internal = async (tok) => {
        const d = await api("/auth/step2", {
            method: "POST",
            body: JSON.stringify({ phone, temp_token: tok, env }),
        });
        tmpRef.current = d.temp_token;
        setInfo(`OTP sent to ${phone.slice(0, 2)}XXXXXXXX${phone.slice(-2)}`);
        setResendCooldown(45);
        setStep(3);
    };

    // ── Step 3: POST /verifyphoneotp  x-temp-token + x-device-id + {phone, otp}
    // Validates OTP → returns auth_token. Response includes next: "ENTER_MPIN"
    const doStep3 = () => run(async () => {
        const d = await api("/auth/step3", {
            method: "POST",
            body: JSON.stringify({
                phone,
                otp,
                temp_token: tmpRef.current,
                device_id: DEVICE_ID,
                env,
            }),
        });
        authRef.current = d.auth_token;
        setStep(4);
    });

    // ── Step 4: POST /verifypin  Authorization:Bearer auth_token + {pin} ─────
    // Validates MPIN → returns session_token. x-temp-token must NOT be sent.
    const doStep4 = () => run(async () => {
        const d = await api("/auth/step4", {
            method: "POST",
            body: JSON.stringify({
                pin: mpin,
                auth_token: authRef.current,
                device_id: DEVICE_ID,
                env,
            }),
        });
        // d.session_token is now the Bearer token for all subsequent API calls
        onSession({ session_token: d.session_token, userId: d.userId, phone: d.phone, env });
    });

    const STEPS = [
        { n: 1, label: "Mobile Number" },
        { n: 2, label: "Sending OTP…" },
        { n: 3, label: "Enter OTP" },
        { n: 4, label: "Enter MPIN" },
    ];

    return (
        <div style={{
            minHeight: "100vh", background: C.bg, display: "flex",
            alignItems: "center", justifyContent: "center", fontFamily: "'Inter', sans-serif",
        }}>
            <div style={{ width: 400, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, padding: 36 }}>

                {/* Header */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
                    <div style={{ width: 36, height: 36, background: `linear-gradient(135deg, ${C.accent}, #0066FF)`, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>⚡</div>
                    <div>
                        <div style={{ color: C.bright, fontWeight: 700, fontSize: 16 }}>RealSwing</div>
                        <div style={{ color: C.dim, fontSize: 11 }}>Nubra Login</div>
                    </div>
                    <select value={env} onChange={e => setEnv(e.target.value)} style={{
                        marginLeft: "auto", background: "#0A1220", border: `1px solid ${C.border}`,
                        color: C.accent, borderRadius: 6, padding: "4px 10px", fontSize: 12, fontFamily: "monospace"
                    }}>
                        <option value="UAT">UAT</option>
                        <option value="PROD">PROD</option>
                    </select>
                </div>

                {/* Progress bar */}
                <div style={{ display: "flex", gap: 5, marginBottom: 6 }}>
                    {STEPS.map(s => (
                        <div key={s.n} style={{ flex: 1, height: 3, borderRadius: 2, transition: "background 0.3s", background: step >= s.n ? C.accent : C.border }} />
                    ))}
                </div>
                <div style={{ color: C.dim, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 24 }}>
                    Step {step} of 4 — {STEPS[step - 1]?.label}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

                    {/* Step 1: Enter mobile number */}
                    {step === 1 && <>
                        <div style={{ color: C.text, fontSize: 12, lineHeight: 1.6, marginBottom: 4 }}>
                            Enter your Nubra registered mobile number. An OTP will be sent to this number.
                        </div>
                        <Input
                            label="Mobile Number"
                            value={phone}
                            onChange={e => setPhone(e.target.value.replace(/\D/, "").slice(0, 10))}
                            placeholder="10-digit mobile number"
                            type="tel"
                            maxLength={10}
                        />
                        <Btn onClick={doStep1} loading={busy} color={C.accent} disabled={phone.length !== 10}>
                            Send OTP →
                        </Btn>
                    </>}

                    {/* Step 3: Enter OTP */}
                    {step === 3 && <>
                        {info && <Alert type="ok" msg={info} />}
                        <div style={{ color: C.text, fontSize: 12, lineHeight: 1.6 }}>
                            Enter the 6-digit OTP sent to your mobile.
                        </div>
                        <Input
                            label="OTP"
                            value={otp}
                            onChange={e => setOtp(e.target.value.replace(/\D/, "").slice(0, 6))}
                            placeholder="6-digit OTP"
                            type="tel"
                            maxLength={6}
                        />
                        <Btn onClick={doStep3} loading={busy} color={C.green} disabled={otp.length < 4}>
                            Verify OTP →
                        </Btn>
                        <button
                            onClick={() => {
                                if (resendCooldown > 0) return;
                                setOtp(""); setErr("");
                                run(() => doStep2Internal(tmpRef.current));
                            }}
                            disabled={resendCooldown > 0 || busy}
                            style={{
                                background: "none", border: "none",
                                color: resendCooldown > 0 ? C.dim : C.accent,
                                fontSize: 11, cursor: resendCooldown > 0 ? "not-allowed" : "pointer",
                                textAlign: "center", opacity: resendCooldown > 0 ? 0.6 : 1,
                            }}
                        >
                            {resendCooldown > 0
                                ? `⏳ Resend OTP in ${resendCooldown}s`
                                : "↻ Resend OTP"}
                        </button>
                        <button
                            onClick={() => { setStep(1); setOtp(""); setErr(""); setResendCooldown(0); }}
                            style={{ background: "none", border: "none", color: C.dim, fontSize: 11, cursor: "pointer", textAlign: "center" }}
                        >
                            ← Change number
                        </button>
                    </>}

                    {/* Step 4: Enter MPIN */}
                    {step === 4 && <>
                        <div style={{ color: C.text, fontSize: 12, lineHeight: 1.6 }}>
                            Enter your Nubra MPIN to complete login.
                        </div>
                        <Input
                            label="MPIN"
                            value={mpin}
                            onChange={e => setMpin(e.target.value.replace(/\D/, "").slice(0, 6))}
                            placeholder="4–6 digit MPIN"
                            type="password"
                            maxLength={6}
                        />
                        <Btn onClick={doStep4} loading={busy} color={C.green} disabled={mpin.length < 4}>
                            Enter Dashboard ✓
                        </Btn>
                    </>}

                    <Alert type="error" msg={err} />
                </div>

                {/* Flow hint */}
                <div style={{ marginTop: 24, padding: "10px 14px", background: `${C.accent}08`, border: `1px solid ${C.border}`, borderRadius: 6 }}>
                    <div style={{ color: C.dim, fontSize: 10, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 6 }}>Auth Flow</div>
                    {["Mobile → OTP (SMS)", "Verify OTP", "Enter MPIN → session_token"].map((s, i) => (
                        <div key={i} style={{ color: i + 1 < step ? C.green : i + 1 === step - 1 ? C.accent : C.dim, fontSize: 11, padding: "2px 0" }}>
                            {i + 1 < step ? "✓" : "○"} {s}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

// ── ORDER TICKET ──────────────────────────────────────────────────────────────
function OrderTicket({ session, onSelectOption, onChainUpdate }) {
    const [instruments, setInstruments] = useState(null);
    const [instrument, setInstrument] = useState("NIFTY");
    const [exchange, setExchange] = useState("NSE");
    const [expiries, setExpiries] = useState([]);
    const [expiry, setExpiry] = useState("");
    const [chain, setChain] = useState(null);
    const [msg, setMsg] = useState({ type: "", text: "" });
    const [loadingExp, setLoadingExp] = useState(false);
    const [showGreeks, setShowGreeks] = useState(false);
    const chainRef = useRef(null);

    // Fetch instrument list on mount
    useEffect(() => {
        (async () => {
            try {
                const r = await fetch(`${API_BASE}/market/instruments`);
                const d = await r.json();
                setInstruments(d);
            } catch { }
        })();
    }, []);

    // Fetch chain (with default expiry) when instrument changes
    useEffect(() => {
        if (!instrument) return;
        setExpiry("");
        setChain(null);
        setExpiries([]);
        const exch = ["SENSEX", "BANKEX"].includes(instrument) ? "BSE" : "NSE";
        setExchange(exch);

        (async () => {
            setLoadingExp(true);
            try {
                // Fetch chain without expiry param — Nubra uses default expiry
                const d = await api(
                    `/market/optionchain/${instrument}?exchange=${exch}&session_token=${session.session_token}&device_id=${DEVICE_ID}&env=${session.env}`
                );
                if (d.chain) {
                    setExpiries(d.chain.all_expiries || []);
                    if (d.chain.expiry) setExpiry(d.chain.expiry);
                    setChain(d.chain);
                    onChainUpdate?.(d.chain, instrument);
                }
            } catch (e) {
                setMsg({ type: "error", text: `Instrument error: ${e.message}` });
            } finally { setLoadingExp(false); }
        })();
    }, [instrument, session.session_token]);

    // Re-fetch chain when expiry changes
    useEffect(() => {
        if (!instrument || !expiry) return;
        (async () => {
            try {
                const d = await api(
                    `/market/optionchain/${instrument}?expiry=${expiry}&exchange=${exchange}&session_token=${session.session_token}&device_id=${DEVICE_ID}&env=${session.env}`
                );
                setChain(d.chain);
                onChainUpdate?.(d.chain, instrument);
            } catch (e) { setMsg({ type: "error", text: e.message }); }
        })();
    }, [instrument, expiry, exchange, session.session_token]);

    // Scroll to ATM strike when chain loads
    useEffect(() => {
        if (!chain || !chainRef.current) return;
        const rows = chainRef.current.querySelectorAll("tr");
        const atmIdx = Math.floor(rows.length / 2); // ATM is usually middle after sorting
        // Try to find the exact ATM row by matching sp to atm
        const atm = chain.atm;
        let targetRow = null;
        rows.forEach((row, idx) => {
            const strikeEl = row.querySelector("td:nth-child(4)");
            if (strikeEl && Math.abs(parseFloat(strikeEl.textContent) * 100 - atm) < 100) {
                targetRow = row;
            }
        });
        if (targetRow) {
            targetRow.scrollIntoView({ block: "center", behavior: "smooth" });
        } else if (rows[atmIdx]) {
            rows[atmIdx].scrollIntoView({ block: "center", behavior: "smooth" });
        }
    }, [chain]);

    const atm = chain?.atm ? chain.atm / 100 : null;

    return (
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 }}>
            <div style={{ color: C.bright, fontWeight: 600, fontSize: 14, marginBottom: 16 }}>🎯 Order Ticket</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                <div>
                    <label style={{ color: C.dim, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", display: "block", marginBottom: 4 }}>Underlying</label>
                    <select value={instrument} onChange={e => { setInstrument(e.target.value); }}
                        style={{ background: "#0A1220", border: `1px solid ${C.border}`, color: C.bright, borderRadius: 6, padding: "8px 10px", fontSize: 13, width: "100%", fontFamily: "monospace" }}>
                        {!instruments && <option>Loading...</option>}
                        {instruments && <>
                            <optgroup label="📊 Indices">
                                {instruments.indices.map(i => (
                                    <option key={i.name} value={i.name}>{i.name}</option>
                                ))}
                            </optgroup>
                            <optgroup label="📈 Stocks (F&O)">
                                {instruments.stocks.map(s => (
                                    <option key={s.name} value={s.name}>{s.name}</option>
                                ))}
                            </optgroup>
                        </>}
                    </select>
                </div>
                <div>
                    <label style={{ color: C.dim, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", display: "block", marginBottom: 4 }}>Expiry</label>
                    <select value={expiry} onChange={e => setExpiry(e.target.value)}
                        disabled={loadingExp || expiries.length === 0}
                        style={{ background: "#0A1220", border: `1px solid ${C.border}`, color: C.bright, borderRadius: 6, padding: "8px 10px", fontSize: 13, width: "100%", fontFamily: "monospace" }}>
                        {loadingExp && <option>Loading expiries...</option>}
                        {!loadingExp && expiries.length === 0 && <option>No expiries found</option>}
                        {expiries.map(e => (
                            <option key={e} value={e}>{e}</option>
                        ))}
                    </select>
                </div>
            </div>

            {chain && (
                <>
                    <div style={{ color: C.dim, fontSize: 11, marginBottom: 10 }}>
                        ATM: <span style={{ color: C.yellow, fontFamily: "monospace" }}>{atm}</span>
                        &nbsp;| Spot: <span style={{ color: C.accent, fontFamily: "monospace" }}>{chain.cp / 100}</span>
                        &nbsp;| Expiries: {chain.all_expiries?.join(", ")}
                    </div>

                    {/* Greeks toggle + Strike table — Groww style */}
                    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
                        <button onClick={() => setShowGreeks(s => !s)}
                            style={{
                                background: showGreeks ? `${C.accent}18` : "none",
                                border: `1px solid ${showGreeks ? C.accent + "50" : C.border}`,
                                color: showGreeks ? C.accent : C.dim,
                                borderRadius: 4, padding: "3px 10px", cursor: "pointer",
                                fontSize: 10, fontWeight: 600,
                            }}>
                            Greeks {showGreeks ? "✓" : "+"}
                        </button>
                    </div>
                    <div ref={chainRef} style={{ maxHeight: 500, overflowY: "auto", marginBottom: 14, border: `1px solid ${C.border}`, borderRadius: 6 }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                            <thead>
                                <tr style={{ color: C.dim, fontSize: 9, position: "sticky", top: 0, background: C.panel, zIndex: 2 }}>
                                    <th style={{ padding: "5px 8px", textAlign: "right", width: showGreeks ? 60 : 80 }}>OI</th>
                                    <th style={{ padding: "5px 8px", textAlign: "right", width: 70 }}>LTP</th>
                                    {showGreeks && <th style={{ padding: "5px 3px", textAlign: "right", width: 35 }}>Δ</th>}
                                    {showGreeks && <th style={{ padding: "5px 3px", textAlign: "right", width: 35 }}>IV</th>}
                                    <th style={{ padding: "5px 8px", textAlign: "center", width: 65, color: C.yellow, fontWeight: 700 }}>STRIKE</th>
                                    {showGreeks && <th style={{ padding: "5px 3px", textAlign: "left", width: 35 }}>IV</th>}
                                    {showGreeks && <th style={{ padding: "5px 3px", textAlign: "left", width: 35 }}>Δ</th>}
                                    <th style={{ padding: "5px 8px", textAlign: "left", width: 70 }}>LTP</th>
                                    <th style={{ padding: "5px 8px", textAlign: "left", width: showGreeks ? 60 : 80 }}>OI</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(() => {
                                    const allCe = chain.ce || [];
                                    const allPe = chain.pe || [];
                                    const maxCeOi = Math.max(...allCe.map(s => s.oi || 0), 1);
                                    const maxPeOi = Math.max(...allPe.map(s => s.oi || 0), 1);
                                    const sorted = [...allCe].sort((a, b) => a.sp - b.sp);
                                    const spot = chain.cp ? chain.cp / 100 : null;
                                    return sorted.map((ce, i) => {
                                        const pe = allPe.find(p => Math.abs(p.sp - ce.sp) < 100);
                                        const strike = ce.sp / 100;
                                        const isATM = spot && Math.abs(strike - spot) < 50;
                                        const ceOiPct = Math.min((ce.oi || 0) / maxCeOi, 1);
                                        const peOiPct = Math.min((pe?.oi || 0) / maxPeOi, 1);
                                        const ceOiChg = (ce.oi || 0) - (ce.prev_oi || 0);
                                        const peOiChg = (pe?.oi || 0) - (pe?.prev_oi || 0);
                                        const ceOiChgPct = ce.prev_oi ? ((ceOiChg / ce.prev_oi) * 100).toFixed(1) : null;
                                        const peOiChgPct = pe?.prev_oi ? ((peOiChg / pe.prev_oi) * 100).toFixed(1) : null;
                                        return (
                                            <tr key={i} className="row-hover" style={{
                                                borderBottom: `1px solid ${C.border}44`,
                                                cursor: "pointer",
                                            }}>
                                                {/* CE OI */}
                                                <td style={{ padding: "4px 8px", position: "relative", textAlign: "right" }}>
                                                    <div style={{
                                                        position: "absolute", top: 0, right: 0, bottom: 0,
                                                        width: `${ceOiPct * 100}%`,
                                                        background: `${C.green}12`,
                                                    }} />
                                                    <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                                                        <span style={{ color: C.dim, fontFamily: "monospace", fontSize: 11 }}>
                                                            {(ce.oi || 0) > 0 ? `${(ce.oi / 1000).toFixed(0)}K` : ""}
                                                        </span>
                                                        {ceOiChg !== 0 && (
                                                            <span style={{
                                                                color: ceOiChg > 0 ? C.green : C.red,
                                                                fontSize: 9, fontWeight: 700,
                                                                background: `${ceOiChg > 0 ? C.green : C.red}18`,
                                                                borderRadius: 3, padding: "0 4px",
                                                            }}>
                                                                {ceOiChg > 0 ? "+" : ""}{ceOiChgPct || ceOiChg}%
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                {/* CE LTP */}
                                                <td style={{
                                                    padding: "4px 8px", textAlign: "right",
                                                    color: (ce.ltpchg || 0) >= 0 ? C.green : C.red,
                                                    fontFamily: "monospace", fontWeight: 600, fontSize: 12,
                                                }}
                                                    onClick={() => onSelectOption?.({ ...ce, side: "CE" }, instrument)}>
                                                    {ce.ltp > 0 ? (ce.ltp / 100).toFixed(2) : ""}
                                                </td>
                                                {/* CE greeks */}
                                                {showGreeks && (
                                                    <td style={{ padding: "3px 3px", textAlign: "right", color: "#7B8DB0", fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }}>
                                                        {ce.delta != null ? ce.delta.toFixed(2) : ""}
                                                    </td>
                                                )}
                                                {showGreeks && (
                                                    <td style={{ padding: "3px 3px", textAlign: "right", color: "#7B8DB0", fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }}>
                                                        {ce.iv != null ? `${ce.iv.toFixed(0)}%` : ""}
                                                    </td>
                                                )}
                                                {/* STRIKE */}
                                                <td style={{
                                                    padding: "4px 8px", textAlign: "center",
                                                    color: isATM ? C.yellow : C.text,
                                                    fontWeight: isATM ? 700 : 500,
                                                    fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
                                                    borderLeft: isATM ? `3px solid ${C.yellow}` : "3px solid transparent",
                                                    borderRight: isATM ? `3px solid ${C.yellow}` : "3px solid transparent",
                                                }}>
                                                    {strike.toFixed(0)}
                                                </td>
                                                {/* PE greeks */}
                                                {showGreeks && (
                                                    <td style={{ padding: "3px 3px", textAlign: "left", color: "#7B8DB0", fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }}>
                                                        {pe?.iv != null ? `${pe.iv.toFixed(0)}%` : ""}
                                                    </td>
                                                )}
                                                {showGreeks && (
                                                    <td style={{ padding: "3px 3px", textAlign: "left", color: "#7B8DB0", fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }}>
                                                        {pe?.delta != null ? pe.delta.toFixed(2) : ""}
                                                    </td>
                                                )}
                                                {/* PE LTP */}
                                                <td style={{
                                                    padding: "4px 8px", textAlign: "left",
                                                    color: (pe?.ltpchg || 0) >= 0 ? C.green : C.red,
                                                    fontFamily: "monospace", fontWeight: 600, fontSize: 12,
                                                }}
                                                    onClick={() => { if (pe) onSelectOption?.({ ...pe, side: "PE" }, instrument); }}>
                                                    {pe?.ltp > 0 ? (pe.ltp / 100).toFixed(2) : ""}
                                                </td>
                                                {/* PE OI */}
                                                <td style={{ padding: "4px 8px", position: "relative", textAlign: "left" }}>
                                                    <div style={{
                                                        position: "absolute", top: 0, left: 0, bottom: 0,
                                                        width: `${peOiPct * 100}%`,
                                                        background: `${C.red}12`,
                                                    }} />
                                                    <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 4 }}>
                                                        {peOiChg !== 0 && (
                                                            <span style={{
                                                                color: peOiChg > 0 ? C.red : C.green,
                                                                fontSize: 9, fontWeight: 700,
                                                                background: `${peOiChg > 0 ? C.red : C.green}18`,
                                                                borderRadius: 3, padding: "0 4px",
                                                            }}>
                                                                {peOiChg > 0 ? "+" : ""}{peOiChgPct || peOiChg}%
                                                            </span>
                                                        )}
                                                        <span style={{ color: C.dim, fontFamily: "monospace", fontSize: 11 }}>
                                                            {pe?.oi > 0 ? `${(pe.oi / 1000).toFixed(0)}K` : ""}
                                                        </span>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    });
                                })()}
                            </tbody>
                        </table>
                    </div>

                </>
            )}
            <Alert type={msg.type} msg={msg.text} />
        </div>
    );
}

// ── POSITIONS PANEL ───────────────────────────────────────────────────────────
function PositionsPanel({ session }) {
    const [data, setData] = useState(null);
    const [funds, setFunds] = useState(null);
    const [loading, setLoading] = useState(false);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const [p, f] = await Promise.all([
                api(`/portfolio/positions?session_token=${session.session_token}&device_id=${DEVICE_ID}&env=${session.env}`),
                api(`/portfolio/funds?session_token=${session.session_token}&device_id=${DEVICE_ID}&env=${session.env}`),
            ]);
            setData(p.portfolio);
            setFunds(f);
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    }, [session]);

    useEffect(() => { refresh(); }, [refresh]);

    const allPositions = [
        ...(data?.opt_positions || []),
        ...(data?.fut_positions || []),
        ...(data?.stock_positions || []),
    ];

    return (
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div style={{ color: C.bright, fontWeight: 600, fontSize: 14 }}>📊 Live Positions</div>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    {funds && (
                        <span style={{ color: C.dim, fontSize: 11, fontFamily: "monospace" }}>
                            Available: <span style={{ color: C.green }}>{inr(funds?.available || 0)}</span>
                        </span>
                    )}
                    <Btn onClick={refresh} loading={loading} color={C.accent} style={{ padding: "5px 14px", fontSize: 11 }}>↻ Refresh</Btn>
                </div>
            </div>

            {data?.position_stats && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 14 }}>
                    <Metric label="Total P&L" value={inr(data.position_stats.total_pnl / 100)} color={data.position_stats.total_pnl >= 0 ? C.green : C.red} />
                    <Metric label="Realised" value={inr(data.position_stats.realised_pnl / 100)} color={C.green} />
                    <Metric label="Unrealised" value={inr(data.position_stats.unrealised_pnl / 100)} color={C.yellow} />
                    <Metric label="P&L %" value={`${data.position_stats.total_pnl_chg?.toFixed(2)}%`} color={data.position_stats.total_pnl_chg >= 0 ? C.green : C.red} />
                </div>
            )}

            {allPositions.length > 0 ? (
                <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <thead>
                            <tr style={{ color: C.dim, fontSize: 10, letterSpacing: 0.8, textTransform: "uppercase" }}>
                                {["Instrument", "Type", "Side", "Qty", "Avg Price", "LTP", "P&L", "P&L %"].map(h => (
                                    <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600 }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {allPositions.map((p, i) => (
                                <tr key={i} className="row-hover" style={{ borderTop: `1px solid ${C.border}` }}>
                                    <td style={{ padding: "9px 12px", color: C.bright, fontWeight: 600 }}>{p.display_name}</td>
                                    <td style={{ padding: "9px 12px" }}><Tag color={C.dim}>{p.derivative_type}</Tag></td>
                                    <td style={{ padding: "9px 12px" }}><Tag color={p.order_side === "BUY" ? C.green : C.red}>{p.order_side}</Tag></td>
                                    <td style={{ padding: "9px 12px", fontFamily: "monospace", color: C.text }}>{p.qty}</td>
                                    <td style={{ padding: "9px 12px", fontFamily: "monospace", color: C.text }}>{fromPaise(p.avg_price)}</td>
                                    <td style={{ padding: "9px 12px", fontFamily: "monospace", color: C.accent }}>{fromPaise(p.ltp)}</td>
                                    <td style={{ padding: "9px 12px", fontFamily: "monospace", fontWeight: 700, color: p.pnl >= 0 ? C.green : C.red }}>
                                        {p.pnl >= 0 ? "+" : ""}{inr(p.pnl / 100)}
                                    </td>
                                    <td style={{ padding: "9px 12px", fontFamily: "monospace", color: p.pnl_chg >= 0 ? C.green : C.red }}>
                                        {p.pnl_chg >= 0 ? "+" : ""}{p.pnl_chg?.toFixed(2)}%
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div style={{ color: C.dim, textAlign: "center", padding: "30px 0", fontSize: 13 }}>
                    {loading ? "Loading positions..." : "No open positions"}
                </div>
            )}

            {data?.close_positions?.length > 0 && (
                <details style={{ marginTop: 14 }}>
                    <summary style={{ color: C.dim, fontSize: 12, cursor: "pointer", padding: "6px 0" }}>
                        Closed Positions ({data.close_positions.length})
                    </summary>
                    <div style={{ marginTop: 8, opacity: 0.7 }}>
                        {data.close_positions.map((p, i) => (
                            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 12px", fontSize: 12, borderBottom: `1px solid ${C.border}44` }}>
                                <span style={{ color: C.text }}>{p.display_name}</span>
                                <span style={{ color: p.pnl >= 0 ? C.green : C.red, fontFamily: "monospace" }}>
                                    {p.pnl >= 0 ? "+" : ""}{inr(p.pnl / 100)}
                                </span>
                            </div>
                        ))}
                    </div>
                </details>
            )}
        </div>
    );
}

// ── SCROLLING TICKER ──────────────────────────────────────────────────────────
const DEFAULT_WATCH = [
    { symbol: "NIFTY", exchange: "NSE" },
    { symbol: "BANKNIFTY", exchange: "NSE" },
    { symbol: "SENSEX", exchange: "BSE" },
    { symbol: "FINNIFTY", exchange: "NSE" },
    { symbol: "MIDCPNIFTY", exchange: "NSE" },

];

function Ticker({ watchList, hidden, onHide, onAdd, onRemove }) {
    const tickerRef = useRef(null);
    const prices = usePrices(s => s.prices);

    if (hidden || !watchList.length) return null;

    return (
        <div style={{
            background: "#0A1220", borderBottom: `1px solid ${C.border}`,
            padding: "6px 0", overflow: "hidden", position: "relative",
        }}>
            <div ref={tickerRef} style={{
                display: "flex", gap: 28, whiteSpace: "nowrap",
                animation: "ticker 25s linear infinite",
            }}>
                {watchList.concat(watchList).map((w, i) => {
                    const d = prices[w.symbol];
                    const price = d?.price ? (d.price / 100).toFixed(2) : "—";
                    const prev = d?.prev_close ? (d.prev_close / 100) : null;
                    const chg = prev && d?.price ? ((d.price / 100 - prev) / prev * 100).toFixed(2) : null;
                    const up = chg > 0;
                    return (
                        <div key={`${w.symbol}-${i}`} style={{
                            display: "flex", alignItems: "center", gap: 8, fontSize: 12,
                            position: "relative",
                        }}
                            onMouseEnter={e => { e.currentTarget.querySelector('[data-rm]').style.opacity = 1; }}
                            onMouseLeave={e => { e.currentTarget.querySelector('[data-rm]').style.opacity = 0; }}>
                            <span style={{ color: C.text, fontWeight: 700, fontSize: 11 }}>{w.symbol}</span>
                            <span style={{ color: C.bright, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>{price}</span>
                            {chg && (
                                <span style={{ color: up ? C.green : C.red, fontFamily: "monospace", fontSize: 11 }}>
                                    {up ? "▲" : "▼"} {Math.abs(chg)}%
                                </span>
                            )}
                            <span data-rm onClick={() => onRemove?.(w.symbol)} style={{
                                opacity: 0, transition: "opacity 0.15s", cursor: "pointer",
                                color: C.red, fontSize: 10, marginLeft: 2,
                            }}>✕</span>
                        </div>
                    );
                })}
            </div>
            <div style={{ position: "absolute", right: 8, top: 4, display: "flex", gap: 4, zIndex: 10 }}>
                <button onClick={() => {
                    const s = prompt("Add symbol to watch (e.g. RELIANCE, TCS):");
                    if (s && s.trim()) onAdd?.(s.trim().toUpperCase());
                }} style={{
                    background: "#0A1220dd", border: `1px solid ${C.border}`, borderRadius: 4,
                    color: C.accent, cursor: "pointer", fontSize: 10, padding: "1px 8px", lineHeight: 1.5,
                }}>+</button>
                <button onClick={onHide} style={{
                    background: "#0A1220dd", border: `1px solid ${C.border}`, borderRadius: 4,
                    color: C.dim, cursor: "pointer", fontSize: 10, padding: "1px 8px", lineHeight: 1.5,
                }}>✕</button>
            </div>
        </div>
    );
}

// ── ORDERS PANEL ─────────────────────────────────────────────────────────────
function OrdersPanel({ session }) {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(false);
    const [filter, setFilter] = useState("all");
    const refresh = useCallback(async () => {
        setLoading(true);
        try { const d = await api(`/portfolio/orders?session_token=${session.session_token}&device_id=${DEVICE_ID}&env=${session.env}`); setOrders(Array.isArray(d) ? d : d?.orders || []); } catch { setOrders([]); } finally { setLoading(false); }
    }, [session]);
    useEffect(() => { refresh(); }, [refresh]);
    const filtered = orders.filter(o => { const s = o.order_status || ""; if (filter === "all") return true; if (filter === "success") return ["COMPLETE", "FILLED", "EXECUTED"].some(x => s.includes(x)); if (filter === "pending") return ["PENDING", "OPEN", "TRIGGER"].some(x => s.includes(x)); if (filter === "failed") return ["REJECTED", "CANCELLED", "EXPIRED"].some(x => s.includes(x)); return true; });
    const sc = s => { if (!s) return C.dim; if (["COMPLETE", "FILLED", "EXECUTED"].some(x => s.includes(x))) return C.green; if (["PENDING", "OPEN", "TRIGGER"].some(x => s.includes(x))) return C.yellow; return C.red; };
    const fromPaise = v => (v / 100).toFixed(2);
    return (
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div style={{ color: C.bright, fontWeight: 600, fontSize: 14 }}>📋 Orders</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <select value={filter} onChange={e => setFilter(e.target.value)} style={{ background: "#0A1220", border: `1px solid ${C.border}`, color: C.accent, borderRadius: 4, padding: "4px 8px", fontSize: 11, cursor: "pointer" }}>
                        <option value="all">All ({orders.length})</option>
                        <option value="success">Successful</option>
                        <option value="pending">Pending</option>
                        <option value="failed">Failed</option>
                    </select>
                    <Btn onClick={refresh} loading={loading} color={C.accent} style={{ padding: "5px 14px", fontSize: 11 }}>↻</Btn>
                </div>
            </div>
            {filtered.length === 0 ? (
                <div style={{ color: C.dim, textAlign: "center", padding: "30px 0", fontSize: 12 }}>{loading ? "Loading orders..." : "No orders found"}</div>
            ) : (
                <div style={{ maxHeight: 400, overflowY: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                        <thead><tr style={{ color: C.dim, fontSize: 9, position: "sticky", top: 0, background: C.panel, zIndex: 2 }}>
                            {["Order ID", "Instrument", "Side", "Qty", "Price", "Status", "Time"].map(h => <th key={h} style={{ padding: "6px 8px", textAlign: "left", fontWeight: 600 }}>{h}</th>)}
                        </tr></thead>
                        <tbody>{filtered.slice(0, 100).map((o, i) => (
                            <tr key={i} className="row-hover" style={{ borderTop: `1px solid ${C.border}44` }}>
                                <td style={{ padding: "6px 8px", color: C.dim, fontFamily: "monospace", fontSize: 10 }}>{o.order_id || o.ref_id || "—"}</td>
                                <td style={{ padding: "6px 8px", color: C.bright, fontWeight: 600 }}>{o.display_name || o.trading_symbol || "—"}</td>
                                <td style={{ padding: "6px 8px" }}><Tag color={o.order_side === "BUY" || o.order_side === "ORDER_SIDE_BUY" ? C.green : C.red}>{o.order_side?.replace("ORDER_SIDE_", "") || "—"}</Tag></td>
                                <td style={{ padding: "6px 8px", color: C.text, fontFamily: "monospace" }}>{o.order_qty || o.qty || "—"}</td>
                                <td style={{ padding: "6px 8px", color: C.accent, fontFamily: "monospace" }}>{o.order_price ? fromPaise(o.order_price) : o.price ? fromPaise(o.price) : "—"}</td>
                                <td style={{ padding: "6px 8px" }}><span style={{ color: sc(o.order_status), fontSize: 10, fontFamily: "monospace" }}>{o.order_status?.replace("ORDER_STATUS_", "") || "—"}</span></td>
                                <td style={{ padding: "6px 8px", color: C.dim, fontSize: 10, fontFamily: "monospace" }}>{o.order_timestamp || o.updated_at ? new Date(o.order_timestamp || o.updated_at).toLocaleTimeString("en-IN") : "—"}</td>
                            </tr>
                        ))}</tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

// ── AGENT DASHBOARD ───────────────────────────────────────────────────────────
function AgentDashboard({ session, sse }) {
    const [dryRun, setDryRun] = useState(true);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    const [instruments, setInstruments] = useState({ indices: [], stocks: [] });
    const [selectedAssets, setSelectedAssets] = useState({}); // {name: expiry}

    useEffect(() => {
        (async () => {
            try {
                const r = await fetch(`${API_BASE}/market/instruments`);
                const d = await r.json();
                setInstruments(d);
                // Default: NIFTY, BANKNIFTY, SENSEX
                const dflt = {};
                for (const i of d.indices) dflt[i.name] = "";
                setSelectedAssets(dflt);
            } catch { }
        })();
    }, []);

    const toggleAsset = (name, checked) => {
        setSelectedAssets(prev => {
            const n = { ...prev };
            if (checked) n[name] = "";
            else delete n[name];
            return n;
        });
    };

    const defaultExpiry = (() => {
        const d = new Date();
        const day = d.getDay();
        const toThu = day <= 4 ? 4 - day : 4 + 7 - day;
        d.setDate(d.getDate() + toThu);
        return d.toISOString().slice(0, 10).replace(/-/g, "");
    })();

    const assetKeys = Object.keys(selectedAssets);

    return (
        <div>
            {/* Controls */}
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 16, flexWrap: "wrap" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, color: C.dim, fontSize: 12, cursor: "pointer" }}>
                    <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)}
                        style={{ accentColor: C.accent }} />
                    Dry Run
                </label>
                <Btn onClick={async () => {
                    if (!assetKeys.length) return setErr("Select at least one instrument");
                    const assets = assetKeys.map(name => ({
                        name,
                        exchange: "NSE",
                        expiry: selectedAssets[name] || defaultExpiry,
                    }));
                    setBusy(true); setErr("");
                    const r = await sse.startAgents(assets, dryRun);
                    setBusy(false);
                    if (r.error) setErr(r.error);
                }} loading={busy} color={sse.running ? C.yellow : C.green}
                    disabled={!assetKeys.length || sse.running}>
                    {sse.running ? "Running..." : "Start Agents"}
                </Btn>
                <Btn onClick={async () => {
                    setBusy(true);
                    await sse.stopAgents();
                    setBusy(false);
                }} loading={busy} color={C.red} disabled={!sse.running}>
                    Stop
                </Btn>
                {err && <Alert type="error" msg={err} />}
            </div>

            {/* Instrument picker */}
            <div style={{
                background: `${C.panel}`, border: `1px solid ${C.border}`,
                borderRadius: 8, padding: 14, marginBottom: 16, maxHeight: 240, overflowY: "auto",
            }}>
                <div style={{ color: C.dim, fontSize: 10, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
                    Monitored Instruments ({assetKeys.length}/{6 + instruments.stocks.length})
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 4 }}>
                    {instruments.indices.map(i => (
                        <label key={i.name} style={{
                            display: "flex", alignItems: "center", gap: 6,
                            padding: "3px 6px", borderRadius: 4, cursor: "pointer", fontSize: 11,
                            background: i.name in selectedAssets ? `${C.accent}12` : "none",
                        }}>
                            <input type="checkbox" checked={i.name in selectedAssets}
                                onChange={e => toggleAsset(i.name, e.target.checked)}
                                style={{ accentColor: C.accent }} />
                            <span style={{ color: C.bright }}>{i.name}</span>
                            <span style={{ color: C.dim, fontSize: 9, marginLeft: "auto" }}>{i.exchange}</span>
                        </label>
                    ))}
                    {instruments.stocks.map(s => (
                        <label key={s.name} style={{
                            display: "flex", alignItems: "center", gap: 6,
                            padding: "3px 6px", borderRadius: 4, cursor: "pointer", fontSize: 11,
                            background: s.name in selectedAssets ? `${C.accent}12` : "none",
                        }}>
                            <input type="checkbox" checked={s.name in selectedAssets}
                                onChange={e => toggleAsset(s.name, e.target.checked)}
                                style={{ accentColor: C.accent }} />
                            <span style={{ color: C.text }}>{s.name}</span>
                            <span style={{ color: C.dim, fontSize: 9, marginLeft: "auto" }}>{s.exchange}</span>
                        </label>
                    ))}
                </div>
            </div>

            {/* Expiry overrides per asset */}
            {assetKeys.length > 0 && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
                    {assetKeys.map(name => (
                        <div key={name} style={{
                            display: "flex", alignItems: "center", gap: 4,
                            background: "#0A1220", border: `1px solid ${C.border}`, borderRadius: 6,
                            padding: "3px 8px",
                        }}>
                            <span style={{ color: C.bright, fontSize: 11, fontWeight: 600 }}>{name}</span>
                            <input value={selectedAssets[name] || defaultExpiry}
                                onChange={e => setSelectedAssets(prev => ({ ...prev, [name]: e.target.value }))}
                                placeholder="YYYYMMDD"
                                style={{
                                    background: "none", border: "none", color: C.accent,
                                    fontSize: 10, fontFamily: "monospace", outline: "none",
                                    width: 85,
                                }} />
                        </div>
                    ))}
                </div>
            )}

            {/* Status cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 20 }}>
                <Metric label="Orchestrator" value={sse.running ? "Running" : "Stopped"} color={sse.running ? C.green : C.red} />
                <Metric label="Nubra WS" value={sse.connected ? "Connected" : "Disconnected"} color={sse.connected ? C.green : C.dim} />
                <Metric label="Data Agent" value={sse.agentStatus?.data ? "✓" : "—"} color={sse.agentStatus?.data ? C.green : C.dim} />
                <Metric label="Analyst" value={sse.agentStatus?.analyst ? "✓" : "—"} color={sse.agentStatus?.analyst ? C.green : C.dim} />
                <Metric label="Signal (9Router)" value={sse.agentStatus?.signal ? "✓" : "—"} color={sse.agentStatus?.signal ? C.purple : C.dim} />
                <Metric label="Executor" value={sse.agentStatus?.executor ? "✓" : "—"} color={sse.agentStatus?.executor ? C.yellow : C.dim} />
                <Metric label="Signals" value={sse.signals.length} color={C.accent} />
                <Metric label="Auto Orders" value={sse.orders.length} color={sse.orders.filter(o => o.success).length > 0 ? C.green : C.dim} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {/* Analyst Reports */}
                <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 }}>
                    <div style={{ color: C.bright, fontWeight: 600, fontSize: 14, marginBottom: 14 }}>📋 Analyst Reports</div>
                    {Object.keys(sse.analyst).length === 0 ? (
                        <div style={{ color: C.dim, textAlign: "center", padding: 30, fontSize: 12 }}>
                            {sse.running ? "Waiting for first analysis..." : "Start agents to see analysis"}
                        </div>
                    ) : (
                        Object.entries(sse.analyst).map(([asset, r]) => (
                            <div key={asset} style={{
                                background: `${C.accent}08`, border: `1px solid ${C.border}`, borderRadius: 8,
                                padding: 14, marginBottom: 10
                            }}>
                                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                                    <span style={{ color: C.bright, fontWeight: 700 }}>{asset}</span>
                                    <Tag color={r.trend === "BULLISH" ? C.green : r.trend === "BEARISH" ? C.red : C.yellow}>{r.trend}</Tag>
                                </div>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 11 }}>
                                    <span style={{ color: C.dim }}>Spot: <span style={{ color: C.accent, fontFamily: "monospace" }}>{r.spot}</span></span>
                                    <span style={{ color: C.dim }}>ATM: <span style={{ color: C.yellow, fontFamily: "monospace" }}>{r.atm}</span></span>
                                    <span style={{ color: C.dim }}>RSI: <span style={{ fontFamily: "monospace", color: r.rsi > 70 ? C.red : r.rsi < 30 ? C.green : C.text }}>{r.rsi}</span></span>
                                    <span style={{ color: C.dim }}>PCR: <span style={{ fontFamily: "monospace" }}>{r.pcr}</span></span>
                                    <span style={{ color: C.dim }}>IV: <span style={{ fontFamily: "monospace" }}>{r.iv_atm}%</span></span>
                                    <span style={{ color: C.dim }}>OI Dir: <span style={{ fontFamily: "monospace", color: r.oi_direction === "PUT_HEAVY" ? C.green : r.oi_direction === "CALL_HEAVY" ? C.red : C.dim }}>{r.oi_direction}</span></span>
                                </div>
                                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                                    <Tag color={r.trend_gate_pass ? C.green : C.red}>Trend {r.trend_gate_pass ? "✓" : "✗"}</Tag>
                                    <Tag color={r.momentum_pass ? C.green : C.red}>Mom {r.momentum_pass ? "✓" : "✗"}</Tag>
                                    <Tag color={r.structure_pass ? C.green : C.red}>Struct {r.structure_pass ? "✓" : "✗"}</Tag>
                                </div>
                                {r.support > 0 && (
                                    <div style={{ color: C.dim, fontSize: 10, marginTop: 6, fontFamily: "monospace" }}>
                                        S: {r.support} | R: {r.resistance} | CHoCH: {r.choch || "—"}
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>

                {/* Signal Feed */}
                <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 }}>
                    <div style={{ color: C.bright, fontWeight: 600, fontSize: 14, marginBottom: 14 }}>🚦 Signal Feed</div>
                    {sse.signals.length === 0 ? (
                        <div style={{ color: C.dim, textAlign: "center", padding: 30, fontSize: 12 }}>
                            {sse.running ? "Waiting for signals..." : "Start agents to see trade signals"}
                        </div>
                    ) : (
                        <div style={{ maxHeight: 400, overflowY: "auto" }}>
                            {sse.signals.map((s, i) => (
                                <div key={i} style={{
                                    background: s.action === "WAIT" ? `${C.yellow}08` : `${C.green}10`,
                                    border: `1px solid ${s.action === "WAIT" ? C.yellow + "30" : C.green + "30"}`,
                                    borderRadius: 6, padding: 10, marginBottom: 8, fontSize: 11
                                }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                                        <span style={{ color: C.bright, fontWeight: 600 }}>
                                            {s.asset} {s.action.replace("BUY_", "")}
                                            {s.strike > 0 && ` ${s.strike}`}
                                        </span>
                                        <Tag color={s.confidence === "HIGH" ? C.green : s.confidence === "MEDIUM" ? C.yellow : C.dim}>{s.confidence}</Tag>
                                    </div>
                                    {s.entry > 0 && (
                                        <div style={{ color: C.dim, display: "flex", gap: 12, fontFamily: "monospace", marginBottom: 4 }}>
                                            <span>Entry: <span style={{ color: C.accent }}>₹{s.entry}</span></span>
                                            <span>SL: <span style={{ color: C.red }}>₹{s.sl}</span></span>
                                            <span>Target: <span style={{ color: C.green }}>₹{s.target}</span></span>
                                        </div>
                                    )}
                                    <div style={{ display: "flex", justifyContent: "space-between", color: C.dim }}>
                                        <span>{s.setup_type} | R:R {s.rr_ratio}</span>
                                        <span style={{ color: C.dim, fontSize: 10 }}>{s.reason?.slice(0, 60)}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Auto Order Log */}
                    {sse.orders.length > 0 && (
                        <>
                            <div style={{ color: C.bright, fontWeight: 600, fontSize: 13, margin: "16px 0 10px" }}>📦 Auto Orders</div>
                            <div style={{ maxHeight: 200, overflowY: "auto" }}>
                                {sse.orders.slice(0, 10).map((o, i) => (
                                    <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 8px", fontSize: 11, borderBottom: `1px solid ${C.border}44` }}>
                                        <span style={{ color: o.success ? C.green : C.red, fontFamily: "monospace" }}>
                                            {o.success ? "✓" : "✗"} #{o.order_id || "—"}
                                        </span>
                                        <span style={{ color: C.text }}>{o.asset} {o.action?.replace("BUY_", "")}</span>
                                        <span style={{ color: C.dim, fontSize: 10 }}>{o.order_status}</span>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

// ── ERROR BOUNDARY ────────────────────────────────────────────────────────────
class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }
    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }
    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    padding: 40, textAlign: "center", color: "#FF3B5C",
                    background: "#0D1729", borderRadius: 10, minHeight: 400,
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                }}>
                    <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
                    <div style={{ fontSize: 13, marginBottom: 8 }}>Chart component crashed</div>
                    <div style={{ fontSize: 11, color: "#4A6080", marginBottom: 16, maxWidth: 400 }}>
                        {this.state.error?.message || "Unknown error"}
                    </div>
                    <button onClick={() => this.setState({ hasError: false, error: null })}
                        style={{
                            background: "#00D4FF15", border: "1px solid #00D4FF44",
                            color: "#00D4FF", borderRadius: 6, padding: "8px 20px", cursor: "pointer",
                        }}>
                        Retry
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

// ── DIGITAL CLOCK ─────────────────────────────────────────────────────────────
const CLOCK_STYLES = [
    {
        name: "Segments",
        render: (h, m, s, a) => (
            <span style={{ fontFamily: "'Orbitron','JetBrains Mono',monospace", fontWeight: 900, fontSize: 15, letterSpacing: 2, color: "#00FFAA", textShadow: "0 0 8px #00FFAA44" }}>
                {h}:{m}:{s}
            </span>
        ),
    },
    {
        name: "Matrix",
        render: (h, m, s, a) => (
            <span style={{ fontFamily: "'Courier New',monospace", fontWeight: 700, fontSize: 14, color: "#0F0", textShadow: "0 0 6px #0F088", background: "#00110044", padding: "3px 10px", borderRadius: 4, border: "1px solid #0F044" }}>
                [{h}:{m}:{s}]<span style={{ opacity: s % 2 ? .3 : 1 }}>_</span>
            </span>
        ),
    },
    {
        name: "Modern",
        render: (h, m, s, a) => (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: "'Inter',sans-serif", fontWeight: 800, fontSize: 18, lineHeight: 1, color: C.bright, letterSpacing: .5 }}>
                        {h}:{m}<span style={{ color: C.accent }}>:{s}</span>
                    </div>
                    <div style={{ fontSize: 8, color: C.dim, letterSpacing: 1.5, textTransform: "uppercase", marginTop: 1 }}>{a}</div>
                </div>
            </div>
        ),
    },
    {
        name: "Neon",
        render: (h, m, s, a) => (
            <span style={{ fontFamily: "'Orbitron',monospace", fontWeight: 900, fontSize: 16, letterSpacing: 3, color: C.accent, textShadow: `0 0 10px ${C.accent}88,0 0 20px ${C.accent}44` }}>
                {h}:{m}<span style={{ color: C.red, textShadow: "0 0 10px #FF3B5C88", opacity: s % 2 ? 1 : .3, transition: "opacity .3s" }}>:{s}</span>
            </span>
        ),
    },
];

function DigitalClock({ format, time }) {
    const now = new Date();
    let h = now.getHours(); const a = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    const m = String(now.getMinutes()).padStart(2, "0");
    const s = String(now.getSeconds()).padStart(2, "0");
    return <span onClick={format.next} style={{ cursor: "pointer" }} title={`Click: ${format.name}`}>{format.render(h, m, s, a)}</span>;
}

// ── MOMENTUM PANEL ──────────────────────────────────────────────────────────
function MomentumPanel({ oiData, liveData, aiData, onSearch, searchLoading }) {
    const hasLive = liveData?.strikes?.length > 0;
    const hasAi = aiData?.analysis;

    // OI section content
    const renderOI = () => {
        if (!oiData) return <div style={{ color: C.dim, fontSize: 11 }}>Select an instrument to see OI momentum</div>;
        const { concentration, pc_ratio, top_bullish, top_bearish } = oiData;
        const isPH = concentration === "PUT_HEAVY";
        const isCH = concentration === "CALL_HEAVY";
        return (
            <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <span style={{ color: C.dim, fontSize: 10 }}>OI PCR: <b style={{ color: isPH ? C.red : isCH ? C.green : C.text }}>{pc_ratio}</b></span>
                    <Tag color={isPH ? C.red : isCH ? C.green : C.yellow}>{concentration?.replace("_", " ") || "NEUTRAL"}</Tag>
                </div>
                {top_bullish?.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                        <div style={{ color: C.green, fontSize: 10, fontWeight: 700, marginBottom: 4 }}>▲ Bullish (CE OI↑)</div>
                        {top_bullish.slice(0, 4).map((s, i) => (
                            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", fontSize: 11, fontFamily: "monospace" }}>
                                <span style={{ color: C.bright }}>{s.strike}</span>
                                <span style={{ color: C.green, fontWeight: 700 }}>+{s.oi_chg_pct}%</span>
                            </div>
                        ))}
                    </div>
                )}
                {top_bearish?.length > 0 && (
                    <div>
                        <div style={{ color: C.red, fontSize: 10, fontWeight: 700, marginBottom: 4 }}>▼ Bearish (PE OI↑)</div>
                        {top_bearish.slice(0, 4).map((s, i) => (
                            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", fontSize: 11, fontFamily: "monospace" }}>
                                <span style={{ color: C.bright }}>{s.strike}</span>
                                <span style={{ color: C.red, fontWeight: 700 }}>+{s.oi_chg_pct}%</span>
                            </div>
                        ))}
                    </div>
                )}
                {!top_bullish?.length && !top_bearish?.length && (
                    <div style={{ color: C.dim, textAlign: "center", padding: 12, fontSize: 11 }}>No OI change data</div>
                )}
            </>
        );
    };

    // Live feed section content
    const renderLive = () => {
        if (!hasLive) return <div style={{ color: C.dim, fontSize: 11 }}>Start agents for live market feed</div>;
        const { pc_ratio, top_bullish, top_bearish, expected_move } = liveData;
        const em = expected_move;
        return (
            <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <span style={{ color: C.dim, fontSize: 10 }}>Live PCR: <b style={{ color: C.accent }}>{pc_ratio}</b></span>
                    <Tag color={C.accent}>REAL-TIME</Tag>
                </div>
                {em && em["1h"] != null && (
                    <div style={{ fontSize: 10, color: C.dim, marginBottom: 8 }}>
                        Exp. move: <span style={{ color: C.accent, fontFamily: "monospace" }}>1h ±₹{em["1h"]}</span>{" "}
                        <span style={{ color: C.accent, fontFamily: "monospace" }}>1d ±₹{em["1d"]}</span>
                    </div>
                )}
                {top_bullish?.slice(0, 3).map((s, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", fontSize: 11, fontFamily: "monospace" }}>
                        <span style={{ color: C.green }}>{s.strike}⚡</span>
                        <span style={{ color: C.green, fontWeight: 700 }}>+{s.oi_chg_pct}%</span>
                    </div>
                ))}
                {top_bearish?.slice(0, 3).map((s, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", fontSize: 11, fontFamily: "monospace" }}>
                        <span style={{ color: C.red }}>{s.strike}⚡</span>
                        <span style={{ color: C.red, fontWeight: 700 }}>+{s.oi_chg_pct}%</span>
                    </div>
                ))}
                {!top_bullish?.length && !top_bearish?.length && (
                    <div style={{ color: C.dim, textAlign: "center", padding: 12, fontSize: 11 }}>Awaiting live signals...</div>
                )}
            </>
        );
    };

    // Search input state
    const [searchInput, setSearchInput] = useState("");

    // AI analysis section content
    const renderAI = () => {
        const a = aiData?.analysis;
        const rendering = a ? (
            <div style={{ fontSize: 11, color: C.text, lineHeight: 1.6, whiteSpace: "pre-wrap", fontFamily: "'JetBrains Mono',monospace", fontSize: 10 }}>{a}</div>
        ) : (
            <div style={{ color: C.dim, fontSize: 11 }}>AI analysis ready — use search box below</div>
        );
        return (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", gap: 4 }}>
                    <input value={searchInput} onChange={e => setSearchInput(e.target.value)}
                        placeholder="Search news or ask AI..."
                        onKeyDown={e => { if (e.key === "Enter" && searchInput.trim()) { onSearch?.(searchInput.trim()); } }}
                        style={{ flex: 1, background: "#0A1220", border: `1px solid ${C.border}`, borderRadius: 4, color: C.bright, padding: "5px 8px", fontSize: 11, outline: "none" }} />
                    <button onClick={() => { if (searchInput.trim()) { onSearch?.(searchInput.trim()); } }}
                        disabled={searchLoading || !searchInput.trim()}
                        style={{ background: `${C.accent}18`, border: `1px solid ${C.accent}50`, borderRadius: 4, color: C.accent, padding: "5px 10px", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                        {searchLoading ? "..." : "→"}
                    </button>
                </div>
                {rendering}
            </div>
        );
    };

    return (
        <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 12,
            background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16
        }}>
            {/* Column 1: OI Data */}
            <div style={{ borderRight: `1px solid ${C.border}44`, paddingRight: 12 }}>
                <div style={{ color: C.bright, fontWeight: 600, fontSize: 12, marginBottom: 10 }}>📊 OI Data</div>
                {renderOI()}
            </div>
            {/* Column 2: Live Feed */}
            <div style={{ borderRight: `1px solid ${C.border}44`, paddingRight: 12 }}>
                <div style={{ color: C.bright, fontWeight: 600, fontSize: 12, marginBottom: 10 }}>⚡ Live Feed</div>
                {renderLive()}
            </div>
            {/* Column 3: AI Analysis */}
            <div>
                <div style={{ color: C.bright, fontWeight: 600, fontSize: 12, marginBottom: 10 }}>🤖 AI Analysis</div>
                {renderAI()}
            </div>
        </div>
    );
}

// ── OPTION CHAIN TABLE ────────────────────────────────────────────────────────
function OptionChainTable({ data, spotPrice, onSelectOption, instrument }) {

    const chainRef = useRef(null);
    const [filterMode, setFilterMode] = useState('focus'); // 'focus' or 'complete'

    const formatNum = (v, p = 2) => (v == null || isNaN(v)) ? '-' : v.toFixed(p);
    const fmtK = (v) => v > 0 ? `${(v / 1000).toFixed(0)}K` : '-';
    const getChgColor = (v) => v > 0 ? C.green : v < 0 ? C.red : C.dim;

    // Group strikes
    const strikes = (() => {
        if (!data || data.length === 0) return [];
        const ceMap = {}, peMap = {};
        data.forEach(d => {
            const strike = d.sp ? d.sp / 100 : d.strike || 0;
            if (d.type === 'CE') ceMap[strike] = d;
            else peMap[strike] = d;
        });
        const all = [...new Set([...Object.keys(ceMap), ...Object.keys(peMap)])].map(Number).sort((a, b) => a - b);
        return all.map(s => ({ strike: s, ce: ceMap[s] || null, pe: peMap[s] || null }));
    })();

    // Find ATM index
    let atmIndex = -1, minDiff = Infinity;
    strikes.forEach((r, i) => {
        const diff = Math.abs(r.strike - (spotPrice || 0));
        if (diff < minDiff) { minDiff = diff; atmIndex = i; }
    });

    // Filter based on mode
    const rendered = filterMode === 'focus' && atmIndex >= 0
        ? strikes.slice(Math.max(0, atmIndex - 10), atmIndex + 11)
        : strikes;

    // Scroll to ATM
    useEffect(() => {
        if (!chainRef.current || !spotPrice) return;
        const rows = chainRef.current.querySelectorAll("tr[data-strike]");
        let closest = null, minD = Infinity;
        rows.forEach(row => {
            const s = parseFloat(row.dataset.strike);
            if (isNaN(s)) return;
            const d = Math.abs(s - spotPrice);
            if (d < minD) { minD = d; closest = row; }
        });
        if (closest) closest.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, [rendered.length, spotPrice, filterMode]);

    if (!data || data.length === 0) {
        return (
            <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 40, textAlign: 'center' }}>
                <div style={{ fontSize: 28, marginBottom: 12 }}>📋</div>
                <div style={{ color: C.dim, fontSize: 13 }}>No option chain data loaded</div>
                <div style={{ color: C.dim, fontSize: 11, marginTop: 6 }}>Go to the <b>Trade</b> tab first to load an instrument's chain data</div>
            </div>
        );
    }

    return (
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20, display: 'flex', flexDirection: 'column', height: 700 }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                    <div style={{ color: C.bright, fontWeight: 700, fontSize: 15 }}>📋 Symmetric Option Chain</div>
                    <div style={{ color: C.dim, fontSize: 10 }}>Live Greeks, Time Value, Intrinsic Value</div>
                </div>
                <div style={{ display: 'flex', gap: 6, background: '#0A1220', padding: 4, borderRadius: 6 }}>
                    <button onClick={() => setFilterMode('focus')} style={{
                        padding: '5px 12px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                        background: filterMode === 'focus' ? `${C.yellow}20` : 'transparent',
                        color: filterMode === 'focus' ? C.yellow : C.dim, border: 'none', cursor: 'pointer'
                    }}>🎯 Focus (ITM10-OTM10)</button>
                    <button onClick={() => setFilterMode('complete')} style={{
                        padding: '5px 12px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                        background: filterMode === 'complete' ? `${C.yellow}20` : 'transparent',
                        color: filterMode === 'complete' ? C.yellow : C.dim, border: 'none', cursor: 'pointer'
                    }}>🌐 Complete ({strikes.length})</button>
                </div>
            </div>

            {/* Table */}
            <div ref={chainRef} style={{ flex: 1, overflow: 'auto', border: `1px solid ${C.border}`, borderRadius: 6 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10, minWidth: 1200 }}>
                    <thead>
                        {/* Row 1: CALLS / STRIKE / PUTS */}
                        <tr style={{ background: C.panel, position: 'sticky', top: 0, zIndex: 3 }}>
                            <th colSpan={9} style={{ padding: '6px', textAlign: 'center', background: '#3D1A1A', color: C.green, fontWeight: 700, borderRight: `1px solid ${C.border}` }}>CALL OPTIONS</th>
                            <th style={{ padding: '6px', textAlign: 'center', background: C.panel, color: C.yellow, fontWeight: 700, borderRight: `1px solid ${C.border}` }}>STRIKE</th>
                            <th colSpan={9} style={{ padding: '6px', textAlign: 'center', background: '#1A3D1A', color: C.red, fontWeight: 700 }}>PUT OPTIONS</th>
                        </tr>
                        {/* Row 2: Column headers */}
                        <tr style={{ background: C.panel, position: 'sticky', top: 36, zIndex: 2 }}>
                            {/* CE columns */}
                            <th style={{ padding: '3px 4px', textAlign: 'right', color: C.dim }}>Vega</th>
                            <th style={{ padding: '3px 4px', textAlign: 'right', color: C.dim }}>Gamma</th>
                            <th style={{ padding: '3px 4px', textAlign: 'right', color: C.dim }}>IV</th>
                            <th style={{ padding: '3px 4px', textAlign: 'right', color: C.dim }}>Theta</th>
                            <th style={{ padding: '3px 4px', textAlign: 'right', color: C.dim }}>Delta</th>
                            <th style={{ padding: '3px 4px', textAlign: 'right', color: C.dim }}>TV</th>
                            <th style={{ padding: '3px 4px', textAlign: 'right', color: C.dim }}>Int Val</th>
                            <th style={{ padding: '3px 4px', textAlign: 'right', color: C.dim }}>OI</th>
                            <th style={{ padding: '3px 4px', textAlign: 'right', color: C.dim, borderRight: `1px solid ${C.border}` }}>LTP</th>
                            {/* Strike */}
                            <th style={{ padding: '3px 4px', textAlign: 'center', color: C.dim, borderRight: `1px solid ${C.border}` }}></th>
                            {/* PE columns */}
                            <th style={{ padding: '3px 4px', textAlign: 'left', color: C.dim }}>LTP</th>
                            <th style={{ padding: '3px 4px', textAlign: 'left', color: C.dim }}>OI</th>
                            <th style={{ padding: '3px 4px', textAlign: 'left', color: C.dim }}>Int Val</th>
                            <th style={{ padding: '3px 4px', textAlign: 'left', color: C.dim }}>TV</th>
                            <th style={{ padding: '3px 4px', textAlign: 'left', color: C.dim }}>Delta</th>
                            <th style={{ padding: '3px 4px', textAlign: 'left', color: C.dim }}>Theta</th>
                            <th style={{ padding: '3px 4px', textAlign: 'left', color: C.dim }}>IV</th>
                            <th style={{ padding: '3px 4px', textAlign: 'left', color: C.dim }}>Gamma</th>
                            <th style={{ padding: '3px 4px', textAlign: 'left', color: C.dim }}>Vega</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rendered.map((row, idx) => {
                            const strike = row.strike;
                            const isATM = spotPrice && Math.abs(strike - spotPrice) < 50;
                            const isITMCe = spotPrice && strike < spotPrice;
                            const isITMPe = spotPrice && strike > spotPrice;

                            // Call values
                            const ceLtp = row.ce?.ltp ? row.ce.ltp / 100 : 0;
                            const ceIntrinsic = Math.max(0, (spotPrice || 0) - strike);
                            const ceTV = Math.max(0, ceLtp - ceIntrinsic);
                            const ceOiChg = (row.ce?.oi || 0) - (row.ce?.prev_oi || 0);
                            const ceOiChgPct = row.ce?.prev_oi ? ((ceOiChg / row.ce.prev_oi) * 100).toFixed(1) : '0';

                            // Put values
                            const peLtp = row.pe?.ltp ? row.pe.ltp / 100 : 0;
                            const peIntrinsic = Math.max(0, strike - (spotPrice || 0));
                            const peTV = Math.max(0, peLtp - peIntrinsic);
                            const peOiChg = (row.pe?.oi || 0) - (row.pe?.prev_oi || 0);
                            const peOiChgPct = row.pe?.prev_oi ? ((peOiChg / row.pe.prev_oi) * 100).toFixed(1) : '0';

                            // OI distribution bar
                            const totalOI = (row.ce?.oi || 0) + (row.pe?.oi || 0);
                            const ceOiPct = totalOI > 0 ? ((row.ce?.oi || 0) / totalOI) * 100 : 50;

                            return (
                                <Fragment key={idx}>
                                    <tr data-strike={strike} className="row-hover" style={{
                                        borderBottom: `1px solid ${C.border}44`,
                                        background: isATM ? `${C.yellow}08` : 'transparent',
                                    }}>
                                        {/* CE Vega */}
                                        <td style={{ padding: '4px 4px', textAlign: 'right', fontFamily: 'monospace', color: C.dim, background: isITMCe ? `${C.yellow}10` : 'transparent' }}>
                                            {formatNum(row.ce?.vega, 2)}
                                        </td>
                                        {/* CE Gamma */}
                                        <td style={{ padding: '4px 4px', textAlign: 'right', fontFamily: 'monospace', color: C.dim, background: isITMCe ? `${C.yellow}10` : 'transparent' }}>
                                            {formatNum(row.ce?.gamma, 4)}
                                        </td>
                                        {/* CE IV */}
                                        <td style={{ padding: '4px 4px', textAlign: 'right', fontFamily: 'monospace', color: C.text, background: isITMCe ? `${C.yellow}15` : 'transparent' }}>
                                            {formatNum(row.ce?.iv, 1)}%
                                        </td>
                                        {/* CE Theta */}
                                        <td style={{ padding: '4px 4px', textAlign: 'right', fontFamily: 'monospace', color: C.dim, background: isITMCe ? `${C.yellow}10` : 'transparent' }}>
                                            {formatNum(row.ce?.theta, 2)}
                                        </td>
                                        {/* CE Delta */}
                                        <td style={{ padding: '4px 4px', textAlign: 'right', fontFamily: 'monospace', color: C.text, fontWeight: 600, background: isITMCe ? `${C.yellow}10` : 'transparent' }}>
                                            {formatNum(row.ce?.delta, 2)}
                                        </td>
                                        {/* CE Time Value */}
                                        <td style={{ padding: '4px 4px', textAlign: 'right', fontFamily: 'monospace', color: C.text, background: isITMCe ? `${C.yellow}10` : 'transparent' }}>
                                            {formatNum(ceTV, 2)}
                                        </td>
                                        {/* CE Intrinsic */}
                                        <td style={{ padding: '4px 4px', textAlign: 'right', fontFamily: 'monospace', color: C.dim, background: isITMCe ? `${C.yellow}10` : 'transparent' }}>
                                            {formatNum(ceIntrinsic, 2)}
                                        </td>
                                        {/* CE OI */}
                                        <td style={{ padding: '4px 4px', textAlign: 'right', fontFamily: 'monospace', background: isITMCe ? `${C.yellow}10` : 'transparent' }}>
                                            <div style={{ fontWeight: 600, color: C.text }}>{fmtK(row.ce?.oi)}</div>
                                            <div style={{ fontSize: 9, color: getChgColor(ceOiChg), fontWeight: 700 }}>
                                                {ceOiChg > 0 ? '+' : ''}{ceOiChgPct}%
                                                {' '}{(() => {
                                                    const oiUp = ceOiChg > 0;
                                                    const priceUp = (row.ce?.ltpchg || 0) > 0;
                                                    if (oiUp && priceUp) return <span style={{color:C.green,fontSize:8}}>▲LB</span>;
                                                    if (oiUp && !priceUp) return <span style={{color:C.red,fontSize:8}}>▼SB</span>;
                                                    if (!oiUp && !priceUp && ceOiChg < 0) return <span style={{color:C.red,fontSize:8}}>▼LU</span>;
                                                    if (!oiUp && priceUp && ceOiChg < 0) return <span style={{color:C.green,fontSize:8}}>▲SC</span>;
                                                    return null;
                                                })()}
                                            </div>
                                        </td>
                                        {/* CE LTP */}
                                        <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, borderRight: `1px solid ${C.border}`, background: isITMCe ? `${C.yellow}15` : 'transparent' }}
                                            onClick={() => row.ce && onSelectOption?.({ ...row.ce, side: 'CE' }, instrument)}>
                                            <span style={{ color: (row.ce?.ltpchg || 0) >= 0 ? C.green : C.red, cursor: 'pointer' }}>
                                                {row.ce?.ltp > 0 ? `₹${formatNum(ceLtp)}` : '-'}
                                            </span>
                                        </td>

                                        {/* STRIKE */}
                                        <td style={{
                                            padding: '4px 6px', textAlign: 'center', fontFamily: "'JetBrains Mono', monospace",
                                            fontWeight: isATM ? 800 : 600, fontSize: 11,
                                            color: isATM ? C.yellow : C.text,
                                            borderLeft: `3px solid ${isATM ? C.yellow : 'transparent'}`,
                                            borderRight: `3px solid ${isATM ? C.yellow : 'transparent'}`,
                                            background: isATM ? `${C.yellow}12` : C.panel,
                                        }}>
                                            {strike.toFixed(0)}
                                            {/* Mini OI bar */}
                                            <div style={{ width: 36, height: 3, background: C.border, borderRadius: 2, margin: '3px auto 0', display: 'flex', overflow: 'hidden' }}>
                                                <div style={{ width: `${ceOiPct}%`, background: C.green }} />
                                                <div style={{ width: `${100 - ceOiPct}%`, background: C.red }} />
                                            </div>
                                        </td>

                                        {/* PE LTP */}
                                        <td style={{ padding: '4px 6px', textAlign: 'left', fontFamily: 'monospace', fontWeight: 700, background: isITMPe ? `${C.yellow}15` : 'transparent' }}
                                            onClick={() => row.pe && onSelectOption?.({ ...row.pe, side: 'PE' }, instrument)}>
                                            <span style={{ color: (row.pe?.ltpchg || 0) >= 0 ? C.green : C.red, cursor: 'pointer' }}>
                                                {row.pe?.ltp > 0 ? `₹${formatNum(peLtp)}` : '-'}
                                            </span>
                                        </td>
                                        {/* PE OI */}
                                        <td style={{ padding: '4px 4px', textAlign: 'left', fontFamily: 'monospace', background: isITMPe ? `${C.yellow}10` : 'transparent' }}>
                                            <div style={{ fontWeight: 600, color: C.text }}>{fmtK(row.pe?.oi)}</div>
                                            <div style={{ fontSize: 9, color: getChgColor(peOiChg), fontWeight: 700 }}>
                                                {peOiChg > 0 ? '+' : ''}{peOiChgPct}%
                                                {' '}{(() => {
                                                    const oiUp = peOiChg > 0;
                                                    const priceUp = (row.pe?.ltpchg || 0) > 0;
                                                    if (oiUp && priceUp) return <span style={{color:C.green,fontSize:8}}>▲LB</span>;
                                                    if (oiUp && !priceUp) return <span style={{color:C.red,fontSize:8}}>▼SB</span>;
                                                    if (!oiUp && !priceUp && peOiChg < 0) return <span style={{color:C.red,fontSize:8}}>▼LU</span>;
                                                    if (!oiUp && priceUp && peOiChg < 0) return <span style={{color:C.green,fontSize:8}}>▲SC</span>;
                                                    return null;
                                                })()}
                                            </div>
                                        </td>
                                        {/* PE Intrinsic */}
                                        <td style={{ padding: '4px 4px', textAlign: 'left', fontFamily: 'monospace', color: C.dim, background: isITMPe ? `${C.yellow}10` : 'transparent' }}>
                                            {formatNum(peIntrinsic, 2)}
                                        </td>
                                        {/* PE Time Value */}
                                        <td style={{ padding: '4px 4px', textAlign: 'left', fontFamily: 'monospace', color: C.text, background: isITMPe ? `${C.yellow}10` : 'transparent' }}>
                                            {formatNum(peTV, 2)}
                                        </td>
                                        {/* PE Delta */}
                                        <td style={{ padding: '4px 4px', textAlign: 'left', fontFamily: 'monospace', color: C.text, fontWeight: 600, background: isITMPe ? `${C.yellow}10` : 'transparent' }}>
                                            {formatNum(row.pe?.delta, 2)}
                                        </td>
                                        {/* PE Theta */}
                                        <td style={{ padding: '4px 4px', textAlign: 'left', fontFamily: 'monospace', color: C.dim, background: isITMPe ? `${C.yellow}10` : 'transparent' }}>
                                            {formatNum(row.pe?.theta, 2)}
                                        </td>
                                        {/* PE IV */}
                                        <td style={{ padding: '4px 4px', textAlign: 'left', fontFamily: 'monospace', color: C.text, background: isITMPe ? `${C.yellow}15` : 'transparent' }}>
                                            {formatNum(row.pe?.iv, 1)}%
                                        </td>
                                        {/* PE Gamma */}
                                        <td style={{ padding: '4px 4px', textAlign: 'left', fontFamily: 'monospace', color: C.dim, background: isITMPe ? `${C.yellow}10` : 'transparent' }}>
                                            {formatNum(row.pe?.gamma, 4)}
                                        </td>
                                        {/* PE Vega */}
                                        <td style={{ padding: '4px 4px', textAlign: 'left', fontFamily: 'monospace', color: C.dim, background: isITMPe ? `${C.yellow}10` : 'transparent' }}>
                                            {formatNum(row.pe?.vega, 2)}
                                        </td>
                                    </tr>

                                    {/* Spot price banner row */}
                                    {idx < rendered.length - 1 && (() => {
                                        const nextStrike = rendered[idx + 1].strike;
                                        return (spotPrice && strike <= spotPrice && nextStrike > spotPrice) ? (
                                            <tr key="spot-banner" style={{ background: '#0A1220', borderTop: `2px solid ${C.accent}`, borderBottom: `2px solid ${C.accent}` }}>
                                                <td colSpan={9} style={{ padding: '4px 12px', textAlign: 'right', fontSize: 9, color: C.dim, textTransform: 'uppercase' }}>Nifty Spot Price</td>
                                                <td style={{ padding: '4px 8px', textAlign: 'center', background: C.accent, color: '#000', fontWeight: 800, fontSize: 11 }}>₹{spotPrice.toFixed(2)}</td>
                                                <td colSpan={9} style={{ padding: '4px 12px', textAlign: 'left', fontSize: 9, color: C.dim, textTransform: 'uppercase' }}>Options Boundary</td>
                                            </tr>
                                        ) : null;
                                    })()}
                                </Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Legend */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}`, fontSize: 10, color: C.dim }}>
                <div style={{ display: 'flex', gap: 16 }}>
                    <span><span style={{ display: 'inline-block', width: 10, height: 10, background: `${C.yellow}30`, border: `1px solid ${C.yellow}60`, borderRadius: 2, marginRight: 4 }}></span>ITM shaded</span>
                    <span>Spot: <span style={{ color: C.accent, fontWeight: 700 }}>₹{spotPrice?.toFixed(2) || '-'}</span></span>
                </div>
            </div>
        </div>
    );
}

// ── OI HEATMAP ────────────────────────────────────────────────────────────────
function OIHeatmap({ data }) {
    const formatY = (v) => {
        if (v >= 10000000) return `${(v / 10000000).toFixed(1)}Cr`;
        if (v >= 100000) return `${(v / 100000).toFixed(1)}L`;
        if (v >= 1000) return `${(v / 1000).toFixed(0)}K`;
        return v;
    };

    if (!data || data.length === 0) {
        return (
            <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 40, textAlign: 'center' }}>
                <div style={{ fontSize: 28, marginBottom: 12 }}>🔥</div>
                <div style={{ color: C.dim, fontSize: 13 }}>No OI heatmap data loaded</div>
                <div style={{ color: C.dim, fontSize: 11, marginTop: 6 }}>Go to the <b>Trade</b> tab first to load an instrument's chain data</div>
            </div>
        );
    }

    return (
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20, height: 450 }}>
            <div style={{ color: C.bright, fontWeight: 700, fontSize: 15, marginBottom: 8 }}>
                🔥 Open Interest Heatmap & Distribution
            </div>
            <div style={{ color: C.dim, fontSize: 10, marginBottom: 16 }}>
                Visual comparison of Call vs Put Open Interest across strike prices
            </div>

            <div style={{ height: 320 }}>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                        <XAxis dataKey="strike" stroke={C.dim} fontSize={10} tickLine={false} />
                        <YAxis stroke={C.dim} fontSize={10} tickFormatter={formatY} tickLine={false} axisLine={false} />
                        <Tooltip
                            formatter={(v) => v.toLocaleString()}
                            contentStyle={{ backgroundColor: C.panel, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11, color: C.text }}
                        />
                        <Legend verticalAlign="top" height={28} iconSize={8} iconType="circle" wrapperStyle={{ fontSize: 11, color: C.dim }} />
                        <Bar name="Call OI (CE)" dataKey="calls_oi" radius={[4, 4, 0, 0]}
                            shape={(props) => {
                                const { x, y, width, height, payload } = props;
                                const chg = payload.calls_oi_change || 0;
                                const intensity = Math.min(Math.abs(chg) / Math.max(Math.max(...data.map(d => Math.max(Math.abs(d.calls_oi_change || 0), Math.abs(d.puts_oi_change || 0)))), 1), 1);
                                const isUp = chg > 0;
                                const brightColor = '#FF6B8A';
                                const dimColor = '#4A1520';
                                const barColor = isUp ? brightColor : dimColor;
                                return <rect x={x} y={y} width={width} height={height} fill={barColor} opacity={0.4 + intensity * 0.6} rx={4} ry={4} />;
                            }}
                        />
                        <Bar name="Put OI (PE)" dataKey="puts_oi" radius={[4, 4, 0, 0]}
                            shape={(props) => {
                                const { x, y, width, height, payload } = props;
                                const chg = payload.puts_oi_change || 0;
                                const intensity = Math.min(Math.abs(chg) / Math.max(Math.max(...data.map(d => Math.max(Math.abs(d.calls_oi_change || 0), Math.abs(d.puts_oi_change || 0)))), 1), 1);
                                const isUp = chg > 0;
                                const brightColor = '#00E676';
                                const dimColor = '#0A3520';
                                const barColor = isUp ? brightColor : dimColor;
                                return <rect x={x} y={y} width={width} height={height} fill={barColor} opacity={0.4 + intensity * 0.6} rx={4} ry={4} />;
                            }}
                        />
                    </BarChart>
                </ResponsiveContainer>
            </div>

            {/* Summary footer */}
            {data.length > 0 && (() => {
                const totalCe = data.reduce((s, d) => s + (d.calls_oi || 0), 0);
                const totalPe = data.reduce((s, d) => s + (d.puts_oi || 0), 0);
                const totalCeChg = data.reduce((s, d) => s + (d.calls_oi_change || 0), 0);
                const totalPeChg = data.reduce((s, d) => s + (d.puts_oi_change || 0), 0);
                const pcr = totalCe > 0 ? totalPe / totalCe : 0;
                const maxCe = data.reduce((b, d) => (d.calls_oi || 0) > (b.calls_oi || 0) ? d : b, data[0]);
                const maxPe = data.reduce((b, d) => (d.puts_oi || 0) > (b.puts_oi || 0) ? d : b, data[0]);
                return (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 16, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
                        <div><div style={{ color: C.dim, fontSize: 9, letterSpacing: 1 }}>TOTAL CE OI</div><div style={{ color: C.red, fontFamily: 'monospace', fontWeight: 700 }}>{(totalCe / 100000).toFixed(1)}L{totalCeChg !== 0 ? <span style={{ color: totalCeChg > 0 ? C.green : C.red, fontSize: 10, marginLeft: 4 }}>({totalCeChg > 0 ? '+' : ''}{(totalCeChg / 100000).toFixed(1)}L)</span> : ''}</div></div>
                        <div><div style={{ color: C.dim, fontSize: 9, letterSpacing: 1 }}>TOTAL PE OI</div><div style={{ color: C.green, fontFamily: 'monospace', fontWeight: 700 }}>{(totalPe / 100000).toFixed(1)}L{totalPeChg !== 0 ? <span style={{ color: totalPeChg > 0 ? C.green : C.red, fontSize: 10, marginLeft: 4 }}>({totalPeChg > 0 ? '+' : ''}{(totalPeChg / 100000).toFixed(1)}L)</span> : ''}</div></div>
                        <div><div style={{ color: C.dim, fontSize: 9, letterSpacing: 1 }}>PCR</div><div style={{ color: pcr > 1.3 ? C.green : pcr < 0.7 ? C.red : C.yellow, fontFamily: 'monospace', fontWeight: 700 }}>{pcr.toFixed(2)}</div></div>
                        <div><div style={{ color: C.dim, fontSize: 9, letterSpacing: 1 }}>MAX OI STRIKES</div><div style={{ fontFamily: 'monospace', fontSize: 11 }}><span style={{ color: C.red }}>CE:{maxCe?.strike}</span> / <span style={{ color: C.green }}>PE:{maxPe?.strike}</span></div></div>
                    </div>
                );
            })()}
        </div>
    );
}

function OIChart({ data, mode }) {
    const formatY = (v) => {
        if (v >= 10000000) return `${(v / 10000000).toFixed(1)}Cr`;
        if (v >= 100000) return `${(v / 100000).toFixed(1)}L`;
        if (v >= 1000) return `${(v / 1000).toFixed(0)}K`;
        return v;
    };

    if (!data || data.length === 0) return (
        <div style={{ color: C.dim, fontSize: 11, textAlign: 'center', padding: 40 }}>No OI data available</div>
    );

    const isChange = mode === "change";
    const ceKey = isChange ? "calls_oi_change" : "calls_oi";
    const peKey = isChange ? "puts_oi_change" : "puts_oi";
    const maxVal = Math.max(...data.map(d => Math.abs(d[ceKey] || 0)), ...data.map(d => Math.abs(d[peKey] || 0)), 1);
    const maxOiChange = Math.max(...data.map(d => Math.max(Math.abs(d.calls_oi_change || 0), Math.abs(d.puts_oi_change || 0))), 1);

    return (
        <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                <XAxis dataKey="strike" stroke={C.dim} fontSize={9} tickLine={false} interval={Math.max(Math.floor(data.length / 12), 1)} />
                <YAxis stroke={C.dim} fontSize={9} tickFormatter={formatY} tickLine={false} axisLine={false} domain={isChange ? [-(maxVal * 1.1), maxVal * 1.1] : [0, maxVal * 1.1]} />
                <Tooltip
                    formatter={(v, name) => [v.toLocaleString(), name]}
                    contentStyle={{ backgroundColor: C.panel, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 10, color: C.text }}
                />
                <Legend verticalAlign="top" height={24} iconSize={8} iconType="circle" wrapperStyle={{ fontSize: 10, color: C.dim }} />
                {/* CE */}
                <Bar name={isChange ? "CE Change" : "Call OI (CE)"} dataKey={ceKey} fill={C.red} radius={[3, 3, 0, 0]} />
                {/* PE */}
                <Bar name={isChange ? "PE Change" : "Put OI (PE)"} dataKey={peKey} fill={C.green} radius={[3, 3, 0, 0]} />
            </BarChart>
        </ResponsiveContainer>
    );
}

// ── MOBILE HOOK ──────────────────────────────────────────────────────────────
function useMobile(breakpoint = 768) {
    const [isMobile, setIsMobile] = useState(() => window.innerWidth < breakpoint);
    useEffect(() => {
        const h = () => setIsMobile(window.innerWidth < breakpoint);
        window.addEventListener('resize', h);
        return () => window.removeEventListener('resize', h);
    }, [breakpoint]);
    return isMobile;
}

// ── MAIN DASHBOARD ────────────────────────────────────────────────────────────
function Dashboard({ session, onLogout }) {
    const isMobile = useMobile();
    // Start shared price polling (single loop feeds Ticker, MarketWatch etc.)
    usePricePolling(() => session);
    const [activeTab, setActiveTab] = useState("positions");
    const [clock, setClock] = useState("");
    const [clockStyleIdx, setClockStyleIdx] = useState(0); // 0=Segments (default)
    const clockStyle = CLOCK_STYLES[clockStyleIdx];
    clockStyle.next = () => setClockStyleIdx(i => (i + 1) % CLOCK_STYLES.length);
    const [orders, setOrders] = useState([]);
    const [funds, setFunds] = useState(null);
    const [liveMode, setLiveMode] = useState(false); // false=paper, true=live broker
    const [selOption, setSelOption] = useState(null);
    const [tradeQty, setTradeQty] = useState(1);
    const [tradeLimitPrice, setTradeLimitPrice] = useState("");
    const [tradeSlPrice, setTradeSlPrice] = useState("");
    const [tradeMsg, setTradeMsg] = useState("");
    const [activeInstrument, setActiveInstrument] = useState("NIFTY");
    const [chainData, setChainData] = useState(null);
    const [watchList, setWatchList] = useState(() => {
        try { return JSON.parse(localStorage.getItem("realswing_watch") || "[]"); }
        catch { return []; }
    });
    const [tickerHidden, setTickerHidden] = useState(false);
    const [aiAnalysis, setAiAnalysis] = useState(null);
    const [aiLoading, setAiLoading] = useState(false);
    const [oiTimeRange, setOiTimeRange] = useState("fullday");
    const oiSnapshots = useRef([]);  // [{time, ceGrp, peGrp}]
    const sse = useSSE(session);
    const paperStore = usePaperTradeStore();

    // Place a real order via broker
    const placeLiveOrder = async (orderParams) => {
      try {
        const r = await fetch(`${API_BASE}/trade/order`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ref_id: orderParams.ref_id,
            order_type: orderParams.trigger_price ? "ORDER_TYPE_STOPLOSS" : "ORDER_TYPE_REGULAR",
            order_qty: orderParams.qty,
            order_side: orderParams.side === "BUY" ? "ORDER_SIDE_BUY" : "ORDER_SIDE_SELL",
            order_delivery_type: "ORDER_DELIVERY_TYPE_IDAY",
            validity_type: "DAY",
            price_type: "LIMIT",
            order_price: Math.round(orderParams.price * 100),
            trigger_price: orderParams.trigger_price ? Math.round(orderParams.trigger_price * 100) : undefined,
            tag: "realswing_live",
            session_token: session.session_token,
            device_id: DEVICE_ID,
            env: session.env,
          }),
        });
        return await r.json();
      } catch (e) { return { error: e.message }; }
    };
    const [loadTemplateName, setLoadTemplateName] = useState('');

    // Store OI snapshots whenever chainData updates
    useEffect(() => {
        if (!chainData?.chain) return;
        const ce = chainData.chain.ce || [];
        const pe = chainData.chain.pe || [];
        const ceGrp = {};
        const peGrp = {};
        ce.forEach(s => { const k = Math.round((s.sp || (s.strike * 100) || 0) / 100); ceGrp[k] = (ceGrp[k] || 0) + (s.oi || 0); });
        pe.forEach(s => { const k = Math.round((s.sp || (s.strike * 100) || 0) / 100); peGrp[k] = (peGrp[k] || 0) + (s.oi || 0); });
        oiSnapshots.current.push({ time: Date.now(), ceGrp: {...ceGrp}, peGrp: {...peGrp} });
        // Keep last 30 min of snapshots (max ~180 @ 10s intervals)
        const cutoff = Date.now() - 30 * 60 * 1000;
        oiSnapshots.current = oiSnapshots.current.filter(s => s.time > cutoff);
    }, [chainData]);

    const TIME_RANGES = [
        { key: "5m", label: "5m", ms: 5 * 60 * 1000 },
        { key: "10m", label: "10m", ms: 10 * 60 * 1000 },
        { key: "15m", label: "15m", ms: 15 * 60 * 1000 },
        { key: "30m", label: "30m", ms: 30 * 60 * 1000 },
        { key: "1h", label: "1h", ms: 60 * 60 * 1000 },
        { key: "2h", label: "2h", ms: 2 * 60 * 60 * 1000 },
        { key: "3h", label: "3h", ms: 3 * 60 * 60 * 1000 },
        { key: "fullday", label: "Full Day", ms: Infinity },
    ];

    // Compute OI data with change for the selected time range
    const oiChartData = (() => {
        if (!chainData?.chain) return [];
        const ce = chainData.chain.ce || [];
        const pe = chainData.chain.pe || [];
        const timeRange = TIME_RANGES.find(t => t.key === oiTimeRange) || TIME_RANGES[7];
        const atmStrike = Math.round((chainData.chain.atm || 0) / 100);
        const strikeRange = 9; // ±9 strikes around ATM

        // Current OI grouped by strike
        const curCe = {};
        const curPe = {};
        ce.forEach(s => { const k = Math.round((s.sp || (s.strike * 100) || 0) / 100); curCe[k] = (curCe[k] || 0) + (s.oi || 0); });
        pe.forEach(s => { const k = Math.round((s.sp || (s.strike * 100) || 0) / 100); curPe[k] = (curPe[k] || 0) + (s.oi || 0); });

        // Find baseline snapshot for selected time range
        let baseCe = {};
        let basePe = {};
        if (timeRange.key === "fullday") {
            ce.forEach(s => { const k = Math.round((s.sp || (s.strike * 100) || 0) / 100); baseCe[k] = (baseCe[k] || 0) + (s.prev_oi || 0); });
            pe.forEach(s => { const k = Math.round((s.sp || (s.strike * 100) || 0) / 100); basePe[k] = (basePe[k] || 0) + (s.prev_oi || 0); });
        } else {
            const cutoff = Date.now() - timeRange.ms;
            const snapshots = oiSnapshots.current.filter(s => s.time >= cutoff);
            if (snapshots.length > 0) {
                const oldest = snapshots[0];
                baseCe = oldest.ceGrp;
                basePe = oldest.peGrp;
            }
        }

        // Merge all strike keys, slice to ±9 around ATM
        const allKeys = [...new Set([...Object.keys(curCe), ...Object.keys(curPe), ...Object.keys(baseCe), ...Object.keys(basePe)])]
            .map(Number).sort((a, b) => a - b);
        const atmIdx = allKeys.findIndex(k => k >= atmStrike);
        const start = Math.max(0, atmIdx - 9);
        const end = Math.min(allKeys.length, atmIdx + 10);
        const sliced = allKeys.slice(start, end);
        return sliced.map(k => ({
            strike: Number(k),
            calls_oi: curCe[k] || 0,
            puts_oi: curPe[k] || 0,
            calls_oi_change: (curCe[k] || 0) - (baseCe[k] || 0),
            puts_oi_change: (curPe[k] || 0) - (basePe[k] || 0),
        }));
    })();

    // Compute momentum from option chain data (no agents needed)
    const momentumFromChain = (() => {
        if (!chainData?.chain) return null;
        const c = chainData.chain;
        const ce = c.ce || [];
        const pe = c.pe || [];
        const totalCeOi = ce.reduce((s, x) => s + (x.oi || 0), 0);
        const totalPeOi = pe.reduce((s, x) => s + (x.oi || 0), 0);
        const pc_ratio = totalCeOi > 0 ? (totalPeOi / totalCeOi) : 0;
        const concentration = pc_ratio > 1.3 ? "PUT_HEAVY" : pc_ratio < 0.7 ? "CALL_HEAVY" : "NEUTRAL";

        // Map CE strikes with correct side (API returns ltpchg as %, no prev_oi available)
        const ceStrikes = ce.map(s => ({
            strike: (s.strike || s.sp) / 100,
            side: "CE",
            oi: s.oi || 0,
            oi_chg: s.oi_chg || 0, // No prev_oi in API, show raw or 0
            volume: s.volume || 0,
            iv: s.iv || 0,
            delta: s.delta || 0,
            ltp: s.ltp || 0,
            ltp_chg_pct: s.ltpchg || 0, // This is already % from API
        })).filter(s => s.strike);

        // Map PE strikes with correct side
        const peStrikes = pe.map(s => ({
            strike: (s.strike || s.sp) / 100,
            side: "PE",
            oi: s.oi || 0,
            oi_chg: s.oi_chg || 0,
            volume: s.volume || 0,
            iv: s.iv || 0,
            delta: s.delta || 0,
            ltp: s.ltp || 0,
            ltp_chg_pct: s.ltpchg || 0,
        })).filter(s => s.strike);

        const strikes = [...ceStrikes, ...peStrikes].filter(s => s.strike);
        const sorted = [...strikes].sort((a, b) => b.oi - a.oi); // Sort by total OI descending
        return {
            concentration,
            pc_ratio: Math.round(pc_ratio * 100) / 100,
            top_bullish: ceStrikes.filter(s => s.oi_chg > 0).slice(0, 5),
            top_bearish: peStrikes.filter(s => s.oi_chg > 0).slice(0, 5),
            buildup: sorted, // Pass ALL strikes (API doesn't have prev_oi for filtering)
            unwind: [], // Empty since we can't distinguish buildup vs unwind without prev_oi
            strikes: strikes,
            expected_move: null,
        };
    })();

    // Persist watch list
    useEffect(() => {
        localStorage.setItem("realswing_watch", JSON.stringify(watchList));
    }, [watchList]);

    // Fetch funds on mount + every 30s
    useEffect(() => {
        const fetchFunds = async () => {
            try {
                const d = await api(
                    `/portfolio/funds?session_token=${session.session_token}&device_id=${DEVICE_ID}&env=${session.env}`
                );
                setFunds(d);
            } catch { }
        };
        fetchFunds();
        const id = setInterval(fetchFunds, 30000);
        return () => clearInterval(id);
    }, [session]);

    // Clock tick
    useEffect(() => {
        const tick = () => setClock(new Date().toLocaleTimeString("en-IN"));
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, []);

    // Auto-load chain on mount, instrument change, AND poll every 2s for live updates
    const loadedChainRef = useRef(null);
    const fetchChainRef = useRef(null);
    useEffect(() => {
        if (!session?.session_token) return;
        const fetchChain = async () => {
            try {
                const exch = ["SENSEX", "BANKEX"].includes(activeInstrument) ? "BSE" : "NSE";
                const d = await api(
                    `/market/optionchain/${activeInstrument}?exchange=${exch}&session_token=${session.session_token}&device_id=${DEVICE_ID}&env=${session.env}`
                );
                if (d.chain) {
                    const key = `${activeInstrument}_${d.chain.expiry || ''}`;
                    if (loadedChainRef.current !== key) {
                        loadedChainRef.current = key;
                    }
                    setChainData({ chain: d.chain, instrument: activeInstrument });
                }
            } catch { }
        };
        fetchChain();
        fetchChainRef.current = setInterval(fetchChain, 2000);
        return () => { if (fetchChainRef.current) clearInterval(fetchChainRef.current); };
    }, [session?.session_token, activeInstrument]);

    return (
        <div style={{ background: C.bg, minHeight: "100dvh", color: C.text, fontFamily: "'Inter', sans-serif", fontSize: 13, overflowX: "hidden", width: "100%" }}>
            <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #0D1729; }
        ::-webkit-scrollbar-thumb { background: #1A2E52; border-radius: 4px; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
@keyframes ticker { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }
        .row-hover:hover { background: #1A254080 !important; }
        details > summary { list-style: none; }
      `}</style>

            {/* Scrolling ticker */}
            <Ticker watchList={watchList.length ? watchList : DEFAULT_WATCH}
                hidden={tickerHidden} onHide={() => setTickerHidden(true)}
                onRemove={(sym) => setWatchList(prev => prev.filter(w => w.symbol !== sym))}
                onAdd={(sym) => setWatchList(prev => {
                    if (prev.find(w => w.symbol === sym)) return prev;
                    const exch = ["SENSEX", "BANKEX"].includes(sym) ? "BSE" : "NSE";
                    return [...prev, { symbol: sym, exchange: exch }];
                })} />

            {/* Topbar */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 24px", borderBottom: `1px solid ${C.border}`, background: C.panel, position: "sticky", top: 0, zIndex: 100 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 28, height: 28, background: `linear-gradient(135deg, ${C.accent}, #0066FF)`, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>⚡</div>
                        <span style={{ color: C.bright, fontWeight: 700, fontSize: 15 }}>RealSwing</span>
                    </div>
                    <div style={{ width: 1, height: 20, background: C.border }} />
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 7, height: 7, borderRadius: "50%", background: C.green, animation: "pulse 1.5s infinite" }} />
                        <span style={{ color: C.dim, fontSize: 11 }}>LIVE — Nubra {session.env}</span>
                    </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    {funds && (
                        <span style={{
                            color: C.green, fontFamily: "monospace", fontSize: 12,
                            border: `1px solid ${C.green}40`, borderRadius: 6,
                            padding: "3px 12px",
                        }}>
                            ₹{(funds.available / 100 || 0).toLocaleString("en-IN")} avail.
                        </span>
                    )}
                    <SessionTimer loggedInAt={session.loggedInAt} />
                    <DigitalClock format={clockStyle} time={clock} />
                    <button onClick={() => setLiveMode(m => !m)}
                      style={{
                        padding: "4px 12px", fontSize: 11, fontWeight: 700, borderRadius: 6, cursor: "pointer",
                        background: liveMode ? `${C.green}22` : `${C.yellow}22`,
                        border: `1px solid ${liveMode ? C.green + '50' : C.yellow + '50'}`,
                        color: liveMode ? C.green : C.yellow,
                        letterSpacing: 0.5, transition: "all 0.2s",
                      }}>
                      {liveMode ? "🔴 LIVE" : "📝 PAPER"}
                    </button>
                    <Btn onClick={onLogout} color={C.red} style={{ padding: "5px 14px", fontSize: 11 }}>Logout</Btn>
                </div>
            </div>

            <div style={{ padding: isMobile ? "10px 6px" : "20px 24px", maxWidth: "100%", margin: "0 auto", overflowX: "hidden" }}>
                {/* Tab bar */}
                <div style={{
                    display: "flex", gap: isMobile ? 4 : 6, marginBottom: 20,
                    borderBottom: `1px solid ${C.border}`, paddingBottom: 12,
                    overflowX: isMobile ? "auto" : "visible", flexWrap: "nowrap",
                    WebkitOverflowScrolling: "touch",
                }}>
                    <style>{'@media(max-width:768px){.tab-btn{font-size:10px!important;padding:5px 10px!important}}'}</style>
                    {[
                        { id: "portfolio", label: "📊 Portfolio" },
                        { id: "overview", label: "🏠 Overview" },
                        { id: "analysis", label: "🔍 Analysis" },
                        { id: "charts", label: "📈 Charts" },
                        { id: "trade", label: "🎯 Trade" },
                        { id: "optionchain", label: "📊 Options & OI" },
                        { id: "strategies", label: "🎮 Strategies" },
                        { id: "orderflow", label: "🌊 OrderFlow" },
                        { id: "buying", label: "💎 Buying" },
                        { id: "performance", label: "📊 Performance" },
                        { id: "backtest", label: "📉 Backtest" },
                        { id: "papertrade", label: "📊 Paper Trade" },
                        { id: "research", label: "🧠 Research" },
                        { id: "watch", label: "📡 Market Watch" },
                        { id: "agents", label: "🤖 Agents" },
                    ].map(t => (
                        <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
                            background: activeTab === t.id ? `${C.accent}18` : "none",
                            border: `1px solid ${activeTab === t.id ? C.accent + "50" : "transparent"}`,
                            color: activeTab === t.id ? C.bright : C.dim,
                            borderRadius: 6, padding: "7px 16px", cursor: "pointer",
                            fontSize: 12, fontWeight: 600, letterSpacing: 0.5,
                        }}>{t.label}</button>
                    ))}
                </div>

                {activeTab === "portfolio" && (
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
                        <PositionsPanel session={session} />
                        <OrdersPanel session={session} />
                    </div>
                )}
                {activeTab === "charts" && (
                    <ErrorBoundary>
                        <div style={{ minHeight: 400 }}>
                            <WorkspaceLayout />
                        </div>
                    </ErrorBoundary>
                )}
                {activeTab === "trade" && <>
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 300px", gap: 16, alignItems: "start" }}>
                        <OrderTicket session={session}
                            onSelectOption={(opt, inst) => { setSelOption({ ...opt, instrument: inst }); setActiveInstrument(inst); setTradeLimitPrice((opt.ltp / 100).toFixed(2)); }}
                            onChainUpdate={(chain, inst) => setChainData({ chain, instrument: inst })} />
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                            {selOption && (
                                <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 }}>
                                    <div style={{ color: C.dim, fontSize: 10, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Order Ticket</div>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12, fontSize: 12 }}>
                                        <Tag color={selOption.side === "CE" ? C.green : C.red}>{selOption.side}</Tag>
                                        <span style={{ color: C.bright, fontWeight: 600 }}>
                                            {selOption.instrument || activeInstrument} {(selOption.sp / 100).toFixed(0)}
                                        </span>
                                        <span style={{ color: C.dim, fontFamily: "monospace" }}>
                                            ref: {selOption.ref_id} | lot: {selOption.ls}
                                        </span>
                                    </div>
                                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                        <div>
                                            <label style={{ color: C.dim, fontSize: 10, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 3 }}>Lots (1 lot = {selOption.ls} qty)</label>
                                            <input type="number" value={tradeQty} onChange={e => setTradeQty(Math.max(1, Number(e.target.value)))}
                                                style={{ background: "#0A1220", border: `1px solid ${C.border}`, borderRadius: 6, color: C.bright, padding: "8px 12px", fontSize: 13, fontFamily: "monospace", width: "100%" }} />
                                        </div>
                                        <div>
                                            <label style={{ color: C.dim, fontSize: 10, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 3 }}>Limit Price (₹)</label>
                                            <input value={tradeLimitPrice} onChange={e => setTradeLimitPrice(e.target.value)} placeholder="e.g. 145.50"
                                                style={{ background: "#0A1220", border: `1px solid ${C.border}`, borderRadius: 6, color: C.bright, padding: "8px 12px", fontSize: 13, fontFamily: "monospace", width: "100%" }} />
                                        </div>
                                        <div>
                                            <label style={{ color: C.dim, fontSize: 10, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 3 }}>SL Trigger (₹)</label>
                                            <input value={tradeSlPrice} onChange={e => setTradeSlPrice(e.target.value)} placeholder="Optional"
                                                style={{ background: "#0A1220", border: `1px solid ${C.border}`, borderRadius: 6, color: C.bright, padding: "8px 12px", fontSize: 13, fontFamily: "monospace", width: "100%" }} />
                                        </div>
                                        <div style={{ display: "flex", gap: 8 }}>
                                            <button onClick={async () => {
                                                if (!selOption || !tradeLimitPrice) return;
                                                const entry = parseFloat(tradeLimitPrice);
                                                const strike = Math.round(parseFloat(selOption.sp || 0) / 100);
                                                const side = selOption.side || (selOption.type === 'CE' ? 'CE' : 'PE');
                                                if (liveMode) {
                                                  const result = await placeLiveOrder({
                                                    ref_id: selOption.ref_id, side: 'BUY',
                                                    price: entry, qty: tradeQty * (selOption.ls || 1),
                                                    trigger_price: tradeSlPrice ? parseFloat(tradeSlPrice) : null,
                                                  });
                                                  setTradeMsg(result.error ? `❌ ${result.error}` : `✅ Live BUY #${result.intentOrderId || result.order_id || 'placed'}`);
                                                } else {
                                                  if (!paperStore.running) paperStore.start();
                                                  paperStore.evaluateSignal({
                                                    instrument: `${strike} ${side}`, side: 'BUY',
                                                    entryPrice: entry, qty: tradeQty * (selOption.ls || 1),
                                                    sl: tradeSlPrice ? parseFloat(tradeSlPrice) : entry * 0.9,
                                                    tp: entry * 1.2, reason: `Trade: ${strike} ${side}`, source: 'manual',
                                                  });
                                                  setTradeMsg(`✅ Paper BUY ${strike} ${side} @ ₹${entry.toFixed(2)}`);
                                                }
                                            }} style={{
                                                flex: 1, background: `${C.green}18`, border: `1px solid ${C.green}50`, borderRadius: 6,
                                                color: C.green, padding: "9px 0", fontSize: 12, fontWeight: 700, cursor: "pointer", textTransform: "uppercase",
                                            }}>{liveMode ? `LIVE BUY ${tradeQty}` : `BUY ${tradeQty}`}</button>
                                            <button onClick={async () => {
                                                if (!selOption || !tradeLimitPrice) return;
                                                const entry = parseFloat(tradeLimitPrice);
                                                const strike = Math.round(parseFloat(selOption.sp || 0) / 100);
                                                const side = selOption.side || (selOption.type === 'CE' ? 'CE' : 'PE');
                                                if (liveMode) {
                                                  const result = await placeLiveOrder({
                                                    ref_id: selOption.ref_id, side: 'SELL',
                                                    price: entry, qty: tradeQty * (selOption.ls || 1),
                                                    trigger_price: tradeSlPrice ? parseFloat(tradeSlPrice) : null,
                                                  });
                                                  setTradeMsg(result.error ? `❌ ${result.error}` : `✅ Live SELL #${result.intentOrderId || result.order_id || 'placed'}`);
                                                } else {
                                                  if (!paperStore.running) paperStore.start();
                                                  paperStore.evaluateSignal({
                                                    instrument: `${strike} ${side}`, side: 'SELL',
                                                    entryPrice: entry, qty: tradeQty * (selOption.ls || 1),
                                                    sl: tradeSlPrice ? parseFloat(tradeSlPrice) : entry * 1.1,
                                                    tp: entry * 0.8, reason: `Trade: ${strike} ${side}`, source: 'manual',
                                                  });
                                                  setTradeMsg(`✅ Paper SELL ${strike} ${side} @ ₹${entry.toFixed(2)}`);
                                                }
                                            }} style={{
                                                flex: 1, background: `${C.red}18`, border: `1px solid ${C.red}50`, borderRadius: 6,
                                                color: C.red, padding: "9px 0", fontSize: 12, fontWeight: 700, cursor: "pointer", textTransform: "uppercase",
                                            }}>{liveMode ? `LIVE SELL ${tradeQty}` : `SELL ${tradeQty}`}</button>
                                        </div>
                                        {tradeMsg && <div style={{ color: C.red, fontSize: 11 }}>✗ {tradeMsg}</div>}
                                    </div>
                                </div>
                            )}
                            {orders.length > 0 && (
                                <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
                                    <div style={{ color: C.bright, fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Recent Orders</div>
                                    {orders.slice(0, 5).map((o, i) => (
                                        <div key={i} style={{ fontSize: 11, padding: "5px 0", borderBottom: `1px solid ${C.border}44`, display: "flex", justifyContent: "space-between" }}>
                                            <span style={{ color: C.dim, fontFamily: "monospace" }}>#{o.order_id}</span>
                                            <Tag color={o.order_side === "ORDER_SIDE_BUY" ? C.green : C.red}>
                                                {o.order_side === "ORDER_SIDE_BUY" ? "BUY" : "SELL"}
                                            </Tag>
                                            <span style={{ color: C.dim, fontSize: 10 }}>{o.order_status?.replace("ORDER_STATUS_", "")}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                    <div style={{ marginTop: 16 }}>
                        <MomentumPanel oiData={momentumFromChain} liveData={sse.momentum[activeInstrument] || sse.momentum["NIFTY"]}
                            aiData={aiAnalysis} searchLoading={aiLoading}
                            onSearch={async (q) => {
                                if (!chainData?.chain) return;
                                setAiLoading(true);
                                try {
                                    const ce = chainData.chain.ce?.map(s => ({ strike: s.sp || s.strike, oi: s.oi, prev_oi: s.prev_oi, iv: s.iv, delta: s.delta })) || [];
                                    const pe = chainData.chain.pe?.map(s => ({ strike: s.sp || s.strike, oi: s.oi, prev_oi: s.prev_oi, iv: s.iv, delta: s.delta })) || [];
                                    const r = await fetch(`${API_BASE}/ai/momentum`, {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({
                                            instrument: activeInstrument,
                                            spot: liveSpot ? (liveSpot * 100) : (chainData.chain.cp || 0),
                                            atm: chainData.chain.atm || 0,
                                            ce, pe, query: q,
                                        }),
                                    });
                                    const d = await r.json();
                                    setAiAnalysis(d);
                                } catch (e) { setAiAnalysis({ analysis: `Error: ${e.message}` }); }
                                finally { setAiLoading(false); }
                            }} />
                    </div>
                </>}

                {activeTab === "optionchain" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 800 }}>
                        <div style={{ minHeight: 400, flex: 1 }}>
                            {(() => {
                                const liveSpot = sse.marketState?.[activeInstrument]?.ltp;
                                const chainSpot = chainData?.chain?.cp ? chainData.chain.cp / 100 : 0;
                                return <OptionChainTable data={chainData?.chain ? [...(chainData.chain.ce || []).map(c => ({ ...c, type: 'CE' })), ...(chainData.chain.pe || []).map(p => ({ ...p, type: 'PE' }))] : []} spotPrice={liveSpot || chainSpot} onSelectOption={(opt, inst) => { setSelOption({ ...opt, instrument: inst }); setActiveInstrument(inst); setTradeLimitPrice((opt.ltp / 100).toFixed(2)); }} instrument={activeInstrument} />;
                            })()}
                        </div>
                        {/* Time range selector */}
                        {(() => {
                            const activeRange = TIME_RANGES.find(t => t.key === oiTimeRange) || TIME_RANGES[7];
                            return <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
                            <span style={{ color: C.dim, fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase' }}>OI Range:</span>
                            {TIME_RANGES.map(r => (
                                <button key={r.key} onClick={() => setOiTimeRange(r.key)} style={{
                                    background: oiTimeRange === r.key ? `${C.accent}25` : 'none',
                                    border: `1px solid ${oiTimeRange === r.key ? C.accent + '50' : C.border}`,
                                    color: oiTimeRange === r.key ? C.accent : C.dim,
                                    borderRadius: 6, padding: '4px 12px', cursor: 'pointer',
                                    fontSize: 11, fontWeight: oiTimeRange === r.key ? 700 : 500,
                                    transition: 'all 0.15s',
                                }}>{r.label}</button>
                            ))}
                        </div>
                        {/* Two charts: OI Absolute + OI Change */}
                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
                            {/* Chart 1: OI Absolute */}
                            <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, height: 350 }}>
                                <div style={{ color: C.bright, fontWeight: 600, fontSize: 12, marginBottom: 4 }}>📊 Open Interest (OI)</div>
                                <div style={{ color: C.dim, fontSize: 10, marginBottom: 12 }}>CE (red) / PE (green) — shaded vs {activeRange.label}</div>
                                <OIChart data={oiChartData} mode="absolute" />
                            </div>
                            {/* Chart 2: OI Change */}
                            <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, height: 350 }}>
                                <div style={{ color: C.bright, fontWeight: 600, fontSize: 12, marginBottom: 4 }}>🔄 Change in OI</div>
                                <div style={{ color: C.dim, fontSize: 10, marginBottom: 12 }}>Green = OI added, Red = OI shed vs {activeRange.label}</div>
                                <OIChart data={oiChartData} mode="change" />
                            </div>
                        </div>
                            </>;
                        })()}
                    </div>
                )}
                {activeTab === "watch" && (
                    <MarketWatch
                        session={session}
                        watchList={watchList}
                        onAdd={(sym, exch) => setWatchList(prev => {
                            if (prev.find(w => w.symbol === sym)) return prev;
                            return [...prev, { symbol: sym, exchange: exch || (["SENSEX", "BANKEX"].includes(sym) ? "BSE" : "NSE") }];
                        })}
                        onRemove={(sym) => setWatchList(prev => prev.filter(w => w.symbol !== sym))}
                    />
                )}

                {/* Overview Tab */}
                {activeTab === "overview" && (
                    <div style={{ display: 'grid', gap: 16 }}>
                        {(() => {
                            // Use live spot price from SSE if available, fallback to chain data
                            const liveSpot = sse.marketState?.[activeInstrument]?.ltp;
                            const chainSpot = (chainData?.chain?.cp || 0) / 100;
                            const spot = liveSpot || chainSpot;

                            const analysis = chainData?.chain ? analyzeChain(chainData.chain) : null;
                            const ce = chainData?.chain?.ce || [];
                            const pe = chainData?.chain?.pe || [];
                            return <>
                                <MarketSnapshot data={chainData?.chain ? {
                                    spot: liveSpot ? (liveSpot * 100) : chainData.chain.cp,
                                    pcr: ce.length && pe.length ? (pe.reduce((s, x) => s + (x.oi || 0), 0) / Math.max(ce.reduce((s, x) => s + (x.oi || 0), 0), 1)) : null,
                                    max_pain: (analysis?.maxPain || 0) * 100,
                                    volatility_regime: ce.find(c => c.sp === chainData.chain.atm)?.iv > 25 ? 'HIGH' : ce.find(c => c.sp === chainData.chain.atm)?.iv > 15 ? 'NORMAL' : 'LOW'
                                } : null} />
                                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: 12, minWidth: 0 }}>
                                    {/* Market Outlook */}
                                    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, minWidth: 0 }}>
                                        <div style={{ color: C.bright, fontWeight: 700, fontSize: 14, marginBottom: 12 }}>🌐 Market Outlook</div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, padding: '6px 10px', background: '#0A1220', borderRadius: 4 }}>
                                            <span style={{ color: C.dim, fontSize: 10 }}>Max Pain</span>
                                            <span style={{ color: C.yellow, fontWeight: 700, fontFamily: 'monospace', fontSize: 12 }}>
                                                {analysis?.maxPain ? Math.round(analysis.maxPain).toLocaleString('en-IN') : '—'}
                                            </span>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, padding: '6px 10px', background: '#0A1220', borderRadius: 4 }}>
                                            <span style={{ color: C.dim, fontSize: 10 }}>Weighted MP</span>
                                            <span style={{ color: C.accent, fontWeight: 700, fontFamily: 'monospace', fontSize: 12 }}>
                                                {analysis?.weightedMaxPain ? Math.round(analysis.weightedMaxPain).toLocaleString('en-IN') : '—'}
                                            </span>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, padding: '6px 10px', background: '#0A1220', borderRadius: 4 }}>
                                            <span style={{ color: C.dim, fontSize: 10 }}>Magnet Strength</span>
                                            <span style={{ color: analysis?.magnetStrength > 1 ? C.green : C.yellow, fontWeight: 700, fontFamily: 'monospace', fontSize: 12 }}>
                                                {analysis?.magnetStrength?.toFixed(2) || '—'}
                                            </span>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: '#0A1220', borderRadius: 4 }}>
                                            <span style={{ color: C.dim, fontSize: 10 }}>ATM IV</span>
                                            <span style={{ color: C.accent, fontWeight: 700, fontFamily: 'monospace', fontSize: 12 }}>
                                                {ce.find(c => c.sp === chainData?.chain?.atm)?.iv?.toFixed(1) || '—'}%
                                            </span>
                                        </div>
                                    </div>

                                    {/* Support Zones */}
                                    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, minWidth: 0, overflow: 'hidden' }}>
                                        <div style={{ color: C.green, fontWeight: 700, fontSize: 14, marginBottom: 12 }}>📐 Support Zones</div>
                                        {analysis?.supportZones?.length > 0 ? analysis.supportZones.slice(0, 4).map((z, i) => (
                                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', marginBottom: 4, background: `${C.green}10`, borderRadius: 4 }}>
                                                <span style={{ color: C.green, fontWeight: 700, fontFamily: 'monospace', fontSize: 13 }}>
                                                    {Math.round(z.strike).toLocaleString('en-IN')}
                                                </span>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    <div style={{ width: 50, height: 4, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
                                                        <div style={{ width: `${Math.min(z.score, 100)}%`, height: '100%', background: C.green, borderRadius: 2 }} />
                                                    </div>
                                                    <span style={{ color: C.dim, fontSize: 9, fontFamily: 'monospace' }}>{z.score}</span>
                                                </div>
                                            </div>
                                        )) : <div style={{ color: C.dim, fontSize: 11, textAlign: 'center', padding: 20 }}>No support data</div>}
                                        {analysis?.wallStrength?.support > 0 && (
                                            <div style={{ marginTop: 8, padding: '5px 10px', background: '#0A1220', borderRadius: 4, fontSize: 9, color: C.dim }}>
                                                Wall: <span style={{ color: C.green, fontFamily: 'monospace' }}>{Math.round(analysis.wallStrength.support).toLocaleString('en-IN')}</span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Resistance Zones */}
                                    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, minWidth: 0, overflow: 'hidden' }}>
                                        <div style={{ color: C.red, fontWeight: 700, fontSize: 14, marginBottom: 12 }}>🔺 Resistance Zones</div>
                                        {analysis?.resistanceZones?.length > 0 ? analysis.resistanceZones.slice(0, 4).map((z, i) => (
                                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', marginBottom: 4, background: `${C.red}10`, borderRadius: 4 }}>
                                                <span style={{ color: C.red, fontWeight: 700, fontFamily: 'monospace', fontSize: 13 }}>
                                                    {Math.round(z.strike).toLocaleString('en-IN')}
                                                </span>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    <div style={{ width: 50, height: 4, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
                                                        <div style={{ width: `${Math.min(z.score, 100)}%`, height: '100%', background: C.red, borderRadius: 2 }} />
                                                    </div>
                                                    <span style={{ color: C.dim, fontSize: 9, fontFamily: 'monospace' }}>{z.score}</span>
                                                </div>
                                            </div>
                                        )) : <div style={{ color: C.dim, fontSize: 11, textAlign: 'center', padding: 20 }}>No resistance data</div>}
                                        {analysis?.wallStrength?.resistance > 0 && (
                                            <div style={{ marginTop: 8, padding: '5px 10px', background: '#0A1220', borderRadius: 4, fontSize: 9, color: C.dim }}>
                                                Wall: <span style={{ color: C.red, fontFamily: 'monospace' }}>{Math.round(analysis.wallStrength.resistance).toLocaleString('en-IN')}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                {/* Pain Curve — ±10 strikes around ATM */}
                                {analysis?.painCurve?.length > 0 && (
                                    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, overflow: 'hidden' }}>
                                        <div style={{ color: C.bright, fontWeight: 700, fontSize: 14, marginBottom: 12 }}>📉 Pain Curve</div>
                                        <div style={{ height: 100, display: 'flex', alignItems: 'flex-end', gap: 2, padding: '4px 0', minWidth: 0 }}>
                                            {(() => {
                                                // Center around ATM ±10 strikes
                                                const atm = (chainData?.chain?.atm || 0) / 100;
                                                const sorted = [...analysis.painCurve].sort((a, b) => a.strike - b.strike);
                                                const atmIdx = sorted.findIndex(p => p.strike >= atm);
                                                const slice = sorted.slice(Math.max(0, atmIdx - 10), atmIdx + 11);
                                                if (slice.length === 0) return null;
                                                const maxP = Math.max(...slice.map(x => x.payout), 1);
                                                const minP = Math.min(...slice.map(x => x.payout), 0);
                                                const maxPainVal = Math.min(...slice.map(x => x.payout));
                                                return slice.map((p, i) => {
                                                    const isMaxPain = p.payout <= maxPainVal;
                                                    return (
                                                        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 0 }}>
                                                            <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', width: '100%' }}>
                                                                <div style={{
                                                                    width: '100%',
                                                                    height: `${((p.payout - minP) / (maxP - minP || 1)) * 100}%`,
                                                                    background: isMaxPain ? `linear-gradient(to top, ${C.yellow}, ${C.yellow}44)` : `linear-gradient(to top, ${C.accent}, ${C.accent}22)`,
                                                                    minHeight: 4,
                                                                }} />
                                                            </div>
                                                            <span style={{ color: isMaxPain ? C.yellow : C.dim, fontSize: 7, marginTop: 2, whiteSpace: 'nowrap', fontFamily: 'JetBrains Mono, monospace' }}>
                                                                {Math.round(p.strike)}
                                                            </span>
                                                        </div>
                                                    );
                                                });
                                            })()}
                                        </div>
                                        {analysis.maxPain > 0 && (
                                            <div style={{ textAlign: 'center', color: C.yellow, fontSize: 10, fontWeight: 600, marginTop: 4 }}>
                                                ▼ Max Pain @ {Math.round(analysis.maxPain).toLocaleString('en-IN')}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </>;
                        })()}
                    </div>
                )}

                {/* Analysis Tab */}
                {activeTab === "analysis" && (
                    <div style={{ display: 'grid', gap: 16 }}>
                        <OIDynamics data={momentumFromChain ? {
                            buildup: momentumFromChain.buildup?.map(s => ({
                                type: s.side,
                                strike: s.strike,
                                oi_change: s.oi_chg,
                                oi: s.oi,
                                volume: s.volume || 0,
                                ltp: s.ltp || 0,
                                ltp_chg_pct: s.ltp_chg_pct,
                                iv: s.iv || 0,
                            })) || [],
                            unwind: momentumFromChain.unwind?.map(s => ({
                                type: s.side,
                                strike: s.strike,
                                oi_change: s.oi_chg,
                                oi: s.oi,
                                volume: s.volume || 0,
                                ltp: s.ltp || 0,
                                ltp_chg_pct: s.ltp_chg_pct,
                                iv: s.iv || 0,
                            })) || []
                        } : null} />
                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
                            <VolatilityAnalysis data={chainData?.chain ? (() => {
                                const liveSpot = sse.marketState?.[activeInstrument]?.ltp;
                                const spot = liveSpot || (chainData.chain.cp / 100);
                                const atm = chainData.chain.atm;
                                const atmCE = chainData.chain.ce?.find(c => c.sp === atm);
                                const atmPE = chainData.chain.pe?.find(p => p.sp === atm);
                                const rawIv = atmCE?.iv || 0.15;
                                const ivPct = rawIv < 1 ? rawIv * 100 : rawIv;

                                // Expected move: 1 standard deviation over remaining days
                                // Formula: spot × IV × sqrt(DTE/365)
                                let dte = 7;
                                if (chainData.chain.expiry) {
                                    const now = new Date();
                                    const exp = new Date(chainData.chain.expiry.slice(0,4)+'-'+chainData.chain.expiry.slice(4,6)+'-'+chainData.chain.expiry.slice(6,8));
                                    dte = Math.max(1, Math.ceil((exp - now) / 86400000));
                                }
                                const expectedMovePct = ivPct * Math.sqrt(dte / 365);
                                const expectedMoveRs = spot * expectedMovePct / 100;

                                // IV Skew: Put IV / Call IV at same ATM strike (ratio >1 means puts priced higher)
                                const ceIv = atmCE?.iv ? (atmCE.iv < 1 ? atmCE.iv * 100 : atmCE.iv) : 0;
                                const peIv = atmPE?.iv ? (atmPE.iv < 1 ? atmPE.iv * 100 : atmPE.iv) : 0;
                                const ivSkew = peIv > 0 && ceIv > 0 ? (peIv / ceIv).toFixed(2) : '—';

                                return {
                                    atm_iv: ivPct,
                                    expected_move: expectedMoveRs,
                                    iv_skew: ivSkew,
                                    move_percentage: expectedMovePct
                                };
                            })() : null} />
                            <ProbabilityTouch data={chainData?.chain ? {
                                data: chainData.chain.ce?.slice(0, 10).map((c, i) => {
                                    const strike = (c.sp || 0) / 100;
                                    const liveSpot = sse.marketState?.[activeInstrument]?.ltp;
                                    const spotPrice = liveSpot || (chainData.chain.cp / 100);
                                    const distance = Math.abs(strike - spotPrice);
                                    const probability = Math.max(5, Math.min(95, 50 - (distance / spotPrice * 1000)));
                                    return { strike, probability_touch: probability };
                                }) || []
                            } : null} />
                        </div>
                        <SmartMoneySignals data={{
                            signals: sse.analyst[activeInstrument] ? [sse.analyst[activeInstrument].trend, sse.analyst[activeInstrument].momentum_pass ? 'Momentum Confirmed' : 'No Momentum'] : ['Analyzing...'],
                            positioning: (() => {
                                const liveSpot = sse.marketState?.[activeInstrument]?.ltp;
                                const spot = liveSpot || (chainData?.chain?.cp / 100) || 0;
                                const atm = chainData?.chain?.atm / 100 || spot;
                                // Combine CE and PE chains and sort by OI change
                                const allStrikes = [
                                    ...(chainData?.chain?.ce || []).map(c => ({
                                        strike: c.sp / 100,
                                        type: 'CALL',
                                        oi_change: (c.oi || 0) - (c.prev_oi || 0),
                                        oi: c.oi || 0
                                    })),
                                    ...(chainData?.chain?.pe || []).map(p => ({
                                        strike: p.sp / 100,
                                        type: 'PUT',
                                        oi_change: (p.oi || 0) - (p.prev_oi || 0),
                                        oi: p.oi || 0
                                    }))
                                ];
                                // Filter to ATM ± 10% range and sort by OI change magnitude
                                const atmRange = allStrikes.filter(s => Math.abs(s.strike - spot) <= spot * 0.10);
                                return atmRange.sort((a, b) => Math.abs(b.oi_change) - Math.abs(a.oi_change)).slice(0, 5).map(s => ({ type: s.type, strike: s.strike, oi_change: s.oi_change }));
                            })(),
                            flow: (() => {
                                const liveSpot = sse.marketState?.[activeInstrument]?.ltp;
                                const spot = liveSpot || (chainData?.chain?.cp / 100) || 0;
                                // Combine CE and PE chains with volume
                                const allStrikes = [
                                    ...(chainData?.chain?.ce || []).map(c => ({
                                        strike: c.sp / 100,
                                        type: 'CALL',
                                        volume: c.volume || 0,
                                        oi: c.oi || 0
                                    })),
                                    ...(chainData?.chain?.pe || []).map(p => ({
                                        strike: p.sp / 100,
                                        type: 'PUT',
                                        volume: p.volume || 0,
                                        oi: p.oi || 0
                                    }))
                                ];
                                // Filter to ATM ± 10% range and sort by volume
                                const atmRange = allStrikes.filter(s => Math.abs(s.strike - spot) <= spot * 0.10);
                                return atmRange.sort((a, b) => b.volume - a.volume).slice(0, 5).map(s => ({ type: s.type, strike: s.strike, volume: s.volume }));
                            })()
                        }} />
                    </div>
                )}

                {/* Strategies Tab */}
                {activeTab === "strategies" && (
                    <div style={{ display: 'grid', gap: 16 }}>
                        <StrategyEngine
                            chainData={chainData}
                            sse={sse}
                            instrument={activeInstrument}
                            onExecutePaper={() => {}}
                            onInstrumentChange={(inst) => {
                                setActiveInstrument(inst);
                                setChainData(null);
                            }}
                            loadTemplate={loadTemplateName}
                            onClearLoadTemplate={() => setLoadTemplateName('')}
                        />
                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
                            <SpreadOptimizer
                                chainData={chainData}
                                spot={chainData?.chain ? (chainData.chain.cp / 100) : 0}
                                onLoadTemplate={(name) => setLoadTemplateName(name)}
                            />
                            <StrategyLeaderboard data={{
                                leaderboard: [
                                    { name: 'Bull Call Spread', win_rate: 68.5, pnl: 4250 },
                                    { name: 'Iron Condor', win_rate: 72.1, pnl: 5680 },
                                    { name: 'Bear Put Spread', win_rate: 64.3, pnl: 3120 },
                                    { name: 'Short Straddle', win_rate: 58.9, pnl: 2890 },
                                    { name: 'Call Backspread', win_rate: 55.2, pnl: 1450 }
                                ]
                            }} />
                        </div>
                    </div>
                )}

                {/* OrderFlow Tab — Institutional Workstation */}
                {activeTab === "orderflow" && (
                    <ErrorBoundary key="orderflow">
                        <OrderFlowWorkstation session={session} />
                    </ErrorBoundary>
                )}

                {/* Buying Tab */}
                {activeTab === "buying" && (
                    <OptionBuyingPanel data={chainData?.chain || null} session={session} liveMode={liveMode} onLiveOrder={placeLiveOrder} />
                )}

                {/* Backtest Tab */}
                {activeTab === "backtest" && (
                    <BacktestDashboard session={session} />
                )}
                {activeTab === "performance" && (
                    <StrategyPerformance
                        strategies={[]}
                        chainData={chainData}
                        sse={sse}
                    />
                )}

                {activeTab === "papertrade" && (
                    <PaperTradingPanel
                        session={session}
                        chainData={chainData}
                        sse={sse}
                    />
                )}

                {activeTab === "research" && (
                    <ErrorBoundary>
                        <ResearchDesk
                            chainData={chainData}
                            sse={sse}
                            instrument={activeInstrument}
                            onChangeInstrument={(inst) => {
                                setActiveInstrument(inst);
                                setChainData(null); // trigger reload
                            }}
                        />
                    </ErrorBoundary>
                )}

                {activeTab === "agents" && <AgentDashboard session={session} sse={sse} />}
            </div>
        </div>
    );
}

// ── ROOT ──────────────────────────────────────────────────────────────────────
export default function App() {
    const [session, setSession] = useState(null);
    const [checking, setChecking] = useState(true);

    useEffect(() => {
        const saved = localStorage.getItem("realswing_session");
        if (saved) { try { setSession(JSON.parse(saved)); } catch { } }
        setChecking(false);
    }, []);

    const handleSession = (s) => {
        const enriched = { ...s, loggedInAt: Date.now() };
        localStorage.setItem("realswing_session", JSON.stringify(enriched));
        setSession(enriched);
    };

    const handleLogout = () => {
        localStorage.removeItem("realswing_session");
        setSession(null);
    };

    if (checking) return <div style={{ height: "100vh", background: "#080E1C", display: "flex", alignItems: "center", justifyContent: "center", color: "#4A6080", fontSize: 13 }}>Loading...</div>;
    if (!session) return <AuthPanel onSession={handleSession} />;
    return <Dashboard session={session} onLogout={handleLogout} />;
}
