import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
const out=new URL('./public/merchant-test/',import.meta.url);await mkdir(out,{recursive:true});
for(const file of ['index.html','app.js','wallet-flow.js','style.css'])await copyFile(new URL(file,import.meta.url),new URL(file,out));
const source=await readFile(new URL('../../dist/merchant.js',import.meta.url),'utf8');
const browser=source.replace(/^export \{.*\} from '@zucchinifi\/merchant-payments';\n/m,'');
if(/^\s*(import|export).*from\s/m.test(browser)||browser.includes('node:'))throw new Error('Unexpected SDK browser dependencies');
await writeFile(new URL('sdk.js',out),browser);
