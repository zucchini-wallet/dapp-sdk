/** Server-only reconciliation of receipts observed by a merchant-controlled scanner.
 * Customer-supplied txids and explorer responses are never receipt evidence. */
export interface ReceiptOrder { invoiceId: string; network: 'testnet' | 'mainnet'; recipient: string; amountZatoshis: string; expiresAt: number }
export interface ObservedReceipt {
 txid: string; pool: 'sapling' | 'orchard' | 'ironwood'; outputIndex: number;
 recipient: string; amountZatoshis: string; memo: string;
 receivedAt: number; blockHeight: number | null;
}
export interface ReceiptSnapshot {
 version: 1; sequence: number; network: 'testnet' | 'mainnet'; observedAt: number;
 tipHeight: number; tipHash: string; scannedHeight: number;
 /** Complete current canonical receipt set for this invoice, including spent receipts. */
 receipts: ObservedReceipt[];
}
export interface ReceiptStatus {
 state: 'awaiting_payment' | 'detected' | 'confirming' | 'paid' | 'underpaid' | 'overpaid' | 'late_payment' | 'expired' | 'reorg_review' | 'verification_unavailable';
 receivedZatoshis: string; confirmedZatoshis: string; confirmations: number;
 requiredConfirmations: number; canFulfill: boolean;
}
const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;
const amount = (s: string) => typeof s === 'string' && /^(0|[1-9][0-9]{0,15})$/.test(s) && BigInt(s) <= 2100000000000000n;
export function invoiceMemo(invoiceId: string): string {
 if (!/^[A-Za-z0-9_-]{1,128}$/.test(invoiceId)) throw new Error('Invalid invoice ID');
 return `zucchini:${invoiceId}`;
}
export function reconcileMerchantReceipts(order: ReceiptOrder, snapshot: ReceiptSnapshot | undefined, options: {now?:number; requiredConfirmations?:number; previouslyPaid?:boolean} = {}): ReceiptStatus {
 const now=options.now??Math.floor(Date.now()/1000), required=options.requiredConfirmations??10;
 if(!['testnet','mainnet'].includes(order.network)||typeof order.recipient!=='string'||!order.recipient||!integer(now)||!integer(required)||required<1||required>100||!amount(order.amountZatoshis)||BigInt(order.amountZatoshis)===0n||!integer(order.expiresAt))throw new Error('Invalid receipt policy');
 const base={receivedZatoshis:'0',confirmedZatoshis:'0',confirmations:0,requiredConfirmations:required,canFulfill:false};
 if(!snapshot)return {...base,state:'verification_unavailable'};
 if(snapshot.version!==1||!integer(snapshot.sequence)||!integer(snapshot.observedAt)||!integer(snapshot.tipHeight)||!integer(snapshot.scannedHeight)||snapshot.network!==order.network||! /^[a-f0-9]{64}$/i.test(snapshot.tipHash)||!Array.isArray(snapshot.receipts)||snapshot.receipts.length>1000)throw new Error('Invalid scanner snapshot');
 if(snapshot.observedAt>now+30||now-snapshot.observedAt>120||snapshot.scannedHeight!==snapshot.tipHeight)return {...base,state:'verification_unavailable'};
 const seen=new Map<string,string>();let received=0n,confirmed=0n,confirmations=Number.MAX_SAFE_INTEGER,late=false;
 for(const receipt of snapshot.receipts){
  if(!/^[a-f0-9]{64}$/i.test(receipt.txid)||!['sapling','orchard','ironwood'].includes(receipt.pool)||!integer(receipt.outputIndex)||!amount(receipt.amountZatoshis)||!integer(receipt.receivedAt)||receipt.receivedAt>snapshot.observedAt+30||!(receipt.blockHeight===null||(integer(receipt.blockHeight)&&receipt.blockHeight<=snapshot.tipHeight)))throw new Error('Invalid observed receipt');
  const id=`${receipt.txid.toLowerCase()}/${receipt.pool}/${receipt.outputIndex}`,bytes=JSON.stringify(receipt);
  if(seen.has(id)){if(seen.get(id)!==bytes)throw new Error('Conflicting output observations');continue;}seen.set(id,bytes);
  if(receipt.recipient!==order.recipient||receipt.memo!==invoiceMemo(order.invoiceId))continue;
  const n=BigInt(receipt.amountZatoshis);if(n===0n)continue;
  const depth=receipt.blockHeight===null?0:snapshot.tipHeight-receipt.blockHeight+1;
  received+=n;if(depth>=required)confirmed+=n;confirmations=Math.min(confirmations,depth);
  if(receipt.receivedAt>order.expiresAt)late=true;
 }
 const expected=BigInt(order.amountZatoshis);
 let state:ReceiptStatus['state']=received===0n?(now>order.expiresAt?'expired':'awaiting_payment'):late?'late_payment':received>expected?'overpaid':received<expected?'underpaid':confirmed>=expected?'paid':confirmations===0?'detected':'confirming';
 if(options.previouslyPaid&&state!=='paid')state='reorg_review';
 return {state,receivedZatoshis:received.toString(),confirmedZatoshis:confirmed.toString(),confirmations:confirmations===Number.MAX_SAFE_INTEGER?0:confirmations,requiredConfirmations:required,canFulfill:state==='paid'};
}
/** Authenticate exact webhook bytes. Consumers must also enforce event-id deduplication. */
export async function signReceiptWebhook(body: string, key: Uint8Array, timestamp=Math.floor(Date.now()/1000)): Promise<string> {
 if(key.byteLength<32||!integer(timestamp))throw new Error('Invalid webhook signing configuration');
 const imported=await crypto.subtle.importKey('raw',new Uint8Array(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=new Uint8Array(await crypto.subtle.sign('HMAC',imported,new TextEncoder().encode(`${timestamp}.${body}`)));
 return `t=${timestamp},v1=${Array.from(signature,b=>b.toString(16).padStart(2,'0')).join('')}`;
}
export async function verifyReceiptWebhook(body: string, header:string,key:Uint8Array,now=Math.floor(Date.now()/1000)):Promise<boolean>{
 const match=/^t=([0-9]{1,12}),v1=([a-f0-9]{64})$/.exec(header);
 if(!integer(now)||!match||key.byteLength<32||Math.abs(now-Number(match[1]))>300)return false;
 const imported=await crypto.subtle.importKey('raw',new Uint8Array(key),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 const signature=Uint8Array.from(match[2]!.match(/../g)!,v=>parseInt(v,16));
 return crypto.subtle.verify('HMAC',imported,signature,new TextEncoder().encode(`${match[1]}.${body}`));
}
