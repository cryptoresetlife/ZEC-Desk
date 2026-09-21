import {currentAccount,checkNoir,sendNoir,units} from './noir-provider.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function setupNoir({api,$,say}){
 let account=null,provider=null,waiting=null,generation=0,working=false,lastRecords='',nextCheck=0;const boundProviders=new WeakSet();
 const status=text=>{text=String(text).replace('请先在设置中登录官网','请在第 1 步填写官网口令并登录');if(text.includes('口令'))$('#quickgate').open=true;$('#noirstatus').textContent=text;$('#mintactivity').hidden=!(waiting||working);$('#mintactivitytext').textContent=text;};
 const stop=()=>{waiting=null;generation++;$('#noirconsent').checked=false;status(working?'已停止后续处理。如 Noir 已弹出付款，请在插件中拒绝；已广播交易不能撤销。':'已停止等待；不会发起新的付款请求');};
 function ready(){const p=window.noirwallet?.zcash;if(!p?.request)throw Error('此窗口未检测到 Noir。请用安装 Noir 的 Chrome 打开 http://localhost:8793/#noirmint，并允许插件在该网站运行');return p;}
 $('#noirdetect').onclick=()=>{status(window.noirwallet?.zcash?.request?'检测到 Noir zcash 接口，请点击“连接 Noir 钱包”；检测没有请求账户或签名':'未检测到 Noir zcash 接口。Noir 1.0.36 需使用 http://localhost:8793；点击“在 Chrome 连接 Noir”切换入口。请确认使用装有 Noir 的 Chrome 资料、扩展已启用并允许访问此网站，然后刷新。本版不会使用其他钱包接口代替 Noir。');};
 function action(id,fn){$(id).onclick=async()=>{const b=$(id);b.disabled=true;try{await fn();}catch{status('操作未完成。请检查 Noir 是否解锁、主网账户及网站连接权限；未自动重试。');}finally{b.disabled=false;}};}
 async function balances(){if(!account||!provider)throw Error('请先连接 Noir');const a=currentAccount(await provider.request({method:'zcash_getAccounts'}));if(a.address!==account.address||a.transparent!==account.transparent){stop();account=null;throw Error('账户已变更，请重新连接');}const b=await provider.request({method:'zcash_getBalance',params:[]});$('#noiraccount').innerHTML='<p class="wallet-ready">✓ 已连接 · 透明余额 '+esc(b.transparent??'未知')+' ZEC · 屏蔽余额 '+esc(b.shielded??'未知')+' ZEC</p><p>NFT 接收地址：'+esc(a.address.slice(0,12))+'…'+esc(a.address.slice(-8))+'</p><details class="subdetails"><summary>核对完整钱包地址</summary><p>NFT 接收地址：<code>'+esc(a.address)+'</code></p><p>透明付款地址：<code>'+esc(a.transparent)+'</code></p></details>';return b;}
 action('#noirconnect',async()=>{if(working)throw Error('付款处理中');stop();account=null;$('#noiraccount').textContent='';provider=ready();status('正在请求连接 Noir，请在插件中确认本机网站授权；此步骤不会付款。');account=currentAccount(await provider.request({method:'zcash_requestAccounts'}));await balances();status('Noir 已连接。请在插件核对主网和当前账户，再设置价格上限。');if(provider.on&&!boundProviders.has(provider)){boundProviders.add(provider);for(const e of ['accountsChanged','chainChanged','disconnect'])provider.on(e,()=>{stop();account=null;$('#noiraccount').textContent='插件账户、网络或连接已改变，请重新连接';});}});
 action('#noirbalance',async()=>{await balances();status('Noir 余额已刷新；可付金额以付款前插件估算为准');});
 $('#noiropenchrome').onclick=()=>{if(window.chrome?.webview?.postMessage){window.chrome.webview.postMessage({type:'noir.open'});status('已请求在 Chrome 打开本机页面；若未打开，请复制上方地址到安装 Noir 的 Chrome。');}else{if(location.hostname!=='localhost'){location.href='http://localhost:8793/#noirmint';return;}location.hash='noirmint';status(window.noirwallet?.zcash?'已检测到 Noir，请点击连接插件':'请在当前 Chrome 安装或启用 Noir，并确认扩展可以访问本机页面');}};
 $('#noiruseaddress').onclick=()=>{if(!account){status('请先连接 Noir');return;}document.dispatchEvent(new CustomEvent('zec-desk-noir-address',{detail:{address:account.address}}));};
 $('#noirstop').onclick=stop;
 const budgetSummary=()=>{$('#noiradvancedsummary').textContent='手续费估算上限 '+$('#noirfee').value+' ZEC · 等待 '+$('#noirhours').value+' 小时 · 修改';};
 for(const id of ['#noirfee','#noirhours'])$(id).addEventListener('input',budgetSummary);
 budgetSummary();
 for(const id of ['#noirfunding','#noirprice','#noirfee','#noirhours','#noirconsent'])$(id).addEventListener('change',()=>{if(waiting)stop();});
 $('#noirwait').onclick=async()=>{if(working||waiting){status('已有 Noir 请求或等待，请勿重复启动');return;}try{provider=ready();if(!account)throw Error('请先连接 Noir');if(!$('#noirconsent').checked)throw Error('请先勾选付款确认说明');const c={address:account.address,projectId:'zaddr',quantity:1,maxPrice:$('#noirprice').value.trim(),maxFee:$('#noirfee').value.trim(),fundingSource:$('#noirfunding').value,expiresAt:Date.now()+Number($('#noirhours').value)*3600000};units(c.maxPrice);if(units(c.maxFee)<=0n)throw Error('手续费估算上限须大于 0');waiting={config:c,account:{...account}};generation++;nextCheck=0;status('正在读取官网 Public 状态；开放后会核对并请求 Noir 确认一笔付款');await tick();}catch(e){waiting=null;status(e.message);}};
 async function tick(){if(!waiting||working||Date.now()<nextCheck)return;working=true;const job=waiting,g=generation;let ticket=null;const live=()=>g===generation&&waiting===job;
  try{
   if(Date.now()>job.config.expiresAt)throw Error('等待已过期，请重新设置');
   const q=await api('noir/quote',job.config);if(!live())return;
   if(!q.ready){status('等待 ZADDR Public 开放'+(q.opens?' · 开售 '+new Date(q.opens).toLocaleString():''));nextCheck=Date.now()+((q.opens-Date.now())>60000?15000:2500);return;}
   let estimate;try{estimate=await checkNoir(provider,job.account,q.invoice,q.config);}catch(e){throw Error('Noir 付款预检未通过：'+(e.message.startsWith('Noir ')||e.message.startsWith('所选 ')?e.message:'插件未能提供手续费估算，请核对插件版本、余额和连接权限'));}
   if(!live())return;
   $('#noirpreview').innerHTML='<h3>本次请求 · 1 枚</h3><p>价格 '+esc(q.invoice.price)+' ZEC · 插件估算手续费 '+esc(estimate.fee)+' ZEC</p><p>付款余额：'+(q.config.fundingSource==='transparent'?'透明余额':'屏蔽余额')+'</p><p>项目收款地址：<code>'+esc(q.invoice.to)+'</code></p><p>memo：<code>'+esc(q.invoice.memo)+'</code></p><p>请在 Noir 核对这些内容和最终手续费。不会因取消、失败或超时自动重发。</p>';
   ticket=await api('noir/begin',{id:q.id});if(!live()){await api('noir/report',{taskId:ticket.taskId});return;}
   status('Public 已开放，正在唤起 Noir。请在插件中核对并确认付款；尚未取得交易 ID。');
   let txid;try{txid=await sendNoir(provider,ticket,job.account,live);}catch{await api('noir/report',{taskId:ticket.taskId}).catch(()=>{});throw Error('Noir 未返回有效交易 ID。请检查插件交易记录；本次不会自动重发。');}
   $('#noirpreview').innerHTML+='<p>插件返回的交易 ID：<code>'+esc(txid)+'</code></p>';await api('noir/report',{taskId:ticket.taskId,txid});status('Noir 已返回交易 ID，等待 ZADDR 确认发放。不会再次请求付款。');waiting=null;
  }catch(e){waiting=null;status(ticket?'付款请求已记录，请核对 Noir 交易记录；如已发出，在下方补录交易 ID。不会自动重发。':e.message);}
  finally{working=false;$('#mintactivity').hidden=!waiting;}
 }
 setInterval(()=>void tick(),1500);
 window.addEventListener('pagehide',()=>{waiting=null;generation++;});
 $('#noirrecords').addEventListener('click',async e=>{const btn=e.target.closest('button[data-noir-progress],button[data-noir-receipt]');if(!btn)return;btn.disabled=true;try{if(btn.dataset.noirReceipt){const txid=btn.closest('article').querySelector('input').value.trim();if(!/^[a-f0-9]{64}$/i.test(txid))throw Error('请从 Noir 复制完整的 64 位交易 ID');await api('noir/report',{taskId:btn.dataset.noirReceipt,txid});}const r=await api('noir/progress',{taskId:btn.dataset.noirProgress||btn.dataset.noirReceipt});status(r.note);}catch(e){status(e.message);}finally{btn.disabled=false;}});
 let lastProgress=0;
 return s=>{const records=(s.tasks||[]).filter(t=>t.config.walletMode==='noir');const html=records.slice().reverse().map(t=>'<article><b>ZADDR · Noir</b><p>'+esc(t.note)+'</p><p>接收地址：<code>'+esc(t.config.address)+'</code></p><p>状态：'+esc(t.status==='done'?'官网已确认发放':t.status==='broadcast'?'等待官网确认':'请求已记录，需核对插件结果')+'</p>'+(t.attempts[0]?.txid?'<p>交易 ID：<code>'+esc(t.attempts[0].txid)+'</code></p><button class="ghost" data-noir-progress="'+esc(t.id)+'">查询官网发放</button>':'<label>已付款但回执丢失？从 Noir 复制交易 ID<input placeholder="仅填写交易 ID，不是私钥"></label><button class="ghost" data-noir-receipt="'+esc(t.id)+'">补录并核对发放</button>')+'</article>').join('')||'<p>暂无 Noir 付款尝试。</p>';if(html!==lastRecords){lastRecords=html;$('#noirrecords').innerHTML=html;}
  const pending=records.find(t=>t.status==='broadcast');if(pending&&Date.now()-lastProgress>10000){lastProgress=Date.now();void api('noir/progress',{taskId:pending.id}).catch(()=>{});}
 };
}
