import test from 'node:test';
import assert from 'node:assert/strict';
import {invoiceMemo,reconcileMerchantReceipts as reconcile,signReceiptWebhook,verifyReceiptWebhook} from '../dist/merchant-server.js';
const order={invoiceId:'order-1',network:'testnet',recipient:'merchant-receiver',amountZatoshis:'100000',expiresAt:1100};
const receipt={txid:'ab'.repeat(32),pool:'orchard',outputIndex:0,recipient:order.recipient,amountZatoshis:'100000',memo:invoiceMemo(order.invoiceId),receivedAt:1000,blockHeight:90};
const snapshot=(receipts=[receipt],overrides={})=>({version:1,sequence:1,network:'testnet',observedAt:1000,tipHeight:100,tipHash:'cd'.repeat(32),scannedHeight:100,receipts,...overrides});
const result=(snap,options={})=>reconcile(order,snap,{now:1000,...options});
test('only an exact locally observed receipt with sufficient confirmations can fulfill',()=>{
 assert.equal(result(undefined).canFulfill,false);
 assert.equal(result(snapshot([])).state,'awaiting_payment');
 assert.equal(result(snapshot([{...receipt,blockHeight:null}])).state,'detected');
 assert.equal(result(snapshot([{...receipt,blockHeight:100}])).state,'confirming');
 assert.equal(result(snapshot()).state,'paid');assert.equal(result(snapshot()).canFulfill,true);
 for(const wrong of [{recipient:'attacker'},{memo:'wrong'},{memo:invoiceMemo('other-order')}])assert.equal(result(snapshot([{...receipt,...wrong}])).receivedZatoshis,'0');
 assert.throws(()=>result(snapshot([],{network:'mainnet'})),/Invalid scanner/);
});
test('underpayment, overpayment, late payments, duplicates, expiry and reorgs fail closed',()=>{
 assert.equal(result(snapshot([{...receipt,amountZatoshis:'99999'}])).state,'underpaid');
 assert.equal(result(snapshot([{...receipt,amountZatoshis:'100001'}])).state,'overpaid');
 assert.equal(result(snapshot([receipt,receipt])).receivedZatoshis,'100000');
 assert.throws(()=>result(snapshot([receipt,{...receipt,amountZatoshis:'1'}])),/Conflicting/);
 assert.equal(result(snapshot([{...receipt,receivedAt:1101}],{observedAt:1101}),{now:1101}).state,'late_payment');
 assert.equal(result(snapshot([],{observedAt:1101}),{now:1101}).state,'expired');
 assert.equal(result(snapshot([]),{previouslyPaid:true}).state,'reorg_review');
 assert.equal(result(snapshot([{...receipt,blockHeight:100}]),{previouslyPaid:true}).canFulfill,false);
 // An invoice may be satisfied by distinct outputs. The least-confirmed output matters.
 assert.equal(result(snapshot([{...receipt,amountZatoshis:'40000'},{...receipt,outputIndex:1,amountZatoshis:'60000'}])).canFulfill,true);
});
test('stale, incomplete, future or malformed scanner observations never authorize fulfillment',()=>{
 for(const changed of [{observedAt:879},{observedAt:1031},{scannedHeight:99}])assert.equal(result(snapshot(undefined,changed)).state,'verification_unavailable');
 for(const changed of [{sequence:-1},{tipHash:'bad'},{tipHeight:NaN},{receipts:{}},{version:2}])assert.throws(()=>result(snapshot(undefined,changed)));
 for(const changed of [{amountZatoshis:'1e5'},{amountZatoshis:'-1'},{amountZatoshis:'2100000000000001'},{outputIndex:-1},{blockHeight:101},{receivedAt:1031},{pool:'transparent'}])assert.throws(()=>result(snapshot([{...receipt,...changed}])));
 assert.throws(()=>result(snapshot(),{requiredConfirmations:0}));
 assert.throws(()=>invoiceMemo('unsafe\n'));
});
test('webhook authentication binds exact bytes and timestamp; callers still deduplicate events',async()=>{
 const key=new Uint8Array(32).fill(42),body='{"id":"event-1","state":"paid"}';
 const header=await signReceiptWebhook(body,key,1000);
 assert.equal(await verifyReceiptWebhook(body,header,key,1001),true);
 assert.equal(await verifyReceiptWebhook(body+' ',header,key,1001),false);
 assert.equal(await verifyReceiptWebhook(body,header,new Uint8Array(32),1001),false);
 assert.equal(await verifyReceiptWebhook(body,header,key,1301),false);
 assert.equal(await verifyReceiptWebhook(body,header,key,NaN),false);
});

test('collector retains spent/old receipts, detects fork boundary changes and preserves first-seen time',async()=>{
 const {reconcileBatch,snapshotFor}=await import('../receipt-scanner/collector.mjs');
 const h='a'.repeat(64),h2='b'.repeat(64),anchor='c'.repeat(64);
 const initial={network:'testnet',blocks:[],seen:{},scannedHeight:89};
 const b={height:90,hash:h,previousHash:anchor,receipts:[receipt]};
 const first=reconcileBatch(initial,{network:'testnet',tipHeight:90,tipHash:h,anchorHash:anchor,blocks:[b]},90,1000);
 assert.equal(first.caughtUp,true);
 const next=reconcileBatch(first,{network:'testnet',tipHeight:91,tipHash:h2,anchorHash:h,blocks:[{height:91,hash:h2,previousHash:h,receipts:[]}]},90,1001);
 const snap=snapshotFor(next,{id:order.invoiceId,recipient:order.recipient},2);
 assert.equal(snap.receipts.length,1);assert.equal(snap.receipts[0].receivedAt,1000);
 const fork=reconcileBatch(next,{network:'testnet',tipHeight:91,tipHash:h2,anchorHash:'d'.repeat(64),blocks:[{height:91,hash:h2,previousHash:'d'.repeat(64),receipts:[]}]},90,1002);
 assert.equal(fork.caughtUp,false);assert.equal(fork.scannedHeight,89);assert.equal(fork.blocks.length,0);
});

test('collector persists private state before publishing and resumes with a higher sequence',async()=>{
 const {mkdtemp,writeFile,readFile,stat,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {run}=await import('../receipt-scanner/collector.mjs');const directory=await mkdtemp(join(tmpdir(),'merchant-collector-'));
 const original=globalThis.fetch;
 try {
  const key=join(directory,'key'),token=join(directory,'token'),binary=join(directory,'scan'),state=join(directory,'state');
  await writeFile(key,'non-secret fixture key',{mode:0o600});await writeFile(token,'non-secret-test-token'.repeat(3),{mode:0o600});
  const batch={network:'testnet',tipHeight:90,tipHash:'a'.repeat(64),anchorHash:'b'.repeat(64),blocks:[{height:90,hash:'a'.repeat(64),previousHash:'b'.repeat(64),receipts:[{...receipt,blockHeight:90}]}]};
  await writeFile(binary,`#!${process.execPath}\nprocess.stdin.resume();process.stdin.on('end',()=>console.log(${JSON.stringify(JSON.stringify(batch))}));\n`,{mode:0o700});
  const published=[];globalThis.fetch=async(url,options)=>{
   assert.match(options.headers.Authorization,/^Bearer non-secret-test-token/);
   if(url.endsWith('/orders'))return Response.json({orders:[{...order,id:order.invoiceId}],next:null});
   const body=JSON.parse(options.body);const persisted=JSON.parse(await readFile(state,'utf8'));
   assert.equal(body.snapshot.sequence,persisted.sequence);assert.equal(body.snapshot.receipts.length,1);published.push(body);return Response.json({ok:true});
  };
  const config={network:'testnet',birthday:90,checkout:'https://zucchinifi.xyz/merchant-test',endpoint:'https://fixture.invalid',viewingKeyFile:key,tokenFile:token,binary,stateFile:state};
  await run(config,{once:true});await run(config,{once:true});
  assert.deepEqual(published.map(p=>p.snapshot.sequence),[1,2]);assert.equal(published[0].snapshot.receipts[0].receivedAt,published[1].snapshot.receipts[0].receivedAt);
  assert.equal((await stat(state)).mode&0o777,0o600);
  await writeFile(key,'changed fixture key',{mode:0o600});await assert.rejects(run(config,{once:true}),/identity changed/);
 }finally{globalThis.fetch=original;await rm(directory,{recursive:true,force:true});}
});
