import { signInvoice, invoiceMemo, reconcileMerchantReceipts, createReceiptWebhookEvent, deliverReceiptWebhook } from '../../dist/merchant-server.js';
export function createOrderEngine({ storage, recipient, legacyRecipient = recipient, origin, sign, now = () => Math.floor(Date.now()/1000) }) {
 const amount = '0.001';
 let queue = Promise.resolve();
 async function transact(fn) {
  const run = queue.then(async () => {
   const records = await storage.read() ?? {};
   // Preserve recipients of records created before per-order address snapshots.
   for (const record of Object.values(records)) record.recipient ??= legacyRecipient;
   const result = await fn(records);
   await storage.write(records);
   return result;
  }); queue = run.catch(()=>{}); return run;
 }
 const publicOrder = r => ({ id:r.id, amount, recipient:r.recipient, network:'testnet', state:r.txid?'submitted':r.invoice?'invoice_issued':'created', txid:r.txid, expiresAt:r.expiresAt,
  receipt: r.invoice ? reconcileMerchantReceipts({invoiceId:r.id,network:'testnet',recipient:r.recipient,amountZatoshis:'100000',expiresAt:r.expiresAt},r.snapshot,{now:now(),previouslyPaid:r.everPaid}) : undefined });
 return {
  async get(session) { return transact(records => {
   if (!records[session]) {
    if(Object.keys(records).length >= 1000) throw new Error('Demo order limit reached.');
    records[session] = {id:crypto.randomUUID(),recipient};
   }
   return publicOrder(records[session]);
  }); },
  async invoice(session,input,native=false) { return transact(async records => {
   const r=records[session];
   if(!r || !input || Object.keys(input).sort().join(',') !== (native?'orderId':'challenge,orderId') || input.orderId !== r.id || (!native&&!/^[A-Za-z0-9_-]{43}$/.test(input.challenge))) throw new Error('Invalid checkout request.');
   if(r.txid) throw new Error('This order already has a submitted transaction.');
   if(r.invoice) {
    if(r.challenge !== input.challenge || r.expiresAt <= now()) throw new Error('This order already has an invoice. Check wallet Activity before any further payment.');
    return {invoice:r.invoice};
   }
   const issuedAt=now();
   const payload={version:1,registryId:'zucchini-merchant-testing',merchantId:'zucchini-test-merchant',kid:'test-only',origin,network:'testnet',invoiceId:r.id,issuedAt,expiresAt:issuedAt+240,paymentUri:`zcash:${r.recipient}?amount=${amount}&memo=${btoa(invoiceMemo(r.id)).replaceAll("+","-").replaceAll("/","_").replaceAll("=","")}`,...(native?{}:{challenge:input.challenge})};
   // The operator provisions an address copied from their test wallet; clients
   // cannot choose an address. The paying wallet also fully decodes this address.
   r.invoice=await signInvoice(payload,{sign,validateAddress:(address,network)=>address===r.recipient&&network==='testnet'?{network,shielded:true}:null});
   r.challenge=input.challenge;r.expiresAt=payload.expiresAt;
   return {invoice:r.invoice};
  }); },
  async receipt(session,snapshot) { return transact(records => {
   const r=records[session];if(!r?.invoice)throw new Error('Invoice unavailable');
   if(r.snapshot && snapshot.sequence<=r.snapshot.sequence)throw new Error('Stale scanner sequence');
   const receipt=reconcileMerchantReceipts({invoiceId:r.id,network:'testnet',recipient:r.recipient,amountZatoshis:'100000',expiresAt:r.expiresAt},snapshot,{now:now(),previouslyPaid:r.everPaid});
   const previous = r.snapshot ? publicOrder(r).receipt : undefined;
   if(!previous || previous.state !== receipt.state || previous.canFulfill !== receipt.canFulfill || previous.receivedZatoshis !== receipt.receivedZatoshis) {
    r.outbox ??= [];
    if(r.outbox.filter(e=>e.deliveredAt===undefined).length >= 100)throw new Error('Webhook outbox requires operator attention');
    r.outbox=r.outbox.filter(e=>e.deliveredAt===undefined);
    r.outbox.push(createReceiptWebhookEvent(r.id,receipt,now(),snapshot.sequence));
   }
   r.snapshot=snapshot;r.everPaid=r.everPaid||receipt.canFulfill;
   return publicOrder(r);
  }); },
  async deliverWebhooks(config) {
   const events=await transact(records=>Object.values(records).flatMap(r=>(r.outbox??[]).filter(e=>e.deliveredAt===undefined&&e.failedAt===undefined&&e.nextAttemptAt<=now())));
   for(const event of events){
    const updated=await deliverReceiptWebhook(event,{...config,now:now()});
    await transact(records=>{for(const r of Object.values(records)){const index=r.outbox?.findIndex(e=>e.id===event.id);if(index!==undefined&&index>=0&&r.outbox[index].attempts===event.attempts)r.outbox[index]=updated;}});
   }
   return transact(records=>{const pending=Object.values(records).flatMap(r=>(r.outbox??[]).filter(e=>e.deliveredAt===undefined&&e.failedAt===undefined));return pending.length?Math.min(...pending.map(e=>e.nextAttemptAt)):null;});
  },
  async submitted(session,input) { return transact(records => {
   const r=records[session];
   if(!r?.invoice || !input || Object.keys(input).sort().join(',')!=='orderId,txid' || input.orderId!==r.id || !/^[a-f0-9]{64}$/i.test(input.txid) || (r.txid && r.txid!==input.txid)) throw new Error('Invalid submission report.');
   r.txid=input.txid;return publicOrder(r);
  }); }
 };
}
