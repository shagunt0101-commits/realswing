def get_atm_iv(df, spot):
    if df is None or df.empty:
        return 0.0


    atm_strike = min(
        df["strike"],
        key=lambda x: abs(x - spot)
    )

    atm = df[
        df["strike"] == atm_strike
    ]

    ce_iv = atm[
        atm["type"] == "CE"
    ]["iv"].mean()

    pe_iv = atm[
        atm["type"] == "PE"
    ]["iv"].mean()

    return (
        ce_iv + pe_iv
    ) / 2