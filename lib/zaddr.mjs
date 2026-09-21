export const SITE = 'https://zaddr.studio';
export class Zaddr {
  cookie = ''; last = null; live = []; checkedAt = null; error = '';
  async request(path, options = {}) {
    if (!path.startsWith('/api/')) throw new Error('接口路径无效');
    const r = await fetch(SITE + path, { ...options, redirect:'error', signal:AbortSignal.timeout(10000), headers:{'accept':'application/json',...(this.cookie ? {cookie:this.cookie} : {}),...options.headers} });
    if (r.status === 401 || r.status === 403) throw new Error('官网需要访问口令，请先在设置中登录官网');
    if (r.status === 429) throw new Error('官网限流，已暂停本次检查，稍后重试');
    if (!r.ok) throw new Error(`官网接口 HTTP ${r.status}`);
    const body = await r.text();
    if (body.length > 2000000) throw new Error('官网响应过大');
    let d; try { d = JSON.parse(body); } catch { throw new Error('官网返回格式改变，请核对官网'); }
    if (d.error || d.gate) throw new Error(d.gate ? '官网需要访问口令' : '官网拒绝本次请求，请核对地址与资格');
    return d;
  }
  async login(password) {
    if (!password || password.length > 200) throw new Error('请填写官网访问口令');
    const r = await fetch(SITE+'/gate', {method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password,next:'/mint'})});
    const cookies = r.headers.getSetCookie().map(x=>x.split(';')[0]);
    if (r.status < 300 || r.status > 399 || !cookies.length) throw new Error('官网口令未通过');
    this.cookie=cookies.join('; ');
    await this.scan();
  }
  async state(address='') {
    const d=await this.request('/api/mint'+(address?'?address='+encodeURIComponent(address):''));
    if (!Array.isArray(d.rounds) || d.network!=='main' || !Number.isSafeInteger(d.now)) throw new Error('官网网络或状态格式与已验证版本不一致');
    return d;
  }
  async scan() {
    try { this.last=await this.state(); this.checkedAt=Date.now(); this.error='';
      const d=await this.request('/api/live?limit=40'); this.live=Array.isArray(d.mints)?d.mints.filter(x=>Number.isSafeInteger(x.face)).slice(0,40):[];
    } catch(e) { this.error=e.message; throw e; }
  }
  progress(address,txid) {return this.request('/api/mint/progress?'+new URLSearchParams({address,txid}));}
  claim(address) {return this.request('/api/mint/claim',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({address})});}
  view() {return {last:this.last,checkedAt:this.checkedAt,error:this.error,live:this.live,accessReady:!!this.cookie};}
}
