# Distribution and compatibility

Version 0.2.0 is the stable SDK release, published under `latest`. It contains
breaking changes from 0.1.7. Existing integrations must follow the migration
notes below; applications that cannot migrate can pin `@zucchinifi/dapp-sdk@0.1.7`.
The `/merchant` and `/merchant/server` APIs remain experimental independently of
the stable ordinary connection/payment API. Production Wallet 0.5.2 does not
support signed merchant payments.

| Entry | Intended consumer | Wallet support |
| --- | --- | --- |
| `/zcash` | Browser checkout; safe to import during SSR | 0.5.2 ordinary Connect and separate reviewed payment |
| `/evm`, `/solana` | Applications discovering compatible third-party providers | Discovery/types only; no Zucchini EVM/Solana signing claim |
| `/merchant` | Experimental signed-invoice checkout | Testing wallet only; production calls fail closed |
| `/merchant/server` | Merchant backend | Invoice signatures, receipt reconciliation, authenticated webhooks |
| root | Existing standards discovery integrations | Re-exports EVM, Solana and ordinary Zcash helpers |

The SDK is ESM with TypeScript declarations. Backend tooling is tested on Node
22.19.x. Browser entry points need a modern browser with BigInt; do not import the
server entry into frontend bundles. It does not include the Rust receipt scanner,
a wallet engine, seed derivation, spending/viewing key export, RPC infrastructure,
or a merchant registration service. The scanner is a separate optional deployment
from this repository, owned by the merchant and scoped by its incoming viewing key.

## Migrating from the legacy 0.1.x package

| 0.1.7 interface | 0.2.0 migration |
| --- | --- |
| `ZucchiniSDK`, singleton `zucchini`, configuration / `apiUrl` | Discover the injected provider and create a client; no hosted API client is supplied |
| CommonJS `require()` | Use ESM `import`; no CommonJS export is provided |
| `connect(['send_transaction'])` | `client.connect({permissions: ['send_transaction']})` |
| `sendTransaction({to, amount, memo})` returning a string | `requestTransaction({recipient, amountZatoshis, memo})` returning `{txid}`; amount is bigint zatoshis |
| `getNetwork()` returning `{network: 'main' / 'test'}` | `network()` returning `'mainnet' / 'testnet'` |
| Event `on` / `off` helpers | `client.on(...)` returns an unsubscribe function |
| `toZats`, `fromZats`, address/ZIP-321 parsing, URI generation and QR helpers | Not exported; migrate these explicitly to application utilities or a suitable dedicated library |
| Balance/address/status convenience methods and `isConnected()` | No corresponding client convenience methods; use granted provider capabilities and connection results, not inferred support |
| Viewing-key methods and `view_keys` permission | Removed; viewing-key export remains a local wallet action |
| Shielding, Swap / explorer HTTP clients | Not supplied by this SDK; do not assume general wallet or API access |

Do not convert decimal ZEC through JavaScript floating-point arithmetic. For
example, `0.001 ZEC` is `100000n` zatoshis. Connecting does not guarantee every
requested permission was approved: check `connected` and `approvedPermissions`
before enabling Pay. Treat account arrays as potentially empty.


Use `discoverZucchiniProvider()` and `createZucchiniClient(provider)` from `/zcash`.
Call `connect({permissions: [...]})` from Connect and `requestPayment(uri)` or
`requestTransaction({recipient, amountZatoshis, memo?})` from a separate Pay action.
The latter takes bigint zatoshis, not floating-point ZEC; it returns `{txid}`.
`network()` returns `mainnet` or `testnet`. Do not assume a legacy wallet class,
key tools, general chain signing, or every ZIP-321 field is implemented.
See website-payments.md for the exact URI subset and uncertainty handling.

Connection does not send funds. A txid is submission, not proof of receipt.
Merchant registration, invoice authentication and incoming receipt scanning are
separate opt-in capabilities. No SDK method retries an uncertain payment or
falls back from signed to unsigned payment automatically.

## Releasing

With Node 22.19.x and pnpm 10.15.0, run `pnpm install --frozen-lockfile`,
`pnpm check`, `pnpm test`, and `pnpm verify:package`. The last command packs the
real artifact, installs it into a fresh external npm project without lifecycle
scripts, imports every export, checks SSR and Connect/Pay separation, and compiles
a TypeScript consumer. The experimental protocol and both licenses are bundled;
consumers do not need the development override's local tarball path.

Publish the verified tarball with `npm publish <tarball> --access public --tag latest`.
Keep the tarball integrity and source revision in the release record. Verify the published version, integrity and `latest` tag after publication.
No CI job stores npm credentials or publishes on an ordinary push.
