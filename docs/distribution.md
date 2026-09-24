# Distribution and compatibility

The 0.2 prerelease is published as `@zucchinifi/dapp-sdk@next`. The existing
`latest` 0.1.7 release stays unchanged. Pin the full prerelease version in production
applications; npm's normal semver range does not opt users into prereleases.

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

Publish the verified tarball with `npm publish <tarball> --access public --tag next`.
Keep the tarball integrity and source revision in the release record. Do not move
`latest` without a separately reviewed stable release and migration decision.
No CI job stores npm credentials or publishes on an ordinary push.
