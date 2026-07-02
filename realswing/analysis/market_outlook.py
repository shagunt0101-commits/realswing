def market_outlook(spot, support, resistance, pcr):

    if pcr > 1:
        bias = "Bullish"

    elif pcr < 0.8:
        bias = "Bearish"

    else:
        bias = "Neutral"

    return {
        "Bias": bias,
        "Nearest Support": support[0],
        "Nearest Resistance": resistance[0]
    }