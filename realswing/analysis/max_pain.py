def calculate_max_pain(df):
    if df is None or df.empty:
        return 0


    strikes = sorted(df["strike"].unique())

    losses = {}

    for strike in strikes:

        total_loss = 0

        for _,row in df.iterrows():

            s = row["strike"]

            if row["type"] == "CE":
                total_loss += max(0,strike-s)*row["oi"]

            else:
                total_loss += max(0,s-strike)*row["oi"]

        losses[strike] = total_loss

    return min(losses,key=losses.get)