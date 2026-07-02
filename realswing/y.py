url = f"{base(body.env)}/orders/v2/single"

print("ORDER URL:", url)

r = await c.post(
    url,
    headers={
        "Authorization": f"Bearer {body.session_token}",
        "x-device-id": body.device_id,
        "Content-Type": "application/json",
    },
    json=payload,
)

print("STATUS:", r.status_code)
print("BODY:", r.text)