import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createPrivateKey, randomBytes, sign } from 'node:crypto';
import { resolve } from 'node:path';
import { strictJSON } from '@zucchinifi/merchant-payments';
import { createOrders } from './orders.mjs';
const origin='https://zucchinifi.xyz';
const recipient=process.env.MERCHANT_TEST_RECEIVER;
if(!/^(utest1|ztestsapling1)[a-z0-9]{40,1000}$/.test(recipient??'')) throw new Error('Set MERCHANT_TEST_RECEIVER to a shielded address copied from your testnet wallet.');
const port=Number(process.env.PORT??4319);
// Public TEST key, deliberately matching the testing extension. Never production.
const key=createPrivateKey({key:Buffer.from('302e020100300506032b657004220420'+'22'.repeat(32),'hex'),format:'der',type:'pkcs8'});
const orders=createOrders({file:resolve(process.env.MERCHANT_ORDER_FILE??'/tmp/zucchini-test-checkout/orders.json'),recipient,origin,sign:async bytes=>new Uint8Array(sign(null,bytes,key))});
const base='/merchant-test';
const files=new Map([['/','index.html'],['/app.js','app.js'],['/style.css','style.css']]);
createServer(async(req,res)=>{
 const send=(status,data,type='application/json')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"});res.end(typeof data==='string'?data:JSON.stringify(data));};
 try {
  const url=new URL(req.url,'http://localhost');
  if(!url.pathname.startsWith(base)) return send(404,{});
  const path=url.pathname.slice(base.length)||'/';
  if(req.method==='GET' && files.has(path)) return send(200,(await readFile(new URL(files.get(path),import.meta.url),'utf8')).replace('id="native"','id="native" hidden'),path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');
  if(req.method==='GET' && path==='/sdk.js') {
   const sdk=await readFile(new URL('../../dist/merchant.js',import.meta.url),'utf8');
   // This page uses only the bridge client, not the standalone verifier re-export.
   return send(200,sdk.replace(/^export \{.*\} from '@zucchinifi\/merchant-payments';\n/m,''),'text/javascript');
  }
  let session=req.headers.cookie?.match(/(?:^|;\s*)zucchini_demo=([a-f0-9]{64})(?:;|$)/)?.[1];
  if(req.method==='GET' && path==='/api/order') {
   if(!session) {session=randomBytes(32).toString('hex');res.setHeader('Set-Cookie',`zucchini_demo=${session}; Path=${base}; HttpOnly; Secure; SameSite=Strict`);}
   return send(200,await orders.get(session));
  }
  if(req.method!=='POST'|| !session || req.headers.origin!==origin || !['/api/invoice','/api/submitted'].includes(path)) return send(403,{error:'Request not allowed.'});
  let body='';for await(const chunk of req){body+=chunk;if(body.length>2048)return send(413,{error:'Request too large.'});}
  const input=strictJSON(body,2048);
  return send(200,path==='/api/invoice'?await orders.invoice(session,input):await orders.submitted(session,input));
 }catch(e){return send(400,{error:e.message==='Invalid checkout request.'?e.message:'Checkout could not continue. Check wallet Activity before retrying.'});}
}).listen(port,'127.0.0.1',()=>console.log(`Test checkout on loopback port ${port}; proxy ${origin}${base}/ here. No production keys.`));
