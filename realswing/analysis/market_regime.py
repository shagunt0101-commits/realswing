def market_regime(
    pcr,
    spot,
    support,
    resistance,
    skew=0
):

    nearest_support = support[0]
    nearest_resistance = resistance[0]

    distance_to_support = spot - nearest_support
    distance_to_resistance = nearest_resistance - spot

    if pcr > 1.1:
        bias = "Bullish"

    elif pcr < 0.7:
        bias = "Bearish"

    else:
        bias = "Neutral"

    if (
        distance_to_support < 100
        and bias == "Bullish"
    ):
        regime = "Bullish Support Test"

    elif (
        distance_to_resistance < 100
        and bias == "Bearish"
    ):
        regime = "Bearish Resistance Test"

    elif bias == "Neutral":
        regime = "Range Bound"

    else:
        regime = "Trend"

    return {
        "bias": bias,
        "regime": regime,
        "spot": spot,
        "support": nearest_support,
        "resistance": nearest_resistance
    }