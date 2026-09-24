import {readFile,writeFile,rename,mkdir,open,lstat,unlink} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const now=()=>Math.floor(Date.now()/1000);
export function reconcileBatch(state,batch,birthday,observedAt=now()) {
 if(batch.network!==state.network||!Number.isSafeInteger(batch.tipHeight)||batch.tipHeight<0||!Array.isArray(batch.blocks)||batch.blocks.length>100)throw Error('Invalid scan result');
 const start=batch.blocks[0]?.height??state.scannedHeight+1;
 const previous=state.blocks.find(b=>b.height===start-1);
 if(previous&&previous.hash!==batch.anchorHash)return {...state,blocks:[],scannedHeight:birthday-1,tipHeight:batch.tipHeight,tipHash:batch.tipHash,caughtUp:false};
 const blocks=state.blocks.filter(b=>b.height<start);
 let height=start,hash=batch.anchorHash;
 for(const block of batch.blocks){
  if(block.height!==height++||block.previousHash!==hash||!/^[a-f0-9]{64}$/.test(block.hash)||!Array.isArray(block.receipts))throw Error('Invalid block sequence');
  hash=block.hash;blocks.push(block);
 }
 const scanned=blocks.at(-1)?.height??birthday-1;
 if(scanned>batch.tipHeight||(scanned===batch.tipHeight&&hash!==batch.tipHash))throw Error('Inconsistent scan tip');
 const seen={...state.seen};
 for(const block of blocks)for(const receipt of block.receipts){
  const key=`${receipt.txid}/${receipt.pool}/${receipt.outputIndex}`;
  seen[key]??=observedAt;
 }
 return {...state,blocks,seen,scannedHeight:scanned,tipHeight:batch.tipHeight,tipHash:batch.tipHash,caughtUp:scanned===batch.tipHeight,observedAt};
}
export function snapshotFor(state,order,sequence){
 return {version:1,sequence,network:state.network,observedAt:state.observedAt,tipHeight:state.tipHeight,tipHash:state.tipHash,scannedHeight:state.scannedHeight,
 receipts:state.blocks.flatMap(b=>b.receipts).filter(r=>r.recipient===order.recipient&&r.memo===`zucchini:${order.id}`).map(r=>({...r,receivedAt:state.seen[`${r.txid}/${r.pool}/${r.outputIndex}`]}))};
}
async function privateFile(path,max){const stat=await lstat(path);if(!stat.isFile()||(stat.mode&0o077)||stat.size>max)throw Error('Sensitive file must be a regular file with mode 600');return readFile(path,'utf8');}
async function save(path,value){await mkdir(dirname(path),{recursive:true,mode:0o700});const temp=path+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value),{mode:0o600,flag:'wx',flush:true});await rename(temp,path);const directory=await open(dirname(path),'r');try{await directory.sync();}finally{await directory.close();}}
async function request(config,token,path,body){
 const response=await fetch(config.checkout+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error(`Collector HTTP ${response.status}`);
 const reader=response.body.getReader();let size=0;const chunks=[];
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024){await reader.cancel();throw Error('Collector response too large');}chunks.push(value);}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function scan(config,state,recipients){
 return new Promise((resolve,reject)=>{
  const child=spawn(config.binary,[],{stdio:['pipe','pipe','pipe'],timeout:100000});let stdout='',stderr='';
  child.stdout.on('data',data=>{stdout+=data;if(stdout.length>4*1024*1024)child.kill();});child.stderr.on('data',data=>{if(stderr.length<1000)stderr+=data;});
  child.once('error',reject);child.once('close',code=>{if(code!==0)return reject(Error('Local receipt scan failed; no status confirmed.'));try{resolve(JSON.parse(stdout));}catch(e){reject(e);}});
  child.stdin.on('error',()=>{});
  child.stdin.end(JSON.stringify({endpoint:config.endpoint,network:config.network,viewingKeyFile:config.viewingKeyFile,from:Math.max(config.birthday,state.scannedHeight-(state.caughtUp?20:0)+1),limit:100,recipients}));
 });
}
export async function run(config,{once=false}={}){
 if(!['testnet','mainnet'].includes(config.network)||!Number.isSafeInteger(config.birthday)||config.birthday<1||config.checkout!=='https://zucchinifi.xyz/merchant-test'||config.network!=='testnet')throw Error('This collector deployment supports the testnet demo only');
 const token=(await privateFile(config.tokenFile,4096)).trim();if(token.length<32)throw Error('Collector token too short');
 const keyFingerprint=createHash('sha256').update((await privateFile(config.viewingKeyFile,8192)).trim()).digest('hex');
 await mkdir(dirname(config.stateFile),{recursive:true,mode:0o700});
 const lock=await open(config.stateFile+'.lock','wx',0o600);await lock.writeFile(String(process.pid));
 try{
  let state;try{state=JSON.parse(await privateFile(config.stateFile,100*1024*1024));}catch(e){if(e.code!=='ENOENT')throw e;state={keyFingerprint,network:config.network,birthday:config.birthday,endpoint:config.endpoint,viewingKeyFile:config.viewingKeyFile,scannedHeight:config.birthday-1,blocks:[],seen:{},sequence:0};}
  if(state.keyFingerprint!==keyFingerprint||state.network!==config.network||state.birthday!==config.birthday||state.endpoint!==config.endpoint||state.viewingKeyFile!==config.viewingKeyFile)throw Error('Scanner identity changed; use a separate state file');
  do{
   let delay=15000;
   try{
    let orders=[],cursor='';do{const page=await request(config,token,'/internal/orders'+(cursor?'?after='+encodeURIComponent(cursor):''));orders.push(...page.orders);cursor=page.next;if(orders.length>1000)throw Error('Collector order limit reached');}while(cursor);
    // An explicitly scoped collector must not attempt to scan historical wallets.
    if(config.recipients) orders=orders.filter(o=>config.recipients.includes(o.recipient));
    const recipients=[...new Set(orders.map(o=>o.recipient))];if(recipients.length>100)throw Error('Too many recipient addresses');
    if(recipients.length){
     if((state.recipients??[]).length&&recipients.some(r=>!state.recipients.includes(r))){state.blocks=[];state.scannedHeight=config.birthday-1;state.caughtUp=false;}
     state.recipients=recipients;
     const batch=await scan(config,state,recipients);
     const watched=new Set(orders.map(o=>JSON.stringify([o.recipient,`zucchini:${o.id}`])));
     const keep=r=>watched.has(JSON.stringify([r.recipient,r.memo]));
     for(const block of batch.blocks)block.receipts=block.receipts.filter(keep);
     for(const block of state.blocks)block.receipts=block.receipts.filter(keep);
     state=reconcileBatch(state,batch,config.birthday);state.sequence+=1;
     await save(config.stateFile,state); // Persist sequence and first-seen times before any external write.
     for(const order of orders){if(order.network!==config.network)throw Error('Order network mismatch');await request(config,token,'/internal/receipt',{orderId:order.id,snapshot:snapshotFor(state,order,state.sequence)});}
     console.log(`Scanned ${state.scannedHeight}/${state.tipHeight}; ${orders.length} order statuses reconciled.`);if(!state.caughtUp)delay=1000;
    }else console.log('No issued invoices to watch.');
   }catch(e){console.error(e.message);delay=60000;if(once)throw e;}
   if(!once)await new Promise(r=>setTimeout(r,delay));
  }while(!once);
 }finally{await lock.close();await unlink(config.stateFile+'.lock');}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const config=JSON.parse(await readFile(process.argv[2],'utf8'));await run(config,{once:process.argv.includes('--once')});}catch(e){console.error(e.message);process.exitCode=1;}
}
