import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const version=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version;
if(process.platform!=='darwin'||!['arm64','x64'].includes(process.arch)||!/^\d+\.\d+\.\d+$/.test(version))throw Error('Requires supported macOS build host');
const name=`ZEC-Desk-v${version}-macOS-${process.arch}`,out=path.join(root,'release',name);
await fs.mkdir(path.join(root,'release'),{recursive:true});
await fs.mkdir(out,{recursive:false});
const app=path.join(out,'ZEC Desk.app'),contents=path.join(app,'Contents'),dst=path.join(contents,'Resources','app');
const fixed=['README.md','INTELLIGENCE.md','使用说明.md','BUILD.md','CHANGELOG.md','THIRD_PARTY_NOTICES.md','LICENSE','package.json','server.mjs','runtime/node','runtime/NODE-LICENSE.txt','native/zingo-deskwallet','native/nym-proxy','native/wallet-lock','native/desk-stdio.patch','native/ZINGO-LICENSE.txt','native/NYM-APACHE-2.0.txt','public/index.html','public/app.js','public/intelligence.js','public/sweep.js','public/style.css','public/favicon.svg','public/noir-provider.js','public/noir-ui.js','launcher/macos-launcher.mjs'];
for(const e of await fs.readdir(path.join(root,'lib'),{withFileTypes:true}))if(e.isFile()&&e.name.endsWith('.mjs'))fixed.push('lib/'+e.name);
for(const file of fixed){const dest=path.join(dst,file);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.copyFile(path.join(root,file),dest);}
for(const file of ['runtime/node','native/zingo-deskwallet','native/nym-proxy','native/wallet-lock']){
  const bin=path.join(dst,file);await fs.chmod(bin,0o755);
  const arch=execFileSync('/usr/bin/lipo',['-archs',bin],{encoding:'utf8'}).trim();
  if(!arch.split(/\s+/).includes(process.arch==='x64'?'x86_64':'arm64'))throw Error('Wrong binary architecture: '+file);
  if(file!=='runtime/node')execFileSync('/usr/bin/codesign',['--force','--sign','-',bin]);
}
await fs.mkdir(path.join(contents,'MacOS'),{recursive:true});
await fs.writeFile(path.join(contents,'MacOS','ZEC Desk'),'#!/bin/sh\nset -eu\nAPP_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../Resources/app" && pwd)"\nexec "$APP_ROOT/runtime/node" "$APP_ROOT/launcher/macos-launcher.mjs"\n',{mode:0o755});
await fs.writeFile(path.join(contents,'Info.plist'),`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>CFBundleName</key><string>ZEC Desk</string><key>CFBundleDisplayName</key><string>ZEC Desk</string><key>CFBundleIdentifier</key><string>com.cryptoresetlife.zecdesk</string><key>CFBundleExecutable</key><string>ZEC Desk</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>${version}</string><key>CFBundleVersion</key><string>${version}</string><key>LSMinimumSystemVersion</key><string>14.0</string><key>LSUIElement</key><true/><key>NSHighResolutionCapable</key><true/></dict></plist>\n`);
execFileSync('/usr/bin/plutil',['-lint',path.join(contents,'Info.plist')]);
execFileSync('/usr/bin/codesign',['--force','--sign','-',app]);
execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app]);
await fs.copyFile(path.join(root,'MACOS.md'),path.join(out,'Mac 使用说明.md'));
console.log(out);
