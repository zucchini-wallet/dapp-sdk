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

The SDK never handles wallet seeds, signing keys, wallet databases, or transaction proving.

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
