# Accept payments with your existing Zucchini wallet

## 1. Export incoming viewing authority

In a development build, open **Settings → Security & recovery → Export viewing
key**. Authenticate and save the incoming-only viewing-key file for the selected
network. No separate merchant wallet is required. This account-level key can read
incoming personal payments too, including payments to rotated receiving addresses.
It cannot spend. Never put it in browser code, Git, chat, or the merchant registry.
The browser dApp provider deliberately has no viewing-key permission or method.

## 2. Run your scanner

Build from the SDK repository, independently of the native wallet repository:

```sh
cargo build --release --locked --manifest-path receipt-scanner/Cargo.toml
python3 receipt-scanner/setup.py --viewing-key /absolute/path/merchant.viewing-key
```

The setup command currently targets our **testnet reference checkout**. Its
collector API is not a general hosted merchant service. Use `--birthday HEIGHT`
to choose a scan start that covers the invoices being tested. Protect the original
export as well as the private copy created by setup. Existing UFVK configurations
remain accepted for migration; the scanner reduces them to incoming authority.

For an offline encrypted-backup fallback, the separate wallet-core tool is:
`cargo build --release -p zucchini-merchant-key-export`. It exports testnet
account-0 UIVK only. The scanner has no dependency on that tool or on wallet-core.

## 3. Configure signed invoices

Generate a separate Ed25519 invoice-signing key on your backend. Follow the public
[merchant protocol](https://github.com/zucchini-wallet/open-zcash-merchant-payments)
registration/proof format. The public registry contains domain and invoice public
keys, never wallet viewing keys. Production registry onboarding remains a release
gate; the reference checkout uses PUBLIC test signing keys and testnet ZEC only.

The backend owns order amount, receiver and expiry. Browser checkout obtains a
fresh wallet challenge and asks the backend to sign the matching invoice. Include
the order's unique `invoiceMemo(orderId)` in its ZIP321 memo. A wallet submission
report is not payment proof: fulfill only when reconciliation returns `canFulfill`.

## 4. Receipt status and webhooks

`/merchant/server` exports receipt reconciliation and webhook helpers. The
reference order engine persists each status event with its receipt snapshot.
Its Cloudflare Durable Object schedules retries through alarms. Configure
`MERCHANT_WEBHOOK_URL` and a random `MERCHANT_WEBHOOK_SECRET` (at least 32 bytes)
on your deployment to enable delivery; neither is configured automatically.
Verify the exact raw body with `verifyReceiptWebhook`, then atomically deduplicate
by event ID alongside your fulfillment action. Track the largest `sequence` per
order and ignore older events so a delayed retry cannot overwrite newer status.
Delivery is at least once.

Retries back off, stop after eight attempts, and retain failed events in the
order's private outbox for operator review. Do not log webhook bodies or keys.
Only order status is delivered, not viewing keys, unrelated notes or memos.

## Acceptance before live use

Use your testnet wallet to pay a fresh invoice. Verify detection, confirmations,
restart recovery, expiry, underpayment, and a duplicate webhook. Manually verify
both extension and native exports. A lightwallet provider supplies chain data;
this is not independent full-node consensus validation. Keep the scanner running:
stale or incomplete scans do not authorize fulfillment.

The npm packages are prepared locally, not published. Mainnet merchant receipt
operation and production registry rollout require separate acceptance.
