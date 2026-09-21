import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'release','ZEC-Desk-v0.1.0-Windows-x64');
try{await fs.access(out);throw new Error('Release directory already exists');}catch(e){if(e.code!=='ENOENT')throw e;}
const fixed=['README.md','使用说明.md','BUILD.md','CHANGELOG.md','THIRD_PARTY_NOTICES.md','LICENSE','package.json','server.mjs','ZEC Desk.ico','ZEC Desk.exe','ZecDeskWindow.exe','Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll','WEBVIEW2-LICENSE.txt','WEBVIEW2-NOTICE.txt','runtime/node.exe','runtime/NODE-LICENSE.txt','native/zingo-deskwallet','native/desk-stdio.patch','native/ZINGO-LICENSE.txt','public/index.html','public/app.js','public/style.css','public/favicon.svg'];
for(const dir of ['lib','tests','launcher','scripts'])for(const name of await fs.readdir(path.join(root,dir)))if(/\.(mjs|cs)$/.test(name))fixed.push(dir+'/'+name);
for(const file of fixed){await fs.access(path.join(root,file));}
for(const file of fixed){const dst=path.join(out,file);await fs.mkdir(path.dirname(dst),{recursive:true});await fs.copyFile(path.join(root,file),dst);}
console.log(`Packaged ${fixed.length} allowlisted files.`);
