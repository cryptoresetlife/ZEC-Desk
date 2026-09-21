import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createInterface} from 'node:readline';
import {join} from 'node:path';
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {macWalletPath} from './platform.mjs';
const exec=promisify(execFile);
export function walletScanComplete(sync){
  return Number.isSafeInteger(sync?.sync_start_height)&&sync.sync_start_height>0&&Array.isArray(sync.scan_ranges)&&sync.scan_ranges.every(r=>r.priority==='Scanned');
}
export function syncFailure(raw){
  const text=typeof raw==='string'?raw:JSON.stringify(raw);
  if(/Unknown transaction format/i.test(text)){
    const error=new Error('当前 Zingo 组件不支持链上的新版交易格式，同步已停止。需升级兼容的钱包组件；继续等待或重复刷新不能解决。可改用 Noir 插件付款。');
    error.syncCode='unsupported-tx-format';return error;
  }
  const categories=[[/sync is already running/i,'busy'],[/chain verification|invalid frontier|invalid subtree|invalid transaction/i,'server-data'],[/server request failed|gRPC|transport|connection|deadline|timed out/i,'network'],[/shard tree|checkpoint|rescan required/i,'tree'],[/scan error|continuity/i,'scan'],[/wallet error|file error/i,'wallet'],[/mempool/i,'mempool']];
  const category=categories.find(([re])=>re.test(text))?.[1]||'unknown';
  const grpc=['Cancelled','Unknown','InvalidArgument','DeadlineExceeded','NotFound','AlreadyExists','PermissionDenied','ResourceExhausted','FailedPrecondition','Aborted','OutOfRange','Unimplemented','Internal','Unavailable','DataLoss','Unauthenticated'].find(x=>text.includes('code: '+x));
  const error=new Error('钱包同步任务失败，将稍后重试。请检查网络和轻钱包服务连接。');error.syncCode=category+(grpc?':'+grpc:'');return error;
}
export async function walletBinaryPath(root,run=exec,platform=process.platform){
  if(platform==='darwin'){
    const bin=join(root,'native','zingo-deskwallet');
    try{for(const name of ['zingo-deskwallet','nym-proxy','wallet-lock'])await fs.access(join(root,'native',name),constants.X_OK);return bin;}
    catch{throw Error('缺少可执行的 macOS 钱包组件，请完整解压对应芯片版本的程序。');}
  }
  try{
    const {stdout}=await run('wsl.exe',['-d','Ubuntu','--exec','wslpath','-u',join(root,'native','zingo-deskwallet').replaceAll('\\','/')],{windowsHide:true,timeout:10000});
    const bin=stdout.trim();if(!bin.startsWith('/')||/[\r\n\0]/.test(bin))throw Error('path');return bin;
  }catch{throw new Error('无法定位本机 Ubuntu 钱包组件。请确认已安装 WSL Ubuntu，并完整解压程序；此按钮打开软件的 Zingo 钱包，不连接 Chrome Noir 插件。');}
}
export class Wallet {
  child=null;pending=new Map();seq=0;ready=false;view={ready:false};starting=false;poisoned=false;
  syncBusy=false;syncError='';syncRetryAt=0;syncCode='';syncBlocked=false;
  constructor(root){this.root=root;}
  async start(create=false) {
    if(this.ready){if(create)throw new Error('已有钱包正在使用，请使用当前钱包');return this.status();}if(this.starting)throw new Error('钱包正在启动');
    if(this.poisoned)throw new Error('钱包响应超时，先退出软件并核对钱包记录后再打开');
    this.starting=true;
    try {
      const bin=await walletBinaryPath(this.root);
      // All shell text is constant. Executable path is passed as a separate positional argument.
      const script='umask 077; d="$HOME/.local/share/zec-desk/wallet-mainnet"; '+(create?'test ! -f "$d/zingo-wallet.dat" || exit 46; mkdir -p "$d"; chmod 700 "$d"; ':'test -f "$d/zingo-wallet.dat" || exit 44; ')+'exec 9>"$d/zec-desk.lock"; flock -n 9 || exit 45; exec "$1" --data-dir "$d" --chain mainnet --server https://zec.rocks:443 --desk-stdio';
      if(process.platform==='darwin'){
        const dir=macWalletPath();await fs.mkdir(dir,{recursive:true,mode:0o700});await fs.chmod(dir,0o700);
        this.child=spawn(join(this.root,'native','wallet-lock'),[dir,create?'create':'open',bin],{stdio:['pipe','pipe','pipe']});
      }else this.child=spawn('wsl.exe',['-d','Ubuntu','--exec','sh','-c',script,'zec-desk',bin],{windowsHide:true,stdio:['pipe','pipe','pipe']});
      const child=this.child;
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{this.poisoned=true;reject(new Error('钱包启动超时，请核对轻钱包网络连接'));},180000);
        const rl=createInterface({input:child.stdout});
        rl.on('line',line=>{
          if(line==='ZEC_DESK_READY'){this.ready=true;clearTimeout(timer);resolve();return;}
          if(!line.startsWith('ZEC_DESK_JSON:'))return;
          try {const m=JSON.parse(line.slice(14));const p=this.pending.get(m.id);if(p){clearTimeout(p.timer);this.pending.delete(m.id);p.resolve(m.result);}}catch{}
        });
        child.stderr.on('data',()=>{}); // never echo wallet internals, addresses or backup material
        child.on('error',()=>{clearTimeout(timer);reject(new Error('无法启动本机钱包组件，请检查安装包与系统兼容性'));});
        child.on('exit',code=>{clearTimeout(timer);this.ready=false;this.view={...this.view,ready:false};this.child=null;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('钱包进程退出，操作结果待核实'));}this.pending.clear();reject(new Error(code===44?'本软件尚未创建 Zingo 钱包；打开软件钱包不连接 Noir。做项目任务请添加 Noir 公开地址，自动付款请先创建独立钱包':code===45?'独立钱包正在被另一个进程使用':code===46?'独立钱包已存在，请点击打开软件钱包':'钱包组件退出，请检查网络或重启软件'));});
      });
      await this.syncTick();return this.view;
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
    if((typeof data==='string'&&/^(error|failed)/i.test(data))||data?.error){
      if(command==='sync')throw syncFailure(data);
      throw new Error('钱包拒绝本次操作，请核对同步状态、可用余额与参数');
    }
    return data;
  }
  async syncTick(){
    if(!this.ready||this.poisoned||this.syncBusy)return this.view;
    this.syncBusy=true;
    try{
      if(!this.syncBlocked&&Date.now()>=this.syncRetryAt){
        try{
          const result=await this.command('sync',['poll']);
          if(result!=='Sync task is not complete.')await this.command('sync',['run']);
          this.syncError='';this.syncRetryAt=0;this.syncCode='';
        }catch(e){
          this.syncCode=e.syncCode||'unknown';
          this.syncBlocked=this.syncCode==='unsupported-tx-format';
          this.syncError=this.syncBlocked?syncFailure('Unknown transaction format').message:'钱包同步任务失败，将稍后重试。请检查网络和轻钱包服务连接。';
          this.syncRetryAt=this.syncBlocked?0:Date.now()+60000;
        }
      }
      return await this.status();
    }finally{this.syncBusy=false;}
  }
  async status(){
    const addresses=await this.command('addresses');const funds=await this.command('spendable_balance');
    const sync=await this.command('sync',['status']);
    this.view={ready:true,addresses:Array.isArray(addresses)?addresses.map(x=>x.encoded_address).filter(x=>typeof x==='string'&&x.startsWith('u1')):[],spendable:funds.spendable_balance,sync,syncComplete:walletScanComplete(sync),syncError:this.syncError,syncCode:this.syncCode,syncRetryAt:this.syncRetryAt,syncCheckedAt:Date.now()};return this.view;
  }
  async check(address){
    const s=await this.status();if(!s.addresses.includes(address))throw new Error('接收地址不属于当前本地签名钱包');
    if(s.syncError)throw new Error(s.syncError);
    if(!walletScanComplete(s.sync))throw new Error('钱包扫描尚未完成，请到“独立钱包”查看同步进度；同步完成后再预检');
    const info=await this.command('info'); const height=await this.command('height');
    if(!['main','mainnet'].includes(info.chain_name))throw new Error('轻钱包服务不是 ZEC 主网');
    if(!Number.isSafeInteger(info.latest_block_height)||!Number.isSafeInteger(height.height)||info.latest_block_height-height.height>1||height.height>info.latest_block_height+1)throw new Error('钱包尚未追上主网，请等同步完成');
    if(!Number.isSafeInteger(s.spendable)||s.spendable<0)throw new Error('无法核实可用余额');
    return s;
  }
  async propose(i){return this.command('send',[JSON.stringify([{address:i.to,amount:i.amount,memo:i.memo}])]);}
  async confirm(){return this.command('confirm');}
  async close(){if(this.ready&&!this.poisoned)await this.command('quit').catch(()=>{});else this.child?.stdin.end();}
}
