import assert from "node:assert/strict";
import test from "node:test";

import {
  EIP6963_ANNOUNCE_PROVIDER_EVENT,
  isZucchiniCompatibleSolanaWallet,
  requestEip6963Providers,
} from "../dist/index.js";

test("discovers a structurally valid EIP-6963 provider", () => {
  const target = new EventTarget();
  const discovered = [];
  const stop = requestEip6963Providers((provider) => discovered.push(provider), target);
  const provider = {
    on() {
      return this;
    },
    removeListener() {
      return this;
    },
    async request() {
      return [];
    },
  };
  target.dispatchEvent(
    new CustomEvent(EIP6963_ANNOUNCE_PROVIDER_EVENT, {
      detail: {
        info: {
          icon: "data:image/png;base64,AA==",
          name: "Zucchini",
          rdns: "xyz.zucchinifi.wallet",
          uuid: "350670db-19fa-4704-a166-e52e178b59d2",
        },
        provider,
      },
    }),
  );

  assert.equal(discovered.length, 1);
  assert.equal(discovered[0].provider, provider);
  stop();
});

test("requires every selected Solana Wallet Standard feature", () => {
  const complete = {
    accounts: [],
    chains: ["solana:devnet"],
    features: {
      "solana:signAndSendTransaction": {
        signAndSendTransaction() {},
        version: "1.0.0",
      },
      "solana:signIn": { signIn() {}, version: "1.0.0" },
      "solana:signMessage": { signMessage() {}, version: "1.0.0" },
      "solana:signTransaction": { signTransaction() {}, version: "1.0.0" },
      "standard:connect": { connect() {}, version: "1.0.0" },
      "standard:events": { on() {}, version: "1.0.0" },
    },
    icon: "data:image/png;base64,AA==",
    name: "Zucchini",
    version: "1.0.0",
  };

  assert.equal(isZucchiniCompatibleSolanaWallet(complete), true);
  const { "solana:signMessage": _removed, ...incompleteFeatures } = complete.features;
  assert.equal(
    isZucchiniCompatibleSolanaWallet({ ...complete, features: incompleteFeatures }),
    false,
  );
});
