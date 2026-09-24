import { createOrderEngine } from './order-engine.mjs';
import receiver from './receiver.json' with {type:'json'};
import { signRegistry } from '@zucchinifi/merchant-payments/server';
import { strictJSON } from '@zucchinifi/merchant-payments';
const origin='https://zucchinifi.xyz',base='/merchant-test';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"};
const json=(data,status=200)=>Response.json(data,{status,headers});
let key;
async function signer(bytes){
 key??=crypto.subtle.importKey('pkcs8',Uint8Array.from(('302e020100300506032b657004220420'+'22'.repeat(32)).match(/../g),v=>parseInt(v,16)),{name:'Ed25519'},false,['sign']);
 return new Uint8Array(await crypto.subtle.sign('Ed25519',await key,bytes));
}
async function testingRegistry(){
 const issuedAt=Math.floor(Date.now()/3600000)*3600;
 const root=await crypto.subtle.importKey('pkcs8',Uint8Array.from(('302e020100300506032b657004220420'+'11'.repeat(32)).match(/../g),v=>parseInt(v,16)),{name:'Ed25519'},false,['sign']);
 return signRegistry({version:1,registryId:'zucchini-merchant-testing',sequence:issuedAt,issuedAt,expiresAt:issuedAt+86400,sourceCommit:'0b69276f031b2e3e615e11c8ff296442407513b5',merchants:[{version:1,id:'zucchini-test-merchant',name:'Zucchini test merchant',origins:[origin],status:'active',paymentKeys:[{kid:'test-only',algorithm:'Ed25519',publicKey:'oJql9HpnWYAv-VX43C0qFKXJnSO-l_hkEn_5ODRVpPA',networks:['testnet'],notBefore:1,expiresAt:issuedAt+86400}]}],revocations:[]},{kid:'test-release',sign:async bytes=>new Uint8Array(await crypto.subtle.sign('Ed25519',root,bytes))});
}
export class CheckoutOrder {
 constructor(ctx,env={}){this.env=env;this.ctx=ctx;this.orders=createOrderEngine({recipient:receiver.recipient,legacyRecipient:receiver.legacyRecipient,origin,sign:signer,storage:{read:()=>ctx.storage.get('order'),write:value=>ctx.storage.put('order',value)}});}
 async alarm(){
  if(!this.env.MERCHANT_WEBHOOK_URL||!this.env.MERCHANT_WEBHOOK_SECRET)return;
  const next=await this.orders.deliverWebhooks({endpoint:this.env.MERCHANT_WEBHOOK_URL,key:new TextEncoder().encode(this.env.MERCHANT_WEBHOOK_SECRET)});
  if(next!==null)await this.ctx.storage.setAlarm(Math.max(Date.now()+1000,next*1000));
 }
 async fetch(req){
  try{
   const path=new URL(req.url).pathname;
   if(path==='/index/register'){const {id,session}=await req.json();await this.ctx.storage.put(id,session);return json({ok:true});}
   if(path==='/index/watch'){const order=await req.json();await this.ctx.storage.put('watch:'+order.id,order);return json({ok:true});}
   if(path==='/index/orders'){const url=new URL(req.url),after=url.searchParams.get('after');const values=await this.ctx.storage.list({prefix:'watch:',limit:100,...(after?{startAfter:after}:{})});return json({orders:[...values.values()],next:values.size===100?[...values.keys()].at(-1):null});}
   if(path==='/index/find'){return json({session:await this.ctx.storage.get(new URL(req.url).searchParams.get('id'))});}
   if(path.endsWith('/receipt')){
    // Set the alarm first: a crash after durable receipt storage cannot strand an event.
    if(this.env.MERCHANT_WEBHOOK_URL&&this.env.MERCHANT_WEBHOOK_SECRET)await this.ctx.storage.setAlarm(Date.now()+1000);
    return json(await this.orders.receipt('order',await req.json()));
   }
   if(req.method==='GET')return json(await this.orders.get('order'));
   const input=strictJSON(await req.text(),2048);
   if(path.endsWith('/native-invoice'))return json(await this.orders.invoice('order',input,true));
   return json(path.endsWith('/invoice')?await this.orders.invoice('order',input):await this.orders.submitted('order',input));
  }catch{return json({error:'Checkout could not continue. Check wallet Activity before retrying.'},400);}
 }
}
export default {
 async fetch(req,env){
  const url=new URL(req.url);
  if(url.origin!==origin || (url.pathname!==base&&!url.pathname.startsWith(base+'/'))) return json({error:'Not found'},404);
  if(url.pathname===base)return Response.redirect(origin+base+'/',302);
  if(req.method==='GET'&&url.pathname===base+'/api/registry')return new Response(await testingRegistry(),{headers:{...headers,'Content-Type':'text/plain'}});
  if(url.pathname===base+'/internal/receipt'||url.pathname===base+'/internal/orders'){
   if(!env.RECEIPT_COLLECTOR_TOKEN)return json({error:'Receipt scanner not configured'},503);
   const token=req.headers.get('Authorization')?.replace(/^Bearer /,'')??'';
   const a=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)));
   const b=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(env.RECEIPT_COLLECTOR_TOKEN)));
   let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
   if(diff)return json({error:'Unauthorized'},401);
   if(url.pathname.endsWith('/orders')){
    if(req.method!=='GET')return json({error:'Method not allowed'},405);
    const after=url.searchParams.get('after')??'';
    if(after&&!/^watch:[a-zA-Z0-9_-]{1,128}$/.test(after))return json({error:'Invalid cursor'},400);
    return env.ORDERS.get(env.ORDERS.idFromName('receipt-index')).fetch(new Request('https://internal/index/orders?after='+encodeURIComponent(after)));
   }
   if(req.method!=='POST')return json({error:'Method not allowed'},405);
   const reader=req.body?.getReader();if(!reader)return json({error:'Empty snapshot'},400);
   const chunks=[];let length=0;
   for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>262144){await reader.cancel();return json({error:'Too large'},413);}chunks.push(value);}
   const body=await new Blob(chunks).text();
   let input;try{input=strictJSON(body,262144);}catch{return json({error:'Invalid snapshot'},400);}
   if(!input||typeof input!=='object'||Object.keys(input).sort().join(',')!=='orderId,snapshot'||!/^[a-zA-Z0-9_-]{1,128}$/.test(input.orderId??''))return json({error:'Invalid order'},400);
   const index=env.ORDERS.get(env.ORDERS.idFromName('receipt-index'));
   const {session}=await(await index.fetch(new Request('https://internal/index/find?id='+input.orderId))).json();
   if(!session)return json({error:'Unknown order'},404);
   return env.ORDERS.get(env.ORDERS.idFromName(session)).fetch(new Request('https://internal/receipt',{method:'POST',body:JSON.stringify(input.snapshot)}));
  }
  if(!url.pathname.startsWith(base+'/api/'))return env.ASSETS.fetch(req);
  const path=url.pathname.slice(base.length);
  if(!['/api/order','/api/invoice','/api/native-invoice','/api/submitted','/api/new-order'].includes(path))return json({error:'Not found'},404);
  if((path==='/api/order'&&req.method!=='GET')||(path!=='/api/order'&&req.method!=='POST'))return json({error:'Method not allowed'},405);
  if(req.method==='POST'&&(req.headers.get('Origin')!==origin||!req.headers.get('Content-Type')?.startsWith('application/json')))return json({error:'Request not allowed'},403);
  let session=req.headers.get('Cookie')?.match(/(?:^|;\s*)zucchini_demo=([a-f0-9]{64})(?:;|$)/)?.[1];
  let cookie;
  if(path==='/api/new-order'){
   const fresh=Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
   const response=json({ok:true});
   response.headers.set('Set-Cookie',`zucchini_demo=${fresh}; Path=${base}; HttpOnly; Secure; SameSite=Strict`);
   return response;
  }
  if(!session){
   if(req.method!=='GET')return json({error:'Open checkout first'},403);
   session=Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
   cookie=`zucchini_demo=${session}; Path=${base}; HttpOnly; Secure; SameSite=Strict`;
  }
  let body;
  if(req.method==='POST'){
   const reader=req.body?.getReader();let bytes=0;const chunks=[];
   if(!reader)return json({error:'Empty request'},400);
   for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>2048){await reader.cancel();return json({error:'Request too large'},413);}chunks.push(value);}
   body=await new Blob(chunks).text();
  }
  const stub=env.ORDERS.get(env.ORDERS.idFromName(session));
  const response=await stub.fetch(new Request(req.url,{method:req.method,...(body===undefined?{}:{body})}));
  if(path==='/api/order'&&response.ok){
   const order=await response.clone().json();
   await env.ORDERS.get(env.ORDERS.idFromName('receipt-index')).fetch(new Request('https://internal/index/register',{method:'POST',body:JSON.stringify({id:order.id,session})}));
  }
  if(response.ok && ['/api/invoice','/api/native-invoice','/api/order'].includes(path)){
   const order=path==='/api/order'?await response.clone().json():await(await stub.fetch(new Request('https://internal/api/order'))).json();
   if(order.expiresAt)await env.ORDERS.get(env.ORDERS.idFromName('receipt-index')).fetch(new Request('https://internal/index/watch',{method:'POST',body:JSON.stringify({id:order.id,recipient:order.recipient,network:order.network,amountZatoshis:'100000',expiresAt:order.expiresAt})}));
  }
  const result=new Response(response.body,response);if(cookie)result.headers.set('Set-Cookie',cookie);return result;
 }
};
