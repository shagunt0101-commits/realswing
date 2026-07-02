def suggest_strategy(
    spot,
    pcr,
    support,
    resistance
):

    nearest_support = support[0]
    nearest_resistance = resistance[0]

    if pcr > 1:
        return {
            "strategy": "Bull Put Spread",
            "sell_strike": nearest_support,
            "buy_strike": nearest_support - 100,
            "confidence": 70
        }

    if pcr < 0.7:
        return {
            "strategy": "Bear Call Spread",
            "sell_strike": nearest_resistance,
            "buy_strike": nearest_resistance + 100,
            "confidence": 70
        }

    return {
        "strategy": "Iron Condor",
        "sell_pe": nearest_support,
        "sell_ce": nearest_resistance,
        "confidence": 60
    }