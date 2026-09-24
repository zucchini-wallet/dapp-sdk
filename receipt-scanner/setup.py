#!/usr/bin/env python3
"""Interactive local setup. Never put a password/viewing key in chat or CLI arguments."""
import argparse, getpass, json, os, pathlib, secrets, shlex, subprocess
root=pathlib.Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description='Prepare the testnet merchant viewing-only collector locally.')
p.add_argument('--viewing-key',required=True,help='Incoming viewing-key file exported by your existing Zucchini wallet')
p.add_argument('--scanner',default=str(root/'receipt-scanner/target/release/zucchini-merchant-receipt-scanner'))
p.add_argument('--birthday',type=int,help='First block to scan; default is 1,000 blocks before the current testnet tip')
p.add_argument('--install-worker-secret',action='store_true',help='Provision the new collector token on the testing checkout Worker')
a=p.parse_args()
if a.birthday is not None and a.birthday<1: p.error('birthday must be positive')
scanner=pathlib.Path(a.scanner).expanduser().resolve()
if not scanner.is_file(): raise SystemExit('Build the scanner first; see receipt-scanner/README.md.')
if a.birthday is None:
 a.birthday=max(1,int(subprocess.check_output([str(scanner),'--testnet-tip'],text=True).strip())-1000)
 print('Starting at testnet block',a.birthday,'(recent 1,000 blocks). Earlier payments require a separate historical review.')
local=root/'receipt-scanner/local';local.mkdir(mode=0o700,exist_ok=True)
if local.is_symlink() or local.stat().st_mode&0o077: raise SystemExit('Local collector directory must have mode 700.')
key=local/'merchant.viewing-key';token_file=local/'collector-token';config_file=local/'config.json'
if key.exists() or token_file.exists() or config_file.exists(): raise SystemExit('Setup files already exist. Preserve them; follow the resume instructions rather than overwriting credentials.')
source=pathlib.Path(a.viewing_key).expanduser()
if source.is_symlink() or not source.is_file() or source.stat().st_size>8192: raise SystemExit('Choose a regular incoming viewing-key file smaller than 8 KB.')
encoded=source.read_text().strip()
if not encoded.startswith('uivktest1'): raise SystemExit('The demo requires a testnet incoming viewing key.')
fd=os.open(key,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:f.write(encoded)
del encoded
token=secrets.token_urlsafe(48)
fd=os.open(token_file,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:f.write(token)
config={'network':'testnet','endpoint':'https://testnet.zec.rocks:443','birthday':a.birthday,'viewingKeyFile':str(key),'tokenFile':str(token_file),'stateFile':str(local/'state.json'),'binary':str(scanner),'checkout':'https://zucchinifi.xyz/merchant-test'}
fd=os.open(config_file,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:json.dump(config,f,indent=2)
if a.install_worker_secret:
 subprocess.run(['wrangler','secret','put','RECEIPT_COLLECTOR_TOKEN','--config',str(root/'examples/wallet-checkout/wrangler.jsonc')],input=token.encode(),cwd=root,check=True)
else:print('Collector secret was not installed; the hosted endpoint remains disabled until it is provisioned.')
print('Setup saved. Run one reconciliation pass:')
print(shlex.join(['node',str(root/'receipt-scanner/collector.mjs'),str(config_file),'--once']))
