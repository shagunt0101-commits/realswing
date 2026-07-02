import numpy as np
import pandas as pd


def momentum_tracker(df):
    if df is None or df.empty:
        return df


    result = df.copy()

    result["oi_velocity"] = np.where(
        result["oi"] > 0,
        (result["oi_change"] / result["oi"]) * 100,
        0
    )

    avg_volume = max(
        result["volume"].mean(),
        1
    )

    result["volume_factor"] = (
        result["volume"] / avg_volume
    )

    result["momentum_score"] = (

        result["ltp_change"] * 0.40

        +

        result["oi_velocity"] * 0.30

        +

        result["volume_factor"] * 10 * 0.30

    )

    result["flow_signal"] = "Neutral"

    # Long Build-up
    result.loc[
        (result["ltp_change"] > 0)
        &
        (result["oi_change"] > 0),
        "flow_signal"
    ] = "Long Build-up"

    # Short Covering
    result.loc[
        (result["ltp_change"] > 0)
        &
        (result["oi_change"] < 0),
        "flow_signal"
    ] = "Short Covering"

    # Short Build-up
    result.loc[
        (result["ltp_change"] < 0)
        &
        (result["oi_change"] > 0),
        "flow_signal"
    ] = "Short Build-up"

    # Long Unwinding
    result.loc[
        (result["ltp_change"] < 0)
        &
        (result["oi_change"] < 0),
        "flow_signal"
    ] = "Long Unwinding"

    result["scalp_signal"] = "WAIT"

    result.loc[
        (result["flow_signal"] == "Long Build-up")
        &
        (result["volume_factor"] > 2)
        &
        (abs(result["delta"]) > 0.40),
        "scalp_signal"
    ] = "MOMENTUM LONG"

    result.loc[
        (result["flow_signal"] == "Short Build-up")
        &
        (result["volume_factor"] > 2)
        &
        (abs(result["delta"]) > 0.40),
        "scalp_signal"
    ] = "MOMENTUM SHORT"

    result["confidence"] = (

        np.minimum(
            100,
            (
                abs(result["ltp_change"]) * 0.4
            )
            +
            (
                abs(result["oi_velocity"]) * 0.3
            )
            +
            (
                result["volume_factor"] * 10 * 0.3
            )
        )

    ).round(1)

    return result.sort_values(
        "momentum_score",
        ascending=False
    )