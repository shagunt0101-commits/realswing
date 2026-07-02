import pandas as pd

def institutional_flow(df):

    result = df.copy()

    signals = []

    for _, row in result.iterrows():

        oi_change = row.get("oi_change", 0)
        volume = row.get("volume", 0)

        if volume <= 0:
            continue

        # Put Writing
        if (
            row["type"] == "PE"
            and oi_change > 0
        ):
            signal = "Fresh Put Writing"

        # Call Writing
        elif (
            row["type"] == "CE"
            and oi_change > 0
        ):
            signal = "Fresh Call Writing"

        # Put Unwinding
        elif (
            row["type"] == "PE"
            and oi_change < 0
        ):
            signal = "Put Unwinding"

        # Call Unwinding
        elif (
            row["type"] == "CE"
            and oi_change < 0
        ):
            signal = "Call Unwinding"

        else:
            signal = "Neutral"

        signals.append({
            "type": row["type"],
            "strike": row["strike"],
            "oi_change": oi_change,
            "volume": volume,
            "signal": signal
        })

    return pd.DataFrame(signals)