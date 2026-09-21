import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
const release=resolve(process.argv[2]),entry=join(release,'ZEC Desk.app','Contents','MacOS','ZEC Desk');
const home=await fs.mkdtemp(join(tmpdir(),'zec-launcher-'));
const base='http://127.0.0.1:8793';let token;
const run=()=>new Promise((res,rej)=>{
  const c=spawn(entry,[],{env:{...process.env,HOME:home,ZEC_DESK_HEADLESS:'1'},stdio:'ignore'});
  const timer=setTimeout(()=>{c.kill();rej(Error('Launcher timeout'));},35000);
  c.once('error',e=>{clearTimeout(timer);rej(e);});c.once('exit',code=>{clearTimeout(timer);res(code);});
});
async function stop(){if(!token)return;await fetch(base+'/api/exit',{method:'POST',headers:{'x-zec-desk':token,'content-type':'application/json',origin:base},body:'{}'}).catch(()=>{});}
try{
  assert.equal(await run(),0);
  const html=await(await fetch(base)).text();token=html.match(/name="session-token" content="([^"]+)"/)[1];
  const first=await(await fetch(base+'/health')).json();assert.equal(first.app,'zec-desk');
  assert.equal(await run(),0);
  const secondHtml=await(await fetch(base)).text();assert(secondHtml.includes(token),'second launch reuses the same server');
  await stop();token=null;
  await new Promise(r=>setTimeout(r,1000));
  const foreign=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({app:'zec-desk',instanceId:'different-installation'}));});
  await new Promise((res,rej)=>{foreign.once('error',rej);foreign.listen(8793,'127.0.0.1',res);});
  try{assert.equal(await run(),1,'launcher refuses another installation');}finally{await new Promise(r=>foreign.close(r));}
  console.log('Packaged macOS executable starts cleanly, reuses its own server and refuses a foreign instance.');
}finally{await stop();}
