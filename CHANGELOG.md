# Changelog

## 0.2.0 — 2026-09-27

Stable release of the new SDK API. This is a breaking update from 0.1.7;
see [migration instructions](docs/distribution.md).

- Typed, SSR-safe Zcash provider discovery and explicit permission requests.
- Separate Connect and Pay actions; ordinary ZIP-321 payment requests and exact
  bigint-zatoshi transaction requests. No automatic payment retries.
- EVM EIP-6963 discovery and Solana Wallet Standard helpers. These do not add
  EVM/Solana signing to Zucchini Wallet.
- Separate experimental merchant browser/server exports for signed invoices,
  receipt reconciliation and webhooks. Production wallet merchant support is
  still disabled; the Rust receipt scanner is distributed separately.
- Six ESM entry points with TypeScript declarations and clean-install validation.
- Removed the legacy wallet class/singleton, CommonJS entry, QR/address/amount
  utilities, key-export wrappers and hosted Swap/explorer clients.

The SDK contains no wallet core, seed derivation or spending-key handling.
