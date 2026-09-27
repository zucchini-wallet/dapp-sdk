import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('..',import.meta.url));
const temp=mkdtempSync(join(tmpdir(),'scanner-package-'));
const destination=process.argv[2]?resolve(process.argv[2]):temp;
const run=(cmd,args,cwd=temp)=>execFileSync(cmd,args,{cwd,encoding:'utf8',stdio:['ignore','pipe','inherit']});
try {
 const [pack]=JSON.parse(run('npm',['pack','--ignore-scripts','--json','--pack-destination',destination],join(root,'receipt-scanner/sdk')));
 for(const file of pack.files)assert.ok(!/viewing-key|\.env|test\/|node_modules|target\//.test(file.path));
 writeFileSync(join(temp,'package.json'),'{"private":true,"type":"module"}');
 run('npm',['install','--ignore-scripts','--no-audit','--no-fund',join(destination,pack.filename)]);
 writeFileSync(join(temp,'consumer.mjs'),"import {createReceiptScanner} from '@zucchinifi/zcash-scanner'; if(typeof createReceiptScanner !== 'function')throw Error('Missing export');");
 run(process.execPath,['consumer.mjs']);
 writeFileSync(join(temp,'consumer.ts'),"import {createReceiptScanner,type ScanBatch} from '@zucchinifi/zcash-scanner'; const scanner=createReceiptScanner({binary:'/bin/scanner',viewingKeyFile:'/private/key',endpoint:'https://example.com',network:'testnet'}); const batch:Promise<ScanBatch>=scanner.scan({from:1,recipients:['receiver']}); void batch;");
 run(process.execPath,[join(root,'node_modules/typescript/bin/tsc'),'--noEmit','--strict','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2023','consumer.ts']);
 console.log(JSON.stringify({name:pack.name,version:pack.version,integrity:pack.integrity,tarball:join(destination,pack.filename),cleanInstall:true,types:true},null,2));
} finally {rmSync(temp,{recursive:true,force:true});}
