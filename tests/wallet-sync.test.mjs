import test from 'node:test';
import assert from 'node:assert/strict';
import {Wallet,syncFailure,walletScanComplete} from '../lib/wallet.mjs';
function wallet(poll='Sync task is not complete.'){
 const w=new Wallet('fixture');w.ready=true;const calls=[];
 w.command=async(c,args=[])=>{calls.push([c,...args]);if(c==='sync'&&args[0]==='poll'){if(poll instanceof Error)throw poll;return poll;}if(c==='sync'&&args[0]==='run')return 'Launching sync task...';if(c==='addresses')return [{encoded_address:'u1fixture'}];if(c==='spendable_balance')return {spendable_balance:0};if(c==='sync'&&args[0]==='status')return {percentage_total_outputs_scanned:42,total_blocks_scanned:20};throw Error('unexpected');};return {w,calls};
}
test('running sync is polled and progress refreshed without restarting it',async()=>{const {w,calls}=wallet();await w.syncTick();assert.equal(calls[0][1],'poll');assert(!calls.some(x=>x[1]==='run'));assert.equal(w.view.sync.percentage_total_outputs_scanned,42);assert(w.view.syncCheckedAt>0);});
test('finished or absent sync is collected before starting the next scan',async()=>{for(const p of ['Sync task has not been launched.','Sync completed succesfully: fixture']){const {w,calls}=wallet(p);await w.syncTick();assert.deepEqual(calls.slice(0,2),[['sync','poll'],['sync','run']]);}});
test('failed sync is surfaced without raw error data and retries after cooldown',async()=>{const {w,calls}=wallet(Error('private upstream payload'));await w.syncTick();assert.match(w.view.syncError,/同步任务失败/);assert(!w.view.syncError.includes('private'));assert(w.view.syncRetryAt>Date.now());await w.syncTick();assert.equal(calls.filter(x=>x[1]==='poll').length,1);w.syncRetryAt=0;await w.syncTick();assert.equal(calls.filter(x=>x[1]==='poll').length,2);});
test('overlapping maintenance ticks do not issue duplicate sync commands',async()=>{const {w,calls}=wallet();const original=w.command;let resume;w.command=async(c,a)=>{if(a?.[0]==='poll')await new Promise(r=>resume=r);return original(c,a);};const first=w.syncTick();await w.syncTick();resume();await first;assert.equal(calls.filter(x=>x[1]==='poll').length,1);});
test('sync error and incomplete sync still block payment readiness',async()=>{for(const state of [{syncError:'同步失败',sync:{percentage_total_outputs_scanned:100}},{sync:{percentage_total_outputs_scanned:42}}]){const {w}=wallet();w.status=async()=>({addresses:['u1fixture'],...state});await assert.rejects(w.check('u1fixture'),/同步/);}});
test('unsupported transaction format stops retries and reports the compatibility blocker',async()=>{const {w,calls}=wallet(syncFailure('Error: server returned invalid transaction. Unknown transaction format'));await w.syncTick();assert.equal(w.view.syncCode,'unsupported-tx-format');assert.match(w.view.syncError,/需升级/);assert.equal(w.syncBlocked,true);assert.equal(w.view.syncRetryAt,0);await w.syncTick();assert.equal(calls.filter(x=>x[1]==='poll').length,1);assert(!calls.some(x=>x[1]==='run'));});
test('native scan ranges determine completeness including an empty-output range',()=>{
 const done={sync_start_height:3490000,scan_ranges:[{priority:'Scanned'}],percentage_total_outputs_scanned:0};
 assert.equal(walletScanComplete(done),true);
 assert.equal(walletScanComplete({...done,sync_start_height:0}),false);
 assert.equal(walletScanComplete({...done,scan_ranges:[{priority:'Verify'}],percentage_total_outputs_scanned:100}),false);
 assert.equal(walletScanComplete({percentage_total_outputs_scanned:100}),false);
 assert.equal(walletScanComplete({...done,scan_ranges:[]}),false);
});
test('conflicting roots and missing checkpoints pause retry instead of reporting a network failure',async()=>{
 for(const [raw,code] of [['Error: shard tree error\ncaused by: Inserted root conflicts with existing root at address Address { level: Level(2), index: 129180 }','tree-conflict'],['Error: missing Ironwood shard tree checkpoints. wallet data cleared. rescan required.','rescan-required']]){
  const {w,calls}=wallet(syncFailure(raw));await w.syncTick();
  assert.equal(w.syncBlocked,true);assert.equal(w.view.syncCode,code);assert.equal(w.view.syncRetryAt,0);
  assert.match(w.view.syncError,/备份/);assert(!w.view.syncError.includes('129180'));
  await w.syncTick();assert.equal(calls.filter(x=>x[1]==='poll').length,1);
  await assert.rejects(w.check('u1fixture'),/扫描/);
 }
});
test('v6 readiness uses height without obsolete argument and checks chain freshness',async()=>{
 const w=new Wallet('fixture'),calls=[];
 w.status=async()=>({addresses:['u1fixture'],spendable:0,sync:{sync_start_height:3490000,scan_ranges:[{priority:'Scanned'}]}});
 let tip=3490100;
 w.command=async(c,a)=>{calls.push([c,a]);return c==='info'?{chain_name:'main',latest_block_height:tip}:{height:3490100};};
 await w.check('u1fixture');assert.deepEqual(calls,[['info',undefined],['height',undefined]]);
 tip+=3;await assert.rejects(w.check('u1fixture'),/追上主网/);
});
