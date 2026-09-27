# Basic checkout — ordinary ZIP-321

From the repository root run `pnpm build`, then in this directory:

```sh
npm install
npm run dev
```

Enable the production-capable Zucchini provider for the example origin, switch
Wallet 0.5.2 to testnet and enter a testnet unified address you control. If your
wallet requires HTTPS website permissions, use an HTTPS development origin.
Click Connect: no payment should appear. Click Review payment separately, verify
the wallet's recipient/amount/fee, then approve or reject. No merchant registry or
signing key is required. `npm run build` produces a static site.

The example uses the checked-out SDK through a local dependency. For your deployed
application install `@zucchinifi/dapp-sdk@0.2.0` after that version is published.
It deliberately blocks repeat payment attempts after invoking the wallet; retains this guard across reloads in the same tab. Inspect
Activity before starting a new checkout tab. No backend receipt verification or order persistence
is implied. A production checkout should use backend-owned orders and receipt state.
