import test from 'node:test';
import assert from 'node:assert/strict';
import { createMerchantPaymentClient, ProtocolError } from '../dist/merchant.js';
import { signInvoice } from '../dist/merchant-server.js';

test('merchant and server entry points expose the verifier and signing helper', () => {
 assert.equal(typeof ProtocolError, 'function'); assert.equal(typeof signInvoice, 'function');
});
test('capabilities require explicit verified payment support', async () => {
 const calls = [];
 const client = createMerchantPaymentClient({ async request(r) { calls.push(r); return { versions: [1], networks: ['testnet'], features: ['single-shielded-zec'] }; } });
 assert.deepEqual(await client.capabilities(), { versions: [1], networks: ['testnet'], features: ['single-shielded-zec'] });
 assert.equal(calls[0].method, 'zcash_getMerchantPaymentCapabilities');
 await assert.rejects(createMerchantPaymentClient({ async request() { return { versions: [], networks: ['testnet'], features: [] }; } }).capabilities());
});
test('payment failure is propagated once without retry or unsigned fallback', async () => {
 const calls = [];
 const error = new Error('broadcast outcome unknown');
 const client = createMerchantPaymentClient({ async request(r) { calls.push(r); throw error; } });
 await assert.rejects(client.requestPayment('e30.e30.AA'), (e) => e === error);
 assert.equal(calls.length, 1); assert.equal(calls[0].method, 'zcash_requestMerchantPayment');
 await assert.rejects(client.requestPayment('not-an-invoice'));
 assert.equal(calls.length, 1);
});
test('browser challenge validates origin and expiry against active page', async () => {
 const original = globalThis.window;
 globalThis.window = { location: { protocol: 'https:', origin: 'https://shop.example.com' } };
 try {
  const response = { challenge: Buffer.alloc(32, 7).toString('base64url'), origin: 'https://shop.example.com', network: 'testnet', expiresAt: Math.floor(Date.now()/1000) + 120 };
  const client = createMerchantPaymentClient({ async request() { return response; } });
  assert.deepEqual(await client.challenge('testnet'), response);
  response.origin = 'https://evil.example'; await assert.rejects(client.challenge('testnet'));
  response.origin = 'https://shop.example.com'; response.expiresAt = 1; await assert.rejects(client.challenge('testnet'));
 } finally { if (original === undefined) delete globalThis.window; else globalThis.window = original; }
});
test('malformed success response requires wallet activity check, never retries', async () => {
 let calls = 0;
 const client = createMerchantPaymentClient({ async request() { calls++; return { txid: 'bad' }; } });
 await assert.rejects(client.requestPayment('e30.e30.AA'), /check wallet activity/);
 assert.equal(calls, 1);
});
