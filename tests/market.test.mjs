import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeMarket,marketChanges,ProjectMonitor,safeImage,targetPrice,checkTarget} from '../lib/market.mjs';
const doc=(id,fields)=>({document:{name:'projects/test/documents/collections/'+id,fields:Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,typeof v==='number'?{doubleValue:v}:{stringValue:v}]))}});
test('market groups listings, preserves empty collections and distinguishes missing price from zero',()=>{
 const m=normalizeMarket([doc('empty',{name:'Empty'})],[doc('a',{collectionId:'art',price:2}),doc('b',{collectionId:'art',price:0}),doc('c',{collectionId:'unknown',price:'bad'})]);
 assert.equal(m.items.find(x=>x.id==='art').floor,0);assert.equal(m.items.find(x=>x.id==='art').listed,2);assert.equal(m.items.find(x=>x.id==='empty').floor,null);assert.equal(m.items.find(x=>x.id==='unknown').floor,null);assert.equal(m.partial,false);
});
test('market baseline does not announce old projects and partial samples do not announce price changes',()=>{
 const a={items:[{id:'a',name:'A',floor:1,listed:1}],partial:false},b={items:[{id:'a',name:'A',floor:2,listed:2},{id:'b',name:'B',floor:0,listed:1}],partial:false};
 assert.deepEqual(marketChanges(null,b,1),[]);assert.equal(marketChanges(a,b,1).length,2);assert.deepEqual(marketChanges({...a,partial:true},{...b,partial:true},1),[]);
});
test('image normalizer does not accept script or private image addresses',()=>{for(const u of ['javascript:alert(1)','http://ipfs.io/a','https://127.0.0.1/a','https://user:pass@ipfs.io/a'])assert.equal(safeImage(u),null);assert.equal(safeImage('ipfs://QmYK2AQHBodYiNpV98zdNjpTdgc488cHnToCNSiyayyk26'),'https://ipfs.io/ipfs/QmYK2AQHBodYiNpV98zdNjpTdgc488cHnToCNSiyayyk26');});
test('market errors retain last good data and saved collection, without generating false delistings',async()=>{
 const journal={},monitor=new ProjectMonitor(journal,async()=>{}, {market:async()=>({items:[{id:'a',name:'A',listed:1,floor:2}],partial:false,listingCount:1})});
 await monitor.refresh();await monitor.add({collectionId:'a'});await monitor.add({collectionId:'a'});assert.equal(journal.watch.items.length,1);
 monitor.market=async()=>{throw new Error('offline');};await monitor.refresh();assert.equal(journal.watch.snapshot.items[0].floor,2);assert.equal(journal.watch.items[0].error,'offline');assert.equal(journal.watch.events.length,0);
 const restored=new ProjectMonitor(JSON.parse(JSON.stringify(journal)),async()=>{});assert.equal(restored.view().items.length,1);await restored.remove(restored.view().items[0].id);assert.equal(restored.view().items.length,0);
});
test('target price inputs reject zero, malformed values and excess precision',()=>{for(const v of ['0','-1','1e2','NaN','0.000000001',1])assert.throws(()=>targetPrice(v));assert.equal(targetPrice('0.00000001'),1e-8);assert.equal(targetPrice(''),null);});
test('target alerts fire once per crossing; incomplete or missing quotes never rearm',()=>{
 const item={collectionId:'a',targetPrice:1},snap={partial:false,items:[{id:'a',name:'A',floor:0.5,listed:1}]};
 assert.equal(checkTarget(item,snap,1).type,'target');assert.equal(checkTarget(item,snap,2),null);
 assert.equal(checkTarget(item,{...snap,partial:true},3),null);assert.equal(checkTarget(item,{items:[]},4),null);assert.equal(checkTarget(item,snap,5),null);
 snap.items[0].floor=2;assert.equal(checkTarget(item,snap,6),null);snap.items[0].floor=1;assert.ok(checkTarget(item,snap,7));
});
test('saved targets survive restart without replay and acknowledgement is persisted',async()=>{
 let at=1000;const market=async()=>({items:[{id:'a',name:'A',listed:1,floor:1}],partial:false,listingCount:1});const journal={};let p=new ProjectMonitor(journal,async()=>{}, {market,now:()=>at});
 await p.refresh();await p.add({collectionId:'a'});await p.setTarget(journal.watch.items[0].id,'1');await p.refresh();assert.equal(journal.watch.alerts.length,1);
 const copy=JSON.parse(JSON.stringify(journal));p=new ProjectMonitor(copy,async()=>{}, {market,now:()=>at});await p.refresh();assert.equal(copy.watch.alerts.length,1);await p.acknowledge();assert.equal(copy.watch.alerts[0].read,true);
 await p.setTarget(copy.watch.items[0].id,'');await p.refresh();assert.equal(copy.watch.alerts.length,1);
});
test('failed market reads back off and mark stale; successful read restores cadence',async()=>{
 let at=1000,fail=false;const p=new ProjectMonitor({},async()=>{}, {now:()=>at,market:async()=>{if(fail)throw Error('offline');return {items:[],partial:false,listingCount:0};}});
 await p.refresh();assert.equal(p.due(),false);fail=true;at+=190000;await p.refresh();assert.equal(p.view().stale,true);assert.equal(p.view().nextRefreshAt,at+60000);await p.refresh();assert.equal(p.view().nextRefreshAt,at+120000);fail=false;await p.refresh();assert.equal(p.view().failureCount,0);assert.equal(p.view().stale,false);
});
test('first baseline and reappearing known collection are not new discoveries',async()=>{
 let ids=['a'],at=1000;const p=new ProjectMonitor({},async()=>{}, {now:()=>at,market:async()=>({items:ids.map(id=>({id,name:id,listed:1,floor:1})),partial:false,listingCount:ids.length})});
 await p.refresh();assert.equal(p.view().snapshot.items[0].discoveredAt,null);ids=['a','b'];at=2000;await p.refresh();assert.equal(p.view().snapshot.items[1].discoveredAt,2000);ids=['b'];await p.refresh();ids=['a','b'];await p.refresh();assert.equal(p.view().events.filter(x=>x.type==='new').length,1);
});
