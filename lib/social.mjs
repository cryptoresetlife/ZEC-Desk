import {readPublicPage,earlySignal} from './discovery.mjs';
import {isIP} from 'node:net';

export const DEFAULT_QUERY='(Zcash OR $ZEC OR #ZEC) (NFT OR mint OR whitelist OR allowlist OR "early access" OR waitlist) -is:retweet';
const metric=n=>Number.isSafeInteger(n)&&n>=0?n:null;
export function website(raw){try{const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!isIP(u.hostname)&&u.hostname.includes('.')&&!['x.com','www.x.com','twitter.com','www.twitter.com','t.co'].includes(u.hostname)?u.href:null;}catch{return null;}}
const avatar=raw=>{try{const u=new URL(raw);return u.protocol==='https:'&&u.hostname==='pbs.twimg.com'&&!u.username&&!u.password?u.href:null;}catch{return null;}};
function metrics(raw={}){return {likes:metric(raw.like_count),reposts:metric(raw.retweet_count??raw.repost_count),replies:metric(raw.reply_count),quotes:metric(raw.quote_count),views:metric(raw.impression_count)};}
export function heat(m,createdAt,now){
  if([m.likes,m.reposts,m.replies,m.quotes].some(v=>v===null)||!Number.isFinite(createdAt)||createdAt>now)return null;
  return Math.round((m.likes+2*m.reposts+2*m.replies+3*m.quotes)/Math.sqrt(1+(now-createdAt)/3600000)*100)/100;
}
export function normalizeSocial(data,now=Date.now()){
  if(!data||(!Array.isArray(data.data)&&data.meta?.result_count!==0)||data.errors?.length)throw Error('X 返回了不完整结果，保留上次数据');
  const users=new Map((data.includes?.users||[]).map(u=>[u.id,u])),groups=new Map(),seen=new Set();
  for(const t of (data.data||[]).slice(0,100)){
    if(!/^\d+$/.test(t.id)||seen.has(t.id))continue;seen.add(t.id);
    const u=users.get(t.author_id);if(!u||!/^\w{1,15}$/.test(u.username))continue;
    const text=String(t.text||'').slice(0,6000),context=text+' '+String(u.description||'');
    if(!/\bzcash\b|\bzec\b/i.test(context)||!/\bnft\b|mint|whitelist|allowlist|early.access|waitlist|白名单|资格申请/i.test(context))continue;
    if((t.referenced_tweets||t.referenced_posts||[]).some(r=>r.type==='retweeted'))continue;
    let g=groups.get(u.id);
    if(!g){
      const urls=u.entities?.url?.urls||[],home=urls.map(x=>website(x.expanded_url||x.unwound_url)).find(Boolean)||website(u.url);
      g={id:u.id,name:String(u.name||u.username).slice(0,160),username:u.username,url:'https://x.com/'+u.username,website:home,image:avatar(u.profile_image_url),description:String(u.description||'').slice(0,500),followers:metric(u.public_metrics?.followers_count),createdAt:Date.parse(u.created_at)||null,posts:[],score:null,earlySignals:[],verifiedType:String(u.verified_type||'').slice(0,40)};groups.set(u.id,g);
    }
    const at=Date.parse(t.created_at),m=metrics(t.public_metrics),score=heat(m,at,now);
    g.posts.push({id:t.id,text,url:'https://x.com/'+u.username+'/status/'+t.id,at:Number.isFinite(at)?at:null,metrics:m,score});
    g.earlySignals=[...new Set([...g.earlySignals,...earlySignal(text+' '+g.description)])].slice(0,8);
  }
  for(const g of groups.values()){g.score=g.posts.every(p=>p.score!==null)?Math.round(g.posts.reduce((s,p)=>s+p.score,0)*100)/100:null;g.posts.sort((a,b)=>(b.score??-1)-(a.score??-1));}
  return {items:[...groups.values()].sort((a,b)=>(b.score??-1)-(a.score??-1)),checkedAt:now,partial:!!data.meta?.next_token,postCount:seen.size};
}
export function hasProfileLink(html,username,base){
  const visible=html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
  for(const m of visible.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi))try{const u=new URL(m[1].replace(/&amp;/g,'&'),base);if(u.protocol==='https:'&&!u.username&&!u.password&&['x.com','www.x.com','twitter.com','www.twitter.com'].includes(u.hostname)&&u.pathname.replace(/\/$/,'').toLowerCase()==='/'+username.toLowerCase())return true;}catch{}
  return false;
}
export class SocialScanner {
  #token='';busy=false;enabled=false;error='';nextAt=0;generation=0;
  constructor(journal,persist,{fetcher=fetch,page=readPublicPage,now=Date.now}={}){
    Object.assign(this,{journal,persist,fetcher,page,now});
    journal.social??={query:DEFAULT_QUERY,intervalMinutes:30,dailyLimit:12,usage:{day:'',count:0},snapshot:null,links:{}};
  }
  view(){const s=this.journal.social;return {...s,tokenReady:!!this.#token,busy:this.busy,enabled:this.enabled,error:this.error,nextAt:this.nextAt,stale:!s.snapshot||this.now()-s.snapshot.checkedAt>2*s.intervalMinutes*60000};}
  async configure(b){
    if(this.busy)throw Error('正在扫描，请结束后再改设置');
    if(typeof b.query!=='string'||!b.query.trim()||b.query.length>450||/[\r\n]/.test(b.query))throw Error('搜索式须为 1–450 个字符且不换行');
    if(!Number.isInteger(b.intervalMinutes)||b.intervalMinutes<15||b.intervalMinutes>360||!Number.isInteger(b.dailyLimit)||b.dailyLimit<1||b.dailyLimit>96)throw Error('间隔为 15–360 分钟，每日上限 1–96 次');
    if(b.token!==undefined&&b.token!==''&&(typeof b.token!=='string'||b.token.length<10||b.token.length>3000||/\s/.test(b.token)))throw Error('Token 格式不正确，请只填 Bearer Token 本身');
    this.stop();if(b.clearToken===true)this.#token='';else if(b.token)this.#token=b.token;
    const s=this.journal.social;if(s.query!==b.query.trim()){s.snapshot=null;s.links={};}
    Object.assign(s,{query:b.query.trim(),intervalMinutes:b.intervalMinutes,dailyLimit:b.dailyLimit});this.error='';await this.persist();
  }
  stop(){this.enabled=false;this.generation++;}
  async start(){if(!this.#token)throw Error('请先在本机设置填写有搜索权限的 X API Bearer Token');this.enabled=true;if(this.now()>=this.nextAt)await this.scan();}
  async tick(){if(this.enabled&&!this.busy&&this.now()>=this.nextAt)await this.scan();}
  async scan(){
    if(this.busy)return;if(!this.#token)throw Error('未配置 X API，尚未读取任何热度数据');
    if(this.now()<this.nextAt)throw Error('尚未到下次检查时间，请稍后再试');
    this.busy=true;const g=this.generation,s=this.journal.social;
    try{
      const day=new Date(this.now()).toISOString().slice(0,10);if(s.usage.day!==day)s.usage={day,count:0};
      if(s.usage.count>=s.dailyLimit){this.enabled=false;throw Error('已达到每日请求上限（UTC），扫描已暂停');}
      s.usage.count++;await this.persist(); // Count before the request, including failures and process interruptions.
      if(g!==this.generation)return;
      this.nextAt=this.now()+s.intervalMinutes*60000;
      // Current X reference calls this post.fields; response normalization also accepts legacy metrics.
      const params=new URLSearchParams({query:s.query,max_results:'100',sort_order:'recency','post.fields':'created_at,public_metrics,entities','expansions':'author_id,referenced_posts','user.fields':'name,username,description,url,entities,created_at,profile_image_url,public_metrics'});
      const r=await this.fetcher('https://api.x.com/2/tweets/search/recent?'+params,{headers:{authorization:'Bearer '+this.#token},redirect:'error',signal:AbortSignal.timeout(15000)});
      if(!r.ok){
        if([401,402,403].includes(r.status))this.enabled=false;
        if(r.status===429)this.nextAt=Math.max(this.nextAt,this.now()+3600000);
        await r.body?.cancel();
        throw Error(r.status===429?'X API 限流，至少 1 小时后重试':[401,403].includes(r.status)?'X Token 无效或没有搜索权限，扫描已停止':r.status===402?'X API 额度不足，扫描已停止':'X API 暂不可用（HTTP '+r.status+'）');
      }
      let size=0,text='';const decoder=new TextDecoder();for await(const chunk of r.body){size+=chunk.length;if(size>2000000)throw Error('X 返回内容过大');text+=decoder.decode(chunk,{stream:true});}text+=decoder.decode();
      let data;try{data=JSON.parse(text);}catch{throw Error('X 返回格式异常');}
      const next=normalizeSocial(data,this.now());if(g!==this.generation)return;
      for(const item of next.items){const link=s.links[item.id];if(link&&(link.website!==item.website||link.username!==item.username))delete s.links[item.id];}
      s.snapshot=next;this.error='';await this.persist();
    }catch(e){if(g===this.generation)this.error=/^(X |已达到|X 返回)/.test(e.message)?e.message:'搜索连接失败或本地记录未能保存；未展示原始错误';}
    finally{this.busy=false;}
  }
  async verify(id){
    const s=this.journal.social,item=s.snapshot?.items.find(x=>x.id===id);if(!item?.website)throw Error('该账号未提供可核对的 HTTPS 官网');
    let match=false,note='';
    try{const {html,url}=await this.page(item.website);match=hasProfileLink(html,item.username,url);note=match?'账号资料链接的网站也链接回此账号；仅证明互链，不保证项目真实性。':'网页未找到回链，官推身份待核实；动态网页可能无法读取。';}
    catch{note='官网读取失败或地址不适合公开读取，官推身份待核实。';}
    s.links[id]={username:item.username,website:item.website,matched:match,checkedAt:this.now(),note};await this.persist();
  }
}
