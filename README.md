# CBCheckout

Static Chromebook checkout app for PHS with a Google Sheets database.

The frontend can be hosted on GitHub Pages. Shared checkout data is stored in one Google Sheets spreadsheet through a free Google Apps Script Web App.

## Files

- `index.html` - static page for GitHub Pages
- `style.css` - desktop/mobile styles
- `app.js` - frontend logic and Google Apps Script `fetch()` calls
- `google-apps-script.gs` - backend code to paste into Google Apps Script

There is no Node/Express server, no package install step, and no private key in the frontend.

## Frontend Config

Open `app.js` and paste your deployed Apps Script Web App URL here:

```js
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec';
```

The app will show:

- `SHEET SYNC` when it can reach Google Sheets
- `SYNC OFFLINE` when the Web App URL is missing, wrong, or unavailable

## Google Sheet Setup

Create one Google Sheets spreadsheet. The script uses two tabs inside that one spreadsheet:

### Devices

| ID | Barcode | Serial | CheckedOut | StudentID | CheckoutTime | UpdatedAt |
| --- | --- | --- | --- | --- | --- | --- |

Each row is one Chromebook. If the sheet is empty, the script creates 32 default rows like `BC-000001` and `CB-000001`.

### ActivityLog

| Timestamp | Type | DeviceID | Message |
| --- | --- | --- | --- |

Each checkout, check-in, or barcode/serial edit is logged here.

You can create these tabs manually, or just run the Apps Script setup once and it will create the tabs and headers for you.

## Apps Script Setup

1. Open your Google Sheet.
2. Go to Extensions > Apps Script.
3. Delete any starter code.
4. Copy all code from `google-apps-script.gs` into the Apps Script editor.
5. If the script is bound to the Sheet, leave this line blank:

```js
const SPREADSHEET_ID = '';
```

If you create a standalone script instead, paste your spreadsheet ID there.

6. Save the project.
7. In the Apps Script editor, choose the `setupSpreadsheet` function and run it once.
8. Approve the permissions.
9. Visit this URL pattern in your browser to confirm setup:

```text
YOUR_WEB_APP_URL?action=setup
```

## Deploy Apps Script As A Web App

1. In Apps Script, click Deploy > New deployment.
2. Click the gear icon and choose Web app.
3. Set Execute as: Me.
4. Set Who has access: Anyone.
5. Click Deploy.
6. Copy the Web App URL ending in `/exec`.
7. Paste that URL into `GOOGLE_SCRIPT_URL` in `app.js`.

No private keys or secrets are needed. The frontend only knows the public Web App URL.

## Test With GitHub Pages

1. Commit and push the static files to GitHub.
2. Enable GitHub Pages for the repository.
3. Open the GitHub Pages URL.
4. Sign in to the app.
5. Confirm the header says `SHEET SYNC`.
6. Open the same GitHub Pages URL on another device.
7. Check out a Chromebook on one device.
8. Wait up to 10 seconds for the other device to refresh from Google Sheets.

The app polls the Google Sheet every 10 seconds. Apps Script is simple and free, but it is not instant push sync.

## Camera Notes

- Barcode scanning works best in Chrome or Edge.
- Camera access requires HTTPS or `localhost`.
- GitHub Pages is HTTPS, so phone camera scanning should work there if the browser supports `BarcodeDetector`.
