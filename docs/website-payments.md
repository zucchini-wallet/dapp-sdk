# Website payments with Zucchini Wallet 0.5.2

Ordinary website payments do not require merchant registration, invoice-signing
keys or viewing keys. Connection and payment are separate user approvals.
The website origin is shown by the wallet; it is not a merchant endorsement.

```ts
import {
  discoverZucchiniProvider,
  createZucchiniClient,
} from "@zucchinifi/dapp-sdk/zcash";
const provider = discoverZucchiniProvider();
if (!provider) throw new Error("Install or enable Zucchini Wallet");
const wallet = createZucchiniClient(provider);
// Run from the Connect wallet button. This does not request a payment.
await wallet.connect({ permissions: ["send_transaction"] });
// Separately run from the Pay button, using your actual receiving address.
const { txid } = await wallet.requestPayment(`zcash:${recipient}?amount=0.001`);
```

Without the SDK, the equivalent payment call is:

```js
const txid = await window.zucchini.request({
  method: "zcash_requestPayment",
  params: { uri: `zcash:${recipient}?amount=0.001` },
});
```

The initial ZIP-321 profile supports one address (in the path or `address`
parameter), an explicit positive ZEC `amount` with at most eight decimal places,
and an optional unpadded base64url `memo`. Memo content must be printable UTF-8,
up to 512 bytes; transparent recipients cannot receive memos. The wallet core
validates the address against its active network before review. Both mainnet and
testnet use the same method, with network-specific connection grants.

Indexed/multiple payments, binary/control-character memos, omitted amounts,
labels, messages, custom assets and other parameters are currently rejected.
Duplicate parameters, extra method arguments and malformed encodings are also
rejected. This is a supported subset, not complete ZIP-321 support. The original
`sendTransaction` method and SDK `requestTransaction` remain available.

The unpublished `0.3.0-direct-payment.1` SDK adds typed address access. Ask for `view_addresses`
explicitly, check the returned approved permissions, then read addresses:

```ts
const connection = await wallet.connect({
  permissions: ["view_addresses", "send_transaction"],
});
if (!connection.approvedPermissions.includes("view_addresses"))
  throw new Error("Address access declined");
const addresses = await wallet.getAddresses();
// For an origin-chain swap refund, independently validate this against the selected network.
const refundAddress = addresses.transparent;
```

`getAddresses()` never connects, escalates consent or reads balances. The wallet
enforces the origin/network-bound permission. Its result includes `unified`,
`orchard`, `sapling` and `transparent`; `orchard` currently aliases the Unified
Address rather than a raw Orchard receiver. No viewing key is exposed.

The integration candidate and updated wallet source support an optional payment approval
deadline in integer Unix seconds, outside the URI:

```ts
await wallet.requestPayment(paymentUri, { expiresAt: latestApprovalAt });
```

The wallet caps review and transfer authorization at the earlier of that deadline
and its normal ten-minute approval limit. It rejects already-expired requests
and rechecks expiry before authorizing signing. For a direct swap, pass the
backend's persisted approval cutoff, derived from the quote and provider invoice
windows. This is an approval limit; it does not authenticate a quote or guarantee
when a transaction confirms or a swap delivers.

Old wallets reject the additional field. Do not catch that rejection and retry
without the deadline. Calls that omit the option retain the existing `{ uri }`
request and normal approval window. These additions are local source work and
are not present in the published SDK `0.2.0` or an already-installed old wallet.

The wallet displays recipient, amount and memo, then calculates a fee before the
user approves sending. It binds the approved transfer to those exact values and
the requesting document. Rejection, navigation, lock or revocation can invalidate
the request. Do not retry payments automatically after an uncertain result;
ask the user to check Activity. A returned transaction ID means submitted, not
confirmed receipt or fulfilled order.

Ordinary URIs do not authenticate merchant invoices. Signed merchant payments
remain a separate experimental protocol and are disabled in production 0.5.2.
Never downgrade a rejected signed invoice to an ordinary payment automatically.
Website compromise can change an unsigned request before review; the user must
check the wallet's displayed recipient and amount.

Specification: https://zips.z.cash/zip-0321
