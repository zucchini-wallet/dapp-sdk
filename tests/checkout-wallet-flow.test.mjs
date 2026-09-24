import test from 'node:test';
import assert from 'node:assert/strict';
import {createWalletFlow} from '../examples/wallet-checkout/wallet-flow.js';
test('connection cannot issue an invoice or send; payment requires a separate call',async()=>{
 const calls=[];
 const flow=createWalletFlow({connect:async p=>calls.push(['connect',p])},()=>({capabilities:async()=>({networks:['testnet']}),checkout:async(network,invoice)=>{calls.push(['checkout',network]);await invoice({challenge:'fresh'});return {txid:'test'};}}));
 await assert.rejects(flow.pay(()=>{}),/Connect/);
 await flow.connect();assert.deepEqual(calls,[['connect',['send_transaction']]]);
 const result=await flow.pay(async c=>{assert.equal(c.challenge,'fresh');calls.push(['invoice']);return 'signed';});
 assert.equal(result.txid,'test');assert.equal(calls.length,3);
});
test('failed connection cannot proceed to checkout',async()=>{
 const flow=createWalletFlow({connect:async()=>{}},()=>({capabilities:async()=>({networks:['mainnet']}),checkout:()=>{throw Error('must not run');}}));
 await assert.rejects(flow.connect(),/testnet/);await assert.rejects(flow.pay(()=>{}),/Connect/);
});
