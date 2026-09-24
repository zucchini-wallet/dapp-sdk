import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPrivateKey, sign } from 'node:crypto';
import { createOrders } from '../examples/wallet-checkout/orders.mjs';
const recipient='ztestsapling1'+'q'.repeat(80); // Only fixture construction; real wallet must decode addresses.
const challenge=Buffer.alloc(32,7).toString('base64url');
const privateKey=createPrivateKey({key:Buffer.from('302e020100300506032b657004220420'+'22'.repeat(32),'hex'),format:'der',type:'pkcs8'});
async function fixture(fn){const dir=await mkdtemp(join(tmpdir(),'merchant-orders-'));try{const config={file:join(dir,'orders.json'),recipient,origin:'https://zucchinifi.xyz',sign:async bytes=>new Uint8Array(sign(null,bytes,privateKey))};await fn(createOrders(config),()=>createOrders(config));}finally{await rm(dir,{recursive:true,force:true});}}
test('checkout signs server-owned payment, persists invoice and rejects replacement after restart',()=>fixture(async(store,restart)=>{
 const order=await store.get('session');
 const input={orderId:order.id,challenge};
 const results=await Promise.all([store.invoice('session',input),store.invoice('session',input)]);
 assert.equal(results[0].invoice,results[1].invoice);
 const payload=JSON.parse(Buffer.from(results[0].invoice.split('.')[1],'base64url'));
 assert.equal(payload.paymentUri,`zcash:${recipient}?amount=0.001&memo=${Buffer.from("zucchini:"+order.id).toString("base64url")}`);
 assert.equal(payload.invoiceId,order.id);
 assert.equal((await restart().get('session')).state,'invoice_issued');
 await assert.rejects(restart().invoice('session',{...input,challenge:Buffer.alloc(32,8).toString('base64url')}),/already has an invoice/);
}));
test('untrusted payment fields, foreign orders and malformed challenges are rejected',()=>fixture(async store=>{
 const order=await store.get('session');
 for(const input of [{orderId:order.id,challenge,amount:'500'},{orderId:order.id,challenge,recipient:'attacker'},{orderId:'other',challenge},{orderId:order.id,challenge:'bad'}]) await assert.rejects(store.invoice('session',input));
 await assert.rejects(store.invoice('other',{orderId:order.id,challenge}));
 assert.equal((await store.get('session')).state,'created');
}));
test('submission report stays unconfirmed and cannot overwrite an existing transaction',()=>fixture(async(store,restart)=>{
 const order=await store.get('session');
 await assert.rejects(store.submitted('session',{orderId:order.id,txid:'a'.repeat(64)}));
 await store.invoice('session',{orderId:order.id,challenge});
 assert.equal((await store.submitted('session',{orderId:order.id,txid:'a'.repeat(64)})).state,'submitted');
 assert.equal((await restart().get('session')).state,'submitted');
 await assert.rejects(store.submitted('session',{orderId:order.id,txid:'b'.repeat(64)}));
 await assert.rejects(store.invoice('session',{orderId:order.id,challenge}));
}));
test('receipt events survive restart and successful webhook delivery is acknowledged durably',()=>fixture(async(store,restart)=>{
 const order=await store.get('session');await store.invoice('session',{orderId:order.id,challenge});
 const now=Math.floor(Date.now()/1000);
 await store.receipt('session',{version:1,sequence:1,network:'testnet',observedAt:now,tipHeight:100,tipHash:'a'.repeat(64),scannedHeight:100,receipts:[{txid:'b'.repeat(64),pool:'orchard',outputIndex:0,recipient,amountZatoshis:'100000',memo:`zucchini:${order.id}`,receivedAt:now,blockHeight:90}]});
 let calls=0;const config={endpoint:'https://merchant.example/webhook',key:new Uint8Array(32).fill(7),fetch:async(_,request)=>{calls++;const event=JSON.parse(request.body);assert.equal(event.orderId,order.id);assert.equal(event.sequence,1);assert.equal(event.receipt.canFulfill,true);assert.equal('memo' in event.receipt,false);return new Response('ok');}};
 assert.equal(await restart().deliverWebhooks(config),null);assert.equal(calls,1);
 assert.equal(await restart().deliverWebhooks(config),null);assert.equal(calls,1);
}));

test('receiver changes preserve legacy orders and signed invoices while new orders use the current receiver',async()=>{
 const {createOrderEngine}=await import('../examples/wallet-checkout/order-engine.mjs');
 let records={legacy:{id:crypto.randomUUID()}};
 const next='ztestsapling1'+'p'.repeat(80);
 const store=createOrderEngine({storage:{read:async()=>structuredClone(records),write:async value=>{records=structuredClone(value);}},recipient:next,legacyRecipient:recipient,origin:'https://zucchinifi.xyz',sign:async bytes=>new Uint8Array(sign(null,bytes,privateKey))});
 const old=await store.get('legacy');assert.equal(old.recipient,recipient);
 const invoice=await store.invoice('legacy',{orderId:old.id,challenge});
 assert.ok(JSON.parse(Buffer.from(invoice.invoice.split('.')[1],'base64url')).paymentUri.startsWith(`zcash:${recipient}?`));
 assert.equal((await store.get('fresh')).recipient,next);
 assert.equal(records.legacy.recipient,recipient);
 assert.equal((await store.invoice('legacy',{orderId:old.id,challenge})).invoice,invoice.invoice);
});
