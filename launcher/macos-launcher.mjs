import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const exec=promisify(execFile);
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const instanceId=createHash('sha256').update(root.replace(/[\\/]+$/,'').toLowerCase()).digest('hex');
const origin='http://127.0.0.1:8793';
async function probe(){
  try {const r=await fetch(origin+'/health',{signal:AbortSignal.timeout(2000),redirect:'error'});const s=await r.json();return s.app==='zec-desk'&&s.instanceId===instanceId?'own':'other';}
  catch(e){return e.cause?.code==='ECONNREFUSED'?'absent':'unknown';}
}
async function open(){
  if(process.env.ZEC_DESK_HEADLESS==='1')return;
  try{await exec('/usr/bin/open',['-a','Google Chrome','http://localhost:8793/']);}
  catch{await exec('/usr/bin/open',['http://localhost:8793/']);}
}
try {
  if(process.platform!=='darwin')throw Error('此启动器仅用于 macOS。');
  let state=await probe();
  if(state==='other'||state==='unknown')throw Error('8793 端口已有其他版本或无法核实的服务。请先在原软件点击“停止并退出软件”，再打开此版本。');
  if(state==='absent'){
    const child=spawn(process.execPath,[resolve(root,'server.mjs')],{cwd:root,detached:true,stdio:'ignore',env:{...process.env,ZEC_DESK_PORT:'8793'}});
    let failed=false;child.on('error',()=>{failed=true;});child.on('exit',()=>{failed=true;});child.unref();
    for(let i=0;i<80;i++){
      state=await probe();if(state==='own')break;
      if(failed||state==='other')throw Error('本机服务启动失败。请确认程序已完整解压，并检查是否有另一版本占用端口。');
      await new Promise(r=>setTimeout(r,250));
    }
    if(state!=='own')throw Error('本机服务未就绪，请稍后重新打开。');
  }
  await open();
} catch(e) {
  const message=e.message||'启动失败';
  if(process.env.ZEC_DESK_HEADLESS==='1'){console.error(message);process.exitCode=1;}
  else await exec('/usr/bin/osascript',['-e','on run argv','-e','display alert "ZEC Desk" message (item 1 of argv)','-e','end run',message]).catch(()=>{});
}
