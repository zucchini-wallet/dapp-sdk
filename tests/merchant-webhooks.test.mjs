import test from 'node:test';
import assert from 'node:assert/strict';
import {createReceiptWebhookEvent,deliverReceiptWebhook,verifyReceiptWebhook} from '../dist/merchant-server.js';
test('webhooks sign exact bytes, retain event identity on retry and stop after acknowledgement',async()=>{
 const key=new Uint8Array(32).fill(9), status={state:'paid',canFulfill:true,receivedZatoshis:'1',confirmedZatoshis:'1',confirmations:10,requiredConfirmations:10};
 const first=createReceiptWebhookEvent('fixture',status,1000);let calls=0;
 const fetch=async(url,request)=>{calls++;assert.equal(request.redirect,'error');assert.equal(request.headers['Zucchini-Event-Id'],first.id);assert.equal(await verifyReceiptWebhook(request.body,request.headers['Zucchini-Signature'],key,calls===1?1000:1015),true);return new Response('',{status:calls===1?503:200});};
 const config={endpoint:'https://merchant.example/webhook',key,fetch};
 const retry=await deliverReceiptWebhook(first,{...config,now:1000});assert.equal(retry.nextAttemptAt,1015);
 assert.deepEqual(await deliverReceiptWebhook(retry,{...config,now:1001}),retry);assert.equal(calls,1);
 const done=await deliverReceiptWebhook(retry,{...config,now:1015});assert.equal(done.deliveredAt,1015);assert.equal(done.id,first.id);
 await deliverReceiptWebhook(done,{...config,now:2000});assert.equal(calls,2);
});
test('exhausted deliveries become visible failures rather than infinite retries',async()=>{
 const event={...createReceiptWebhookEvent('fixture',{state:'paid'},1),attempts:7};
 const result=await deliverReceiptWebhook(event,{endpoint:'https://merchant.example/hook',key:new Uint8Array(32),now:2,fetch:async()=>{throw Error('offline')}});
 assert.equal(result.failedAt,2);assert.equal(result.attempts,8);
});
