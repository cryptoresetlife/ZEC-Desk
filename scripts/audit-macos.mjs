import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(process.argv[2]);let count=0;
async function walk(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){
  const p=path.join(dir,e.name),rel=path.relative(root,p);
  if(e.isSymbolicLink())throw Error('Unexpected symlink: '+rel);
  if(e.isDirectory()){if(/^(data|\.git|build-cache|node_modules|wallet-mainnet|zaddr)$/i.test(e.name))throw Error('Private/generated directory: '+rel);await walk(p);continue;}
  if(/\.(dat|key|pem|log|pdb)$|^\.env|journal/i.test(e.name))throw Error('Private file: '+rel);
  count++;
  if(/\.(mjs|js|html|md|json|txt|css|plist|sh)$/.test(e.name)){
    const text=await fs.readFile(p,'utf8');
    if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:xai-|ghp_)[a-zA-Z0-9]{25,}|u1[a-z0-9]{80,}|t1[a-zA-Z0-9]{33}/.test(text))throw Error('Possible private content: '+rel);
  }
}}
await walk(root);console.log('Release privacy audit passed: '+count+' files; no application data or credentials.');
