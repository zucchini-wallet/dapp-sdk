# Zucchini Dapp SDK

Framework-independent TypeScript SDK for integrating applications with Zucchini and other standards-compatible browser wallets.

## Install

```sh
npm install @zucchinifi/dapp-sdk@0.2.0
```

See [compatibility and migration](docs/distribution.md) before replacing 0.1.x.

## Responsibilities

- EIP-1193 provider contracts and EIP-6963 multi-provider discovery.
- Official Solana Wallet Standard types, discovery, and required-feature detection.
- Zucchini Zcash provider connection and payment-request contracts.
- Explicit permission requests.
- Address, balance, network, and transaction request contracts.
- Signed ZIP 321 payment parsing and verification through the merchant entry point.
- Compatibility fixtures and integration examples.

The browser SDK never handles wallet seeds, spending keys, wallet databases, or transaction proving.

## Merchant payment protocol proposal

The [open merchant-payment implementation](https://github.com/zucchini-wallet/open-zcash-merchant-payments)
provides independent registry and signed ZIP 321 invoice verification. The browser
entry point is `@zucchinifi/dapp-sdk/merchant`; backend signing helpers are at
`@zucchinifi/dapp-sdk/merchant/server`. Both are experimental; production Wallet 0.5.2 does not enable signed merchant payments.
Merchant signing uses a separate invoice key, never a wallet spending key.

The browser client explicitly negotiates support, requests a wallet challenge,
and submits a signed invoice once. It never retries a payment or downgrades to an
unsigned request. Wallet approval and recovery support must exist before a wallet
advertises the capability. The testing extension supports the merchant flow. Production availability is gated by its trusted registry configuration.

## EVM discovery

```ts
import { requestEip6963Providers } from "@zucchinifi/dapp-sdk";

const stop = requestEip6963Providers(({ info, provider }) => {
  console.log(info.name);
  void provider.request({ method: "eth_chainId" });
});

// Call when the application no longer needs discovery events.
stop();
```

Discovery validates UUIDv4 metadata, image data URIs, reverse-DNS identifiers, and the required EIP-1193 methods. Provider metadata is self-attested and must not be used as proof of wallet identity.

## Solana discovery

```ts
import { getCompatibleSolanaWallets } from "@zucchinifi/dapp-sdk";

for (const wallet of getCompatibleSolanaWallets()) {
  console.log(wallet.name, wallet.accounts);
}
```

A compatible wallet must expose `standard:connect`, `standard:events`, `solana:signIn`, `solana:signMessage`, `solana:signTransaction`, and `solana:signAndSendTransaction` with callable standard methods.

## Status

Wallet 0.5.2 implements ordinary Zcash connection and payment approvals. EVM and Solana exports provide discovery and interface helpers, not Zucchini signing support. Native imported invoices use issuer verification; they do not establish browser-origin-bound sessions.

Licensed under either Apache-2.0 or MIT, at your option.

### Reference wallet checkout (testnet)

[Wallet checkout example](https://github.com/zucchini-wallet/dapp-sdk/tree/staging/examples/wallet-checkout) connects the browser SDK to a backend-owned 0.001 test-ZEC order, persists invoice issuance, and reports submission without claiming receipt confirmation. It uses public test keys and requires an operator-owned testnet receiver and HTTPS hosting matching the testing registry. It is not a production merchant service.

## Existing-wallet merchant setup

See [merchant setup](docs/merchant-setup.md). Use your existing wallet: export an
incoming viewing key locally and configure the receipt scanner. No separate wallet
is required. The browser SDK never imports viewing keys or seeds.

Use `/zcash` for the small browser connection client, `/merchant` for signed
checkout, and `/merchant/server` only in backend code. The default entry re-exports
Zcash, EVM and Solana helpers; it does not preserve the legacy 0.1.x API. The protocol package is bundled in the
release tarball with its licenses so installation does not require our private file
paths; its dependency version is explicit. Development overrides are not a runtime
requirement. Version 0.2.0 is the stable API release intended for `latest`. Signed merchant
entry points remain explicitly experimental and do not enable production wallet support.

### Ordinary website payments (Wallet 0.5.2)

Use `@zucchinifi/dapp-sdk/zcash` for website-initiated Connect and separate payment
approval. `requestPayment(uri)` sends a supported single-recipient ZIP-321 URI to
the wallet for parsing and review; merchant registration is not required.
See [website payment integration](docs/website-payments.md) for supported fields,
error handling and the distinction between submission and receipt confirmation.
