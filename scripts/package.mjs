import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const version=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version;
if(!/^\d+\.\d+\.\d+$/.test(version))throw new Error('Invalid release version');
const out=path.join(root,'release',`ZEC-Desk-v${version}-Windows-x64`);
try{await fs.access(out);throw new Error('Release directory already exists');}catch(e){if(e.code!=='ENOENT')throw e;}
const fixed=['README.md','INTELLIGENCE.md','使用说明.md','BUILD.md','CHANGELOG.md','THIRD_PARTY_NOTICES.md','LICENSE','package.json','server.mjs','ZEC Desk.ico','ZEC Desk.exe','ZecDeskWindow.exe','Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll','WEBVIEW2-LICENSE.txt','WEBVIEW2-NOTICE.txt','runtime/node.exe','runtime/NODE-LICENSE.txt','native/zingo-deskwallet','native/desk-stdio.patch','native/ZINGO-LICENSE.txt','public/index.html','public/app.js','public/intelligence.js','public/sweep.js','public/style.css','public/favicon.svg'];
fixed.push('native/nym-proxy','native/SHA256SUMS.txt','native/NYM-APACHE-2.0.txt','public/noir-provider.js','public/noir-ui.js','launcher/task-autofill.js');
for(const dir of ['lib','tests','launcher','scripts'])for(const entry of await fs.readdir(path.join(root,dir),{withFileTypes:true}))if(entry.isFile()&&/\.(mjs|cs)$/.test(entry.name))fixed.push(dir+'/'+entry.name);
for(const file of fixed){await fs.access(path.join(root,file));}
for(const file of fixed){const dst=path.join(out,file);await fs.mkdir(path.dirname(dst),{recursive:true});await fs.copyFile(path.join(root,file),dst);}
console.log(`Packaged ${fixed.length} allowlisted files.`);
