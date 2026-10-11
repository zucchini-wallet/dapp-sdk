import test from "node:test";
import assert from "node:assert/strict";
import {
  createZucchiniClient,
  discoverZucchiniProvider,
} from "../dist/zcash.js";
test("SSR discovery is safe and connection uses the implemented permission names", async () => {
  assert.equal(discoverZucchiniProvider(), undefined);
  let permissions;
  const client = createZucchiniClient({
    connect: async (p) => {
      permissions = p;
      return { connected: true, approvedPermissions: p, accounts: [] };
    },
    disconnect: async () => {},
    request: async () => ({ network: "test" }),
  });
  await client.connect({ permissions: ["send_transaction"] });
  assert.deepEqual(permissions, ["send_transaction"]);
  assert.equal(await client.network(), "testnet");
  assert.throws(() => client.connect({ permissions: ["view_viewing_key"] }));
});
test("payments use exact decimal amounts and never retry uncertain submission", async () => {
  const calls = [];
  let fail = false;
  const client = createZucchiniClient({
    connect: async () => {},
    disconnect: async () => {},
    request: async (r) => {
      calls.push(r);
      if (fail) throw Error("unknown submission");
      return "a".repeat(64);
    },
  });
  assert.equal(
    (
      await client.requestTransaction({
        recipient: "fixture",
        amountZatoshis: 123456789n,
      })
    ).txid,
    "a".repeat(64),
  );
  assert.equal(calls[0].params.amount, "1.23456789");
  fail = true;
  await assert.rejects(
    client.requestTransaction({ recipient: "fixture", amountZatoshis: 1n }),
    /unknown/,
  );
  assert.equal(calls.length, 2);
  await assert.rejects(
    client.requestTransaction({ recipient: "fixture", amountZatoshis: 0n }),
  );
  assert.equal(calls.length, 2);
});
test("ZIP-321 is passed intact to the wallet without retries or fallback", async () => {
  const calls = [];
  let result = "b".repeat(64);
  const provider = {
    connect: async () => {},
    disconnect: async () => {},
    request: async (r) => {
      calls.push(r);
      if (result instanceof Error) throw result;
      return result;
    },
  };
  const client = createZucchiniClient(provider),
    uri = "zcash:fixture?amount=0.001&memo=b3JkZXI";
  assert.deepEqual(await client.requestPayment(uri), { txid: "b".repeat(64) });
  assert.deepEqual(calls, [
    { method: "zcash_requestPayment", params: { uri } },
  ]);
  result = Object.assign(new Error("Unsupported request"), { code: 4200 });
  await assert.rejects(client.requestPayment(uri), { code: 4200 });
  assert.equal(calls.length, 2);
  result = { txid: "c".repeat(64) };
  await assert.rejects(client.requestPayment(uri), /uncertain/);
  assert.equal(calls.length, 3);
  await assert.rejects(client.requestPayment("https://example.com"));
  assert.equal(calls.length, 3);
});
test("typed address access requires explicit address consent and never escalates or reads balances", async () => {
  const calls = [];
  let granted = false;
  const addresses = {
    unified: "u1fixture",
    orchard: "u1fixture",
    sapling: "zs1fixture",
    transparent: "t1fixture",
  };
  const client = createZucchiniClient({
    connect: async (permissions) => {
      calls.push({ method: "connect", permissions });
      granted = permissions.includes("view_addresses");
      return {
        connected: true,
        approvedPermissions: permissions,
        accounts: [],
      };
    },
    disconnect: async () => {},
    request: async (request) => {
      calls.push(request);
      if (!granted)
        throw Object.assign(new Error("Address permission required"), {
          code: 4100,
        });
      return addresses;
    },
  });
  await assert.rejects(client.getAddresses(), { code: 4100 });
  assert.deepEqual(calls, [{ method: "getAddresses" }]);
  await client.connect({ permissions: ["view_addresses", "send_transaction"] });
  const result = await client.getAddresses();
  assert.deepEqual(result, addresses);
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(
    calls.map((call) => call.method),
    ["getAddresses", "connect", "getAddresses"],
  );
});
test("typed address results reject missing, oversized or non-address fields", async () => {
  const addresses = {
    unified: "u1fixture",
    orchard: "u1fixture",
    sapling: "zs1fixture",
    transparent: "t1fixture",
  };
  let result = addresses;
  const client = createZucchiniClient({
    connect: async () => {},
    disconnect: async () => {},
    request: async () => result,
  });
  for (const changed of [
    { transparent: undefined },
    { sapling: 3 },
    { unified: "" },
    { orchard: "u1 with whitespace" },
    { transparent: "t".repeat(1601) },
  ]) {
    result = { ...addresses, ...changed };
    await assert.rejects(client.getAddresses(), /address response/);
  }
  for (const invalid of [null, [], "address"]) {
    result = invalid;
    await assert.rejects(client.getAddresses(), /address response/);
  }
});
test("ZIP-321 expiry is explicit, integer seconds, and never downgraded for an older wallet", async (t) => {
  const now = 1800000000000;
  t.mock.method(Date, "now", () => now);
  const calls = [];
  let fail = false;
  const client = createZucchiniClient({
    connect: async () => {},
    disconnect: async () => {},
    request: async (request) => {
      calls.push(request);
      if (fail)
        throw Object.assign(new Error("Unsupported deadline"), {
          code: -32602,
        });
      return "a".repeat(64);
    },
  });
  const uri = "zcash:t1fixture?amount=0.00000001",
    expiresAt = now / 1000 + 120;
  assert.deepEqual(await client.requestPayment(uri, { expiresAt }), {
    txid: "a".repeat(64),
  });
  assert.deepEqual(calls, [
    { method: "zcash_requestPayment", params: { uri, expiresAt } },
  ]);
  for (const invalid of [
    expiresAt - 120,
    expiresAt - 121,
    expiresAt + 0.5,
    "1800000120",
    Infinity,
    Number.MAX_SAFE_INTEGER,
  ])
    await assert.rejects(
      client.requestPayment(uri, { expiresAt: invalid }),
      /deadline/,
    );
  for (const options of [null, [], { amount: "1" }])
    await assert.rejects(client.requestPayment(uri, options), /options/);
  assert.equal(calls.length, 1);
  fail = true;
  await assert.rejects(client.requestPayment(uri, { expiresAt }), {
    code: -32602,
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].params, { uri, expiresAt });
});
