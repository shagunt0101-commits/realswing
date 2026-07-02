# support_resistance.py

def get_support_resistance(df):
    if df is None or df.empty:
        return [], []


    ce = (
        df[df["type"]=="CE"]
        .sort_values("oi", ascending=False)
        .head(5)
    )

    pe = (
        df[df["type"]=="PE"]
        .sort_values("oi", ascending=False)
        .head(5)
    )

    resistance = ce["strike"].tolist()
    support = pe["strike"].tolist()

    return support, resistance