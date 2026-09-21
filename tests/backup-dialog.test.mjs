import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the shipped dialog handlers with synthetic recovery data only.
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function fixture(recovery='TEST ONLY: recovery fixture, not a wallet seed'){
 const nodes=new Map(),queued=[],calls=[],handlers={};let resolveBackup;
 const $=id=>{if(!nodes.has(id)){let content='';nodes.set(id,{open:false,hidden:false,onclick:null,
  get innerHTML(){return content;},set innerHTML(v){content=v;},get textContent(){return content;},set textContent(v){content=v;},
  showModal(){this.open=true;},close(){if(this.open){this.open=false;queued.push(()=>handlers.close?.());}},
  addEventListener(type,fn){handlers[type]=fn;}});}return nodes.get(id);};
 const context=vm.createContext({$,esc:s=>s,bind:(id,fn)=>{$(id).onclick=fn;},
  api:async(path)=>{calls.push(path);if(path==='wallet/backup')return new Promise(resolve=>{resolveBackup=()=>resolve({recovery});});return {ok:true};}});
 vm.runInContext('let dialogAction=null,dialogVersion=0;'+source.slice(source.indexOf('function dialog('),source.indexOf("bind('#login'"))+source.slice(source.indexOf("bind('#backup'"),source.indexOf("bind('#history'")),context);
 return {$,calls,context,resolve:()=>resolveBackup(),flush:()=>{while(queued.length)queued.shift()();},cancel:()=>{handlers.cancel();$('#dialog').close();}};
}
test('backup stays visible after first confirmation and only a second click marks backed up',async()=>{
 const f=fixture();await f.$('#backup').onclick();const pending=f.$('#dialogconfirm').onclick();f.resolve();await pending;f.flush();
 assert.equal(f.$('#dialog').open,true);assert.match(f.$('#dialogbody').innerHTML,/TEST ONLY/);assert.equal(f.$('#dialogconfirm').textContent,'已离线保存备份');assert.deepEqual(f.calls,['wallet/backup']);
 await f.$('#dialogconfirm').onclick();f.flush();assert.deepEqual(f.calls,['wallet/backup','wallet/backed-up']);assert.equal(f.$('#dialogbody').innerHTML,'');assert.equal(f.$('#dialog').open,false);
});
test('closing or Escape during a slow recovery request prevents a late reveal',async()=>{
 for(const cancel of [false,true]){const f=fixture();await f.$('#backup').onclick();const pending=f.$('#dialogconfirm').onclick();if(cancel)f.cancel();else f.$('#dialogclose').onclick();f.resolve();await pending;f.flush();assert.equal(f.$('#dialog').open,false);assert.equal(f.$('#dialogbody').innerHTML,'');assert.deepEqual(f.calls,['wallet/backup']);}
});
test('queued close event from a previous dialog cannot erase a newly opened dialog',async()=>{
 const f=fixture();await f.$('#backup').onclick();f.$('#dialogclose').onclick();await f.$('#backup').onclick();f.flush();assert.equal(f.$('#dialog').open,true);assert.match(f.$('#dialogbody').innerHTML,/下一步/);
});
test('empty recovery never presents a backup-completed action',async()=>{
 for(const value of ['',null,{},[]]){const f=fixture(value);await f.$('#backup').onclick();const pending=f.$('#dialogconfirm').onclick();f.resolve();await assert.rejects(pending,/未取得有效备份内容/);assert.equal(f.$('#dialogconfirm').textContent,'在本机显示');assert.deepEqual(f.calls,['wallet/backup']);}
});
