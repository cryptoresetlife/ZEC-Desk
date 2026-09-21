import {createHash,randomUUID} from 'node:crypto';
export function zats(v) {
  if (typeof v!=='string' || !/^(0|[1-9]\d{0,7})(\.\d{1,8})?$/.test(v)) throw new Error('ZEC 金额格式不正确，最多 8 位小数');
  const [a,b='']=v.split('.'); const n=BigInt(a)*100000000n+BigInt(b.padEnd(8,'0'));
  if(n>21000000n*100000000n) throw new Error('金额超出范围'); return n;
}
export function validateConfig(c) {
  if(c?.projectId!==undefined&&c.projectId!=='zaddr')throw new Error('该项目尚未适配自动 mint，不能使用 ZADDR 的付款流程');
  if(!c || !/^u1[a-z0-9]{50,500}$/.test(c.address||'')) throw new Error('请选择本地钱包的主网 Unified 收款地址');
  if(!Number.isInteger(c.quantity)||c.quantity<1||c.quantity>3) throw new Error('数量须为 1–3');
  zats(c.maxPrice); zats(c.maxFee);
  if(zats(c.maxFee)<=0n) throw new Error('手续费上限必须大于 0');
  if(!Number.isSafeInteger(c.expiresAt)||c.expiresAt<=Date.now()||c.expiresAt>Date.now()+7*86400000) throw new Error('任务有效期须在未来 7 天内');
  return {projectId:'zaddr',address:c.address,quantity:c.quantity,maxPrice:c.maxPrice,maxFee:c.maxFee,expiresAt:c.expiresAt};
}
export function evaluate(s,c) {
  if(s.network!=='main'||!Number.isSafeInteger(s.now)) throw new Error('不是已验证的主网状态');
  if(s.addressError || s.address!==c.address) throw new Error('官网未确认当前 NFT 接收地址');
  if(s.soldOut===true) throw new Error('项目已售罄');
  if(s.round?.audience!=='public') return null;
  if(s.round.state!=='live'||s.canMint!==true) return null;
  if(s.now < s.round.start || (s.round.end!=null && s.now>=s.round.end)) return null;
  if(!Number.isInteger(s.remaining)||s.remaining<1 || !Number.isInteger(s.left)||s.left<1) throw new Error('额度或库存不足');
  if(!Number.isInteger(s.limit)||s.limit<1||s.limit>3) throw new Error('官网限额改变，请重新核对');
  const price=zats(String(s.price));
  if(price>zats(c.maxPrice)) throw new Error('官网价格超过你设置的上限');
  if(price===0n) { if(s.free!==true) throw new Error('免费状态不一致'); return {free:true,price:'0',amount:0}; }
  if(s.free===true || s.watched!==true) throw new Error('官网收款监测未就绪');
  if(typeof s.payTo!=='string'||!(/^(u1|zs)[a-z0-9]{50,500}$/.test(s.payTo))) throw new Error('官网未提供可携带 memo 的收款地址');
  if(typeof s.memo!=='string'||!s.memo.includes(c.address)||Buffer.byteLength(s.memo,'utf8')>512||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s.memo)) throw new Error('官网 memo 缺失或不匹配接收地址');
  return {free:false,price:String(s.price),amount:Number(price),to:s.payTo,memo:s.memo};
}
export class Engine {
  busy=false; active=false; generation=0;
  constructor({site,wallet,journal,persist}) {Object.assign(this,{site,wallet,journal,persist}); this.task=null;
    for(const t of journal.tasks) if(['waiting','preparing'].includes(t.status)) {t.status='stopped';t.note='软件重启，需重新检查并启动';}
    // Any attempt recorded before broadcast is indeterminate after a crash.
    for(const t of journal.tasks) if(t.status==='sending') {t.status='unknown';t.note='发送途中进程中断，禁止自动重发，请核对钱包记录';}
  }
  async arm(c) {
    c=validateConfig(c);
    if(this.active||this.busy) throw new Error('已有任务在运行或付款处理中');
    if(this.journal.tasks.some(t=>t.config.address===c.address && (t.attempts?.length>0 || ['sending','unknown','broadcast','issued','done','claimed'].includes(t.status)))) throw new Error('该地址已有发送或铸造记录，禁止重复启动；请先在官网核对');
    this.busy=true;const startGeneration=this.generation;
    try {
    await this.wallet.check(c.address);
    if(this.generation!==startGeneration)throw new Error('启动已取消');
    const t={id:randomUUID(),config:c,status:'waiting',count:0,attempts:[],createdAt:Date.now(),note:'只等待 Public；白名单阶段不会付款'};
    this.journal.tasks.push(t);await this.persist(); this.task=t;this.active=true;this.generation++;
    return t;
    } finally {this.busy=false;}
  }
  async stop() {this.active=false;this.generation++;if(this.task&&['waiting','preparing'].includes(this.task.status)) {this.task.status='stopped';this.task.note='已停止，尚未广播';}await this.persist();}
  async tick() {
    if(this.busy||!this.active||!this.task||Date.now()<(this.nextCheckAt||0)) return;
    this.busy=true;const t=this.task,g=this.generation;
    const live=()=>this.active&&g===this.generation;
    try {
      if(t.status==='broadcast') {
        this.nextCheckAt=Date.now()+5000;
        const a=t.attempts.at(-1);const p=await this.site.progress(t.config.address,a.txid);
        // A rise in holdings alone can be an unrelated transfer. Require the matching transaction and issued step.
        if(p.txid===a.txid && Array.isArray(p.steps) && p.steps.some(x=>x.key==='issued'&&x.done===true)) {
          a.issued=true;t.count++;t.status=t.count>=t.config.quantity?'done':'issued';t.note='官网确认已发放 NFT';await this.persist();
          if(t.status==='done') this.active=false;else this.nextCheckAt=0;
        } else {t.note='已广播，等待官网按该交易确认并发放；不会重发';}
        return;
      }
      if(Date.now()>t.config.expiresAt) throw new Error('任务已过有效期');
      let s;try{s=await this.site.state(t.config.address);}catch(e){t.note=e.message;this.nextCheckAt=Date.now()+10000;return;}
      if(!live()) return;
      const invoice=evaluate(s,t.config);
      if(!invoice) {t.note='等待官网确认 Public 开放';const opens=s.rounds?.find(r=>r.audience==='public')?.start;this.nextCheckAt=Date.now()+((opens-s.now)>60000?15000:1500);return;}
      t.status='preparing';t.note='Public 已开放，正在核对钱包与手续费';
      await this.wallet.check(t.config.address); if(!live())return;
      let fee=0;
      if(!invoice.free) {const proposal=await this.wallet.propose(invoice);fee=proposal.fee;
        if(!Number.isSafeInteger(fee)||fee<0||BigInt(fee)>zats(t.config.maxFee)) throw new Error('实际手续费超过上限或无法核实');}
      const fresh=await this.site.state(t.config.address);const again=evaluate(fresh,t.config);
      if(!again||JSON.stringify(invoice)!==JSON.stringify(again)) throw new Error('付款条件改变，已停止，请重新核对');
      if(!live()||Date.now()>t.config.expiresAt)return;
      const a={at:Date.now(),invoice,fee,fingerprint:createHash('sha256').update(JSON.stringify(invoice)).digest('hex')};
      t.attempts.push(a);t.status='sending';t.note='签名发送中';await this.persist(); // durable before any fund-moving call
      if(!live()) {t.status='stopped';t.note='发送前已停止';await this.persist();return;}
      try {
        if(invoice.free) {const r=await this.site.claim(t.config.address); if(r.ok!==true||!Number.isInteger(r.face)) throw new Error('免费领取结果未确认');a.face=r.face;t.count++;t.status=t.count>=t.config.quantity?'done':'claimed';}
        else {const r=await this.wallet.confirm();if(!Array.isArray(r.txids)||r.txids.length!==1||!/^[0-9a-f]{64}$/i.test(r.txids[0])) throw new Error('发送回执未确认');a.txid=r.txids[0];t.status='broadcast';t.note='已广播，等待链上及官网确认';}
        await this.persist();if(t.status==='done')this.active=false;
      } catch {t.status='unknown';t.note='发送结果不明，已锁定该地址，禁止自动重发；请核对钱包交易记录';this.active=false;await this.persist();}
    } catch(e) {this.active=false;if(t.status==='sending'){t.status='unknown';t.note='记录写入异常，已停止；核对钱包前禁止重试';}else{t.status='stopped';t.note=e.message;}await this.persist();}
    finally {this.busy=false;}
  }
}
