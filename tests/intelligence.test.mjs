import test from 'node:test';
import assert from 'node:assert/strict';
import {Intelligence,pageEvidence,parseAnnouncement} from '../lib/intelligence.mjs';
import {calendarItems,dayKey} from '../public/intelligence.js';
const source={name:'Example',url:'https://example.org/apply'};
const page=async()=>({url:source.url,html:'<title>Example</title><main>Whitelist applications open. Apply for early access.</main>'});
const validate=async raw=>{const u=new URL(raw);if(u.protocol!=='https:'||u.hostname==='localhost')throw Error('not public');return u;};
const make=(journal={},options={})=>new Intelligence(journal,async()=>{},{page,validate,seeds:[source],now:()=>1000,...options});
test('keyword evidence cannot enable automatic mint or declare Public live',async()=>{
  const r=make();await r.refresh();const item=r.view().items[0];assert.equal(item.phase,'application-hint');assert.equal(item.autoMint,false);assert(item.snippets.length);assert.equal(r.view().enabled,false);
});
test('closed applications take precedence over a whitelist mention',()=>{
  const p=pageEvidence('<main>Whitelist applications closed. Mint sold out.</main>',source.url);assert.equal(p.phase,'closed-hint');
});
test('scripts and styles cannot serve as qualification evidence',()=>{
  const p=pageEvidence('<script>whitelist open; mint now</script><style>.application{}</style><div id="root"></div>',source.url);assert.equal(p.phase,'unknown');assert.equal(p.snippets.length,0);assert(p.limited);
});
test('failure retains last successful evidence but invalidates current classification',async()=>{
  let now=1000;const r=make({},{now:()=>now});await r.refresh();r.page=async()=>{throw Error('offline')};now=2000;await r.refresh();const x=r.view().items[0];assert.equal(x.checkedAt,1000);assert.equal(x.phase,'unknown');assert(x.error);assert(x.snippets.length);
});
test('expired evidence is not current after restart',async()=>{
  const journal={},r=make(journal);await r.refresh();const restarted=make(JSON.parse(JSON.stringify(journal)),{now:()=>2000000});assert.equal(restarted.view().items[0].phase,'unknown');assert(restarted.view().items[0].stale);
});
test('changes are deduplicated, persisted and first read is a baseline',async()=>{
  const journal={},r=make(journal);await r.refresh();assert.equal(r.view().events.length,0);r.page=async()=>({url:source.url,html:'<main>Whitelist applications closed</main>'});await r.refresh();await r.refresh();assert.equal(r.view().events.length,1);assert.equal(make(JSON.parse(JSON.stringify(journal))).view().events.length,1);
});
test('custom sources are deduplicated against seeds and monitored without a paid API',()=>{
  const r=make({watch:{items:[{kind:'web',name:'saved',url:source.url+'#apply'}]},sources:[source.url]});assert.equal(r.sources().length,1);
});
test('a saved URL name preserves the catalog label and provenance',()=>{
  const r=make({watch:{items:[{kind:'web',name:source.url,url:source.url}]},sources:[source.url]},{seeds:[{...source,discoverySource:'https://directory.example/'}]});assert.equal(r.sources()[0].name,'Example');assert.equal(r.sources()[0].discoverySource,'https://directory.example/');
});
test('new links from configured directory scans can join the evidence monitor',()=>{
  const r=make();r.discovered=[{name:'New',url:'https://another.example/apply',sourceUrl:'https://example.org/directory'}];assert.equal(r.sources().length,2);assert.equal(r.sources()[1].discoverySource,'https://example.org/directory');assert.equal(r.view().items[1].autoMint,false);
});
test('refresh avoids overlapping requests and schedules a bounded interval',async()=>{
  let release,calls=0;const hold=new Promise(r=>release=r);const r=make({},{page:async()=>{calls++;await hold;return page();}});await r.enable(true);assert(r.due());const first=r.refresh();await r.refresh();assert.equal(calls,1);release();await first;assert.equal(r.view().nextAt,601000);assert(!r.due());await r.enable(false);assert(!r.due());
});
test('private image candidates are removed',async()=>{
  const r=make({},{page:async()=>({url:source.url,html:'<meta property="og:image" content="https://blocked.example/art.png"><p>whitelist</p>'}),validate:async()=>{throw Error('blocked')}});await r.refresh();assert.equal(r.view().items[0].image,null);
});
const announcement={name:'Example',url:source.url,sourceUrl:'https://example.org/news',stage:'allowlist',verification:'secondary',originalTime:'2026-09-21T19:00Z',note:'Time copied from an announcement'};
test('announcement requires explicit timezone and valid dates',()=>{
  for(const x of ['2026-09-21T19:00','2026-02-30T19:00Z','2026-09-21T24:00Z','TBA','2026-09-21T99:00+08:00'])assert.throws(()=>parseAnnouncement(x));assert.equal(parseAnnouncement('2026-09-22T03:00+08:00'),parseAnnouncement('2026-09-21T19:00Z'));
});
test('announcements preserve original sources, stage and verification with no payment side effect',async()=>{
  const journal={tasks:[]},r=make(journal);await r.saveSchedule(announcement);await r.saveSchedule({...announcement,note:'rechecked'});assert.equal(r.view().schedule.length,1);const x=r.view().schedule[0];assert.equal(x.stage,'allowlist');assert.equal(x.verification,'secondary');assert.equal(x.sourceUrl,announcement.sourceUrl);assert.equal(x.autoMint,false);assert.deepEqual(journal.tasks,[]);await assert.rejects(r.saveSchedule({...announcement,sourceUrl:'http://localhost/'}));await r.removeSchedule(x.id);assert.equal(r.view().schedule.length,0);
});
test('calendar groups by selected timezone and retains past entries as unverified',()=>{
  const at=Date.parse('2026-09-21T19:00Z'),items=[{startsAt:at}];assert.equal(dayKey(at,'Asia/Shanghai'),'2026-09-22');assert.equal(dayKey(at,'UTC'),'2026-09-21');assert.equal(calendarItems(items,'today','Asia/Shanghai',Date.parse('2026-09-22T01:00Z')).length,1);assert.equal(calendarItems(items,'today','UTC',Date.parse('2026-09-22T01:00Z')).length,0);assert.equal(calendarItems(items,'past','UTC',at+1).length,1);
});
test('stale ZADDR API schedule is labelled and never arms a task',()=>{
  const r=make({},{now:()=>200000});const x=r.view({last:{rounds:[{audience:'public',start:1000}]},checkedAt:1000}).schedule[0];assert(x.stale);assert(x.past);assert.equal(x.autoMint,false);
});
