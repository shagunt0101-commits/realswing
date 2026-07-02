
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

import { useState, useEffect, useCallback, useRef, Component } from "react";
import {
    AreaChart, Area, BarChart, Bar, XAxis, YAxis,
    CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from "recharts";
import WorkspaceLayout from "./workspace/WorkspaceLayout";

// ── CONFIG ────────────────────────────────────────────────────────────────────
const API_BASE = "http://localhost:9000";  // ← change to your deployed backend URL
const ORCH_BASE = "http://localhost:9010"; // Agent orchestrator (SSE, start/stop)
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

    // Tokens passed between steps — never shown to user
    const tmpRef = useRef("");   // temp_token (updated at steps 1 & 2)
    const authRef = useRef("");   // auth_token (set at step 3, used in step 4)

    const run = async (fn) => {
        setErr(""); setInfo(""); setBusy(true);
        try { await fn(); }
        catch (e) { setErr(e.message); }
        finally { setBusy(false); }
    };

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
                        <button onClick={() => { setStep(1); setOtp(""); setErr(""); }} style={{
                            background: "none", border: "none", color: C.dim, fontSize: 11, cursor: "pointer", textAlign: "center"
                        }}>← Resend OTP / Change number</button>
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
];

function Ticker({ session, watchList, hidden, onHide, onAdd, onRemove }) {
    const [prices, setPrices] = useState({});
    const tickerRef = useRef(null);

    const fetchPrices = useCallback(async () => {
        const results = {};
        await Promise.all(watchList.map(async ({ symbol, exchange }) => {
            try {
                const d = await api(
                    `/market/price/${symbol}?exchange=${exchange}&session_token=${session.session_token}&device_id=${DEVICE_ID}&env=${session.env}`
                );
                results[symbol] = d;
            } catch { results[symbol] = null; }
        }));
        setPrices(results);
    }, [session, watchList.map(w => w.symbol).join(",")]);

    useEffect(() => {
        fetchPrices();
        const id = setInterval(fetchPrices, 5000);
        return () => clearInterval(id);
    }, [fetchPrices]);

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

function MarketWatch({ session }) {
    const [prices, setPrices] = useState({});
    const [loading, setLoading] = useState(false);
    const symbols = [
        { symbol: "NIFTY", exchange: "NSE" },
        { symbol: "BANKNIFTY", exchange: "NSE" },
        { symbol: "SENSEX", exchange: "BSE" },
        { symbol: "FINNIFTY", exchange: "NSE" },
    ];

    const fetchAll = useCallback(async () => {
        setLoading(true);
        const results = {};
        await Promise.all(symbols.map(async ({ symbol, exchange }) => {
            try {
                const d = await api(
                    `/market/price/${symbol}?exchange=${exchange}&session_token=${session.session_token}&device_id=${DEVICE_ID}&env=${session.env}`
                );
                results[symbol] = d;
            } catch { results[symbol] = null; }
        }));
        setPrices(results);
        setLoading(false);
    }, [session]);

    useEffect(() => {
        fetchAll();
        const id = setInterval(fetchAll, 5000);
        return () => clearInterval(id);
    }, [fetchAll]);

    return (
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ color: C.bright, fontWeight: 600, fontSize: 13 }}>📡 Market Watch</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.green, animation: "pulse 2s infinite" }} />
                    <span style={{ color: C.dim, fontSize: 10 }}>AUTO 5s</span>
                </div>
            </div>
            {symbols.map(({ symbol }) => {
                const d = prices[symbol];
                const price = d?.price ? (d.price / 100).toFixed(2) : "—";
                const prev = d?.prev_close ? (d.prev_close / 100) : null;
                const change = prev && d?.price ? ((d.price / 100 - prev) / prev * 100).toFixed(2) : null;
                const up = change > 0;
                return (
                    <div key={symbol} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${C.border}44` }}>
                        <span style={{ color: C.text, fontWeight: 600 }}>{symbol}</span>
                        <div style={{ textAlign: "right" }}>
                            <div style={{ color: C.bright, fontFamily: "monospace", fontSize: 14, fontWeight: 700 }}>
                                {loading && !d ? "..." : price}
                            </div>
                            {change && (
                                <div style={{ color: up ? C.green : C.red, fontSize: 10, fontFamily: "monospace" }}>
                                    {up ? "▲" : "▼"} {Math.abs(change)}%
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}
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
                                <React.Fragment key={idx}>
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
                                </React.Fragment>
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
                        <Bar name="Call OI (CE)" dataKey="calls_oi" fill={C.red} radius={[4, 4, 0, 0]} />
                        <Bar name="Put OI (PE)" dataKey="puts_oi" fill={C.green} radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>

            {/* Summary footer */}
            {data.length > 0 && (() => {
                const totalCe = data.reduce((s, d) => s + (d.calls_oi || 0), 0);
                const totalPe = data.reduce((s, d) => s + (d.puts_oi || 0), 0);
                const pcr = totalCe > 0 ? totalPe / totalCe : 0;
                const maxCe = data.reduce((b, d) => (d.calls_oi || 0) > (b.calls_oi || 0) ? d : b, data[0]);
                const maxPe = data.reduce((b, d) => (d.puts_oi || 0) > (b.puts_oi || 0) ? d : b, data[0]);
                return (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 16, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
                        <div><div style={{ color: C.dim, fontSize: 9, letterSpacing: 1 }}>TOTAL CE OI</div><div style={{ color: C.red, fontFamily: 'monospace', fontWeight: 700 }}>{(totalCe / 100000).toFixed(1)}L</div></div>
                        <div><div style={{ color: C.dim, fontSize: 9, letterSpacing: 1 }}>TOTAL PE OI</div><div style={{ color: C.green, fontFamily: 'monospace', fontWeight: 700 }}>{(totalPe / 100000).toFixed(1)}L</div></div>
                        <div><div style={{ color: C.dim, fontSize: 9, letterSpacing: 1 }}>PCR</div><div style={{ color: pcr > 1.3 ? C.green : pcr < 0.7 ? C.red : C.yellow, fontFamily: 'monospace', fontWeight: 700 }}>{pcr.toFixed(2)}</div></div>
                        <div><div style={{ color: C.dim, fontSize: 9, letterSpacing: 1 }}>MAX OI STRIKES</div><div style={{ fontFamily: 'monospace', fontSize: 11 }}><span style={{ color: C.red }}>CE:{maxCe?.strike}</span> / <span style={{ color: C.green }}>PE:{maxPe?.strike}</span></div></div>
                    </div>
                );
            })()}
        </div>
    );
}

// ── NEW COMPONENTS FROM OLD PROJECT ────────────────────────────────────────────
function MarketSnapshot({ data }) {
    const pcr = data?.pcr;
    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
                <div style={{ color: C.dim, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }}>Current Spot</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: C.bright, marginTop: 4 }}>₹{data?.spot ? (data.spot / 100).toFixed(2) : '-'}</div>
            </div>
            <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
                <div style={{ color: C.dim, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }}>Put-Call Ratio</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: pcr > 1 ? C.green : pcr < 0.7 ? C.red : C.yellow, marginTop: 4 }}>{pcr?.toFixed(2) || '-'}</div>
            </div>
            <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
                <div style={{ color: C.dim, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }}>Max Pain</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: C.bright, marginTop: 4 }}>{data?.max_pain ? Math.round(data.max_pain / 100) : '-'}</div>
            </div>
            <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
                <div style={{ color: C.dim, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }}>Volatility</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: C.accent, marginTop: 4 }}>{data?.volatility_regime || '-'}</div>
            </div>
        </div>
    );
}

function OIDynamics({ data }) {
    const fmtK = (v) => v > 0 ? `${(v / 1000).toFixed(0)}K` : '0';
    return (
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 }}>
            <div style={{ color: C.bright, fontWeight: 700, fontSize: 15, marginBottom: 16 }}>📊 Open Interest Dynamics</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
                    <div style={{ color: C.green, fontWeight: 600, fontSize: 11, marginBottom: 8 }}>● Largest OI Build-up</div>
                    <table style={{ width: '100%', fontSize: 10 }}>
                        <thead><tr style={{ color: C.dim }}><th style={{ textAlign: 'left', padding: 4 }}>Type</th><th style={{ textAlign: 'right', padding: 4 }}>Strike</th><th style={{ textAlign: 'right', padding: 4 }}>OI Chg</th><th style={{ textAlign: 'right', padding: 4 }}>Total OI</th></tr></thead>
                        <tbody>
                            {(data?.buildup || []).slice(0, 5).map((r, i) => (
                                <tr key={i} style={{ borderTop: `1px solid ${C.border}44` }}>
                                    <td style={{ padding: 4, color: r.type === 'CE' ? C.red : C.green, fontWeight: 700 }}>{r.type}</td>
                                    <td style={{ padding: 4, textAlign: 'right', fontFamily: 'monospace' }}>{r.strike}</td>
                                    <td style={{ padding: 4, textAlign: 'right', color: C.green, fontFamily: 'monospace' }}>+{fmtK(r.oi_change)}</td>
                                    <td style={{ padding: 4, textAlign: 'right', color: C.dim, fontFamily: 'monospace' }}>{fmtK(r.oi)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
                    <div style={{ color: C.red, fontWeight: 600, fontSize: 11, marginBottom: 8 }}>● Largest OI Unwinding</div>
                    <table style={{ width: '100%', fontSize: 10 }}>
                        <thead><tr style={{ color: C.dim }}><th style={{ textAlign: 'left', padding: 4 }}>Type</th><th style={{ textAlign: 'right', padding: 4 }}>Strike</th><th style={{ textAlign: 'right', padding: 4 }}>OI Chg</th><th style={{ textAlign: 'right', padding: 4 }}>Total OI</th></tr></thead>
                        <tbody>
                            {(data?.unwind || []).slice(0, 5).map((r, i) => (
                                <tr key={i} style={{ borderTop: `1px solid ${C.border}44` }}>
                                    <td style={{ padding: 4, color: r.type === 'CE' ? C.red : C.green, fontWeight: 700 }}>{r.type}</td>
                                    <td style={{ padding: 4, textAlign: 'right', fontFamily: 'monospace' }}>{r.strike}</td>
                                    <td style={{ padding: 4, textAlign: 'right', color: C.red, fontFamily: 'monospace' }}>{fmtK(r.oi_change)}</td>
                                    <td style={{ padding: 4, textAlign: 'right', color: C.dim, fontFamily: 'monospace' }}>{fmtK(r.oi)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

function OutlookRegime({ data }) {
    const getDirColor = (d) => d?.toLowerCase().includes('bull') ? C.green : d?.toLowerCase().includes('bear') ? C.red : C.yellow;
    return (
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 }}>
            <div style={{ color: C.bright, fontWeight: 700, fontSize: 15, marginBottom: 16 }}>🌐 Market Regime & Outlook</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 16, background: 'linear-gradient(180deg, #0A1220 0%, #0D1729 100%)' }}>
                    <div style={{ color: C.dim, fontSize: 11, marginBottom: 12 }}>📍 Market Outlook</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, borderBottom: `1px solid ${C.border}`, paddingBottom: 8 }}>
                        <span style={{ color: C.dim, fontSize: 10 }}>Market Bias</span>
                        <span style={{ padding: '2px 8px', borderRadius: 4, background: `${getDirColor(data?.outlook?.direction)}22`, border: `1px solid ${getDirColor(data?.outlook?.direction)}44`, color: getDirColor(data?.outlook?.direction), fontWeight: 700, fontSize: 10 }}>
                            {data?.outlook?.direction || 'Neutral'}
                        </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: C.dim, fontSize: 10 }}>Confidence</span>
                        <span style={{ color: C.text, fontWeight: 600, fontSize: 10 }}>{data?.outlook?.confidence || 'Medium'}</span>
                    </div>
                </div>
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 16, background: 'linear-gradient(180deg, #0A1220 0%, #0D1729 100%)' }}>
                    <div style={{ color: C.dim, fontSize: 11, marginBottom: 12 }}>🎚️ Market Regime</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, borderBottom: `1px solid ${C.border}`, paddingBottom: 8 }}>
                        <span style={{ color: C.dim, fontSize: 10 }}>Volatility Regime</span>
                        <span style={{ color: C.text, fontWeight: 600, fontSize: 10 }}>⚖️ {data?.regime?.regime || 'Consolidation'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: C.dim, fontSize: 10 }}>Regime Signal</span>
                        <span style={{ color: C.accent, fontWeight: 600, fontSize: 10 }}>🔮 {data?.regime?.signal || 'Neutral Rangebound'}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

function VolatilityAnalysis({ data }) {
    return (
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 }}>
            <div style={{ color: C.bright, fontWeight: 700, fontSize: 15, marginBottom: 16 }}>📈 Volatility Analysis</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                <div style={{ background: '#0A1220', borderRadius: 8, padding: 12 }}><div style={{ color: C.dim, fontSize: 10 }}>ATM IV</div><div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{data?.atm_iv?.toFixed(2) || '-'}%</div></div>
                <div style={{ background: '#0A1220', borderRadius: 8, padding: 12 }}><div style={{ color: C.dim, fontSize: 10 }}>Expected Move</div><div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>₹{data?.expected_move?.toFixed(2) || '-'}</div></div>
                <div style={{ background: '#0A1220', borderRadius: 8, padding: 12 }}><div style={{ color: C.dim, fontSize: 10 }}>IV Skew</div><div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{data?.iv_skew?.toFixed(2) || '-'}</div></div>
                <div style={{ background: '#0A1220', borderRadius: 8, padding: 12 }}><div style={{ color: C.dim, fontSize: 10 }}>Move %</div><div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{data?.move_percentage?.toFixed(2) || '-'}%</div></div>
            </div>
        </div>
    );
}

function ProbabilityTouch({ data }) {
    return (
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20, maxHeight: 400, overflow: 'auto' }}>
            <div style={{ color: C.bright, fontWeight: 700, fontSize: 15, marginBottom: 8 }}>🎯 Probability of Touch</div>
            <table style={{ width: '100%', fontSize: 11 }}>
                <thead style={{ position: 'sticky', top: 0, background: C.panel, zIndex: 1 }}>
                    <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                        <th style={{ padding: 8, textAlign: 'left', color: C.dim }}>Strike Price</th>
                        <th style={{ padding: 8, textAlign: 'right', color: C.dim }}>Probability of Touch</th>
                    </tr>
                </thead>
                <tbody>
                    {(data?.data || []).map((r, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${C.border}44` }}>
                            <td style={{ padding: 8, fontWeight: 600 }}>{r.strike}</td>
                            <td style={{ padding: 8, textAlign: 'right', fontFamily: 'monospace', color: C.accent, fontWeight: 700 }}>{r.probability_touch?.toFixed(1) || '-'}%</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function SmartMoneySignals({ data }) {
    return (
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 }}>
            <div style={{ color: C.bright, fontWeight: 700, fontSize: 15, marginBottom: 16 }}>🕵️‍♂️ Signal Engine & Smart Money Detection</div>
            {(data?.signals?.length > 0) && (
                <div style={{ marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {data.signals.map((s, i) => (
                        <div key={i} style={{ background: `${C.accent}22`, borderLeft: `3px solid ${C.accent}`, padding: '6px 10px', borderRadius: 4, fontSize: 10, color: C.accent }}>
                            ⚡ {s}
                        </div>
                    ))}
                </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
                    <div style={{ color: C.accent, fontWeight: 600, fontSize: 11, marginBottom: 8 }}>🎯 Institutional Positioning</div>
                    <table style={{ width: '100%', fontSize: 10 }}>
                        <thead><tr style={{ color: C.dim }}><th style={{ textAlign: 'left', padding: 4 }}>Type</th><th style={{ textAlign: 'right', padding: 4 }}>Strike</th><th style={{ textAlign: 'right', padding: 4 }}>OI Chg</th></tr></thead>
                        <tbody>
                            {(data?.positioning || []).slice(0, 5).map((r, i) => (
                                <tr key={i} style={{ borderTop: `1px solid ${C.border}44` }}>
                                    <td style={{ padding: 4, fontWeight: 700, color: r.type === 'CE' ? C.red : C.green }}>{r.type}</td>
                                    <td style={{ padding: 4, textAlign: 'right', fontFamily: 'monospace' }}>{r.strike}</td>
                                    <td style={{ padding: 4, textAlign: 'right', fontFamily: 'monospace', color: r.oi_change >= 0 ? C.green : C.red }}>{r.oi_change >= 0 ? '+' : ''}{(r.oi_change / 1000).toFixed(0)}K</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
                    <div style={{ color: C.purple, fontWeight: 600, fontSize: 11, marginBottom: 8 }}>🚀 Institutional Flow Scanner</div>
                    <table style={{ width: '100%', fontSize: 10 }}>
                        <thead><tr style={{ color: C.dim }}><th style={{ textAlign: 'left', padding: 4 }}>Type</th><th style={{ textAlign: 'right', padding: 4 }}>Strike</th><th style={{ textAlign: 'right', padding: 4 }}>Volume</th></tr></thead>
                        <tbody>
                            {(data?.flow || []).slice(0, 5).map((r, i) => (
                                <tr key={i} style={{ borderTop: `1px solid ${C.border}44` }}>
                                    <td style={{ padding: 4, fontWeight: 700, color: r.type === 'CE' ? C.red : C.green }}>{r.type}</td>
                                    <td style={{ padding: 4, textAlign: 'right', fontFamily: 'monospace' }}>{r.strike}</td>
                                    <td style={{ padding: 4, textAlign: 'right', fontFamily: 'monospace', color: C.dim }}>{(r.volume / 1000).toFixed(0)}K</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

function SupportResistance({ data }) {
    return (
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 }}>
            <div style={{ color: C.bright, fontWeight: 700, fontSize: 15, marginBottom: 16 }}>📐 Support & Resistance</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ background: `${C.green}22`, border: `1px solid ${C.green}44`, borderRadius: 8, padding: 16 }}>
                    <div style={{ color: C.dim, fontSize: 11 }}>Strongest Support</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: C.green, marginTop: 4 }}>{data?.strongest_support || '-'}</div>
                    <div style={{ color: C.dim, fontSize: 10, marginTop: 4 }}>Score: {data?.support_score?.toFixed(2) || '-'}</div>
                </div>
                <div style={{ background: `${C.red}22`, border: `1px solid ${C.red}44`, borderRadius: 8, padding: 16 }}>
                    <div style={{ color: C.dim, fontSize: 11 }}>Strongest Resistance</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: C.red, marginTop: 4 }}>{data?.strongest_resistance || '-'}</div>
                    <div style={{ color: C.dim, fontSize: 10, marginTop: 4 }}>Score: {data?.resistance_score?.toFixed(2) || '-'}</div>
                </div>
            </div>
        </div>
    );
}

function StrategyEngine({ data }) {
    return (
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 }}>
            <div style={{ color: C.bright, fontWeight: 700, fontSize: 15, marginBottom: 16 }}>🧠 Strategy Recommendations</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ background: `${C.accent}22`, border: `1px solid ${C.accent}44`, borderRadius: 8, padding: 16 }}>
                    <div style={{ color: C.accent, fontSize: 11, marginBottom: 8 }}>Strategy V1 (Rule-Based)</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: C.accent }}>{data?.strategy_v1?.strategy || '-'}</div>
                    <div style={{ color: C.dim, fontSize: 10, marginTop: 8 }}>Confidence: {data?.strategy_v1?.confidence || '-'}%</div>
                </div>
                <div style={{ background: `${C.purple}22`, border: `1px solid ${C.purple}44`, borderRadius: 8, padding: 16 }}>
                    <div style={{ color: C.purple, fontSize: 11, marginBottom: 8 }}>Strategy V2 (AI)</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: C.purple }}>{data?.strategy_v2?.strategy || '-'}</div>
                    <div style={{ color: C.dim, fontSize: 10, marginTop: 8 }}>Market Bias: {data?.market_bias || '-'}</div>
                </div>
            </div>
        </div>
    );
}

// ── MAIN DASHBOARD ────────────────────────────────────────────────────────────
function Dashboard({ session, onLogout }) {
    const [activeTab, setActiveTab] = useState("positions");
    const [clock, setClock] = useState("");
    const [clockStyleIdx, setClockStyleIdx] = useState(0); // 0=Segments (default)
    const clockStyle = CLOCK_STYLES[clockStyleIdx];
    clockStyle.next = () => setClockStyleIdx(i => (i + 1) % CLOCK_STYLES.length);
    const [orders, setOrders] = useState([]);
    const [funds, setFunds] = useState(null);
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
    const sse = useSSE(session);

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
        const strikes = [...ce, ...pe].map(s => ({
            strike: s.strike || s.sp,
            side: ce.includes(s) ? "CE" : "PE",
            oi: s.oi || 0,
            oi_chg: (s.oi || 0) - (s.prev_oi || 0),
            oi_chg_pct: s.prev_oi ? Math.round(((s.oi || 0) - (s.prev_oi || 0)) / s.prev_oi * 100) : 0,
            volume: s.volume || 0,
            iv: s.iv || 0,
            delta: s.delta || 0,
            ltp: s.ltp || 0,
        })).filter(s => s.strike);
        const sorted = [...strikes].sort((a, b) => Math.abs(b.oi_chg) - Math.abs(a.oi_chg));
        return {
            concentration,
            pc_ratio: Math.round(pc_ratio * 100) / 100,
            top_bullish: sorted.filter(s => s.oi_chg > 0 && s.side === "CE").slice(0, 5),
            top_bearish: sorted.filter(s => s.oi_chg > 0 && s.side === "PE").slice(0, 5),
            strikes: strikes.slice(0, 20),
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

    return (
        <div style={{ background: C.bg, minHeight: "100vh", color: C.text, fontFamily: "'Inter', sans-serif", fontSize: 13 }}>
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
            <Ticker session={session} watchList={watchList.length ? watchList : DEFAULT_WATCH}
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
                    <Btn onClick={onLogout} color={C.red} style={{ padding: "5px 14px", fontSize: 11 }}>Logout</Btn>
                </div>
            </div>

            <div style={{ padding: "20px 24px", maxWidth: 1400, margin: "0 auto" }}>
                {/* Tab bar */}
                <div style={{ display: "flex", gap: 6, marginBottom: 20, borderBottom: `1px solid ${C.border}`, paddingBottom: 12 }}>
                    {[
                        { id: "positions", label: "📊 Positions" },
                        { id: "orders", label: "📋 Orders" },
                        { id: "charts", label: "📈 Charts" },
                        { id: "trade", label: "🎯 Trade" },
                        { id: "optionchain", label: "📋 Option Chain" },
                        { id: "oiheatmap", label: "🔥 OI Heatmap" },
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

                {activeTab === "positions" && <PositionsPanel session={session} />}
                {activeTab === "orders" && <OrdersPanel session={session} />}
                {activeTab === "charts" && (
                    <ErrorBoundary>
                        <div style={{ minHeight: 400 }}>
                            <WorkspaceLayout />
                        </div>
                    </ErrorBoundary>
                )}
                {activeTab === "trade" && <>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16, alignItems: "start" }}>
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
                                                if (!tradeLimitPrice) return;
                                                setTradeMsg("");
                                                try {
                                                    const result = await api("/trade/order", {
                                                        method: "POST",
                                                        body: JSON.stringify({
                                                            ref_id: selOption.ref_id,
                                                            order_type: tradeSlPrice ? "ORDER_TYPE_STOPLOSS" : "ORDER_TYPE_REGULAR",
                                                            order_qty: tradeQty * (selOption.ls || 1),
                                                            order_side: "ORDER_SIDE_BUY",
                                                            order_delivery_type: "ORDER_DELIVERY_TYPE_IDAY",
                                                            validity_type: "DAY",
                                                            price_type: "LIMIT",
                                                            order_price: paise(parseFloat(tradeLimitPrice)),
                                                            trigger_price: tradeSlPrice ? paise(parseFloat(tradeSlPrice)) : undefined,
                                                            tag: "realswing_scalp",
                                                            session_token: session.session_token,
                                                            device_id: DEVICE_ID,
                                                            env: session.env,
                                                        }),
                                                    });
                                                    setOrders(prev => [result, ...prev]);
                                                } catch (e) { setTradeMsg(e.message); }
                                            }} style={{
                                                flex: 1, background: `${C.green}18`, border: `1px solid ${C.green}50`, borderRadius: 6,
                                                color: C.green, padding: "9px 0", fontSize: 12, fontWeight: 700, cursor: "pointer", textTransform: "uppercase",
                                            }}>BUY {tradeQty} lot</button>
                                            <button onClick={async () => {
                                                if (!tradeLimitPrice) return;
                                                setTradeMsg("");
                                                try {
                                                    const result = await api("/trade/order", {
                                                        method: "POST",
                                                        body: JSON.stringify({
                                                            ref_id: selOption.ref_id,
                                                            order_type: tradeSlPrice ? "ORDER_TYPE_STOPLOSS" : "ORDER_TYPE_REGULAR",
                                                            order_qty: tradeQty * (selOption.ls || 1),
                                                            order_side: "ORDER_SIDE_SELL",
                                                            order_delivery_type: "ORDER_DELIVERY_TYPE_IDAY",
                                                            validity_type: "DAY",
                                                            price_type: "LIMIT",
                                                            order_price: paise(parseFloat(tradeLimitPrice)),
                                                            trigger_price: tradeSlPrice ? paise(parseFloat(tradeSlPrice)) : undefined,
                                                            tag: "realswing_scalp",
                                                            session_token: session.session_token,
                                                            device_id: DEVICE_ID,
                                                            env: session.env,
                                                        }),
                                                    });
                                                    setOrders(prev => [result, ...prev]);
                                                } catch (e) { setTradeMsg(e.message); }
                                            }} style={{
                                                flex: 1, background: `${C.red}18`, border: `1px solid ${C.red}50`, borderRadius: 6,
                                                color: C.red, padding: "9px 0", fontSize: 12, fontWeight: 700, cursor: "pointer", textTransform: "uppercase",
                                            }}>SELL {tradeQty} lot</button>
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
                                            spot: chainData.chain.cp || 0,
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
                    <div style={{ minHeight: 600 }}>
                        <OptionChainTable data={chainData?.chain ? [...(chainData.chain.ce || []).map(c => ({ ...c, type: 'CE' })), ...(chainData.chain.pe || []).map(p => ({ ...p, type: 'PE' }))] : []} spotPrice={chainData?.chain?.cp ? chainData.chain.cp / 100 : 0} onSelectOption={(opt, inst) => { setSelOption({ ...opt, instrument: inst }); setActiveInstrument(inst); setTradeLimitPrice((opt.ltp / 100).toFixed(2)); }} instrument={activeInstrument} />
                    </div>
                )}
                {activeTab === "oiheatmap" && (
                    <div style={{ minHeight: 400 }}>
                        <OIHeatmap data={chainData?.chain ? (() => { const ceGrp = {}; const peGrp = {}; (chainData.chain.ce || []).forEach(s => { const k = Math.round(((s.sp || (s.strike * 100) || 0) / 100)); ceGrp[k] = (ceGrp[k] || 0) + (s.oi || 0); }); (chainData.chain.pe || []).forEach(s => { const k = Math.round(((s.sp || (s.strike * 100) || 0) / 100)); peGrp[k] = (peGrp[k] || 0) + (s.oi || 0); }); const allKeys = [...new Set([...Object.keys(ceGrp), ...Object.keys(peGrp)])].sort((a, b) => a - b); return allKeys.map(k => ({ strike: Number(k), calls_oi: ceGrp[k] || 0, puts_oi: peGrp[k] || 0 })); })() : []} />
                    </div>
                )}
                {activeTab === "watch" && (

                    <div style={{ maxWidth: 480 }}>
                        <MarketWatch session={session} />
                    </div>
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
