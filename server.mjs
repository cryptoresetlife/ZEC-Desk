import http from 'node:http';
import fs from 'node:fs/promises';
import {openSync,fsyncSync,closeSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,dirname,resolve} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {Zaddr} from './lib/zaddr.mjs';
import {Wallet} from './lib/wallet.mjs';
import {localOrigin,localRequestAllowed} from './lib/local-origin.mjs';
import {NoirPayments} from './lib/noir-payments.mjs';
import {Engine,validateConfig,zats} from './lib/engine.mjs';
import {scanSource,publicUrl} from './lib/discovery.mjs';
import {ProjectMonitor} from './lib/market.mjs';
import {LaunchRadar} from './lib/launches.mjs';
import {SocialScanner} from './lib/social.mjs';
import {GrokConnection} from './lib/grok.mjs';
const root=dirname(fileURLToPath(import.meta.url)),port=Number(process.env.ZEC_DESK_PORT||8793),origin=`http://127.0.0.1:${port}`,token=randomBytes(32).toString('hex');
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid ZEC_DESK_PORT');
const data=join(root,'data');await fs.mkdir(data,{recursive:true});
let journal={version:1,tasks:[],backedUp:false,sources:[]};
try{journal=JSON.parse(await fs.readFile(join(data,'journal.json'),'utf8'));if(journal.version!==1||!Array.isArray(journal.tasks)||!Array.isArray(journal.sources))throw new Error('schema');}catch(e){if(e.code!=='ENOENT')throw new Error('本地记录损坏，已停止启动以防重复付款。请保留 data 目录并检查。');}
let writes=Promise.resolve();
function persist(){const body=JSON.stringify(journal,null,2);writes=writes.then(async()=>{const tmp=join(data,'journal.tmp');await fs.writeFile(tmp,body,{mode:0o600});const fd=openSync(tmp,'r+');try{fsyncSync(fd);}finally{closeSync(fd);}await fs.rename(tmp,join(data,'journal.json'));});return writes;}
const site=new Zaddr(),wallet=new Wallet(root),engine=new Engine({site,wallet,journal,persist});await persist();
const noir=new NoirPayments({site,journal,persist,otherBusy:()=>engine.active||engine.busy});
const projects=new ProjectMonitor(journal,persist);
const launches=new LaunchRadar(journal,persist);
const social=new SocialScanner(journal,persist);
const grok=new GrokConnection();
const grokTimer=setInterval(()=>{void grok.tick().catch(()=>{});},1000);
let backupShownFor='';
function walletIdentity(){return wallet.ready&&wallet.view.addresses?.[0]||'';}
function backupMatches(){return Boolean(walletIdentity()&&journal.backedUpAddress===walletIdentity());}
let scanning=false,scanBusy=false,lastScan=null,candidates=[],scanError='',previews=new Map(),closing=false;
async function scan(){
  if(scanBusy)return;scanBusy=true;
  try{
    scanError='';await Promise.all([site.scan().catch(e=>{scanError=e.message;}),launches.refresh()]);
    const items=[],pending=[...new Set([...journal.sources,...journal.watch.items.filter(x=>x.kind==='web').map(x=>x.url)])];
    const worker=async()=>{while(pending.length){
      const source=pending.shift();
      try{items.push(...await scanSource(source));}
      catch{items.push({name:new URL(source).hostname,url:source,kind:'读取失败，请核对来源'});}
    }};
    await Promise.all([worker(),worker(),worker()]);candidates=items;lastScan=Date.now();
  }finally{scanBusy=false;}
}
const interval=setInterval(async()=>{
  if(closing)return;
  await engine.tick().catch(()=>{engine.active=false;scanError='本地任务记录写入异常，已停止付款，请检查磁盘';});
},1500);
const scanner=setInterval(()=>{if(scanning&&!closing)void scan();},30000);
const marketTimer=setInterval(()=>{if(projects.due()&&!closing)void projects.refresh().catch(()=>{projects.error='项目记录保存失败，请检查磁盘';});},15000);
const socialTimer=setInterval(()=>{if(!closing)void social.tick().catch(()=>{social.error='X 扫描未完成，请检查设置';});},60000);
if(journal.watch.enabled)void projects.refresh().catch(()=>{projects.error='项目记录保存失败，请检查磁盘';});
const syncer=setInterval(()=>{if(wallet.ready&&!engine.busy&&!closing)void wallet.syncTick().catch(()=>{wallet.view={...wallet.view,syncError:'读取钱包同步状态失败，请检查网络后刷新'};});},20000);
const instanceId=createHash('sha256').update(resolve(root).replace(/[\\/]+$/,'').toLowerCase()).digest('hex');
function json(res,status,obj){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(obj));}
async function body(req){let b='';for await(const chunk of req){b+=chunk;if(b.length>16384)throw new Error('请求过大');}try{return JSON.parse(b||'{}');}catch{throw new Error('请求格式错误');}}
const server=http.createServer(async(req,res)=>{
  if(!localOrigin(req.headers.host,port)){res.writeHead(403);res.end();return;}
  res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','no-referrer');
  res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: https:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try{
    const path=new URL(req.url,origin).pathname;
    if(path==='/health'&&req.method==='GET')return json(res,200,{app:'zec-desk',instanceId});
    if(!path.startsWith('/api/')){
      if(req.method!=='GET')return json(res,405,{});
      const art=path.match(/^\/zaddr\/([1-9]\d{0,3})\.svg$/);
      if(art&&Number(art[1])<=2800){res.setHeader('content-type','image/svg+xml');res.setHeader('cache-control','private, max-age=86400');res.end(await fs.readFile(join(root,'public','zaddr',art[1]+'.svg')));return;}
      const files={'/':'index.html','/app.js':'app.js','/noir-provider.js':'noir-provider.js','/noir-ui.js':'noir-ui.js','/style.css':'style.css','/favicon.svg':'favicon.svg'};
      if(!files[path])return json(res,404,{});
      let source=await fs.readFile(join(root,'public',files[path]),'utf8');if(path==='/')source=source.replace('__SESSION_TOKEN__',token);
      res.setHeader('content-type',path.endsWith('.js')?'text/javascript; charset=utf-8':path.endsWith('.css')?'text/css; charset=utf-8':path.endsWith('.svg')?'image/svg+xml':'text/html; charset=utf-8');res.end(source);return;
    }
    if(!localRequestAllowed(req.headers,token,port))return json(res,403,{error:'请从本机软件窗口操作'});
    if(path==='/api/state'&&req.method==='GET')return json(res,200,{version:'0.1.0',grok:grok.view(),social:social.view(),launches:launches.view({site:site.view(),projects:projects.view(),candidates,scanError,scanning}),projects:projects.view(),site:site.view(),wallet:wallet.view,scanning,scanBusy,lastScan,candidates,scanError,sources:journal.sources,backedUp:backupMatches(),tasks:journal.tasks,active:engine.active,busy:engine.busy});
    if(req.method!=='POST')return json(res,405,{});
    const b=await body(req);
    if(path==='/api/noir/quote')return json(res,200,await noir.quote(b));
    if(path==='/api/noir/begin')return json(res,200,await noir.begin(b.id));
    if(path==='/api/noir/report')return json(res,200,await noir.report(b.taskId,b.txid));
    if(path==='/api/noir/progress')return json(res,200,await noir.progress(b.taskId));
    if(path==='/api/grok/login'){await grok.login();return json(res,200,{ok:true});}
    if(path==='/api/grok/logout'){grok.logout();return json(res,200,{ok:true});}
    if(path==='/api/grok/key'){grok.configureKey(b);return json(res,200,{ok:true});}
    if(path==='/api/grok/check'){await grok.check();return json(res,200,{ok:true});}
    if(path==='/api/grok/research'){await grok.research(b);return json(res,200,{ok:true});}
    if(path==='/api/social/config'){await social.configure(b);return json(res,200,{ok:true});}
    if(path==='/api/social/start'){await social.start();return json(res,200,{ok:true});}
    if(path==='/api/social/stop'){social.stop();return json(res,200,{ok:true});}
    if(path==='/api/social/scan'){await social.scan();return json(res,200,{ok:true});}
    if(path==='/api/social/verify'){await social.verify(b.id);return json(res,200,{ok:true});}
    if(path==='/api/social/watch'){const item=social.view().snapshot?.items.find(x=>x.id===b.id);if(!item?.website)throw Error('该账号未提供可加入自选的官网');await projects.add({url:item.website,name:item.name});void projects.refresh().catch(()=>{});return json(res,200,{ok:true});}
    if(path==='/api/launches/plan'){await launches.plan(b.id);return json(res,200,{ok:true});}
    if(path==='/api/launches/remove'){await launches.remove(b.id);return json(res,200,{ok:true});}
    if(path==='/api/projects/refresh'){await projects.refresh();return json(res,200,{ok:true});}
    if(path==='/api/projects/enabled'){await projects.enable(b.enabled);if(b.enabled)void projects.refresh().catch(()=>{});return json(res,200,{ok:true});}
    if(path==='/api/projects/add'){await projects.add(b);void projects.refresh().catch(()=>{});return json(res,200,{ok:true});}
    if(path==='/api/projects/remove'){await projects.remove(b.id);return json(res,200,{ok:true});}
    if(path==='/api/projects/target'){await projects.setTarget(b.id,b.price);return json(res,200,{ok:true});}
    if(path==='/api/projects/read'){await projects.acknowledge();return json(res,200,{ok:true});}
    if(path==='/api/site/login'){await site.login(b.password);return json(res,200,{ok:true});}
    if(path==='/api/scan'){scanning=true;await scan();return json(res,200,{ok:true});}
    if(path==='/api/scan/stop'){scanning=false;return json(res,200,{ok:true});}
    if(path==='/api/sources'){if(!Array.isArray(b.urls)||b.urls.length>10)throw new Error('最多 10 个公开来源');for(const url of b.urls)await publicUrl(url);journal.sources=[...new Set(b.urls)];await persist();return json(res,200,{ok:true});}
    if(path==='/api/wallet/start'){if(engine.busy)throw new Error('交易处理中');await wallet.start(b.create===true);return json(res,200,{ok:true});}
    if(path==='/api/wallet/status'){await wallet.syncTick();return json(res,200,{ok:true});}
    if(path==='/api/wallet/backup'){if(engine.active||engine.busy)throw new Error('请先停止任务再备份');const recovery=await wallet.command('recovery_info');backupShownFor=walletIdentity();return json(res,200,{recovery});}
    if(path==='/api/wallet/backed-up'){if(b.confirm!==true||!wallet.ready||!backupShownFor||backupShownFor!==walletIdentity())throw new Error('请先完成钱包备份');journal.backedUp=true;journal.backedUpAddress=backupShownFor;backupShownFor='';await persist();return json(res,200,{ok:true});}
    if(path==='/api/wallet/history'){return json(res,200,{history:await wallet.command('value_transfers')});}
    if(path==='/api/preview'){
      if(!backupMatches())throw new Error('请先备份独立钱包');
      if(engine.active||engine.busy)throw new Error('请先停止当前任务');
      const config=validateConfig(b);const w=await wallet.check(config.address);const s=await site.state(config.address);
      const r=s.rounds.find(x=>x.audience==='public'&&x.state!=='done');
      if(!r||s.address!==config.address||s.addressError)throw new Error('官网没有可用 Public 场次或未接受接收地址');
      if(zats(String(r.price))>zats(config.maxPrice))throw new Error('Public 价格超过你的价格上限');
      const budget=(zats(config.maxPrice)+zats(config.maxFee))*BigInt(config.quantity);
      if(BigInt(w.spendable)<budget)throw new Error('钱包可用屏蔽余额低于本次总预算，充值后需等待确认');
      const id=randomBytes(24).toString('hex');previews.clear();previews.set(id,{config,at:Date.now()});
      return json(res,200,{id,config,round:r,budget:Number(budget)/1e8,notice:'任务只对 ZADDR Public 生效。到点从官网获取付款地址和 memo；软件将自动签名并支付，每笔先检查手续费。'});
    }
    if(path==='/api/arm'){
      if(noir.busy)throw Error('Noir 正在核对付款，请稍后');
      const p=previews.get(b.previewId);if(!p||Date.now()-p.at>120000||b.confirm!==true)throw new Error('预检过期或未确认，请重新预检');
      previews.delete(b.previewId);await engine.arm(p.config);return json(res,200,{ok:true});
    }
    if(path==='/api/stop'){await engine.stop();return json(res,200,{ok:true});}
    if(path==='/api/exit'){
      if(engine.busy||wallet.starting||noir.busy)throw new Error('正在启动钱包、核对或发送交易，请等本次操作结束再退出');
      closing=true;grok.logout();clearInterval(grokTimer);social.stop();await engine.stop();await wallet.close();json(res,200,{ok:true});clearInterval(interval);clearInterval(scanner);clearInterval(syncer);clearInterval(marketTimer);clearInterval(socialTimer);server.close();setTimeout(()=>process.exit(0),500);return;
    }
    return json(res,404,{error:'接口不存在'});
  }catch(e){json(res,400,{error:e.message||'操作未完成'});}
});
server.listen(port,'127.0.0.1');
