import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{CheckoutOrder} from '../examples/wallet-checkout/worker.mjs';
const base='https://zucchinifi.xyz/merchant-test';
function environment() {
 const objects=new Map();
 return {
  ASSETS:{fetch:async()=>new Response('asset')},
  ORDERS:{
   idFromName:s=>s,
   get(id) {
    if(!objects.has(id)) {
     const values=new Map();
     const storage={list:async({prefix,startAfter,limit})=>new Map([...values].filter(([k])=>k.startsWith(prefix)&&(!startAfter||k>startAfter)).sort(([a],[b])=>a.localeCompare(b)).slice(0,limit)),get:async key=>structuredClone(values.get(key)),put:async(key,next)=>{values.set(key,structuredClone(next));}};
     objects.set(id,new CheckoutOrder({storage}));
    }
    return objects.get(id);
   }
  }
 };
}
test('hosted checkout enforces origin, cookie, request size and persistent invoice binding',async()=>{
 const env=environment();
 assert.equal((await worker.fetch(new Request('https://evil.example/merchant-test/api/order'),env)).status,404);
 const first=await worker.fetch(new Request(base+'/api/order'),env),order=await first.json();
 const cookie=first.headers.get('set-cookie');assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);
 const headers={'Cookie':cookie.split(';')[0],'Origin':'https://zucchinifi.xyz','Content-Type':'application/json'};
 const request=body=>new Request(base+'/api/invoice',{method:'POST',headers,body:JSON.stringify(body)});
 const payload={orderId:order.id,challenge:Buffer.alloc(32,1).toString('base64url')};
 assert.equal((await worker.fetch(new Request(base+'/api/invoice',{method:'POST',headers:{...headers,Origin:'https://evil.example'},body:JSON.stringify(payload)}),env)).status,403);
 assert.equal((await worker.fetch(request({...payload,amount:'10'}),env)).status,400);
 assert.equal((await worker.fetch(request({value:'x'.repeat(2049)}),env)).status,413);
 const issued=await worker.fetch(request(payload),env);assert.equal(issued.status,200);
 const invoice=(await issued.json()).invoice;
 const decoded=JSON.parse(Buffer.from(invoice.split('.')[1],'base64url'));
 assert.equal(decoded.network,'testnet');assert.match(decoded.paymentUri,/\?amount=0\.001&memo=/);
 const again=await worker.fetch(new Request(base+'/api/order',{headers}),env);assert.equal((await again.json()).state,'invoice_issued');
 assert.equal((await worker.fetch(request({...payload,challenge:Buffer.alloc(32,2).toString('base64url')}),env)).status,400);
});

test('native invoices share the signed protocol but cannot replace browser-bound invoices',async()=>{
 const env=environment(),response=await worker.fetch(new Request(base+'/api/order'),env),order=await response.json();
 const headers={Cookie:response.headers.get('set-cookie').split(';')[0],Origin:'https://zucchinifi.xyz','Content-Type':'application/json'};
 const post=(path,body)=>worker.fetch(new Request(base+path,{method:'POST',headers,body:JSON.stringify(body)}),env);
 const issued=await post('/api/native-invoice',{orderId:order.id});assert.equal(issued.status,200);
 const invoice=(await issued.json()).invoice,payload=JSON.parse(Buffer.from(invoice.split('.')[1],'base64url'));
 assert.equal(payload.challenge,undefined);assert.equal(payload.invoiceId,order.id);
 assert.equal((await post('/api/invoice',{orderId:order.id,challenge:Buffer.alloc(32,2).toString('base64url')})).status,400);
 const registry=await(await worker.fetch(new Request(base+'/api/registry'),env)).text();
 const {verifyRegistry,verifyInvoice}=await import('@zucchinifi/merchant-payments');
 const verifiedRegistry=await verifyRegistry(registry,{state:{accept:async()=>{}},trust:{registryId:'zucchini-merchant-testing',minimumSequence:1,roots:[{kid:'test-release',publicKey:'0EqyMnQrtKs6E2i9RhXk5tAiSrcaAWuvhSCjMsl3hzc'}]}});
 const verified=await verifyInvoice(invoice,{registry:verifiedRegistry,network:'testnet',context:{kind:'import'},validateAddress:(address,network)=>address===order.recipient?{network,shielded:true}:null});
 assert.equal(verified.verification,'issuer-only');assert.equal(verified.payment.amountZatoshis,'100000');
});
test('only authenticated scanner snapshots update receipts; stale sequences and client reports cannot fulfill',async()=>{
 const env=environment();
 const push=(input,token='collector-test-secret')=>worker.fetch(new Request(base+'/internal/receipt',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify(input)}),env);
 assert.equal((await push({})).status,503);env.RECEIPT_COLLECTOR_TOKEN='collector-test-secret';
 assert.equal((await push({},'wrong')).status,401);
 const response=await worker.fetch(new Request(base+'/api/order'),env),order=await response.json();
 const headers={Cookie:response.headers.get('set-cookie').split(';')[0],Origin:'https://zucchinifi.xyz','Content-Type':'application/json'};
 await worker.fetch(new Request(base+'/api/native-invoice',{method:'POST',headers,body:JSON.stringify({orderId:order.id})}),env);
 const now=Math.floor(Date.now()/1000),snapshot={version:1,sequence:1,network:'testnet',observedAt:now,tipHeight:100,tipHash:'c'.repeat(64),scannedHeight:100,receipts:[{txid:'a'.repeat(64),pool:'orchard',outputIndex:0,recipient:order.recipient,amountZatoshis:'100000',memo:'zucchini:'+order.id,receivedAt:now,blockHeight:90}]};
 const paid=await push({orderId:order.id,snapshot});assert.equal(paid.status,200);assert.equal((await paid.json()).receipt.canFulfill,true);
 assert.equal((await push({orderId:order.id,snapshot})).status,400);
 assert.equal((await push({orderId:order.id,snapshot,recipient:'attacker'})).status,400);
 const reorg=await push({orderId:order.id,snapshot:{...snapshot,sequence:2,receipts:[]}});
 const updated=await reorg.json();assert.equal(updated.receipt.state,'reorg_review');assert.equal(updated.receipt.canFulfill,false);
});

test('collector discovery is authenticated, paginated and contains only issued invoice details',async()=>{
 const env=environment();env.RECEIPT_COLLECTOR_TOKEN='test-token';
 assert.equal((await worker.fetch(new Request(base+'/internal/orders'),env)).status,401);
 const getOrders=()=>worker.fetch(new Request(base+'/internal/orders',{headers:{Authorization:'Bearer test-token'}}),env);
 assert.deepEqual((await(await getOrders()).json()).orders,[]);
 const first=await worker.fetch(new Request(base+'/api/order'),env),order=await first.json();
 assert.deepEqual((await(await getOrders()).json()).orders,[]);
 const headers={Cookie:first.headers.get('set-cookie').split(';')[0],Origin:'https://zucchinifi.xyz','Content-Type':'application/json'};
 assert.equal((await worker.fetch(new Request(base+'/api/native-invoice',{method:'POST',headers,body:JSON.stringify({orderId:order.id})}),env)).status,200);
 const feed=await(await getOrders()).json();assert.equal(feed.orders.length,1);assert.equal(feed.orders[0].id,order.id);assert.equal(feed.orders[0].amountZatoshis,'100000');assert.equal(feed.next,null);
 assert.equal(feed.orders[0].session,undefined);assert.equal(feed.orders[0].invoice,undefined);
});

test('starting another test order requires a same-origin POST and retains the previous order',async()=>{
 const env=environment();
 const initial=await worker.fetch(new Request(base+'/api/order'),env);
 const old=await initial.json(),cookie=initial.headers.get('set-cookie').split(';')[0];
 assert.equal((await worker.fetch(new Request(base+'/api/new-order'),env)).status,405);
 assert.equal((await worker.fetch(new Request(base+'/api/new-order',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'}}),env)).status,403);
 const fresh=await worker.fetch(new Request(base+'/api/new-order',{method:'POST',headers:{Origin:'https://zucchinifi.xyz','Content-Type':'application/json',Cookie:cookie},body:'{}'}),env);
 assert.equal(fresh.status,200);
 const next=await(await worker.fetch(new Request(base+'/api/order',{headers:{Cookie:fresh.headers.get('set-cookie').split(';')[0]}}),env)).json();
 assert.notEqual(next.id,old.id);
 const preserved=await(await worker.fetch(new Request(base+'/api/order',{headers:{Cookie:cookie}}),env)).json();
 assert.equal(preserved.id,old.id);
});
