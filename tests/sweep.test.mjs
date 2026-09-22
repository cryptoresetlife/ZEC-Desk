import test from 'node:test';
import assert from 'node:assert/strict';
import {Sweep,sweepConfig,marketSnapshot,eligible,invoiceFor} from '../lib/sweep.mjs';
const address='u1'+'a'.repeat(100),payTo='u1'+'b'.repeat(100),txid='c'.repeat(64);
const now=1800000000000;
const config=()=>({address,below:'0.02',total:'0.1',quantity:2,maxFee:'0.001',expiresAt:now+3600000});
function fixture(){
 let time=now,sends=0,reserves=0,releases=0;const journal={sweeps:[]},writes=[];
 const listings=[{id:'one',face:1,price:'0.019',reserved:false},{id:'two',face:2,price:'0.019',reserved:false}];
 const reservations=new Map();let owned=[];
 const market={read:async()=>({open:true,listings}),mine:async()=>({faces:owned.map(face=>({face})),listings:[]}),
 listing:async id=>{const l=listings.find(l=>l.id===id),r=reservations.get(id);return {...l,reservedByOther:false,reservedForYou:!!r,payTo:r?.payTo,memo:r?.memo,reservedUntil:r?.until};},
 reserve:async(id,to)=>{reserves++;const l=listings.find(l=>l.id===id);const r={...l,ok:true,to,payTo,memo:'BUY:'+id+':'+to,until:new Date(time+1200000).toISOString()};reservations.set(id,r);return r;},
 release:async id=>{releases++;reservations.delete(id);},progress:async id=>({ok:true,got:true,face:listings.find(l=>l.id===id).face})};
 const wallet={check:async()=>({spendable:10000000}),propose:async()=>({fee:10000}),confirm:async()=>{sends++;return {txids:[txid]};}};
 const sweep=new Sweep({market,wallet,journal,persist:async()=>writes.push(structuredClone(journal)),now:()=>time,backedUp:()=>true});
 return {sweep,wallet,market,journal,writes,listings,reservations,sends:()=>sends,reserves:()=>reserves,releases:()=>releases,advance:()=>time+=11000,owned:v=>owned=v,arm:async(c=config())=>{const p=await sweep.preview(c);await sweep.arm(p.id,true);}};
}
test('strict below threshold, exact decimal boundary, reserved and duplicate suppression',()=>{
 const m=marketSnapshot({open:true,listings:[{id:'a',face:1,price:'0.02',reserved:false},{id:'b',face:2,price:'0.01999999',reserved:false},{id:'c',face:3,price:'0.01',reserved:true}]},now);
 assert.deepEqual(eligible(m,config()).map(x=>x.id),['b']);assert.equal(eligible(m,config(),new Set(['face:2'])).length,0);
});
test('settings reject missing, negative, malformed and expired amounts',()=>{
 for(const v of [{below:''},{total:'NaN'},{below:'0'},{maxFee:'0'},{total:'0.0001'},{quantity:0},{quantity:1.5},{expiresAt:now},{expiresAt:now+8*86400000}])assert.throws(()=>sweepConfig({...config(),...v},now));
});
test('unknown market fields and duplicate listing data fail closed',()=>{
 for(const raw of [{listings:[]},{open:true,listings:[{id:'x',face:1,price:0.01,reserved:false}]},{open:true,listings:[{id:'x',face:1,price:'0.01'}]}])assert.throws(()=>marketSnapshot(raw));
});
test('preview never reserves or pays and requires full budget balance',async()=>{const f=fixture();await f.sweep.preview(config());assert.equal(f.reserves(),0);assert.equal(f.sends(),0);f.wallet.check=async()=>({spendable:1});await assert.rejects(f.sweep.preview(config()));});
test('explicit confirmation required; preview cannot be reused',async()=>{const f=fixture(),p=await f.sweep.preview(config());await assert.rejects(f.sweep.arm(p.id,false));await assert.rejects(f.sweep.arm(p.id,true));});
test('other payment engine blocks preview',async()=>{const f=fixture();f.sweep.otherBusy=()=>true;await assert.rejects(f.sweep.preview(config()));});
test('concurrent ticks pay once; durable intent exists before confirmation',async()=>{
 const f=fixture();await f.arm();f.wallet.confirm=async()=>{assert.equal(f.writes.at(-1).sweeps[0].status,'sending');assert.equal(f.writes.at(-1).sweeps[0].spent,'0.01910000');return {txids:[txid]};};
 await Promise.all([f.sweep.tick(),f.sweep.tick()]);assert.equal(f.reserves(),1);assert.equal(f.sweep.task.status,'broadcast');assert.equal(f.releases(),0);
});
test('wait for matching ownership then buy next and stop at quantity',async()=>{
 const f=fixture();await f.arm();await f.sweep.tick();f.advance();await f.sweep.tick();assert.equal(f.sends(),1);assert.equal(f.sweep.task.count,0);
 f.owned([1]);f.advance();await f.sweep.tick();f.advance();await f.sweep.tick();assert.equal(f.sends(),2);
 f.owned([1,2]);f.advance();await f.sweep.tick();assert.equal(f.sweep.active,false);assert.equal(f.sweep.task.count,2);
});
test('fees count toward total budget; no second buy beyond remaining budget',async()=>{
 const f=fixture();await f.arm({...config(),total:'0.021'});await f.sweep.tick();f.owned([1]);f.advance();await f.sweep.tick();f.advance();await f.sweep.tick();assert.equal(f.sends(),1);
});
test('own holdings and own listings are skipped',async()=>{const f=fixture();f.owned([1,2]);await f.arm();await f.sweep.tick();assert.equal(f.reserves(),0);});
test('fresh listing price change does not reserve',async()=>{const f=fixture();await f.arm();f.market.listing=async()=>({...f.listings[0],price:'0.03',reservedByOther:false});await f.sweep.tick();assert.equal(f.reserves(),0);});
test('fee over limit does not send and releases unpaid reservation',async()=>{const f=fixture();await f.arm();f.wallet.propose=async()=>({fee:200000});await f.sweep.tick();assert.equal(f.sends(),0);assert.equal(f.releases(),1);});
test('invoice revalidation detects memo changes',async()=>{const f=fixture();await f.arm();const original=f.market.listing;f.market.listing=async id=>{const r=await original(id);if(r.reservedForYou)r.memo='changed';return r;};await f.sweep.tick();assert.equal(f.sends(),0);});
test('invalid reserve response never sends',async()=>{const f=fixture();await f.arm();const original=f.market.reserve;f.market.reserve=async(...args)=>({...await original(...args),to:'wrong'});await f.sweep.tick();assert.equal(f.sends(),0);});
test('stop during proposal never confirms, releases hold',async()=>{const f=fixture();await f.arm();f.wallet.propose=async()=>{await f.sweep.stop();return {fee:10000};};await f.sweep.tick();assert.equal(f.sends(),0);assert.equal(f.releases(),1);assert.equal(f.sweep.active,false);});
test('stop during arm cancels startup',async()=>{const f=fixture(),p=await f.sweep.preview(config());f.wallet.check=async()=>{await f.sweep.stop();return {spendable:10000000};};await assert.rejects(f.sweep.arm(p.id,true));assert.equal(f.sweep.active,false);});
test('unknown broadcast blocks new tasks and no retry or release occurs',async()=>{const f=fixture();await f.arm();let calls=0;f.wallet.confirm=async()=>{calls++;throw Error('timeout');};await f.sweep.tick();f.advance();await f.sweep.tick();assert.equal(calls,1);assert.equal(f.releases(),0);assert.equal(f.sweep.task.status,'unknown');await assert.rejects(f.sweep.preview(config()));});
test('restart never resumes and sending intents remain blocked',()=>{const f=fixture();f.journal.sweeps.push({status:'sending',attempts:[{id:'x',face:1}],config:config()});const s=new Sweep({journal:f.journal});assert.equal(s.active,false);assert.equal(s.task.status,'unknown');assert.equal(s.unresolved(),true);});
test('durable write failure prevents payment',async()=>{const f=fixture();await f.arm();f.sweep.persist=async()=>{throw Error('disk full');};await assert.rejects(f.sweep.tick());assert.equal(f.sends(),0);assert.equal(f.sweep.active,false);});
test('different face in progress never confirms delivery',async()=>{const f=fixture();await f.arm();await f.sweep.tick();f.owned([1]);f.market.progress=async()=>({ok:true,got:true,face:2});await f.sweep.reconcile();assert.equal(f.sweep.task.count,0);});
test('deadline prevents a new reservation',async()=>{const f=fixture();await f.arm({...config(),expiresAt:now+5000});f.advance();await f.sweep.tick();assert.equal(f.reserves(),0);assert.equal(f.sweep.active,false);});
test('reservation must match listing id in memo and have enough lifetime',()=>{const f=fixture(),l=f.listings[0],r={...l,ok:true,to:address,payTo,memo:'BUY:one:'+address,until:new Date(now+120000).toISOString()};assert.ok(invoiceFor(r,l,config(),now));for(const v of [{memo:'BUY:wrong:'+address},{until:new Date(now+1000).toISOString()},{price:'0.02'},{payTo:'t1invalid'}])assert.throws(()=>invoiceFor({...r,...v},l,config(),now));});
