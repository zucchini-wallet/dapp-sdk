# Contributing

This repository contains independently versioned packages:

- `@zucchinifi/dapp-sdk`: browser connection and payment APIs at the repository root.
- `@zucchinifi/zcash-scanner`: Node wrapper in `receipt-scanner/sdk`, with its Rust
  executable in `receipt-scanner`.
- Runnable examples in `examples`; these are not hosted production services.

Use Node 22.19.x and pnpm 10.15.0. Run:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm verify:package
node --test receipt-scanner/sdk/test/*.test.mjs
node scripts/verify-scanner-package.mjs
cargo test --locked --manifest-path receipt-scanner/Cargo.toml
```

For the checkout example, build the root SDK first, then run `npm ci` and
`npm run build` in `examples/basic-checkout`. Rust tests require a Rust toolchain;
one read-only live-network test is opt-in. Unit tests must not require real funds,
private wallet keys or production credentials.

Open focused pull requests against `staging`. Include the behavior change, relevant
tests and any API migration impact. `main` is the release branch. Keep Connect and
Pay separate, preserve explicit approval, and never automatically retry an uncertain
payment. Do not imply a submitted transaction is confirmed merchant receipt.

Never commit seeds, viewing keys, tokens, private customer data or production keys.
Public deterministic test fixtures must be clearly labeled and unusable as production
trust roots. Use SECURITY.md for vulnerability reports instead of public issues.

Unless explicitly stated otherwise, your contribution is offered under
`MIT OR Apache-2.0`, at the recipient's option, consistent with this repository.
Preserve third-party notices and identify the origin/license of copied code.
