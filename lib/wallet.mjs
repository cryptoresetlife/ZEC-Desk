import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createInterface} from 'node:readline';
import {join} from 'node:path';
const exec=promisify(execFile);
export class Wallet {
  child=null;pending=new Map();seq=0;ready=false;view={ready:false};starting=false;poisoned=false;
  constructor(root){this.root=root;}
  async start(create=false) {
    if(this.ready){if(create)throw new Error('已有钱包正在使用，请使用当前钱包');return this.status();}if(this.starting)throw new Error('钱包正在启动');
    if(this.poisoned)throw new Error('钱包响应超时，先退出软件并核对钱包记录后再打开');
    this.starting=true;
    try {
      const {stdout}=await exec('wsl.exe',['-d','Ubuntu','--','wslpath','-u',join(this.root,'native','zingo-deskwallet')],{windowsHide:true,timeout:10000});
      const bin=stdout.trim();
      // All shell text is constant. Executable path is passed as a separate positional argument.
      const script='umask 077; d="$HOME/.local/share/zec-desk/wallet-mainnet"; '+(create?'test ! -f "$d/zingo-wallet.dat" || exit 46; mkdir -p "$d"; chmod 700 "$d"; ':'test -f "$d/zingo-wallet.dat" || exit 44; ')+'exec 9>"$d/zec-desk.lock"; flock -n 9 || exit 45; exec "$1" --data-dir "$d" --chain mainnet --server https://zec.rocks:443 desk_stdio';
      this.child=spawn('wsl.exe',['-d','Ubuntu','--','sh','-c',script,'zec-desk',bin],{windowsHide:true,stdio:['pipe','pipe','pipe']});
      const child=this.child;
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{this.poisoned=true;reject(new Error('钱包启动超时，请核对轻钱包网络连接'));},90000);
        const rl=createInterface({input:child.stdout});
        rl.on('line',line=>{
          if(line==='ZEC_DESK_READY'){this.ready=true;clearTimeout(timer);resolve();return;}
          if(!line.startsWith('ZEC_DESK_JSON:'))return;
          try {const m=JSON.parse(line.slice(14));const p=this.pending.get(m.id);if(p){clearTimeout(p.timer);this.pending.delete(m.id);p.resolve(m.result);}}catch{}
        });
        child.stderr.on('data',()=>{}); // never echo wallet internals, addresses or backup material
        child.on('error',()=>{clearTimeout(timer);reject(new Error('无法启动本机 Ubuntu 钱包组件'));});
        child.on('exit',code=>{clearTimeout(timer);this.ready=false;this.view={...this.view,ready:false};this.child=null;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('钱包进程退出，操作结果待核实'));}this.pending.clear();reject(new Error(code===44?'尚未创建独立钱包，请先点击创建':code===45?'独立钱包正在被另一个进程使用':code===46?'独立钱包已存在，请点击启动已有钱包':'钱包组件退出，请检查网络或重启软件'));});
      });
      return await this.status();
    } finally {this.starting=false;}
  }
  async command(command,args=[]) {
    if(!this.ready||!this.child||this.poisoned)throw new Error('钱包尚未连接或状态不确定');
    const id=++this.seq;
    const raw=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);this.poisoned=true;reject(new Error('钱包操作超时，结果需核对'));},command==='confirm'?180000:60000);
      this.pending.set(id,{resolve,reject,timer});
      this.child.stdin.write(JSON.stringify({id,command,args})+'\n');
    });
    let data;try{data=JSON.parse(raw);}catch{data=raw;}
    if((typeof data==='string'&&/^(error|failed)/i.test(data))||data?.error)throw new Error('钱包拒绝本次操作，请核对同步状态、可用余额与参数');
    return data;
  }
  async status(){
    const addresses=await this.command('addresses');const funds=await this.command('spendable_balance');
    const sync=await this.command('sync',['status']);
    this.view={ready:true,addresses:Array.isArray(addresses)?addresses.map(x=>x.encoded_address).filter(x=>typeof x==='string'&&x.startsWith('u1')):[],spendable:funds.spendable_balance,sync};return this.view;
  }
  async check(address){
    const s=await this.status();if(!s.addresses.includes(address))throw new Error('接收地址不属于当前本地签名钱包');
    if(s.sync?.percentage_total_outputs_scanned!==100)throw new Error('钱包扫描尚未完成，请等待同步');
    const info=await this.command('info'); const height=await this.command('height',['false']);
    if(!['main','mainnet'].includes(info.chain_name))throw new Error('轻钱包服务不是 ZEC 主网');
    if(!Number.isSafeInteger(info.latest_block_height)||!Number.isSafeInteger(height.height)||info.latest_block_height-height.height>1||height.height>info.latest_block_height+1)throw new Error('钱包尚未追上主网，请等同步完成');
    if(!Number.isSafeInteger(s.spendable)||s.spendable<0)throw new Error('无法核实可用余额');
    return s;
  }
  async propose(i){return this.command('send',[JSON.stringify([{address:i.to,amount:i.amount,memo:i.memo}])]);}
  async confirm(){return this.command('confirm');}
  async close(){if(this.ready&&!this.poisoned)await this.command('quit').catch(()=>{});else this.child?.stdin.end();}
}
