def calculate_pcr(df):
    if df is None or df.empty:
        return {"PCR": 0.0, "INTERPRETATION": "NO DATA", "CE_OI": 0, "PE_OI": 0}


    ce_oi = df[df.type=="CE"]["oi"].sum()
    pe_oi = df[df.type=="PE"]["oi"].sum()

    pcr = pe_oi / ce_oi

    return {
        "PCR": round(pcr,3),
        "CE_OI": int(ce_oi),
        "PE_OI": int(pe_oi)
    }