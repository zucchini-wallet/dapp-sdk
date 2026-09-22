# Zucchini Dapp SDK

Framework-independent TypeScript SDK for integrating applications with Zucchini and other standards-compatible browser wallets.

## Responsibilities

- EIP-1193 provider contracts and EIP-6963 multi-provider discovery.
- Official Solana Wallet Standard types, discovery, and required-feature detection.
- Zucchini Zcash provider connection and payment-request contracts.
- Explicit permission requests.
- Address, balance, network, and transaction request contracts.
- ZIP 321 parsing and formatting.
- Compatibility fixtures and integration examples.

The browser SDK never handles wallet seeds, spending keys, wallet databases, or transaction proving.

## Merchant payment protocol proposal

The [open merchant-payment implementation](docs/merchant-payments/README.md)
provides independent registry and signed ZIP 321 invoice verification. The browser
entry point is `@zucchinifi/dapp-sdk/merchant`; backend signing helpers are at
`@zucchinifi/dapp-sdk/merchant/server`. Both are experimental and unpublished.
Merchant signing uses a separate invoice key, never a wallet spending key.

The browser client explicitly negotiates support, requests a wallet challenge,
and submits a signed invoice once. It never retries a payment or downgrades to an
unsigned request. Wallet approval and recovery support must exist before a wallet
advertises the capability. The current extension does not advertise it yet.

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

Provider discovery and compatibility checks are implemented. Zucchini's injected providers and signing backends remain disabled until the extension approval bridge, vault, chain-specific payload parsing, and adversarial tests are complete.

Licensed under either Apache-2.0 or MIT, at your option.
