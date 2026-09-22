import {randomUUID} from 'node:crypto';
import {zats} from './engine.mjs';

export const decimal=n=>`${BigInt(n)/100000000n}.${(BigInt(n)%100000000n).toString().padStart(8,'0')}`;
const fail=s=>{throw Error(s);};
const amount=v=>zats(typeof v==='string'?v:fail('官网价格格式改变，已停止'));
const listingId=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v);
const faceId=v=>Number.isInteger(v)&&v>=1&&v<=2800;
export function sweepConfig(raw,now=Date.now()){
  const c={address:raw?.address,below:raw?.below,total:raw?.total,quantity:raw?.quantity,maxFee:raw?.maxFee,expiresAt:raw?.expiresAt};
  if(!/^u1[a-z0-9]{50,500}$/.test(c.address||''))fail('请选择独立钱包的接收地址');
  if(amount(c.below)<=0n||amount(c.total)<=0n||amount(c.maxFee)<=0n)fail('价格、总预算和手续费上限须大于 0');
  if(amount(c.total)<=amount(c.maxFee))fail('总预算必须高于单笔手续费上限');
  if(!Number.isInteger(c.quantity)||c.quantity<1||c.quantity>2800)fail('最多购买数量须为 1–2800 的整数');
  if(!Number.isSafeInteger(c.expiresAt)||c.expiresAt<=now||c.expiresAt>now+7*86400000)fail('截止时间须在未来 7 天内');
  return c;
}
export function marketSnapshot(raw,now=Date.now()){
  if(typeof raw?.open!=='boolean'||!Array.isArray(raw.listings)||raw.listings.length>10000)fail('市场响应格式改变');
  const seen=new Set(),faces=new Set();
  const items=raw.listings.map(l=>{
    if(!listingId(l.id)||!faceId(l.face)||typeof l.reserved!=='boolean'||seen.has(l.id)||faces.has(l.face))fail('挂单数据不完整或重复');
    if(amount(l.price)<=0n)fail('挂单价格无效');
    seen.add(l.id);faces.add(l.face);return {id:l.id,face:l.face,price:l.price,reserved:l.reserved};
  }).sort((a,b)=>amount(a.price)<amount(b.price)?-1:amount(a.price)>amount(b.price)?1:a.face-b.face);
  return {open:raw.open,items,checkedAt:now};
}
export function eligible(snapshot,c,blocked=new Set()){
  if(!snapshot?.open)return [];
  return snapshot.items.filter(l=>!l.reserved&&!blocked.has(l.id)&&!blocked.has('face:'+l.face)&&amount(l.price)<amount(c.below));
}
export function invoiceFor(r,l,c,now=Date.now()){
  const until=Date.parse(r?.until);
  if(r?.ok!==true||r.id!==l.id||r.face!==l.face||r.to!==c.address||r.price!==l.price||!Number.isFinite(until)||until<=now+60000)fail('预订回执与挂单不一致或付款时间不足');
  if(amount(r.price)>=amount(c.below))fail('挂单价格已达到或超过阈值');
  if(!/^(u1|zs)[a-z0-9]{50,500}$/.test(r.payTo||''))fail('官网未提供有效的屏蔽收款地址');
  if(typeof r.memo!=='string'||!r.memo.includes(c.address)||!r.memo.includes(l.id)||Buffer.byteLength(r.memo)>512||/[\x00-\x1f]/.test(r.memo))fail('官网 memo 未匹配接收地址与挂单，已停止付款');
  return {to:r.payTo,price:r.price,amount:Number(amount(r.price)),memo:r.memo,until};
}
export class MarketAPI{
  constructor(site){this.site=site;}
  read(){return this.site.request('/api/market');}
  listing(id,address){return this.site.request('/api/listing?'+new URLSearchParams({id,to:address}));}
  reserve(id,to){return this.site.request('/api/reserve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,to,method:'zec'})});}
  release(id,to){return this.site.request('/api/unreserve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,to})});}
  progress(id,address){return this.site.request('/api/buy/progress?'+new URLSearchParams({listing:id,address}));}
  mine(address){return this.site.request('/api/mine?'+new URLSearchParams({address}));}
}
export class Sweep{
  active=false;busy=false;scanBusy=false;generation=0;nextAt=0;snapshot=null;error='';previews=new Map();
  constructor({market,wallet,journal,persist,otherBusy=()=>false,backedUp=()=>false,now=Date.now}){
    Object.assign(this,{market,wallet,journal,persist,otherBusy,backedUp,now});
    journal.sweeps??=[];
    if(!Array.isArray(journal.sweeps))fail('扫货记录损坏，停止启动');
    for(const t of journal.sweeps){
      if(t.status==='sending'){t.status='unknown';t.note='发送途中退出，禁止自动重发，请核对钱包和官网';}
      else if(['waiting','preparing'].includes(t.status)){t.status='stopped';t.note='软件重启，需重新预检并确认';}
    }
    this.task=journal.sweeps.at(-1)||null;
  }
  blocked(){return new Set(this.journal.sweeps.flatMap(t=>(t.attempts||[]).flatMap(a=>[a.id,'face:'+a.face])));}
  unresolved(){return this.journal.sweeps.some(t=>t.attempts?.some(a=>!a.settled));}
  guard(){if(this.active||this.busy||this.otherBusy())fail('已有付款任务运行，请先停止或核对付款结果');if(this.wallet.syncBusy||this.wallet.starting)fail('钱包正在同步或启动，请稍后预检');if(this.unresolved())fail('存在尚未确认的扫货付款，请先核对记录；不会重复发送');if(!this.backedUp())fail('请先打开并备份独立钱包');}
  async refresh(){
    if(this.scanBusy)return;this.scanBusy=true;
    try{this.snapshot=marketSnapshot(await this.market.read(),this.now());this.error='';}
    catch(e){this.error=e.message;throw e;}finally{this.scanBusy=false;}
  }
  async preview(raw){
    this.guard();this.busy=true;
    try{
      const config=sweepConfig(raw,this.now()),w=await this.wallet.check(config.address);
      if(BigInt(w.spendable)<amount(config.total))fail('独立钱包可用屏蔽余额低于总预算');
      await this.refresh();if(this.error||!this.snapshot?.open)fail('市场未开放或读取失败');
      const id=randomUUID();this.previews.clear();this.previews.set(id,{config,at:this.now()});
      return {id,config,matches:eligible(this.snapshot,config,this.blocked()).length};
    }finally{this.busy=false;}
  }
  async arm(id,confirm){
    this.guard();const p=this.previews.get(id);this.previews.delete(id);
    if(confirm!==true||!p||this.now()-p.at>120000)fail('请重新预检并确认预算');
    this.busy=true;const generation=this.generation;
    try{
      const c=sweepConfig(p.config,this.now()),w=await this.wallet.check(c.address);
      if(this.generation!==generation)fail('启动已取消');
      if(BigInt(w.spendable)<amount(c.total))fail('可用屏蔽余额不足');
      const t={id:randomUUID(),config:c,at:this.now(),status:'waiting',note:'等待低于阈值的可购买挂单',count:0,spent:'0',attempts:[]};
      this.journal.sweeps.push(t);await this.persist();
      if(this.generation!==generation){t.status='stopped';t.note='启动已取消';await this.persist();return;}
      this.task=t;this.generation++;this.active=true;this.nextAt=0;
    }finally{this.busy=false;}
  }
  async stop(){
    this.active=false;this.generation++;this.previews.clear();
    if(this.task&&['waiting','preparing'].includes(this.task.status)){this.task.status='stopped';this.task.note='已停止，尚未发送的挂单不会付款';}
    await this.persist();
  }
  async reconcile(){
    if(this.busy)return;this.busy=true;
    try{
      for(const t of this.journal.sweeps){const a=t.attempts?.at(-1);if(!a||a.settled)continue;
        const p=await this.market.progress(a.id,t.config.address);
        // Require the exact listing/address query, expected face, and current ownership.
        if(p?.ok===true&&p.got===true&&p.face===a.face){
          const mine=await this.market.mine(t.config.address);
          if(!Array.isArray(mine?.faces)||!mine.faces.some(f=>f.face===a.face))continue;
          a.settled=true;t.count++;t.status=this.active&&this.task===t?'waiting':'done';t.note='官网确认接收地址已持有对应 NFT';
          if(t.count>=t.config.quantity){t.status='done';if(this.task===t)this.active=false;}
          await this.persist();
        }else if(p?.stalled){this.active=false;t.note='官网报告结算异常，已停止后续购买；请核对官网';await this.persist();}
      }
    }finally{this.busy=false;}
  }
  async tick(){
    if(this.busy||this.wallet.syncBusy||this.wallet.starting||!this.active||this.now()<this.nextAt)return;
    if(this.task?.status==='broadcast'){this.nextAt=this.now()+10000;try{await this.reconcile();}catch{this.task.note='等待官网确认，读取失败不会重发';}return;}
    this.busy=true;const t=this.task,g=this.generation;let reserved=null,intent=false;
    const live=()=>this.active&&g===this.generation&&this.now()<t.config.expiresAt;
    try{
      if(!live())fail('任务已到截止时间');
      if(this.otherBusy())fail('其他付款任务占用钱包，已停止');
      if(t.count>=t.config.quantity||amount(t.spent)+amount(t.config.maxFee)>=amount(t.config.total)){this.active=false;t.status='done';t.note='已达到数量或预算上限';await this.persist();return;}
      this.nextAt=this.now()+10000;
      await this.refresh();if(!live())return;
      if(this.error||!this.snapshot?.open)fail('市场不可用，已停止');
      const mine=await this.market.mine(t.config.address);
      if(!Array.isArray(mine?.faces)||!Array.isArray(mine?.listings))fail('无法核实已有 NFT 和本人挂单');
      const owned=new Set([...mine.faces,...mine.listings].map(f=>f.face));
      const l=eligible(this.snapshot,t.config,this.blocked()).find(l=>!owned.has(l.face)&&amount(t.spent)+amount(l.price)+amount(t.config.maxFee)<=amount(t.config.total));
      if(!l){t.note='等待符合价格及剩余预算的挂单';return;}
      const w=await this.wallet.check(t.config.address);if(!live())return;
      if(BigInt(w.spendable)<amount(l.price)+amount(t.config.maxFee))fail('钱包可用余额不足，已停止');
      const before=await this.market.listing(l.id,t.config.address);if(!live())return;
      if(before.id!==l.id||before.face!==l.face||before.price!==l.price||before.reservedByOther!==false){t.note='挂单已变化，等待下一轮';return;}
      t.status='preparing';t.note='正在锁定挂单并核对付款';
      // Reservation does not send funds. On timeout stop, without retrying it.
      reserved={id:l.id};const r=await this.market.reserve(l.id,t.config.address);if(!live())return;
      const invoice=invoiceFor(r,l,t.config,this.now());
      const proposal=await this.wallet.propose(invoice);if(!live())return;
      const fee=proposal?.fee;
      if(!Number.isSafeInteger(fee)||fee<0||BigInt(fee)>amount(t.config.maxFee))fail('实际手续费无法核实或超过上限');
      const cost=amount(l.price)+BigInt(fee);
      if(amount(t.spent)+cost>amount(t.config.total))fail('付款将超过总预算');
      const fresh=await this.market.listing(l.id,t.config.address);
      if(fresh.id!==l.id||fresh.face!==l.face||fresh.price!==invoice.price||fresh.reservedForYou!==true||fresh.reservedByOther!==false||fresh.payTo!==invoice.to||fresh.memo!==invoice.memo||Date.parse(fresh.reservedUntil)!==invoice.until)fail('预订或付款条件发生变化，已停止');
      if(!live()||invoice.until<=this.now()+60000)return;
      const a={id:l.id,face:l.face,price:l.price,fee,invoice,at:this.now(),settled:false};
      t.attempts.push(a);t.spent=decimal(amount(t.spent)+cost);t.status='sending';t.note='签名发送中';intent=true;
      await this.persist(); // No transfer may happen without a durable intent and budget debit.
      if(!live()){a.settled=true;a.cancelled=true;t.spent=decimal(amount(t.spent)-cost);t.status='stopped';intent=false;await this.persist();return;}
      const sent=await this.wallet.confirm();
      if(!Array.isArray(sent?.txids)||sent.txids.length!==1||!/^[a-f0-9]{64}$/i.test(sent.txids[0]))fail('付款回执不确定');
      a.txid=sent.txids[0];t.status='broadcast';t.note='已广播，等待官网确认 NFT 到账后再购买下一枚';await this.persist();
    }catch(e){
      this.active=false;t.status=intent?'unknown':'stopped';t.note=intent?'付款结果或记录不确定，已锁定；请核对钱包与官网，禁止重发':e.message;await this.persist();
    }finally{
      if(reserved&&!intent)await this.market.release(reserved.id,t.config.address).catch(()=>{});
      if(t.status==='preparing'){t.status='stopped';t.note='付款前已停止或时间不足';this.active=false;await this.persist();}
      this.busy=false;
    }
  }
  view(){return {active:this.active,busy:this.busy,snapshot:this.snapshot,error:this.error,task:this.task,records:this.journal.sweeps.slice(-20),unresolved:this.unresolved()};}
}
