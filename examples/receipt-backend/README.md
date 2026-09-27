# Backend receipt scan

Build the Rust binary using `receipt-scanner/README.md`. Copy
`config.example.json` to a private location and supply your binary path, incoming
viewing-key file, owned recipient and actual scan birthday. The example height is
not a recommended birthday. Keep the key file mode 600.

```sh
node examples/receipt-backend/scan.mjs /absolute/private/scanner-config.json
```

This runs a single bounded scan and prints aggregate progress. No checkout server,
webhook or automatic fulfillment is started. The example imports the local SDK;
a packaged backend imports `@zucchinifi/zcash-scanner` instead.

For continuous receipt verification, persist canonical blocks and first-seen times,
rescan an overlap, roll back on reorgs, and only reconcile complete, fresh receipt
snapshots when caught up. `receipt-scanner/collector.mjs` is the existing testnet
reference for that lifecycle; `docs/merchant-receipts.md` defines order matching,
confirmation depth and webhook handling. Do not make a payment verdict from one
batch or a customer-supplied transaction ID.
