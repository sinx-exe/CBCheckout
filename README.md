# CBCheckout

New and improved Chromebook checkout app for PHS.

## Run With Live Shared Data

This version includes a Node backend and JSON database so phones, tablets, and laptops can all see the same live checkout data.

```bash
npm start
```

Then open:

```text
http://localhost:3000
```

To use it from another device on the same Wi-Fi network, open the host computer's local IP address from the phone/tablet:

```text
http://YOUR-COMPUTER-IP:3000
```

On macOS, you can usually find that IP in System Settings > Wi-Fi > Details, or with:

```bash
ipconfig getifaddr en0
```

## Data Storage

Checkout state is stored in:

```text
data/db.json
```

That file is intentionally ignored by Git because it is live runtime data.

## Notes

- Barcode scanning works best in Chrome or Edge.
- Camera access usually requires HTTPS, except on `localhost`.
- For phone camera scanning against a server on another computer, run the app over HTTPS or put it behind an HTTPS proxy/tunnel.

## Optional HTTPS

If you have a TLS certificate and key, run:

```bash
SSL_KEY_PATH=/path/to/key.pem SSL_CERT_PATH=/path/to/cert.pem npm start
```

The app will then serve HTTPS on the configured port.
