def generate_signals(df):

    signals = []

    ce = df[df["type"] == "CE"]
    pe = df[df["type"] == "PE"]

    top_ce = ce.sort_values(
        "oi",
        ascending=False
    ).head(5)

    top_pe = pe.sort_values(
        "oi",
        ascending=False
    ).head(5)

    signals.append(
        f"Strong Resistance: {list(top_ce['strike'])}"
    )

    signals.append(
        f"Strong Support: {list(top_pe['strike'])}"
    )

    ce_iv = ce["iv"].mean()
    pe_iv = pe["iv"].mean()

    if pe_iv > ce_iv:
        signals.append(
            "Put IV > Call IV : Downside fear present"
        )
    else:
        signals.append(
            "Call IV >= Put IV : Bullish positioning"
        )

    return signals