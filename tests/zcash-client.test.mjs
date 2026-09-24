import test from 'node:test';
import assert from 'node:assert/strict';
import { createZucchiniClient, discoverZucchiniProvider } from '../dist/zcash.js';
test('SSR discovery is safe and connection uses the implemented permission names',async()=>{
 assert.equal(discoverZucchiniProvider(),undefined);
 let permissions;const client=createZucchiniClient({connect:async p=>{permissions=p;return {connected:true,approvedPermissions:p,accounts:[]}},disconnect:async()=>{},request:async()=>({network:'test'})});
 await client.connect({permissions:['send_transaction']});assert.deepEqual(permissions,['send_transaction']);assert.equal(await client.network(),'testnet');
 assert.throws(()=>client.connect({permissions:['view_viewing_key']}));
});
test('payments use exact decimal amounts and never retry uncertain submission',async()=>{
 const calls=[];let fail=false;const client=createZucchiniClient({connect:async()=>{},disconnect:async()=>{},request:async r=>{calls.push(r);if(fail)throw Error('unknown submission');return 'a'.repeat(64)}});
 assert.equal((await client.requestTransaction({recipient:'fixture',amountZatoshis:123456789n})).txid,'a'.repeat(64));
 assert.equal(calls[0].params.amount,'1.23456789');fail=true;
 await assert.rejects(client.requestTransaction({recipient:'fixture',amountZatoshis:1n}),/unknown/);assert.equal(calls.length,2);
 await assert.rejects(client.requestTransaction({recipient:'fixture',amountZatoshis:0n}));assert.equal(calls.length,2);
});
test('ZIP-321 is passed intact to the wallet without retries or fallback',async()=>{
 const calls=[];let result='b'.repeat(64);
 const provider={connect:async()=>{},disconnect:async()=>{},request:async r=>{calls.push(r);if(result instanceof Error)throw result;return result}};
 const client=createZucchiniClient(provider),uri='zcash:fixture?amount=0.001&memo=b3JkZXI';
 assert.deepEqual(await client.requestPayment(uri),{txid:'b'.repeat(64)});
 assert.deepEqual(calls,[{method:'zcash_requestPayment',params:{uri}}]);
 result=Object.assign(new Error('Unsupported request'),{code:4200});
 await assert.rejects(client.requestPayment(uri),{code:4200});assert.equal(calls.length,2);
 result={txid:'c'.repeat(64)};
 await assert.rejects(client.requestPayment(uri),/uncertain/);assert.equal(calls.length,3);
 await assert.rejects(client.requestPayment('https://example.com'));assert.equal(calls.length,3);
});
