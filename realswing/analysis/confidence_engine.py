def confidence_score(row):

    score = 0

    score += min(
        row["volume_factor"] * 15,
        30
    )

    score += min(
        row["oi_velocity"] * 2,
        30
    )

    score += min(
        abs(row["delta"]) * 50,
        20
    )

    if row["ltp_change"] > 0:
        score += 20

    return round(
        min(score, 100),
        1
    )


def calculate_confidence(pcr, pop, risk_reward):
    """
    Calculate overall confidence score based on PCR, POP, and Risk/Reward

    Parameters:
    - pcr: Put-Call Ratio
    - pop: Probability of Profit (%)
    - risk_reward: Risk/Reward ratio

    Returns:
    - Confidence score (0-100)
    """
    score = 0

    # PCR component (40 points max)
    if pcr < 0.8:
        score += 40  # Very bullish
    elif pcr < 0.95:
        score += 30  # Moderately bullish
    elif pcr < 1.05:
        score += 20  # Neutral
    elif pcr < 1.2:
        score += 15  # Moderately bearish
    else:
        score += 10  # Very bearish

    # POP component (40 points max)
    pop_score = min((pop / 100) * 40, 40)
    score += pop_score

    # Risk/Reward component (20 points max)
    if risk_reward > 2:
        score += 20
    elif risk_reward > 1.5:
        score += 15
    elif risk_reward > 1:
        score += 10
    else:
        score += 5

    return round(min(max(score, 0), 100), 1)