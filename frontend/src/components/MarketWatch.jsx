import React, { useState, useEffect, useCallback } from 'react';

const DEV = typeof window !== 'undefined' && window.location.hostname === 'localhost';
const API = import.meta.env?.VITE_API_BASE || (DEV ? 'http://localhost:9000' : '');

const C = {
  bg: "#080E1C", panel: "#0D1729", border: "#1A2E52",
  accent: "#00D4FF", green: "#00E676", red: "#FF3B5C",
  yellow: "#FFD600", text: "#B8C7E0", dim: "#4A6080", bright: "#E8F0FF",
};

const DEFAULT_INDICES = [
  { symbol: 'NIFTY', exchange: 'NSE' },
  { symbol: 'BANKNIFTY', exchange: 'NSE' },
  { symbol: 'SENSEX', exchange: 'BSE' },
  { symbol: 'FINNIFTY', exchange: 'NSE' },
];

const FNO_SYMBOLS = [
  { name: 'NIFTY', exchange: 'NSE' }, { name: 'BANKNIFTY', exchange: 'NSE' },
  { name: 'FINNIFTY', exchange: 'NSE' }, { name: 'SENSEX', exchange: 'BSE' },
  { name: 'RELIANCE', exchange: 'NSE' }, { name: 'TCS', exchange: 'NSE' },
  { name: 'HDFCBANK', exchange: 'NSE' }, { name: 'INFY', exchange: 'NSE' },
];

function computeMarketBias(prices, watchList) {
  if (!prices || !watchList.length)
    return { bias: 'NEUTRAL', confidence: 0, signals: [], scores: { bullish: 0, bearish: 0 } };
  const signals = []; let bScore = 0, bScoreB = 0, totalW = 0;
  watchList.forEach(({ symbol }) => {
    const d = prices[symbol];
    if (!d?.price || !d?.prev_close) return;
    const pct = ((d.price / 100) / (d.prev_close / 100) - 1) * 100;
    const weight = symbol.includes('NIFTY') ? 3 : symbol.includes('SENSEX') ? 2 : 1.5;
    if (pct > 0.3) { bScore += weight; signals.push({ symbol, dir: 'BULLISH', pct }); }
    else if (pct < -0.3) { bScoreB += weight; signals.push({ symbol, dir: 'BEARISH', pct }); }
    else signals.push({ symbol, dir: 'FLAT', pct });
    totalW += weight;
  });
  const net = bScore - bScoreB;
  const bias = net > 0.4 ? 'BULLISH' : net < -0.4 ? 'BEARISH' : net > 0.1 ? 'CAUTIOUS_BUY' :
               net < -0.1 ? 'CAUTIOUS_SELL' : 'NEUTRAL';
  return {
    bias,
    confidence: Math.round((Math.abs(net) / (totalW || 1)) * 100),
    signals,
    scores: { bullish: Math.round(bScore * 10) / 10, bearish: Math.round(bScoreB * 10) / 10 },
  };
}

const BM = {
  BULLISH: { c: C.green, i: '\u{1F680}', l: 'Bullish' },
  BEARISH: { c: C.red, i: '\u{1F53B}', l: 'Bearish' },
  NEUTRAL: { c: C.dim, i: '⚖️', l: 'Neutral' },
  CAUTIOUS_BUY: { c: C.yellow, i: '\u{1F4C8}', l: 'Caution Buy' },
  CAUTIOUS_SELL: { c: C.yellow, i: '\u{1F4C9}', l: 'Caution Sell' },
};

function MarketBiasBox({ prices, watchList }) {
  const { bias, confidence, signals, scores } =
    React.useMemo(() => computeMarketBias(prices, watchList), [prices, watchList]);
  const m = BM[bias] || BM.NEUTRAL;
  return (
    <div style={{
      background: C.panel, border: `1px solid ${C.border}`,
      borderRadius: 10, padding: 14, height: 'fit-content',
    }}>
      <div style={{ color: C.bright, fontWeight: 600, fontSize: 12, marginBottom: 8 }}>
        Market Sentiment
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: `${m.c}12`, border: `1px solid ${m.c}40`,
        borderRadius: 8, padding: '8px 12px', marginBottom: 8,
      }}>
        <span style={{ fontSize: 20 }}>{m.i}</span>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: m.c, fontWeight: 700, fontSize: 14 }}>{m.l}</div>
          <div style={{ color: C.dim, fontSize: 9, marginTop: 2 }}>
            Confidence {confidence}%
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
        <div style={{ background: C.bg, borderRadius: 4, padding: '6px 8px' }}>
          <div style={{ color: C.green, fontSize: 9, fontWeight: 600 }}>
            Bullish {scores?.bullish || 0}
          </div>
          <div style={{
            height: 3, background: C.border, borderRadius: 2, marginTop: 2,
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', width: `${Math.min((scores?.bullish || 0) * 25, 100)}%`,
              background: C.green, borderRadius: 2,
            }} />
          </div>
        </div>
        <div style={{ background: C.bg, borderRadius: 4, padding: '6px 8px' }}>
          <div style={{ color: C.red, fontSize: 9, fontWeight: 600 }}>
            Bearish {scores?.bearish || 0}
          </div>
          <div style={{
            height: 3, background: C.border, borderRadius: 2, marginTop: 2,
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', width: `${Math.min((scores?.bearish || 0) * 25, 100)}%`,
              background: C.red, borderRadius: 2,
            }} />
          </div>
        </div>
      </div>
      {signals.map((s, i) => (
        <div key={i} style={{
          display: 'flex', justifyContent: 'space-between',
          padding: '2px 6px', background: C.bg, borderRadius: 3,
          fontSize: 9, marginBottom: 2,
        }}>
          <span style={{
            color: s.dir === 'BULLISH' ? C.green : s.dir === 'BEARISH' ? C.red : C.dim,
            fontWeight: 600,
          }}>
            {s.dir === 'BULLISH' ? '▲' : s.dir === 'BEARISH' ? '▼' : '—'} {s.symbol}
          </span>
          <span style={{
            color: s.dir === 'BULLISH' ? C.green : s.dir === 'BEARISH' ? C.red : C.dim,
          }}>
            {s.pct > 0 ? '+' : ''}{s.pct.toFixed(2)}%
          </span>
        </div>
      ))}
    </div>
  );
}

export default function MarketWatch({ session, watchList: externalWatchList, onAdd, onRemove }) {
  const [prices, setPrices] = useState({});
  const [instruments, setInstruments] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerTab, setPickerTab] = useState('indices');
  const [search, setSearch] = useState('');
  const [foTab, setFoTab] = useState('futures');
  const [selectedFoSymbol, setSelectedFoSymbol] = useState('NIFTY');
  const [selectedExpiry, setSelectedExpiry] = useState('');
  const [expiries, setExpiries] = useState([]);
  const [foChain, setFoChain] = useState(null);
  const [foSearch, setFoSearch] = useState('');

  const displayList = externalWatchList?.length ? externalWatchList : DEFAULT_INDICES;

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API}/market/instruments`);
        setInstruments(await r.json());
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (!session?.session_token || !selectedFoSymbol) return;
    (async () => {
      try {
        const exch = ['SENSEX', 'BANKEX'].includes(selectedFoSymbol) ? 'BSE' : 'NSE';
        const r = await fetch(
          `${API}/market/expiries/${selectedFoSymbol}?exchange=${exch}&session_token=${session.session_token}&device_id=TS123&env=${session.env}`
        );
        const d = await r.json();
        setExpiries(d.expiries || []);
        if (d.expiries?.length) setSelectedExpiry(d.expiries[0]);
      } catch {}
    })();
  }, [session, selectedFoSymbol]);

  useEffect(() => {
    if (!session?.session_token || !selectedExpiry || !selectedFoSymbol) return;
    (async () => {
      try {
        const exch = ['SENSEX', 'BANKEX'].includes(selectedFoSymbol) ? 'BSE' : 'NSE';
        const r = await fetch(
          `${API}/market/optionchain/${selectedFoSymbol}?expiry=${selectedExpiry}&exchange=${exch}&session_token=${session.session_token}&device_id=TS123&env=${session.env}`
        );
        const d = await r.json();
        if (d.chain) setFoChain(d.chain);
      } catch {}
    })();
  }, [session, selectedFoSymbol, selectedExpiry]);

  const fetchAll = useCallback(async () => {
    if (!session?.session_token) return;
    setLoading(true);
    const results = {};
    await Promise.all(displayList.map(async ({ symbol, exchange }) => {
      try {
        const url =
          `${API}/market/price/${symbol}?exchange=${exchange}&session_token=${session.session_token}&device_id=TS123&env=${session.env}`;
        results[symbol] = await fetch(url).then(r => r.json());
      } catch { results[symbol] = null; }
    }));
    setPrices(results);
    setLoading(false);
  }, [session, displayList]);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 5000);
    return () => clearInterval(id);
  }, [fetchAll]);

  const filteredInstruments = (() => {
    if (!instruments) return [];
    const list = pickerTab === 'indices' ? instruments.indices : instruments.stocks;
    if (!search) return list;
    return list.filter(i => i.name.toLowerCase().includes(search.toLowerCase()));
  })();

  const isWatched = (sym) => displayList.some(w => w.symbol === sym);
  const isIndex = (symbol) =>
    instruments
      ? instruments.indices?.some(i => i.name === symbol)
      : DEFAULT_INDICES.some(d => d.symbol === symbol);
  const indexList = displayList.filter(w => isIndex(w.symbol));
  const stockList = displayList.filter(w => !isIndex(w.symbol));

  const renderRow = ({ symbol, exchange }) => {
    const d = prices[symbol];
    const price = d?.price ? (d.price / 100).toFixed(2) : '—';
    const prev = d?.prev_close ? (d.prev_close / 100) : null;
    const change = prev && d?.price
      ? ((d.price / 100 - prev) / prev * 100).toFixed(2)
      : null;
    const up = change > 0;
    return (
      <div key={symbol} style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '8px 12px', borderBottom: `1px solid ${C.border}44`,
        borderRadius: 6, marginBottom: 2,
      }}
        onMouseEnter={e => {
          e.currentTarget.style.background = '#1A254080';
          const rm = e.currentTarget.querySelector('[data-rm]');
          if (rm) rm.style.opacity = 1;
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'none';
          const rm = e.currentTarget.querySelector('[data-rm]');
          if (rm) rm.style.opacity = 0;
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: C.bright, fontWeight: 600, fontSize: 12 }}>{symbol}</span>
          <span style={{ color: C.dim, fontSize: 9 }}>{exchange}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: C.bright, fontFamily: 'monospace', fontSize: 14, fontWeight: 700 }}>
              {price}
            </div>
            {change && (
              <div style={{ color: up ? C.green : C.red, fontSize: 10 }}>
                {up ? '▲' : '▼'} {Math.abs(change)}%
              </div>
            )}
          </div>
          <span data-rm onClick={() => onRemove?.(symbol)}
            style={{ opacity: 0, transition: 'opacity 0.15s', cursor: 'pointer', color: C.red, fontSize: 12, padding: '0 4px' }}>
            ✕
          </span>
        </div>
      </div>
    );
  };

  return (
    <div style={{
      display: 'grid', gap: 16,
      gridTemplateColumns: showPicker ? '1.2fr 1.2fr 1.2fr 1.2fr' : '1fr 1fr 1fr 1fr',
    }}>
      <div style={{
        background: C.panel, border: `1px solid ${C.border}`,
        borderRadius: 10, padding: 14, maxHeight: 500, overflow: 'auto',
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: 8, position: 'sticky', top: 0, background: C.panel, zIndex: 2,
          paddingBottom: 6, borderBottom: `1px solid ${C.border}`,
        }}>
          <span style={{ color: C.bright, fontWeight: 600, fontSize: 12 }}>
            Indices ({indexList.length})
          </span>
          <button onClick={() => setShowPicker(s => !s)} style={{
            background: `${C.accent}18`, border: `1px solid ${C.accent}50`,
            borderRadius: 4, color: C.accent, padding: '2px 10px',
            cursor: 'pointer', fontSize: 10, fontWeight: 600,
          }}>{showPicker ? '✕' : '+ Add'}</button>
        </div>
        {indexList.length === 0
          ? <div style={{ padding: 20, color: C.dim, fontSize: 11, textAlign: 'center' }}>No indices</div>
          : indexList.map(w => renderRow(w))}
      </div>

      <div style={{
        background: C.panel, border: `1px solid ${C.border}`,
        borderRadius: 10, padding: 14, maxHeight: 500, overflow: 'auto',
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: 8, position: 'sticky', top: 0, background: C.panel, zIndex: 2,
          paddingBottom: 6, borderBottom: `1px solid ${C.border}`,
        }}>
          <span style={{ color: C.bright, fontWeight: 600, fontSize: 12 }}>
            Stocks ({stockList.length})
          </span>
          <button onClick={() => setShowPicker(s => !s)} style={{
            background: `${C.accent}18`, border: `1px solid ${C.accent}50`,
            borderRadius: 4, color: C.accent, padding: '2px 10px',
            cursor: 'pointer', fontSize: 10, fontWeight: 600,
          }}>{showPicker ? '✕' : '+ Add'}</button>
        </div>
        {stockList.length === 0
          ? <div style={{ padding: 20, color: C.dim, fontSize: 11, textAlign: 'center' }}>No stocks</div>
          : stockList.map(w => renderRow(w))}
      </div>

      <MarketBiasBox prices={prices} watchList={displayList} />

      <div style={{
        background: C.panel, border: `1px solid ${C.border}`,
        borderRadius: 10, padding: 14, minHeight: 300, overflow: 'auto',
      }}>
        <div style={{ color: C.bright, fontWeight: 600, fontSize: 12, marginBottom: 8 }}>
          Futures &amp; Options
        </div>
        <div style={{ display: 'flex', gap: 3, marginBottom: 8, flexWrap: 'wrap' }}>
          {FNO_SYMBOLS.slice(0, 8).map(s => (
            <button key={s.name} onClick={() => setSelectedFoSymbol(s.name)} style={{
              padding: '3px 8px', fontSize: 9,
              fontWeight: selectedFoSymbol === s.name ? 700 : 500,
              background: selectedFoSymbol === s.name ? `${C.accent}22` : 'none',
              border: `1px solid ${selectedFoSymbol === s.name ? C.accent + '50' : C.border}`,
              color: selectedFoSymbol === s.name ? C.accent : C.dim,
              borderRadius: 4, cursor: 'pointer',
            }}>{s.name}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          {['futures', 'options'].map(tab => (
            <button key={tab} onClick={() => setFoTab(tab)} style={{
              flex: 1, padding: '5px 0', fontSize: 10, fontWeight: 600,
              background: foTab === tab ? `${C.accent}18` : 'none',
              border: `1px solid ${foTab === tab ? C.accent + '50' : C.border}`,
              color: foTab === tab ? C.accent : C.dim,
              borderRadius: 6, cursor: 'pointer',
            }}>{tab === 'futures' ? 'Futures' : 'Options'}</button>
          ))}
        </div>

        {foTab === 'futures' ? (
          <div style={{ textAlign: 'center', padding: 10 }}>
            <div style={{ color: C.text, fontFamily: 'monospace', fontSize: 13, marginBottom: 4 }}>
              {selectedFoSymbol} Futures
            </div>
            {prices[selectedFoSymbol]?.price ? (
              <>
                <div style={{ color: C.bright, fontSize: 22, fontWeight: 700, fontFamily: 'monospace' }}>
                  {`₹${(prices[selectedFoSymbol].price / 100).toFixed(2)}`}
                </div>
                <button onClick={() => onAdd?.(`${selectedFoSymbol}_FUT`, 'NSE')} style={{
                  marginTop: 8, padding: '6px 14px',
                  background: `${C.green}22`, border: `1px solid ${C.green}50`,
                  borderRadius: 6, color: C.green, cursor: 'pointer', fontSize: 10, fontWeight: 600,
                }}>+ Add Future to Watchlist</button>
              </>
            ) : <div style={{ color: C.dim, fontSize: 11 }}>Loading...</div>}
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 3, marginBottom: 8, flexWrap: 'wrap' }}>
              {expiries.slice(0, 6).map(e => (
                <button key={e} onClick={() => setSelectedExpiry(e)} style={{
                  padding: '2px 6px', fontSize: 8,
                  fontWeight: selectedExpiry === e ? 700 : 400,
                  background: selectedExpiry === e ? `${C.yellow}22` : 'none',
                  border: `1px solid ${selectedExpiry === e ? C.yellow + '50' : C.border}`,
                  color: selectedExpiry === e ? C.yellow : C.dim,
                  borderRadius: 3, cursor: 'pointer',
                }}>{e.slice(-4)}</button>
              ))}
            </div>

            {foChain?.ce?.length > 0 && (
              <>
                <input value={foSearch} onChange={e => setFoSearch(e.target.value)}
                  placeholder="Search strike..." style={{
                    width: '100%', padding: '5px 8px', marginBottom: 6, borderRadius: 4,
                    background: C.bg, border: `1px solid ${C.border}`,
                    color: C.bright, fontSize: 10, fontFamily: 'monospace', outline: 'none',
                  }} />
                <div style={{ fontSize: 9, maxHeight: 280, overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr style={{
                      color: C.dim, fontSize: 8,
                      position: 'sticky', top: 0, background: C.panel, zIndex: 2,
                    }}>
                      <th style={{ textAlign: 'right', padding: '2px 4px' }}>CE OI</th>
                      <th style={{ textAlign: 'right', padding: '2px 4px' }}>CE LTP</th>
                      <th style={{ textAlign: 'center', padding: '2px 4px', color: C.yellow }}>STRIKE</th>
                      <th style={{ textAlign: 'left', padding: '2px 4px' }}>PE LTP</th>
                      <th style={{ textAlign: 'left', padding: '2px 4px' }}>PE OI</th>
                      <th style={{ textAlign: 'center', padding: '2px 4px', width: 28 }}></th>
                    </tr></thead>
                    <tbody>
                      {foChain.ce
                        .filter(c => !foSearch || Math.round(c.sp / 100).toString().includes(foSearch))
                        .map((c, i) => {
                          const pe = foChain.pe?.[i];
                          const strike = Math.round(c.sp / 100);
                          const ceSym = `${selectedFoSymbol}_${strike}_CE`;
                          const peSym = `${selectedFoSymbol}_${strike}_PE`;
                          return (
                            <tr key={i} style={{ borderTop: `1px solid ${C.border}20` }}>
                              <td style={{ textAlign: 'right', padding: '2px 4px', color: C.dim }}>
                                {c.oi ? (c.oi / 1000).toFixed(0) + 'K' : '—'}
                              </td>
                              <td style={{ textAlign: 'right', padding: '2px 4px', color: C.accent, fontFamily: 'monospace' }}>
                                {(c.ltp / 100).toFixed(2)}
                                {!isWatched(ceSym) && (
                                  <button onClick={() => onAdd?.(ceSym, 'NSE')} style={{
                                    marginLeft: 3, background: 'none', border: 'none',
                                    color: C.dim, cursor: 'pointer', fontSize: 7, padding: 0,
                                  }}>+</button>
                                )}
                              </td>
                              <td style={{ textAlign: 'center', padding: '2px 4px', color: C.yellow, fontWeight: 700 }}>
                                {strike}
                              </td>
                              <td style={{ textAlign: 'left', padding: '2px 4px', color: C.accent, fontFamily: 'monospace' }}>
                                {pe ? (pe.ltp / 100).toFixed(2) : '—'}
                                {pe && !isWatched(peSym) && (
                                  <button onClick={() => onAdd?.(peSym, 'NSE')} style={{
                                    marginLeft: 3, background: 'none', border: 'none',
                                    color: C.dim, cursor: 'pointer', fontSize: 7, padding: 0,
                                  }}>+</button>
                                )}
                              </td>
                              <td style={{ textAlign: 'left', padding: '2px 4px', color: C.dim }}>
                                {pe?.oi ? (pe.oi / 1000).toFixed(0) + 'K' : '—'}
                              </td>
                              <td style={{ textAlign: 'center', padding: '2px 4px' }}>
                                {!isWatched(ceSym) && !isWatched(peSym) && pe && (
                                  <button onClick={() => { onAdd?.(ceSym, 'NSE'); onAdd?.(peSym, 'NSE'); }} style={{
                                    background: `${C.accent}22`, border: 'none',
                                    color: C.accent, borderRadius: 2, cursor: 'pointer',
                                    fontSize: 7, padding: '1px 4px',
                                  }}>+B</button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {showPicker && (
        <div style={{
          background: C.panel, border: `1px solid ${C.border}`,
          borderRadius: 10, padding: 14, maxHeight: 600,
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ color: C.bright, fontWeight: 600, fontSize: 12, marginBottom: 8 }}>
            Instrument Picker
          </div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
            {['indices', 'stocks'].map(tab => (
              <button key={tab} onClick={() => setPickerTab(tab)} style={{
                flex: 1, padding: '5px 0', fontSize: 10, fontWeight: 600,
                background: pickerTab === tab ? `${C.accent}18` : 'none',
                border: `1px solid ${pickerTab === tab ? C.accent + '50' : C.border}`,
                color: pickerTab === tab ? C.accent : C.dim,
                borderRadius: 6, cursor: 'pointer',
              }}>{tab === 'indices' ? 'Indices' : 'Stocks'}</button>
            ))}
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={`Search ${pickerTab}...`} style={{
              background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6,
              color: C.bright, padding: '6px 10px', fontSize: 11, fontFamily: 'monospace',
              outline: 'none', width: '100%', marginBottom: 8,
            }} />
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {(filteredInstruments || []).slice(0, 30).map(i => {
              const watched = isWatched(i.name);
              return (
                <div key={i.name} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '5px 8px', borderRadius: 4, marginBottom: 2, fontSize: 11,
                  background: watched ? `${C.green}10` : 'none', cursor: 'pointer',
                }} onClick={() => {
                  if (watched) onRemove?.(i.name);
                  else {
                    const exch = ['SENSEX', 'BANKEX'].includes(i.name) ? 'BSE' : 'NSE';
                    onAdd?.(i.name, exch);
                  }
                }}>
                  <span style={{ color: watched ? C.green : C.text, fontWeight: watched ? 600 : 400 }}>
                    {watched ? '✓ ' : ''}{i.name}
                  </span>
                  <span style={{ color: C.dim, fontSize: 9 }}>{i.exchange || 'NSE'}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
