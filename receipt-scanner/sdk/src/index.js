import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const height = value => Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff;
const invalid = () => new Error('Invalid scanner response; no receipt has been verified.');
/** Validate native output before returning it to an application. */
function validate(batch, request) {
 if (!batch || batch.network !== request.network || !height(batch.tipHeight) || !hash(batch.tipHash) || !hash(batch.anchorHash) || !Array.isArray(batch.blocks) || batch.blocks.length > request.limit) throw invalid();
 const expectedLength = Math.max(0, Math.min(request.limit, batch.tipHeight - request.from + 1));
 if (batch.blocks.length !== expectedLength) throw invalid();
 let previous = batch.anchorHash;
 const seen = new Set();
 for (const [index, block] of batch.blocks.entries()) {
  if (block.height !== request.from + index || !hash(block.hash) || block.previousHash !== previous || !Array.isArray(block.receipts)) throw invalid();
  previous = block.hash;
  for (const receipt of block.receipts) {
   if (!hash(receipt.txid) || !['sapling','orchard','ironwood'].includes(receipt.pool) || !height(receipt.outputIndex) || receipt.blockHeight !== block.height || !request.recipients.includes(receipt.recipient) || typeof receipt.memo !== 'string' || Buffer.byteLength(receipt.memo) > 512 || typeof receipt.amountZatoshis !== 'string' || !/^(0|[1-9][0-9]{0,15})$/.test(receipt.amountZatoshis) || BigInt(receipt.amountZatoshis) > 2100000000000000n) throw invalid();
   const id = `${receipt.txid}/${receipt.pool}/${receipt.outputIndex}`;
   // Different encodings of the same receiver can alias one output. Never double-count it.
   if (seen.has(id)) throw invalid();
   seen.add(id);
  }
 }
 if ((batch.blocks.length === 0 && batch.anchorHash !== batch.tipHash)) throw invalid();
 if (batch.blocks.at(-1)?.height === batch.tipHeight && previous !== batch.tipHash) throw invalid();
 return batch;
}
/** Local, bounded scan. The binary receives a key FILE PATH, never inline key material. */
export function createReceiptScanner(config) {
 if (!config || !isAbsolute(config.binary ?? '') || !isAbsolute(config.viewingKeyFile ?? '') || !['mainnet','testnet'].includes(config.network)) throw new Error('Use absolute binary/key paths and an explicit network.');
 const endpoint = new URL(config.endpoint);
 if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash) throw new Error('Use an HTTPS lightwallet endpoint without embedded credentials.');
 const timeoutMs = config.timeoutMs ?? 100000;
 if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) throw new Error('Invalid scanner timeout.');
 const fixed = { binary: config.binary, viewingKeyFile: config.viewingKeyFile, endpoint: endpoint.href, network: config.network };
 return Object.freeze({
  async scan({from, limit = 100, recipients, signal} = {}) {
   if (!height(from) || from < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Array.isArray(recipients) || recipients.length < 1 || recipients.length > 100 || recipients.some(r => typeof r !== 'string' || !r || r.length > 2048) || new Set(recipients).size !== recipients.length) throw new Error('Invalid scan range or recipients.');
   signal?.throwIfAborted();
   const request = {endpoint: fixed.endpoint, network: fixed.network, viewingKeyFile: fixed.viewingKeyFile, from, limit, recipients: [...recipients]};
   return new Promise((resolve, reject) => {
    const child = spawn(fixed.binary, [], {stdio: ['pipe','pipe','pipe'], shell: false});
    let size = 0, chunks = [], failure;
    const stop = error => { failure ??= error; child.kill('SIGKILL'); };
    const abort = () => stop(new Error('Receipt scan cancelled.'));
    const timer = setTimeout(() => stop(new Error('Receipt scan timed out.')), timeoutMs);
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    signal?.addEventListener('abort', abort, {once: true});
    if (signal?.aborted) abort();
    child.stdout.on('data', data => { size += data.length; if (size > 4 * 1024 * 1024) stop(new Error('Scanner response exceeds the size limit.')); else chunks.push(data); });
    // Never expose child diagnostics: a failed scanner may include sensitive context.
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.once('error', () => {cleanup(); reject(new Error('Unable to start local receipt scanner.'));});
    child.once('close', code => {
     cleanup();
     if (failure) return reject(failure);
     if (code !== 0) return reject(new Error('Local receipt scan failed; no receipt has been verified.'));
     try {resolve(validate(JSON.parse(Buffer.concat(chunks).toString('utf8')), request));} catch {reject(invalid());}
    });
    child.stdin.end(JSON.stringify(request));
   });
  }
 });
}
