import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function fixture(){
 const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{value:'grok-test',dataset:{},textContent:'',innerHTML:'',hidden:false});return nodes.get(id);};
 const ctx=vm.createContext({$,Date,JSON,Math,esc:s=>String(s).replaceAll('<','&lt;'),when:()=>'',setCards:(id,html)=>{$(id).innerHTML=html;}});
 vm.runInContext(source.slice(source.indexOf('function paintGrok('),source.indexOf("bind('#groklogin'")),ctx);
 return {$,paint:g=>ctx.paintGrok({mode:'subscription',loggedIn:true,models:['grok-test'],nextRun:0,...g})};
}
test('old backend cannot run another 60-second query; UI explains full restart',()=>{
 const f=fixture();f.paint({});assert.equal(f.$('#grokrun').disabled,true);assert.equal(f.$('#grokcancel').hidden,true);assert.match(f.$('#grokresult').innerHTML,/停止并退出软件/);
});
test('stream progress shows elapsed time and cancellation, then completed citations',()=>{
 const f=fixture();f.paint({researchTimeoutMs:300000,busy:true,operation:'research',progress:'searching',requestStartedAt:Date.now()-71000});
 assert.match(f.$('#grokresult').innerHTML,/搜索公开帖子.*已等待 71 秒/);assert.equal(f.$('#grokcancel').hidden,false);assert.equal(f.$('#grokrun').disabled,true);
 f.paint({researchTimeoutMs:300000,busy:false,result:{text:'公开测试结果',model:'grok-test',sources:[{url:'https://x.com/example/status/1',title:'原帖'}]}});
 assert.equal(f.$('#grokcancel').hidden,true);assert.equal(f.$('#grokrun').disabled,false);assert.match(f.$('#grokresult').innerHTML,/公开测试结果/);assert.match(f.$('#grokresult').innerHTML,/https:\/\/x.com\/example\/status\/1/);
});
