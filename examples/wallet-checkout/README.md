# Testnet wallet checkout

This reference connects the browser SDK to a server-owned order and the testing extension. It is separate from the verification-only demo in open-zcash-merchant-payments. No production keys or mainnet payments are supported.

## Run

1. `pnpm build` in the SDK repository.
2. Set `MERCHANT_TEST_RECEIVER` to a shielded address **copied from your own testnet wallet**. The server pins this exact configured recipient; it does not implement general Zcash address decoding. The paying extension fully validates it using wallet-core before approval.
3. Run `node examples/wallet-checkout/server.mjs`. It listens only on `127.0.0.1:4319`.
4. Proxy `/merchant-test/` on **https://zucchinifi.xyz** to this server, preserving the path and cookie headers. The HTTPS origin must match the testing registry exactly. Do not weaken the registry/origin check to make localhost work. Hosting/proxy setup is not included or automatically deployed.
5. Reload the testing extension and visit `https://zucchinifi.xyz/merchant-test/`. Select testnet in the wallet and click **Connect wallet**. The app obtains the challenge, requests the signed invoice, and opens wallet approval. No console/CLI invoice copying is needed.

The fixed price is 0.001 test ZEC. The browser cannot submit an amount, recipient, memo or network to the signer. Test keys are public and must never be used outside this test environment. The extension's embedded registry expires after 24 hours; rebuild it if expired.

## State and recovery

`created → invoice_issued → submitted`. These are persisted before responses in a single-process local store (`MERCHANT_ORDER_FILE`, default `/tmp/zucchini-test-checkout/orders.json`). Use a persistent directory for tests spanning machine restarts; `/tmp` can be cleared by the OS. Never run multiple server processes against the same file.

A Secure, HttpOnly, SameSite=Strict cookie identifies a browser's test order. Reload resumes that order. An identical invoice request returns the same invoice; a different challenge cannot replace an issued invoice. Neither the frontend nor server automatically retries a payment. Closing/rejecting an issued invoice leaves the order requiring review in wallet Activity. This conservative reference does not yet provide cancelled-order recovery or a new-order button. A new browser session is a separate test order, not global replay protection.

**Submitted does not mean paid.** The submission endpoint accepts an untrusted client transaction report. It must never trigger fulfillment. Shielded receipt monitoring, confirmations, expiry reconciliation, customer authentication, transactional database storage, rate limits and production signing/registry governance remain required for a real merchant.

If reporting fails after wallet submission, check wallet Activity. The stored invoice continues to block a new payment. Do not delete the order store or reset cookies as a payment-recovery action.

## Validation

`pnpm test` covers server-owned order fields, foreign-order rejection, concurrent issuance, stable invoice reuse, persistence after restart and immutable submitted transaction references, plus the SDK's no-retry and expiry behavior. Funded end-to-end receipt acceptance is a separate manual test.

## Hosted test deployment

The test checkout is deployed at https://zucchinifi.xyz/merchant-test/ using `zucchini-merchant-checkout-testing`, scoped to `/merchant-test*`. The gateway and static landing site are not replaced. `receiver.json` pins the operator-supplied receiver, validated with the real wallet-core WASM on testnet and rejected on mainnet.

The Worker adapter uses a separate SQLite-backed Durable Object per cookie session. It shares the tested order engine with the local Node example. The browser files are built from the SDK, and no private production key is shipped or provisioned (the test signing key is deliberately public).

Build/deploy from the SDK repository:

```sh
pnpm test
node examples/wallet-checkout/build.mjs
../gateway/node_modules/.bin/wrangler deploy --config examples/wallet-checkout/wrangler.jsonc
```

Deployment version on 2026-09-22: `4018faf6-7399-431f-bdec-ae019ff03f49`.

This endpoint is a public test demo, not a production checkout. Test invoice issuance, server persistence and signature/recipient/amount verification have been checked remotely without sending funds. The user has manually confirmed the extension approval and test transaction succeeded. Independent merchant receipt confirmation and the new native flow still require acceptance.

## Receipt and native testing additions

New invoices include a unique signed memo for receipt matching. The hosted Worker
also provides **Use macOS or iOS app**, which creates an issuer-verified native
invoice and opens `zucchini.testing://merchant`. Testing apps verify the signature
and review the immutable payment in-app. Browser and native invoices cannot
replace one another for an existing order.

Receipt reconciliation and authenticated snapshot ingestion are implemented;
the live merchant scanner is not provisioned. Until it is, the checkout remains
pending rather than declaring payment verified. See
[receipt integration and CipherScan evaluation](../../docs/merchant-receipts.md).
The webhook utilities are signing helpers, not a deployed webhook service.

The viewing-only collector and secure backup-export setup are now implemented in [receipt-scanner](../../receipt-scanner/README.md). The live collector remains unconfigured until the operator runs that private local setup.

### Receiver rotation during testing

Each order snapshots its recipient. `receiver.json` retains `legacyRecipient` for records created before this field existed; do not change that migration value. New orders use `recipient`. The checkout’s **Start a new test order** action changes the browser session without deleting previous orders or cancelling payments.

A collector can set `recipients` in its private local config to the addresses owned by its key. Historical orders for other wallets are left untouched. This does not replace the scanner’s cryptographic ownership check.
