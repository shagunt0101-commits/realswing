import pandas as pd

def smart_money_signals(df):
    if df is None or df.empty:
        return df


    signals = []

    top_oi_change = (
        df.sort_values(
            "oi_change",
            ascending=False
        )
        .head(20)
    )

    for _, row in top_oi_change.iterrows():

        if row["type"] == "PE":
            signals.append({
                "type": "PE",
                "strike": row["strike"],
                "oi_change": row["oi_change"],
                "volume": row.get("volume", 0),
                "signal": "Bullish Build-up"
            })

        if row["type"] == "CE":
            signals.append({
                "type": "CE",
                "strike": row["strike"],
                "oi_change": row["oi_change"],
                "volume": row.get("volume", 0),
                "signal": "Bearish Build-up"
            })

    return pd.DataFrame(signals)