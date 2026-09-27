# @zucchinifi/zcash-scanner

Node-only SDK for local shielded Zcash receipt scanning. This is a separate package
from the browser dApp SDK.

```sh
npm install @zucchinifi/zcash-scanner@0.1.0
```

Clone the [source repository](https://github.com/zucchini-wallet/dapp-sdk) and
build the native executable (Rust toolchain required):

```sh
cargo build --release --locked --manifest-path receipt-scanner/Cargo.toml
```

No native executable is downloaded or bundled. Select the binary you built using an absolute path.

```js
import {createReceiptScanner} from '@zucchinifi/zcash-scanner';
const scanner = createReceiptScanner({
 binary: '/srv/scanner/zucchini-merchant-receipt-scanner',
 viewingKeyFile: '/srv/private/merchant.viewing-key',
 network: 'testnet', endpoint: 'https://testnet.zec.rocks:443',
});
const batch = await scanner.scan({from: 4000000, limit: 100, recipients: [merchantAddress]});
```

Replace the example height with your account's actual scan birthday. Keep the
viewing-key file mode 600 inside a private directory. Incoming keys expose account
receipts, not just the orders you display. Never send keys to the browser.

The Rust executable validates key/network/receiver ownership, decrypts shielded
notes and checks fetched transaction identities. The wrapper bounds execution and
output, checks block continuity and receipt structure, supports AbortSignal, and
never retries automatically. It supports Sapling, Orchard and Ironwood text-memo
receipts; it is not a transparent-transaction indexer or general wallet SDK.

## Responsibility boundary

`scan()` returns one bounded batch, not a payment verdict. The caller must persist
checkpoints and first-seen times, rescan overlapping blocks, reconcile reorgs,
ensure scans are fresh and caught up, and apply order/amount/memo/confirmation
policy before fulfillment. Hash continuity is not independent consensus verification;
canonical-chain information comes from the configured lightwallet provider.
Do not count customer-supplied transaction IDs as evidence. Do not treat a batch
containing only part of an invoice's history as its complete receipt set.

Use the separate dApp SDK `/merchant/server` reconciliation helpers when appropriate.
The existing `receipt-scanner/collector.mjs` demonstrates durable checkpoints and
reorg handling but remains restricted to our testnet demo. This package does not
silently turn that collector into a production service. Funded mainnet acceptance,
operational monitoring and deployment review remain required.

See [the backend example](https://github.com/zucchini-wallet/dapp-sdk/tree/main/examples/receipt-backend) for a runnable one-batch
example. No seed import, spending, broadcast, HTTP listener, telemetry or credentials
are included. Native code and SDK use MIT OR Apache-2.0.
