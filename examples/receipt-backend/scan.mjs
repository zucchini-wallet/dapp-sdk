import {readFile} from 'node:fs/promises';
import {createReceiptScanner} from '../../receipt-scanner/sdk/src/index.js';
const config=JSON.parse(await readFile(process.argv[2],'utf8'));
const {from,recipients,...options}=config;
const batch=await createReceiptScanner(options).scan({from,recipients});
// Only aggregate diagnostics go to stdout; no keys, addresses or memos.
console.log(JSON.stringify({network:batch.network,tipHeight:batch.tipHeight,scannedHeight:batch.blocks.at(-1)?.height??from-1,receiptCount:batch.blocks.reduce((n,b)=>n+b.receipts.length,0)},null,2));
