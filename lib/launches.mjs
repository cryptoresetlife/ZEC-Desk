import {createHash} from 'node:crypto';
import {readPublicPage,clean} from './discovery.mjs';

export const ZECMAP='https://www.zecmap.world/whitelist';
export function zecmapStatus(html){
  const visible=html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
  const text=clean(visible.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1]||visible);
  const application=/early.access application,? not a mint/i.test(text);
  return {phase:application?'application':'unknown',note:application?'早期资格申请，不是 mint；官网尚未公布可执行的 Public 付款规则。':'官网内容发生变化或状态无法确认，请核对正式 mint 规则。',hash:createHash('sha256').update(text).digest('hex')};
}
export class LaunchRadar {
  busy=false;error='';checkedAt=null;last=null;
  constructor(journal,persist,{page=readPublicPage,now=Date.now}={}){
    Object.assign(this,{journal,persist,page,now});journal.launches??={plans:[],events:[],zecmap:null};
  }
  async refresh(){
    if(this.busy)return;this.busy=true;
    try{
      const page=await this.page('https://www.zecmap.world/rules'),next={...zecmapStatus(page.html),checkedAt:this.now()};
      const old=this.journal.launches.zecmap;
      if(old&&old.hash!==next.hash)this.journal.launches.events.unshift({at:this.now(),text:'ZECMAP 官网规则已变化，请重新核对 Public 开售与发行规则；自动付款未启用。'});
      this.journal.launches.events=this.journal.launches.events.slice(0,30);
      this.journal.launches.zecmap=next;this.error='';this.checkedAt=next.checkedAt;await this.persist();
    }catch{this.error='ZECMAP 官网读取失败，保留历史结果；不能据此判断已开售';}finally{this.busy=false;}
  }
  view({site,projects,candidates:found,scanError='',scanning=false}){
    const now=this.now(),saved=this.journal.launches,round=site.last?.rounds?.find(r=>r.audience==='public');
    const fresh=site.checkedAt&&now-site.checkedAt<90000&&!site.error;
    const phase=fresh&&site.last.soldOut?'ended':fresh&&round?.state==='live'?'live':fresh&&round&&round.start>site.last.now?'upcoming':'unknown';
    const items=[{id:'zaddr',name:'ZADDR Studio',url:'https://zaddr.studio/mint',image:null,source:'项目官网接口',phase,autoMint:true,note:'已接入 ZADDR Public；仍需选择钱包、预检并确认预算。',checkedAt:site.checkedAt,price:round?.price??null,start:round?.start??null},
      {id:'zecmap',name:'ZECMAP',url:ZECMAP,image:'https://www.zecmap.world/logo-mark.svg',source:'官网规则',phase:!this.error&&saved.zecmap&&now-saved.zecmap.checkedAt<180000?saved.zecmap.phase:'unknown',autoMint:false,note:this.error||saved.zecmap?.note||'正在读取官网规则',checkedAt:saved.zecmap?.checkedAt}];
    const urls=new Set(items.map(x=>x.url));
    for(const c of found||[]){if(urls.has(c.url))continue;urls.add(c.url);const early=c.checkedAt&&now-c.checkedAt<180000&&c.earlySignals?.length;items.push({...c,id:'web:'+createHash('sha256').update(c.url).digest('hex').slice(0,20),source:'公开目录 / 自选官网链接',phase:early?'early':'unknown',autoMint:false,note:early?'发现早期资格线索：'+c.earlySignals.join('、')+'。可能尚未开放或已经结束，请打开官网核对条件；不会自动申请。':'发现了公开链接；开售时间、价格和付款协议尚未核实。'});}
    for(const c of projects.items.filter(x=>x.kind==='web')){if(urls.has(c.url))continue;urls.add(c.url);const early=!c.error&&c.checkedAt&&now-c.checkedAt<180000&&c.earlySignals?.length;items.push({...c,id:'saved:'+c.id,source:'我的自选官网',phase:early?'early':'unknown',autoMint:false,note:early?'官网包含早期资格线索：'+c.earlySignals.join('、')+'，是否开放需到官网核实。':'仅监控网页；尚未适配自动 mint。'});}
    for(const c of projects.snapshot?.items||[])items.push({...c,id:'market:'+c.id,source:'zebra.family 系列索引',phase:'market',autoMint:false,note:'这是市场系列，挂牌价不是 mint 价格；未提供已核实的 Public 开售接口。'});
    this.last=items;
    return {items,plans:saved.plans,events:saved.events,busy:this.busy,scanning,scanError,error:this.error,scope:'已接入来源：ZADDR 官网、ZECMAP 规则、zebra.family 系列目录、自选官网及自定义目录。不是全链完整预售清单。'};
  }
  async plan(id){
    const item=this.last?.find(x=>x.id===id);if(!item)throw new Error('项目列表已变化，请刷新后再添加');
    if(item.phase==='market')throw new Error('二级市场系列不能直接作为 Public mint 任务，请先添加项目官网');
    const plans=this.journal.launches.plans;if(plans.some(x=>x.id===id))return;
    if(plans.length>=30)throw new Error('最多保存 30 个待开售项目');
    plans.push({id,name:item.name,url:item.url,addedAt:this.now(),status:item.autoMint?'needs-budget':'needs-adapter'});await this.persist();
  }
  async remove(id){this.journal.launches.plans=this.journal.launches.plans.filter(x=>x.id!==id);await this.persist();}
}
