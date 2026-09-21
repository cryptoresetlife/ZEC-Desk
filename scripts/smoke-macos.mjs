import fs from 'node:fs/promises';
import {spawn,execFileSync,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const release=resolve(process.argv[2]),app=join(release,'ZEC Desk.app','Contents','Resources','app');
const scratch=await fs.mkdtemp(join(tmpdir(),'zec-desk-smoke-'));
const helper=join(app,'native','wallet-lock');
const fake=join(scratch,'fake-wallet');
await fs.writeFile(fake,'#!/bin/sh\nprintf "ready\\n"\nread answer\n',{mode:0o755});
const call=(mode)=>spawn(helper,[scratch,mode,fake],{stdio:['pipe','pipe','ignore']});
const exit=child=>new Promise((res,rej)=>{child.on('error',rej);child.on('exit',res);});
assert.equal(await exit(call('open')),44);
await fs.writeFile(join(scratch,'zingo-wallet.dat'),'disposable fixture');
assert.equal(await exit(call('create')),46);
const first=call('open');await new Promise((res,rej)=>{first.stdout.once('data',res);first.on('error',rej);});
assert.equal(await exit(call('open')),45);
const firstExit=exit(first);first.stdin.end('quit\n');assert.equal(await firstExit,0);
const again=call('open'),againExit=exit(again);again.stdin.end('quit\n');assert.equal(await againExit,0);
// Load binaries on the actual target OS without creating or funding a wallet.
execFileSync(join(app,'native','zingo-deskwallet'),['--version'],{stdio:'pipe',timeout:30000});
const nym=spawnSync(join(app,'native','nym-proxy'),['--smoke-invalid-argument'],{encoding:'utf8',timeout:30000});
assert.equal(nym.status,1);assert.match(nym.stderr,/unknown argument/i);
const child=spawn(join(app,'runtime','node'),[join(app,'server.mjs')],{cwd:app,env:{...process.env,HOME:scratch,ZEC_DESK_PORT:'18793'},stdio:'ignore'});
try{
  let html='';for(let i=0;i<80;i++){try{const r=await fetch('http://127.0.0.1:18793/');if(r.ok){html=await r.text();break;}}catch{}await new Promise(r=>setTimeout(r,100));}
  assert(html.includes('walletaddresscopy'));
  const token=html.match(/name="session-token" content="([^"]+)"/)[1];
  const headers={'x-zec-desk':token};
  const s=await (await fetch('http://127.0.0.1:18793/api/state',{headers})).json();
  assert.equal(s.platform,'darwin');assert.equal(s.wallet.ready,false);assert.equal(s.active,false);assert.equal(s.tasks.length,0);assert.equal(s.sources.length,0);assert.equal(s.grok.loggedIn,false);assert.equal(s.social.tokenReady,false);
  assert.equal((await fetch('http://127.0.0.1:18793/api/state')).status,403);
  assert.equal((await fetch('http://127.0.0.1:18793/api/exit',{method:'POST',headers:{...headers,'content-type':'application/json',origin:'http://127.0.0.1:18793'},body:'{}'})).status,200);
  await fs.access(join(scratch,'Library','Application Support','ZEC Desk','data','journal.json'));
  console.log('macOS native binaries, wallet lock, clean backend and shutdown verified; no live wallet or payment.');
}finally{child.kill();}
