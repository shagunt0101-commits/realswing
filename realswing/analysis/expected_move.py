import math

def expected_move(
    spot,
    atm_iv,
    dte=1
):

    move = (
        spot
        * atm_iv
        * math.sqrt(dte / 365)
    )

    return {
        "spot": round(spot, 2),
        "expected_move": round(move, 2),
        "upper_band": round(spot + move, 2),
        "lower_band": round(spot - move, 2)
    }