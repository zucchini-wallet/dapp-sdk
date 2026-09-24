# Merchant receipt verification

`@zucchinifi/dapp-sdk/merchant/server` exports `invoiceMemo`,
`reconcileMerchantReceipts`, and HMAC webhook signing/verification helpers.
These operate on **trusted, merchant-local scanner observations**, not on
customer-provided transaction IDs. They do not themselves decrypt shielded notes. The local Rust scanner and Node collector in `receipt-scanner/` now supply those observations; see its README for secure setup.

## Trust boundary and deployment status

The testing checkout signs a unique `zucchini:<invoiceId>` memo into each new
ZIP-321 request. An authenticated collector can publish a complete canonical
snapshot to `/merchant-test/internal/receipt` with:

```json
{"orderId":"<invoice UUID>","snapshot":{"version":1,"sequence":1,"network":"testnet","observedAt":0,"tipHeight":0,"tipHash":"<64 hex chars>","scannedHeight":0,"receipts":[]}}
```

This is a schema illustration, not a valid live observation. `ReceiptSnapshot`
and `ObservedReceipt` in `src/merchant-receipts.ts` define the complete contract.
Sequence must increase per order, persist across scanner restarts, and never be
reset. Retries must first read/reconcile collector state, rather than blindly
resubmitting an old sequence. A snapshot must include all matching receipts,
including notes already spent by the merchant. After a reorg, orphaned receipts
must be removed or updated to their new canonical inclusion height.

`RECEIPT_COLLECTOR_TOKEN` is intentionally **not configured**. The endpoint returns
503 until the scanner is provisioned; no live checkout is marked paid from an
explorer response. This token authenticates the trusted collector, so its holder
can assert receipt observations. Keep it on the merchant backend. Never expose
the collector endpoint credentials or merchant viewing keys to the browser.
The public checkout exposes status only through its existing session cookie.

The local Node example currently supports browser checkout only; hosted Worker
routes add native invoice issuance, registry delivery and receipt ingestion.
Invoices issued before the memo change cannot be automatically matched by this
policy; review those earlier test payments separately.

## Reconciliation policy

- Match network, exact recipient, invoice memo and integer-zatoshi amount.
- Deduplicate `(txid,pool,outputIndex)`; reject contradictory observations.
- Require a scanner caught up to its reported tip and observed within 120 seconds.
- Require ten confirmations by default before `canFulfill` becomes true.
- Underpayment, overpayment and late payment require review, not fulfillment.
- A formerly paid invoice losing sufficient canonical receipts becomes
  `reorg_review`. Unavailable or stale scans always have `canFulfill: false`.
- Preserve the first-observed time durably. Scans performed only after expiry
  cannot reliably prove timely arrival; conservatively flag those for review.

The application must authenticate the scanner, validate its chain source, persist
its sequence and implement idempotent fulfillment separately. The helper cannot
prove an asserted tip hash or timestamp and is not an independent consensus
client. HMAC helpers authenticate exact webhook bytes and enforce a five-minute
clock window; webhook delivery, retries and event-ID deduplication are **not**
implemented by this example. Frontend status must never authorize fulfillment.

## CipherScan evaluation (2026-09-22)

Official docs: https://cipherscan.app/docs

CipherScan offers raw transactions, decoded transactions and chain metadata for
both mainnet and testnet. It explicitly does not expose shielded recipient
activity or balances. Its transaction confirmation information is useful chain
data, but cannot prove the merchant received an invoice amount or memo.

Recommended integration is a merchant-controlled viewing-only scanner, with a
replaceable chain-data provider. CipherScan can supply candidate raw transactions
and explorer links; the scanner must locally decode, validate and decrypt notes
with the merchant's incoming viewing capability, verify canonical inclusion, and
then emit the receipt snapshot. Do not upload the viewing key to CipherScan or
substitute transparent-address lookup for shielded payment verification.

An explorer lookup can reveal the queried transaction ID and requester IP to the
provider. Use the merchant backend, obey rate limits/Retry-After, pin the correct
network, and fail closed on provider failure. A local lightwalletd scanner/collector adapter is implemented. Its live merchant credentials remain unconfigured; CipherScan is not its configured transport. Provisioning the viewing-only service and
funded receipt/reorg acceptance are the remaining end-to-end gates.

## Keep infrastructure small

A merchant-operated full node is optional. For the first implementation, consume
an existing lightwalletd provider rather than operating lightwalletd plus Zebra.
A local viewing-only light client can scan compact blocks starting at the
merchant account birthday and fetch candidate full transactions for memo checks.
The merchant retains its viewing capability, while the provider supplies chain
data. This still depends on provider availability and the light-client trust
model; it is not equivalent to independently validating every consensus rule.
Measure scanner CPU, storage, traffic and catch-up behavior before quoting a
hosting budget. Multiple merchants require isolated viewing keys and receipt
stores. No infrastructure purchase or full-node deployment is needed now.

## Validation recorded 2026-09-22

The SDK suite passes 18 tests, including receipt accounting, fail-closed scanner
freshness, webhook signatures, native invoice verification and authenticated
Worker ingestion/sequence/reorg checks. The testing Worker deployed as
`780dd525-33d3-4802-ae58-bf0cfb7de6da`; live checks confirmed checkout HTTP 200,
a valid registry signature, and scanner-disabled HTTP 503. These checks do not
substitute for an actual viewing-key scanner or funded receipt acceptance.

## Scanner implementation — 2026-09-23

The `receipt-scanner/` tool scans compact blocks and locally decrypts full
transactions, with exact receiver and memo matching. Seven offline Rust tests
pass (including encrypted Sapling/Orchard fixtures and encrypted-backup export);
a separate read-only live two-block scan passed against the native wallet's
existing testnet provider. Twenty-one SDK/collector API tests pass. Native merchant
verifier tests also pass. The collector API includes authenticated, paginated
issued-order discovery. Live credentials and funded native/device receipt
acceptance remain outstanding; the scanner endpoint stays disabled until local
setup provisions its token. See `receipt-scanner/README.md` for the single local
setup command and incoming-only viewing-key disclosure scope.

Testing collector routes deployed as `4018faf6-7399-431f-bdec-ae019ff03f49`. Private local setup is still required; no merchant viewing key has been accessed or collector credential installed.
