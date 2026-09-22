import {createHash,randomUUID} from 'node:crypto';
import {readPublicPage,publicUrl,candidates,clean} from './discovery.mjs';

export const DIRECTORY='https://cornucopia-azure.vercel.app/';
// Public project URLs are leads, not endorsements or proof of official identity.
// No third-party bundle or editorial database is executed or copied.
export const SEEDS=[
  ['ZecFrogs','https://zecfrogs.xyz/'],
  ['Zeckers','https://www.zeckers.xyz/apply'],
  ['Zeccats','https://zeccat.com/apply'],
  ['ZecVisions','https://zecvision.com/'],
  ['ZDACTED','https://zdacted.xyz/'],
  ['CypherSquad','https://cyphersquad.cc/'],
].map(([name,url])=>({name,url,discoverySource:DIRECTORY}));
const INTERVAL=10*60*1000,FRESH=30*60*1000;
export function canonical(raw){const u=new URL(raw);u.hash='';return u.href;}
function hash(s){return createHash('sha256').update(s).digest('hex');}
export function pageEvidence(html,url){
  const stripped=html.replace(/<(script|style|noscript|svg|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
  const body=stripped.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1]||stripped;
  const text=clean(body.replace(/<[^>]+>/g,'\n'));
  const terms=/\b(?:white[\s_-]?list|allow[\s_-]?list|wait[\s_-]?list|froglist|ghostlist|apply|application|early[\s_-]?access|mint|sold\s*out)\b|白名单|申请|开售|售罄/gi;
  const snippets=[];
  for(const m of text.matchAll(terms)){
    const s=text.slice(Math.max(0,m.index-60),Math.min(text.length,m.index+160));
    if(!snippets.some(x=>x.includes(m[0])&&x.includes(s.slice(30,100))))snippets.push(s);
    if(snippets.length===4)break;
  }
  const app=/\b(?:whitelist|allowlist|waitlist|froglist|ghostlist|early.access|apply|application)\b|白名单|资格申请/i.test(text);
  const closed=/\b(?:mint(?:ing)?|application[s]?|whitelist|allowlist|registration)\s+(?:is\s+|are\s+)?(?:now\s+)?(?:closed|ended)|\bsold\s*out\b|申请已结束|申请已关闭|已售罄/i.test(text);
  const upcoming=/coming\s+soon|to\s+be\s+announced|\bTBA\b|即将|待公布/i.test(text);
  const phase=closed?'closed-hint':app?'application-hint':upcoming?'upcoming-hint':'unknown';
  const page=candidates(html,url)[0];
  const links=candidates(html,url).slice(1).filter(x=>x.earlySignals?.length).slice(0,5).map(x=>({name:x.name,url:x.url}));
  return {title:page.name,image:page.image,phase,snippets,links,
    limited:text.length<80||(!snippets.length&&/<script\b/i.test(html)),
    hash:hash(JSON.stringify({title:page.name,phase,snippets,links}))};
}
export function parseAnnouncement(raw){
  if(typeof raw!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?(?:Z|[+-]\d\d:\d\d)$/.test(raw))throw Error('排期必须包含日期、时间和时区');
  const n=Date.parse(raw);if(!Number.isFinite(n))throw Error('排期时间无效');
  const [date,time]=raw.split('T'),[y,m,d]=date.split('-').map(Number),[h,min]=time.slice(0,5).split(':').map(Number);
  if(m<1||m>12||d<1||d>new Date(Date.UTC(y,m,0)).getUTCDate()||h>23||min>59)throw Error('排期时间无效');
  return n;
}
export class Intelligence {
  busy=false;discovered=[];
  constructor(journal,persist,{page=readPublicPage,validate=publicUrl,now=Date.now,seeds=SEEDS}={}){
    Object.assign(this,{journal,persist,page,validate,now,seeds});
    journal.intelligence??={enabled:false,items:[],events:[],schedule:[],nextAt:0};
  }
  sources(){
    const all=[...this.seeds,...(this.journal.watch?.items||[]).filter(x=>x.kind==='web').map(x=>({name:x.name,url:x.url})),...(this.journal.sources||[]).map(url=>({name:new URL(url).hostname,url})),...this.discovered.slice(0,10).map(x=>({name:x.name,url:x.url,discoverySource:x.sourceUrl}))];
    const unique=new Map();
    for(const x of all){const url=canonical(x.url),prior=unique.get(url),name=prior&&(!x.name||x.name===x.url||x.name===new URL(url).hostname)?prior.name:x.name;unique.set(url,{...prior,...x,url,name,discoverySource:x.discoverySource||prior?.discoverySource});}
    return [...unique.values()].slice(0,56);
  }
  due(){return this.journal.intelligence.enabled&&!this.busy&&this.now()>=this.journal.intelligence.nextAt;}
  async enable(enabled){this.journal.intelligence.enabled=enabled===true;await this.persist();}
  async refresh(){
    if(this.busy)return;this.busy=true;const s=this.journal.intelligence;
    try{
      const sources=this.sources(),old=new Map(s.items.map(x=>[x.url,x])),pending=[...sources];
      const results=new Map();
      const worker=async()=>{while(pending.length){const source=pending.shift(),before=old.get(source.url),at=this.now();
        try{
          const p=await this.page(source.url),facts=pageEvidence(p.html,p.url);
          if(facts.image)try{await this.validate(facts.image);}catch{facts.image=null;}
          const item={...source,...facts,checkedAt:at,attemptAt:at,error:'',changedAt:before?.changedAt||null};
          if(before?.hash&&before.hash!==facts.hash){
            item.changedAt=at;s.events.unshift({id:randomUUID(),at,name:source.name,url:source.url,text:'申请 / Mint 相关内容发生变化，请核对页面',before:before.phase,after:facts.phase});
          }
          results.set(source.url,item);
        }catch{results.set(source.url,{...before,...source,attemptAt:at,error:'读取失败或网站需要浏览器 / 登录；保留上次结果',phase:before?.phase||'unknown'});}
      }};
      await Promise.all([worker(),worker(),worker()]);
      s.items=sources.map(x=>results.get(x.url));s.events=s.events.slice(0,60);s.nextAt=this.now()+INTERVAL;await this.persist();
    }finally{this.busy=false;}
  }
  view(site){
    const s=this.journal.intelligence,now=this.now(),items=new Map(s.items.map(x=>[x.url,x]));
    const list=this.sources().map(source=>{
      const x=items.get(source.url)||source,stale=!x.checkedAt||now-x.checkedAt>FRESH;
      return {...x,stale,phase:stale||x.error?'unknown':x.phase,autoMint:false};
    });
    const schedule=s.schedule.map(x=>({...x,past:x.startsAt<=now,autoMint:false}));
    const round=site?.last?.rounds?.find(r=>r.audience==='public');
    if(round&&Number.isFinite(round.start))schedule.push({id:'zaddr-live',name:'ZADDR Studio',url:'https://zaddr.studio/mint',sourceUrl:'https://zaddr.studio/mint',stage:'public',startsAt:round.start,originalTime:new Date(round.start).toISOString(),verification:'project-api',checkedAt:site.checkedAt,past:round.start<=now,stale:!site.checkedAt||now-site.checkedAt>90000||!!site.error,note:'官网接口排期；能否付款仍由实时预检决定。',autoMint:false});
    return {enabled:s.enabled,busy:this.busy,nextAt:s.nextAt,items:list,events:s.events,schedule:schedule.sort((a,b)=>a.startsAt-b.startsAt),intervalMinutes:10};
  }
  async saveSchedule(b){
    const s=this.journal.intelligence;
    const name=String(b.name||'').trim().slice(0,120);if(!name)throw Error('请填写项目名称');
    const url=canonical((await this.validate(b.url)).href),sourceUrl=canonical((await this.validate(b.sourceUrl)).href);
    if(!['public','allowlist','unknown'].includes(b.stage)||!['user-checked','secondary','unverified'].includes(b.verification))throw Error('请选择场次与来源核验状态');
    const startsAt=parseAnnouncement(b.originalTime);
    const prior=s.schedule.find(x=>x.url===url&&x.stage===b.stage&&x.startsAt===startsAt);
    if(!prior&&s.schedule.length>=60)throw Error('最多保存 60 个公告场次');
    const entry={id:prior?.id||randomUUID(),name,url,sourceUrl,stage:b.stage,verification:b.verification,originalTime:b.originalTime,startsAt,note:String(b.note||'').trim().slice(0,300),checkedAt:this.now()};
    if(prior)Object.assign(prior,entry);else s.schedule.push(entry);await this.persist();
  }
  async removeSchedule(id){this.journal.intelligence.schedule=this.journal.intelligence.schedule.filter(x=>x.id!==id);await this.persist();}
}
