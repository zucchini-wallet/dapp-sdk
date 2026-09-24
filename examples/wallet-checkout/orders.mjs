import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createOrderEngine } from './order-engine.mjs';
export function createOrders({file,...config}) {
 return createOrderEngine({...config,storage:{
  async read(){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return {};throw e;}},
  async write(records){await mkdir(dirname(file),{recursive:true});await writeFile(file+'.tmp',JSON.stringify(records),{mode:0o600});await rename(file+'.tmp',file);}
 }});
}
