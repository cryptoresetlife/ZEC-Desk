import {randomUUID,createHash} from 'node:crypto';
import {readPublicPage,candidates,clean,publicUrl} from './discovery.mjs';
export const MARKET='https://www.zebra.family/marketplace';
// Public read-only queries used by zebra.family's marketplace bundle (2026-09-21).
// No login, wallet address, API key, signed offer, or transaction request is used.
const INDEX='https://firestore.googleapis.com/v1/projects/z-nfts/databases/(default)/documents:runQuery';
function value(v){if(v?.stringValue!==undefined)return v.stringValue;if(v?.integerValue!==undefined)return Number(v.integerValue);if(v?.doubleValue!==undefined)return v.doubleValue;return null;}
function documents(rows){if(!Array.isArray(rows)||rows.some(r=>r.error))throw new Error('市场索引响应异常');return rows.filter(r=>r.document).map(r=>({id:r.document.name.split('/').at(-1),...Object.fromEntries(Object.entries(r.document.fields||{}).map(([k,v])=>[k,value(v)]))}));}
export function safeImage(raw){if(typeof raw!=='string')return null;try{if(/^ipfs:\/\//.test(raw))raw='https://ipfs.io/ipfs/'+raw.slice(7).replace(/^ipfs\//,'');if(/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-z2-7]+)$/.test(raw))raw='https://ipfs.io/ipfs/'+raw;const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password&&['ipfs.io','gateway.pinata.cloud','cloudflare-ipfs.com','www.zebra.family','zebra.family'].includes(u.hostname)?u.href:null;}catch{return null;}}
export function normalizeMarket(collectionRows,listingRows){
  const collections=documents(collectionRows),listings=documents(listingRows),partial=collections.length>500||listings.length>500,map=new Map();
  for(const c of collections.slice(0,500))map.set(c.id,{id:c.id,name:typeof c.name==='string'?c.name.slice(0,160):c.id,image:safeImage(c.imageUrl),listed:0,floor:null,url:MARKET});
  for(const x of listings.slice(0,500)){const id=typeof x.collectionId==='string'&&x.collectionId?x.collectionId:'others';let c=map.get(id);if(!c){c={id,name:String(x.collectionName||x.collectionId||'Others').slice(0,160),image:null,listed:0,floor:null,url:MARKET};map.set(id,c);}c.listed++;if(typeof x.price==='number'&&Number.isFinite(x.price)&&x.price>=0)c.floor=c.floor===null?x.price:Math.min(c.floor,x.price);if(!c.image)c.image=safeImage(x.ipfs_cid);}
  return {items:[...map.values()].sort((a,b)=>b.listed-a.listed||a.name.localeCompare(b.name)),partial,listingCount:Math.min(listings.length,500)};
}
async function query(collection){const fields=collection==='collections'?['name','imageUrl']:['collectionId','collectionName','price','ipfs_cid'];const q={from:[{collectionId:collection}],select:{fields:fields.map(fieldPath=>({fieldPath}))},limit:501};if(collection==='mints')q.where={fieldFilter:{field:{fieldPath:'isSale'},op:'EQUAL',value:{booleanValue:true}}};const r=await fetch(INDEX,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({structuredQuery:q}),signal:AbortSignal.timeout(12000),redirect:'error'});if(!r.ok)throw new Error('zebra.family 公开索引暂不可用（HTTP '+r.status+'）');const t=await r.text();if(t.length>3000000)throw new Error('市场索引响应超出限制');return JSON.parse(t);}
export async function fetchMarket(){const [a,b]=await Promise.all([query('collections'),query('mints')]);return normalizeMarket(a,b);}
export function marketChanges(before,after,at){if(!before)return [];const old=new Map(before.items.map(x=>[x.id,x]));const events=[];for(const c of after.items){const p=old.get(c.id);if(!p){if(!before.partial)events.push({id:randomUUID(),at,type:'new',collectionId:c.id,text:'新发现系列：'+c.name});continue;}if(!before.partial&&!after.partial&&(p.floor!==c.floor||p.listed!==c.listed))events.push({id:randomUUID(),at,type:'market',collectionId:c.id,text:c.name+'：挂牌 '+p.listed+' → '+c.listed+'；最低价 '+(p.floor??'—')+' → '+(c.floor??'—')+' ZEC'});}return events;}
export function targetPrice(raw){
  if(raw===null||raw==='')return null;
  if(typeof raw!=='string'||!/^\d{1,9}(\.\d{1,8})?$/.test(raw)||Number(raw)<=0)throw new Error('目标价须大于 0，最多 8 位小数');
  return Number(raw);
}
export function checkTarget(item,snapshot,at){
  if(snapshot.partial||!Number.isFinite(item.targetPrice)||item.targetPrice<=0||item.error)return null;
  const c=snapshot.items.find(x=>x.id===item.collectionId);
  if(!c||!Number.isFinite(c.floor)||c.floor<0||c.listed<=0)return null;
  const matched=c.floor<=item.targetPrice,hit=matched&&!item.targetMatched;item.targetMatched=matched;
  return hit?{id:randomUUID(),at,type:'target',collectionId:c.id,text:c.name+'：最低挂单价 '+c.floor+' ZEC，已达到目标 ≤ '+item.targetPrice+' ZEC（不是成交价）'}:null;
}
export class ProjectMonitor {
  busy=false;error='';lastAttempt=null;
  constructor(journal,persist,{market=fetchMarket,page=readPublicPage,now=Date.now}={}){
    Object.assign(this,{journal,persist,market,page,now});
    journal.watch??={enabled:true,items:[],events:[],snapshot:null};
    const w=journal.watch;w.alerts??=[];w.seenIds??=w.snapshot?.items.map(x=>x.id)||[];w.failureCount??=0;w.nextRefreshAt??=0;
  }
  view(){const w=this.journal.watch;return {...w,busy:this.busy,error:this.error,lastAttempt:this.lastAttempt,stale:!w.snapshot||this.now()-w.snapshot.checkedAt>180000};}
  due(){return this.journal.watch.enabled&&this.now()>=this.journal.watch.nextRefreshAt;}
  async refresh(){
    if(this.busy)return;this.busy=true;this.lastAttempt=this.now();const w=this.journal.watch;
    try{
      this.error='';
      try{
        const next={...await this.market(),checkedAt:this.now()},seen=new Set(w.seenIds),old=new Map(w.snapshot?.items.map(x=>[x.id,x])||[]);
        const events=marketChanges(w.snapshot,next,next.checkedAt).filter(e=>e.type!=='new'||!seen.has(e.collectionId));
        for(const c of next.items){c.discoveredAt=old.get(c.id)?.discoveredAt||(!seen.has(c.id)&&w.snapshot?next.checkedAt:null);seen.add(c.id);}
        w.seenIds=[...seen];w.events=[...events,...w.events].slice(0,50);w.snapshot=next;w.failureCount=0;w.nextRefreshAt=this.now()+60000;
      }catch(e){this.error=e.message;w.failureCount++;w.nextRefreshAt=this.now()+Math.min(600000,60000*2**Math.min(w.failureCount-1,4));}
      for(const item of w.items.filter(x=>x.kind==='zebra')){
        const c=w.snapshot?.items.find(x=>x.id===item.collectionId);
        if(!this.error&&c){Object.assign(item,{name:c.name,image:c.image,listed:c.listed,floor:c.floor,checkedAt:w.snapshot.checkedAt,error:''});const alert=checkTarget(item,w.snapshot,this.now());if(alert)w.alerts.unshift(alert);}
        else item.error=this.error||'当前索引未找到此系列，不代表已售罄';
      }
      // Three bounded workers keep a slow webpage from blocking every other project.
      const pending=w.items.filter(x=>x.kind==='web');
      const worker=async()=>{while(pending.length){const item=pending.shift();if(!w.items.includes(item))continue;await this.refreshPage(item,w);}};
      await Promise.all([worker(),worker(),worker()]);
      w.events=w.events.slice(0,50);w.alerts=w.alerts.slice(0,50);await this.persist();
    }finally{this.busy=false;}
  }
  async refreshPage(item,w){
    try{
      const {html,url}=await this.page(item.url);
      if(/<form[^>]*action=["']\/gate["']/i.test(html))throw new Error('需要登录');
      const found=candidates(html,url)[0];if(found.image)try{await publicUrl(found.image);}catch{found.image=null;}
      const description=clean(html.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1]||'').slice(0,400);
      const hash=createHash('sha256').update(found.name+'\n'+description).digest('hex');
      if(!w.items.includes(item))return;
      if(item.hash&&item.hash!==hash)w.events.unshift({id:randomUUID(),at:this.now(),type:'page',text:item.name+'：网页标题或简介发生变化，请打开官网核对'});
      if(!item.customName)item.name=found.name;
      Object.assign(item,{image:found.image,description,earlySignals:found.earlySignals||[],hash,checkedAt:this.now(),error:''});
    }catch{if(w.items.includes(item))item.error='网页读取失败或需要登录；保留上次结果，请打开官网核对';}
  }
  async add({url,name,collectionId}){
    const w=this.journal.watch;if(w.items.length>=30)throw new Error('最多收藏 30 个项目');let item;
    if(collectionId){const c=w.snapshot?.items.find(x=>x.id===collectionId);if(!c)throw new Error('请先刷新市场再添加此系列');if(w.items.some(x=>x.kind==='zebra'&&x.collectionId===collectionId))return;item={...c,id:randomUUID(),kind:'zebra',collectionId,checkedAt:w.snapshot.checkedAt};}
    else{const u=await publicUrl(url);u.hash='';if(w.items.some(x=>x.kind==='web'&&x.url===u.href))return;const label=typeof name==='string'?name.trim().slice(0,160):'';item={id:randomUUID(),kind:'web',url:u.href,name:label||u.hostname,customName:!!label,image:null,checkedAt:null,error:''};}
    if(w.items.length>=30)throw new Error('最多收藏 30 个项目');w.items.push(item);await this.persist();
  }
  async setTarget(id,raw){const n=targetPrice(raw),item=this.journal.watch.items.find(x=>x.id===id&&x.kind==='zebra');if(!item)throw new Error('请先收藏市场系列');if(item.targetPrice!==n){item.targetPrice=n;item.targetMatched=false;}await this.persist();}
  async acknowledge(){for(const a of this.journal.watch.alerts)a.read=true;await this.persist();}
  async remove(id){this.journal.watch.items=this.journal.watch.items.filter(x=>x.id!==id);await this.persist();}
  async enable(enabled){this.journal.watch.enabled=enabled===true;await this.persist();}
}
