import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createReceiptScanner} from '../src/index.js';
const h = 'a'.repeat(64), p = 'b'.repeat(64);
const batch = {network:'testnet',tipHeight:2,tipHash:h,anchorHash:p,blocks:[{height:2,hash:h,previousHash:p,receipts:[]}]};
function fixture(t, code, options={}) {
 const dir=mkdtempSync(join(tmpdir(),'scanner-sdk-'));
 const binary=join(dir,'scanner.mjs');
 writeFileSync(binary, `#!${process.execPath}\n${code}`, {mode:0o700});
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 return createReceiptScanner({binary,viewingKeyFile:join(dir,'key'),endpoint:'https://example.com',network:'testnet',...options});
}
const req={from:2,recipients:['receiver']};
test('sends only configured file path over stdin and validates batch',async t=>{
 const scanner=fixture(t,`let s='';for await(const c of process.stdin)s+=c;const q=JSON.parse(s);if(q.from!==2||q.limit!==100||q.viewingKey||!q.viewingKeyFile)process.exit(1);console.log(${JSON.stringify(JSON.stringify(batch))});`);
 assert.deepEqual(await scanner.scan(req),batch);
});
test('rejects wrong network, discontinuity, incomplete range and tip mismatch',async t=>{
 for(const broken of [{...batch,network:'mainnet'},{...batch,blocks:[]},{...batch,anchorHash:h},{...batch,tipHash:p}]) {
  const scanner=fixture(t,`console.log(${JSON.stringify(JSON.stringify(broken))})`);
  await assert.rejects(scanner.scan(req),/Invalid scanner response/);
 }
});
test('rejects unrequested recipients and duplicate outputs',async t=>{
 const r={txid:h,pool:'orchard',outputIndex:0,recipient:'receiver',amountZatoshis:'100',memo:'order',blockHeight:2};
 for(const receipts of [[{...r,recipient:'other'}],[r,r]]){
  const b={...batch,blocks:[{...batch.blocks[0],receipts}]};
  await assert.rejects(fixture(t,`console.log(${JSON.stringify(JSON.stringify(b))})`).scan(req));
 }
});
test('does not leak stderr and handles invalid JSON',async t=>{
 await assert.rejects(fixture(t,`console.error('SECRET');process.exit(1)`).scan(req),e=>!e.message.includes('SECRET'));
 await assert.rejects(fixture(t,`console.log('broken')`).scan(req),/Invalid scanner response/);
});
test('bounds output and execution time',async t=>{
 await assert.rejects(fixture(t,`process.stdout.write('x'.repeat(5*1024*1024))`).scan(req),/size limit/);
 await assert.rejects(fixture(t,`setInterval(()=>{},1000)`,{timeoutMs:50}).scan(req),/timed out/);
});
test('supports cancellation and rejects unsafe configuration before launch',async t=>{
 const controller=new AbortController();
 const promise=fixture(t,`setInterval(()=>{},1000)`).scan({...req,signal:controller.signal});
 controller.abort();await assert.rejects(promise,/cancelled/);
 assert.throws(()=>createReceiptScanner({binary:'relative',viewingKeyFile:'/key',network:'testnet'}));
 await assert.rejects(fixture(t,'process.exit(1)').scan({...req,from:0}),/Invalid scan range/);
});
test('returns a valid receipt and allows a consistent caught-up empty range',async t=>{
 const r={txid:h,pool:'orchard',outputIndex:0,recipient:'receiver',amountZatoshis:'100000',memo:'zucchini:order',blockHeight:2};
 const b={...batch,blocks:[{...batch.blocks[0],receipts:[r]}]};
 assert.deepEqual((await fixture(t,`console.log(${JSON.stringify(JSON.stringify(b))})`).scan(req)).blocks[0].receipts,[r]);
 const empty={...batch,anchorHash:h,blocks:[]};
 assert.deepEqual(await fixture(t,`console.log(${JSON.stringify(JSON.stringify(empty))})`).scan({...req,from:3}),empty);
});
