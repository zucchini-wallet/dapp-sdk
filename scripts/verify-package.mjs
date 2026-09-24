// Exercise the actual npm artifact in an unrelated consumer directory.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve(new URL('..', import.meta.url).pathname);
const destination = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), 'zucchini-sdk-pack-'));
const consumer = mkdtempSync(join(tmpdir(), 'zucchini-sdk-consumer-'));
function run(binary, args, cwd) { return execFileSync(binary, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }); }
try {
 const [pack] = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', destination], root));
 assert.equal(pack.name, '@zucchinifi/dapp-sdk');
 for (const file of pack.files) {
  assert.ok(!/(^|\/)(\.env|\.npmrc|.*\.viewing-key|.*\.pem|.*\.key|.*\.map)$/.test(file.path), `Private/unnecessary file in package: ${file.path}`);
  assert.ok(!file.path.startsWith('examples/'), 'Reference service must not be bundled into the browser SDK');
 }
 assert.ok(pack.files.some(f => f.path.includes('node_modules/@zucchinifi/merchant-payments/src/index.js')), 'Missing bundled protocol');
 writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
 run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', join(destination, pack.filename)], consumer);
 const metadata = JSON.parse(readFileSync(join(root, 'package.json')));
 writeFileSync(join(consumer, 'verify.mjs'), `import assert from 'node:assert/strict';
${Object.keys(metadata.exports).map((entry, i) => `import * as entry${i} from '${metadata.name}${entry === '.' ? '' : entry.slice(1)}'; assert.ok(Object.keys(entry${i}).length > 0);`).join('\n')}
import { discoverZucchiniProvider, createZucchiniClient } from '@zucchinifi/dapp-sdk/zcash';
assert.equal(discoverZucchiniProvider(), undefined); // SSR must not need a window.
const calls = []; const provider = {connect: async permissions => { calls.push('connect'); return { connected: true, approvedPermissions: permissions, accounts: [] }; }, disconnect: async () => {}, request: async request => { calls.push(request.method); return 'a'.repeat(64); }};
const wallet = createZucchiniClient(provider); await wallet.connect({permissions:['send_transaction']}); assert.deepEqual(calls, ['connect']);
assert.equal((await wallet.requestPayment('zcash:receiver?amount=0.001')).txid, 'a'.repeat(64)); assert.deepEqual(calls, ['connect', 'zcash_requestPayment']);
`);
 run(process.execPath, ['verify.mjs'], consumer);
 writeFileSync(join(consumer, 'verify.ts'), `import { createZucchiniClient, type ZucchiniProvider } from '@zucchinifi/dapp-sdk/zcash';
import { invoiceMemo } from '@zucchinifi/dapp-sdk/merchant/server';
declare const provider: ZucchiniProvider;
const client = createZucchiniClient(provider);
const result: Promise<{txid: string}> = client.requestPayment('zcash:receiver?amount=0.001');
invoiceMemo('order-id'); void result;
`);
 run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2023', 'verify.ts'], consumer);
 console.log(JSON.stringify({package: pack.name, version: pack.version, tarball: join(destination, pack.filename), integrity: pack.integrity, cleanInstall: true, imports: Object.keys(metadata.exports), types: true}, null, 2));
} finally { rmSync(consumer, {recursive: true, force: true}); }
