import pandas as pd

def trade_candidates(df, spot):
    if df is None or df.empty:
        return df


    lower = spot - 500
    upper = spot + 500

    candidates = df[
        (df["strike"] >= lower)
        &
        (df["strike"] <= upper)
    ].copy()

    candidates["score"] = (
        candidates["oi"].fillna(0) * 0.4
        +
        candidates["volume"].fillna(0) * 0.4
        +
        abs(
            candidates["oi_change"].fillna(0)
        ) * 0.2
    )

    return (
        candidates
        .sort_values(
            "score",
            ascending=False
        )
    )