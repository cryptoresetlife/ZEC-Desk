import test from 'node:test';
import assert from 'node:assert/strict';
import {GrokConnection,officialLoginUrl,researchResult,readResearchResponse,RESEARCH_TIMEOUT_MS} from '../lib/grok.mjs';
const start=()=>({device_code:'private-device-code',user_code:'TEST-CODE',verification_uri:'https://accounts.x.ai/device',verification_uri_complete:'https://accounts.x.ai/device?user_code=TEST-CODE',expires_in:1800,interval:5});
const tokens=()=>({access_token:'private-access-token',refresh_token:'private-refresh-token',expires_in:3600,token_type:'Bearer'});
const answer=()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'测试公开消息',annotations:[{type:'url_citation',url:'https://x.com/example/status/1',title:'原帖'}]}]}]});
function fixture(fn){let at=1_800_000_000_000;const calls=[];const g=new GrokConnection({now:()=>at,fetcher:async(url,opts)=>{calls.push({url,opts});return fn(url,opts,calls.length);}});return {g,calls,advance:n=>{at+=n;}};}
async function connected(f){await f.g.login();f.advance(5000);await f.g.tick();}
test('device login stays pending, observes polling interval, then accepts only token grant; secrets never reach view',async()=>{
 let polls=0;const f=fixture(url=>Response.json(url.endsWith('/device/code')?start():++polls===1?{error:'authorization_pending'}:tokens(),{status:polls===1?400:200}));
 await f.g.login();await f.g.tick();assert.equal(f.calls.length,1);f.advance(5000);await f.g.tick();assert.equal(f.g.view().loggedIn,false);f.advance(5000);await f.g.tick();assert.equal(f.g.view().loggedIn,true);assert.equal(f.g.view().login,null);
 assert.doesNotMatch(JSON.stringify(f.g.view()),/private-(device|access|refresh)/);assert.equal(f.calls.every(c=>new URL(c.url).hostname==='auth.x.ai'&&c.opts.redirect==='error'),true);
});
test('device authorization rate limit backs off; expiry prevents more polling',async()=>{
 const f=fixture(url=>url.endsWith('/device/code')?Response.json(start()):Response.json({error:'slow_down'},{status:400}));await f.g.login();f.advance(5000);await f.g.tick();f.advance(5000);await f.g.tick();assert.equal(f.calls.length,2);f.advance(5000);await f.g.tick();assert.equal(f.calls.length,3);f.advance(1800_000);await f.g.tick();assert.equal(f.g.view().login,null);assert.match(f.g.view().error,/过期/);assert.equal(f.calls.length,3);
});
test('denied login and malicious verification URL never create authentication',async()=>{
 const f=fixture(url=>url.endsWith('/device/code')?Response.json(start()):Response.json({error:'access_denied',error_description:'SECRET'},{status:400}));await f.g.login();f.advance(5000);await f.g.tick();assert.equal(f.g.view().loggedIn,false);assert.match(f.g.view().error,/取消/);assert.doesNotMatch(f.g.view().error,/SECRET/);
 for(const u of ['https://accounts.x.ai.evil.org/','https://u:p@accounts.x.ai/','http://accounts.x.ai/','https://accounts.x.ai:444/'])assert.throws(()=>officialLoginUrl(u));
 const bad=fixture(()=>Response.json({...start(),verification_uri_complete:'https://evil.org/'}));await assert.rejects(bad.g.login());assert.equal(bad.g.view().login,null);
});
test('logout aborts requests and rejects late login tokens',async()=>{
 let release;const f=fixture(url=>url.endsWith('/device/code')?Response.json(start()):new Promise(r=>{release=r;}));await f.g.login();f.advance(5000);const pending=f.g.tick();await new Promise(r=>setImmediate(r));f.g.logout();release(Response.json(tokens()));await pending;assert.equal(f.g.view().loggedIn,false);assert.equal(f.calls[1].opts.signal.aborted,true);
});
test('subscription calls stay on subscription origin, failures do not fall back to API key or leak bodies',async()=>{
 const f=fixture(url=>url.endsWith('/device/code')?Response.json(start()):url.endsWith('/token')?Response.json(tokens()):new Response('private-upstream-error',{status:403}));await connected(f);await assert.rejects(f.g.check(),/权限/);assert.equal(f.calls.at(-1).url,'https://cli-chat-proxy.grok.com/v1/models');assert.equal(f.calls.at(-1).opts.headers.authorization,'Bearer private-access-token');assert.doesNotMatch(JSON.stringify(f.g.view()),/private-/);assert.equal(f.calls.length,3);
});
test('API key requires explicit paid mode, saving does not call upstream, and logout clears it',async()=>{
 const f=fixture(()=>Response.json({data:[{id:'grok-test'}]}));assert.throws(()=>f.g.configureKey({key:'private-api-key'}),/独立计费/);f.g.configureKey({key:'private-api-key',confirmPaid:true});assert.equal(f.calls.length,0);await f.g.check();assert.equal(f.calls[0].url,'https://api.x.ai/v1/models');assert.equal(f.calls[0].opts.headers.authorization,'Bearer private-api-key');assert.doesNotMatch(JSON.stringify(f.g.view()),/private-api-key/);f.g.logout();await assert.rejects(f.g.check(),/API Key/);assert.equal(f.calls.length,1);
});
test('research needs model and explicit action, uses bounded tools, only sends query, and never runs on login',async()=>{
 const f=fixture(url=>Response.json(url.endsWith('/device/code')?start():url.endsWith('/token')?tokens():url.endsWith('/models')?{data:[{id:'grok-test'}]}:answer()));await connected(f);assert.equal(f.calls.length,2);await assert.rejects(f.g.research({model:'grok-test',query:'公开查询',confirm:true}),/选择/);await f.g.check();await assert.rejects(f.g.research({model:'grok-test',query:'公开查询'}),/确认/);await f.g.research({model:'grok-test',query:'公开查询',confirm:true});const b=JSON.parse(f.calls.at(-1).opts.body);assert.equal(b.store,false);assert.equal(b.max_tool_calls,3);assert.equal(b.max_output_tokens,2400);assert.deepEqual(b.input,[{role:'user',content:'公开查询'}]);assert.equal(b.tools[0].type,'x_search');assert.equal(f.g.view().result.sources.length,1);await assert.rejects(f.g.research({model:'grok-test',query:'公开查询',confirm:true}),/间隔/);
});
test('expired access refreshes in memory without switching destination',async()=>{
 let grants=0;const f=fixture((url,opts)=>{if(url.endsWith('/device/code'))return Response.json(start());if(url.endsWith('/token')){grants++;return Response.json({...tokens(),access_token:grants===1?'private-original-token':'private-renewed-token',expires_in:90});}assert.equal(opts.headers.authorization,'Bearer private-renewed-token');return Response.json({data:[{id:'grok-test'}]});});await connected(f);f.advance(40000);await f.g.check();assert.equal(grants,2);assert.equal(new URLSearchParams(f.calls[2].opts.body).get('grant_type'),'refresh_token');assert.doesNotMatch(JSON.stringify(f.g.view()),/private-/);
});
test('incomplete or missing research output is not a success, unsafe citations are dropped',()=>{
 assert.throws(()=>researchResult({status:'incomplete',output:answer().output}));assert.throws(()=>researchResult({status:'completed',output:[]}));const d=answer();d.output[0].content[0].annotations.push({type:'url_citation',url:'javascript:alert(1)'});assert.equal(researchResult(d).sources.length,1);
});

test('subscription inference sends required gateway compatibility header while API key requests do not',async()=>{
 const f=fixture((url,opts)=>{if(url.endsWith('/device/code'))return Response.json(start());if(url.endsWith('/token'))return Response.json(tokens());assert.equal(opts.headers['x-grok-client-version'],'0.2.101');assert.equal(opts.headers['x-grok-client-identifier'],'zec-desk');assert.equal(opts.headers['x-authenticateresponse'],'authenticate-response');return Response.json(url.endsWith('/models')?{data:[{id:'grok-test'}]}:answer());});await connected(f);await f.g.check();await f.g.research({model:'grok-test',query:'test',confirm:true});
 const key=fixture((url,opts)=>{assert.equal(opts.headers['x-grok-client-version'],undefined);return Response.json({data:[{id:'grok-test'}]});});key.g.configureKey({key:'private-api-key',confirmPaid:true});await key.g.check();
});
test('426 is a compatibility failure and does not claim insufficient subscription credits',async()=>{const f=fixture(url=>url.endsWith('/device/code')?Response.json(start()):url.endsWith('/token')?Response.json(tokens()):new Response('sensitive-upstream-body',{status:426}));await connected(f);await assert.rejects(f.g.check(),/兼容协议/);assert.doesNotMatch(f.g.view().error,/sensitive/);assert.equal(f.calls.length,3);});

test('research reports safe timeout, transport, HTTP and response errors without retrying or logging out',async()=>{
 const cases=[
  [()=>{throw new DOMException('private-timeout','TimeoutError');},/超时/],
  [()=>{throw new TypeError('private-network',{cause:{code:'ENOTFOUND'}});},/网络连接失败/],
  [()=>new Response('private-denied',{status:400}),/HTTP 400/],
  [()=>new Response('private-invalid-json'),/格式异常/],
  [()=>new Response('data: private-stream\n\n',{headers:{'content-type':'text/event-stream'}}),/流式响应/],
  [()=>Response.json({status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output:[]}),/输出达到上限/],
  [()=>Response.json({error:{message:'private-error'}}),/服务错误/]
 ];
 for(const [respond,expected] of cases){
  const f=fixture(url=>url.endsWith('/device/code')?Response.json(start()):url.endsWith('/token')?Response.json(tokens()):url.endsWith('/models')?Response.json({data:[{id:'grok-test'}]}):respond());
  await connected(f);await f.g.check();await assert.rejects(f.g.research({model:'grok-test',query:'公开查询',confirm:true}),expected);
  const v=f.g.view();assert.equal(v.busy,false);assert.equal(v.loggedIn,true);assert.equal(v.result,null);assert.equal(v.requestStartedAt,0);assert.equal(f.calls.length,4);assert.doesNotMatch(JSON.stringify(v),/private-/);
 }
});

const sse=d=>'data: '+JSON.stringify(d)+'\r\n\r\n';
function eventResponse(text){const bytes=new TextEncoder().encode(text);return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=7)c.enqueue(bytes.slice(i,i+7));c.close();}}),{headers:{'content-type':'text/event-stream'}});}
test('stream parser handles fragmented UTF-8, comments and progress and retains completed citations',async()=>{
 const stages=[];
 const text=': heartbeat\r\n\r\n'+sse({type:'response.created'})+sse({type:'response.output_item.added',item:{type:'web_search_call'}})+sse({type:'response.output_text.delta',delta:'不完整测试文本'})+sse({type:'response.completed',response:answer()});
 const result=researchResult(await readResearchResponse(eventResponse(text),s=>stages.push(s)));
 assert.equal(result.text,'测试公开消息');assert.equal(result.sources[0].url,'https://x.com/example/status/1');assert.deepEqual(stages,['accepted','searching','writing']);
});
test('partial streams, service errors, malformed data and oversized responses never become success',async()=>{
 for(const [text,expected] of [
  [sse({type:'response.output_text.delta',delta:'private-partial'}),/提前结束/],
  ['data: [DONE]\n\n',/未收到完整/],
  [sse({type:'response.failed',response:{error:{message:'private-upstream'}}}),/服务错误/],
  ['data: private-bad-json\n\n',/格式异常/],
  [sse({type:'response.completed',response:{status:'completed',output:[]}}),/正文/]
 ]){await assert.rejects(readResearchResponse(eventResponse(text)),e=>expected.test(e.message)&&!e.message.includes('private-'));}
 await assert.rejects(readResearchResponse(new Response('x'.repeat(2000001),{headers:{'content-type':'text/event-stream'}})),/过大/);
});
test('research uses five-minute deadline and streaming; deadline still releases busy without retries',async()=>{
 const deadlines=[],deadline=new AbortController();let at=1_800_000_000_000,calls=0;
 const g=new GrokConnection({now:()=>at,timeoutSignal:ms=>{deadlines.push(ms);return deadline.signal;},fetcher:async(url,opts)=>{
  calls++;if(url.endsWith('/models'))return Response.json({data:[{id:'grok-test'}]});
  assert.equal(JSON.parse(opts.body).stream,true);
  return new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(opts.signal.reason),{once:true}));
 }});
 g.configureKey({key:'private-api-key',confirmPaid:true});await g.check();const pending=g.research({model:'grok-test',query:'公开查询',confirm:true});await new Promise(r=>setImmediate(r));
 at+=70000;assert.equal(g.view().busy,true);assert.equal(deadlines.at(-1),300000);assert.equal(RESEARCH_TIMEOUT_MS,300000);
 deadline.abort(new DOMException('test timeout','TimeoutError'));await assert.rejects(pending,/超时/);assert.equal(g.view().busy,false);assert.equal(calls,2);
});
test('cancel stops response body reading, retains credentials and never publishes partial output or retries',async()=>{
 let reads=0;
 const g=new GrokConnection({fetcher:async(url,opts)=>{
  reads++;if(url.endsWith('/models'))return Response.json({data:[{id:'grok-test'}]});
  return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(sse({type:'response.created'})));opts.signal.addEventListener('abort',()=>c.error(opts.signal.reason),{once:true});}}),{headers:{'content-type':'text/event-stream'}});
 }});
 g.configureKey({key:'private-api-key',confirmPaid:true});await g.check();const pending=g.research({model:'grok-test',query:'公开查询',confirm:true});await new Promise(r=>setImmediate(r));
 assert.equal(g.view().progress,'accepted');g.cancelResearch();await assert.rejects(pending,/已取消/);assert.equal(g.view().keyReady,true);assert.equal(g.view().result,null);assert.equal(g.view().busy,false);assert.equal(reads,2);
});

test('research exposes progress while pending and keeps previous success when a later request fails',async()=>{
 let finish;
 const f=fixture(url=>url.endsWith('/models')?Response.json({data:[{id:'grok-test'}]}):new Promise(resolve=>{finish=resolve;}));
 f.g.configureKey({key:'private-api-key',confirmPaid:true});await f.g.check();
 const first=f.g.research({model:'grok-test',query:'公开查询',confirm:true});await new Promise(r=>setImmediate(r));
 assert.equal(f.g.view().operation,'research');assert.equal(f.g.view().busy,true);assert.ok(f.g.view().requestStartedAt>0);
 finish(Response.json(answer()));await first;const previous=f.g.view().result;f.advance(60000);
 const second=f.g.research({model:'grok-test',query:'公开查询',confirm:true});await new Promise(r=>setImmediate(r));finish(new Response('private-bad-response'));await assert.rejects(second,/格式异常/);
 assert.deepEqual(f.g.view().result,previous);assert.equal(f.g.view().busy,false);assert.equal(f.calls.length,3);
});
