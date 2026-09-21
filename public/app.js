import {setupNoir} from './noir-ui.js';
const $=s=>document.querySelector(s),token=$('meta[name=session-token]').content;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when=t=>t?new Date(t).toLocaleString('zh-CN',{timeZoneName:'short'}):'未设置';
let state=null,preview=null,dialogAction=null,dialogVersion=0,mutating=false;
function say(t){$('#message').hidden=!t;$('#message').textContent=t||'';}
async function api(path,data){let r;try{r=await fetch('/api/'+path,{method:data===undefined?'GET':'POST',...(data===undefined?{signal:AbortSignal.timeout(8000)}:path.startsWith('grok/')?{signal:AbortSignal.timeout(path==='grok/research'?330000:75000)}:{}),headers:{'x-zec-desk':token,'content-type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});}catch(e){if(path.startsWith('grok/')&&e.name==='TimeoutError')throw Error('等待 Grok 查询超时；后台状态会继续刷新，请勿连续提交，已发出的查询可能计入额度');throw e;}const d=await r.json();if(!r.ok)throw new Error(d.error||'操作失败');return d;}
function bind(id,fn){$(id).onclick=async()=>{if(mutating&&!['#stop','#groklogout','#grokcancel'].includes(id))return;const btn=$(id);mutating=true;btn.disabled=true;say('处理中…');try{await fn();if($('#message').textContent==='处理中…')say('操作完成');await refresh();}catch(e){say(e.message);}finally{mutating=false;btn.disabled=false;}};}
function dialog(title,content,action,confirm='确认'){dialogVersion++;$('#dialogtitle').textContent=title;$('#dialogbody').innerHTML=content;dialogAction=action;$('#dialogconfirm').textContent=confirm;$('#dialogconfirm').hidden=!action;if(!$('#dialog').open)$('#dialog').showModal();}
function clearDialog(){dialogVersion++;$('#dialogbody').textContent='';dialogAction=null;}
function closeDialog(){clearDialog();$('#dialog').close();}
$('#dialogclose').onclick=closeDialog;
$('#dialog').addEventListener('cancel',clearDialog);
$('#dialog').addEventListener('close',()=>{if(!$('#dialog').open)clearDialog();});
bind('#dialogconfirm',async()=>{const version=dialogVersion,action=dialogAction;if(action)await action();if(version===dialogVersion)closeDialog();});
bind('#login',async()=>{const password=$('#password').value;$('#password').value='';await api('site/login',{password});});
bind('#quicklogin',async()=>{const password=$('#quickpassword').value;$('#quickpassword').value='';$('#quicksitefeedback').textContent='正在登录官网…';try{await api('site/login',{password});$('#quickgate').open=false;$('#quicksitefeedback').textContent='官网已连接。继续连接钱包即可。';}catch(e){$('#quickgate').open=true;$('#quicksitefeedback').textContent=e.message;throw e;}});
bind('#quickrefresh',()=>api('scan',{}));
bind('#scan',()=>api('scan',{}));bind('#stopscan',()=>api('scan/stop',{}));
bind('#savesources',()=>api('sources',{urls:$('#sources').value.split('\n').map(s=>s.trim()).filter(Boolean)}));
bind('#createwallet',async()=>{dialog('创建独立自动签名钱包','<p>将在本机 Ubuntu 中创建新的 ZEC 热钱包。它与 Noir 的资金和助记词独立。创建后请立即备份，再充值。</p><p>自动任务启动后，此钱包可以在预算内付款，无需弹出插件确认。</p>',()=>api('wallet/start',{create:true}),'创建新钱包');});
bind('#startwallet',()=>api('wallet/start',{create:false}));bind('#refreshwallet',()=>api('wallet/status',{}));
bind('#walletaddresscopy',async()=>{
 const address=$('#address').value;
 if(!state?.wallet?.ready||!address||!state.wallet.addresses?.includes(address))throw Error('请先打开独立钱包并选择地址');
 try{await navigator.clipboard.writeText(address);say('已复制独立钱包充值地址，请在转出钱包核对完整地址。');}
 catch{dialog('复制独立钱包充值地址','<p>当前窗口无法自动写入剪贴板。下方已选中完整地址，请按 Ctrl+C 复制。</p><label>完整充值地址<input id="walletcopyfallback" readonly value="'+esc(address)+'"></label>',null);$('#walletcopyfallback').focus();$('#walletcopyfallback').select();say('请在弹窗中手动复制地址');}
});
bind('#backup',async()=>{dialog('本机查看备份','<p>下一步会在本机显示助记词。请离线保管，不要发到聊天、GitHub 或截图中。</p>',async()=>{const version=dialogVersion,d=await api('wallet/backup',{});if(version!==dialogVersion||!$('#dialog').open)return;const recovery=typeof d.recovery==='string'?d.recovery:JSON.stringify(d.recovery,null,2);if(!recovery?.trim()||['null','{}','[]'].includes(recovery.trim()))throw Error('未取得有效备份内容，请关闭后重新查看；不要确认已备份');dialog('备份独立钱包','<pre>'+esc(recovery)+'</pre><p>请记下完整助记词与生日区块。关闭后清除本窗口显示。</p>',()=>api('wallet/backed-up',{confirm:true}),'已离线保存备份');},'在本机显示');});
bind('#history',async()=>{const d=await api('wallet/history',{});dialog('本地钱包交易记录','<pre>'+esc(JSON.stringify(d.history,null,2))+'</pre>');});
bind('#preview',async()=>{preview=await api('preview',{projectId:'zaddr',address:$('#address').value,quantity:Number($('#quantity').value),maxPrice:$('#maxprice').value.trim(),maxFee:$('#maxfee').value.trim(),expiresAt:new Date($('#expiry').value).getTime()});const c=preview.config;$('#previewbox').hidden=false;$('#previewbox').innerHTML=`<h3>启动前核对</h3><p>${esc(preview.notice)}</p><p>接收地址：<code>${esc(c.address)}</code></p><p>数量 ${c.quantity} · 每枚上限 ${esc(c.maxPrice)} ZEC<br>每笔手续费上限 ${esc(c.maxFee)} ZEC<br><b>总预算上限 ${preview.budget} ZEC</b><br>任务截止 ${esc(when(c.expiresAt))}</p><p>官网 Public 时间：${esc(when(preview.round.start))}</p><button id="arm" class="danger">确认预算，启动全自动 mint</button>`;bind('#arm',async()=>{await api('arm',{previewId:preview.id,confirm:true});$('#previewbox').hidden=true;preview=null;say('任务已启动，等待 Public。电脑请保持开机且不休眠。');});});
for(const id of ['#quantity','#maxprice','#maxfee','#expiry','#address'])$(id).addEventListener('input',()=>{preview=null;$('#previewbox').hidden=true;});
bind('#stop',async()=>{await api('stop',{});say('已停止后续自动付款。已经签名或广播的交易仍可能完成。');});
bind('#exit',async()=>{await api('exit',{});say('软件后台已退出，可以关闭窗口。');});
function imageSources(src){
 if(!src)return [];
 try{const u=new URL(src,location.origin);if(['ipfs.io','gateway.pinata.cloud','cloudflare-ipfs.com','dweb.link','ipfs.filebase.io'].includes(u.hostname)&&u.pathname.startsWith('/ipfs/'))return ['https://gateway.pinata.cloud','https://ipfs.filebase.io'].map(base=>base+u.pathname+u.search);}catch{}
 return [src];
}
function thumb(src,label){const urls=imageSources(src);return '<span class="thumbnail"><span class="image-fallback">'+(urls.length?'图片加载中…':'未提供图片')+'</span>'+(urls.length?'<img src="'+esc(urls[0])+'" data-image-source="'+esc(src)+'" data-image-attempt="0" alt="'+esc(label)+'" loading="lazy" decoding="async" referrerpolicy="no-referrer" width="96" height="96">':'')+'</span>';}
// Public builds load provider images and exclude the local artwork cache.
function artwork(){return null;}
function setCards(id,html){const el=$(id);if(el.dataset.rendered!==html){el.innerHTML=html;el.dataset.rendered=html;}}
document.addEventListener('error',event=>{
 const img=event.target;if(!(img instanceof HTMLImageElement))return;
 const urls=imageSources(img.dataset.imageSource),next=Number(img.dataset.imageAttempt||0)+1;
 if(next<urls.length){img.dataset.imageAttempt=String(next);img.src=urls[next];return;}
 img.hidden=true;const box=img.closest('.thumbnail');if(box){box.classList.add('image-unavailable');box.querySelector('.image-fallback').innerHTML='加载失败<br><button class="image-retry" type="button">重试图片</button>';}
},true);
document.addEventListener('load',event=>{const img=event.target;if(img instanceof HTMLImageElement){const box=img.closest('.thumbnail');if(box){box.classList.remove('image-unavailable');box.querySelector('.image-fallback').textContent='';}}},true);
document.addEventListener('click',event=>{const btn=event.target.closest('.image-retry');if(!btn)return;const box=btn.closest('.thumbnail'),img=box.querySelector('img'),urls=imageSources(img.dataset.imageSource);box.querySelector('.image-fallback').textContent='图片加载中…';box.classList.remove('image-unavailable');img.hidden=false;img.dataset.imageAttempt='0';img.src=urls[0];});
bind('#marketrefresh',()=>api('projects/refresh',{}));
bind('#markettoggle',()=>api('projects/enabled',{enabled:!state?.projects?.enabled}));
bind('#addproject',async()=>{dialog('添加自选项目','<label>项目名称（选填）<input id="projectname" maxlength="160" placeholder="自己容易辨认的名字"></label><label>官网 / mint 页面链接<input id="projecturl" type="url" placeholder="https://..."></label><p>添加后定时监控公开网页，不会自动付款。动态网页或需要登录的页面可能无法读取。</p>',async()=>{await api('projects/add',{url:$('#projecturl').value.trim(),name:$('#projectname').value.trim()});say('已加入自选。可在“我的自选项目”查看。');},'添加并监控');});
$('#marketsearch').oninput=()=>{if(state)paintMarket(state.projects);};
for(const id of ['#marketfilter','#marketsort']){try{const v=localStorage.getItem(id);if(v&&[...$(id).options].some(o=>o.value===v))$(id).value=v;}catch{}$(id).onchange=()=>{try{localStorage.setItem(id,$(id).value);}catch{}if(state)paintMarket(state.projects);};}
let audioContext=null,soundOn=false,seenAlerts=null;
function tone(){if(!audioContext||audioContext.state!=='running')return;const o=audioContext.createOscillator(),g=audioContext.createGain();o.connect(g);g.connect(audioContext.destination);o.frequency.value=740;g.gain.setValueAtTime(0.07,audioContext.currentTime);g.gain.exponentialRampToValueAtTime(0.001,audioContext.currentTime+0.25);o.start();o.stop(audioContext.currentTime+0.25);}
bind('#alertsound',async()=>{if(soundOn){soundOn=false;$('#alertsound').textContent='开启提醒声音';return;}audioContext??=new AudioContext();await audioContext.resume();if(audioContext.state!=='running')throw new Error('声音未启用，请再次点击');seenAlerts=new Set(state?.projects?.alerts?.map(a=>a.id)||[]);soundOn=true;$('#alertsound').textContent='关闭提醒声音';tone();say('声音已开启；历史提醒不补响，请保持窗口打开。');});
bind('#alertsread',()=>api('projects/read',{}));
$('#watchlist').addEventListener('click',e=>{const b=e.target.closest('button[data-targetprice]');if(!b)return;const item=state?.projects?.items.find(x=>x.id===b.dataset.targetprice);if(!item)return;dialog('设置目标价提醒','<p>'+esc(item.name)+'</p><label>最低挂单价 ≤ · ZEC<input id="targetprice" inputmode="decimal" value="'+esc(amount(item.targetPrice))+'" placeholder="例如 0.1；留空关闭提醒"></label><p>下一次成功读取完整市场索引时开始判断。仅提醒，不会自动买入或 mint。</p>',async()=>{await api('projects/target',{id:item.id,price:$('#targetprice').value.trim()});say('目标价规则已保存，下一次成功刷新后判断。');},'保存规则');});
function paintAlerts(p){const alerts=p.alerts||[],unread=alerts.filter(a=>!a.read);$('#alerttitle').textContent='目标价提醒 · '+unread.length+' 条未读';setCards('#targetalerts',alerts.map(a=>'<p class="target-alert '+(a.read?'read':'')+'"><small>'+esc(when(a.at))+' · '+(a.read?'已读':'未读')+'</small>'+esc(a.text)+'</p>').join('')||'<p>暂无目标价提醒。点击自选卡片上的“设置目标价”开始。</p>');if(seenAlerts===null)seenAlerts=new Set(alerts.map(a=>a.id));else{const fresh=alerts.some(a=>!a.read&&!seenAlerts.has(a.id));seenAlerts=new Set(alerts.map(a=>a.id));if(fresh&&soundOn)tone();}}

function amount(v){return typeof v==='number'?v.toFixed(8).replace(/\.?0+$/,''):String(v??'');}
function price(v){return typeof v==='number'?amount(v)+' ZEC':'暂无挂单价';}
function paintMarket(p){if(!p)return;paintAlerts(p);const snap=p.snapshot;const health=$('#markethealth');health.className='health '+(p.error||p.stale?'warning':'');health.textContent=p.error?'读取中断 · 自动重试 '+when(p.nextRefreshAt)+' · 已连续失败 '+p.failureCount+' 次':!p.enabled?'监控已停止 · 页面保留上次结果':p.stale?'数据未取得或超过 3 分钟未更新 · 不要按旧行情判断':'公开索引更新正常 · 下次检查约 '+when(p.nextRefreshAt);$('#marketstatus').textContent=(p.enabled?'监控中 · 每 60 秒':'监控已停止')+(p.busy?' · 正在读取':'')+' · 最近成功 '+when(snap?.checkedAt)+(snap?' · '+snap.items.length+' 个系列 / '+snap.listingCount+' 条挂牌':'')+(p.error?' · 读取失败，以下为上次结果：'+p.error:'')+(snap?.partial?' · 索引样本已达上限，数量与最低价只代表已读取样本':'');$('#markettoggle').textContent=p.enabled?'停止市场监控':'启动市场监控';
 const q=$('#marketsearch').value.trim().toLowerCase();const mode=$('#marketfilter').value,sort=$('#marketsort').value;const cards=(snap?.items||[]).filter(c=>c.name.toLowerCase().includes(q)&&(mode==='all'||mode==='listed'&&c.listed>0||mode==='saved'&&p.items.some(w=>w.kind==='zebra'&&w.collectionId===c.id)||mode==='new'&&c.discoveredAt&&Date.now()-c.discoveredAt<86400000)).sort((a,b)=>sort==='price'?(a.floor??Infinity)-(b.floor??Infinity):sort==='new'?(b.discoveredAt||0)-(a.discoveredAt||0):b.listed-a.listed);
 setCards('#marketlist',cards.map(c=>{const saved=p.items.some(w=>w.kind==='zebra'&&w.collectionId===c.id);return '<article class="market-card">'+thumb(c.image,c.name)+'<h3>'+esc(c.name)+'</h3>'+(c.discoveredAt&&Date.now()-c.discoveredAt<86400000?'<span class="badge">新发现</span>':'')+'<p>挂牌 '+c.listed+' 项<br>最低挂单价：'+esc(price(c.floor))+'</p><button data-collect="'+esc(c.id)+'" '+(saved?'disabled':'')+'>'+(saved?'已加入自选':'加入自选')+'</button><a href="'+esc(c.url)+'" target="_blank" rel="noreferrer">查看市场 ↗</a></article>';}).join('')||'<article>'+(snap?'没有匹配的系列':'尚未读取到市场项目')+'</article>');
 setCards('#watchlist',p.items.map(c=>'<article class="market-card">'+thumb(c.image,c.name)+'<h3>'+esc(c.name)+'</h3><span class="badge">'+(c.kind==='zebra'?'市场系列 · 只读监控':'网页监控 · 开售状态未核实')+'</span><p>'+(c.kind==='zebra'?'挂牌 '+c.listed+' 项 · 最低 '+esc(price(c.floor)):esc(c.description||'等待读取网页标题与简介'))+'</p><small>最近成功 '+esc(when(c.checkedAt))+(c.checkedAt&&Date.now()-c.checkedAt>180000?' · 数据已过期':'')+'</small>'+(c.error?'<p class="notice">'+esc(c.error)+'</p>':'')+(c.kind==='zebra'?'<p class="target-rule">'+(c.targetPrice?'目标价 ≤ '+esc(amount(c.targetPrice))+' ZEC':'尚未设置目标价')+'</p><button class="ghost" data-targetprice="'+esc(c.id)+'">设置目标价</button>':'')+'<div class="row"><a href="'+esc(c.url)+'" target="_blank" rel="noreferrer">'+(c.kind==='zebra'?'打开市场（在市场内选择该系列）':'打开项目')+' ↗</a>'+taskButton(c.kind==='web'?c.url:'',c.name)+'<button class="ghost" data-remove="'+esc(c.id)+'">移除自选</button></div></article>').join('')||'<article>还没有自选项目。点击上方“添加项目链接”，或从市场卡片加入。</article>');
 setCards('#marketevents',p.events.map(e=>'<p><small>'+esc(when(e.at))+'</small>'+esc(e.text)+'</p>').join('')||'<p>首次读取作为基准，后续新系列和行情变化会显示在这里。</p>');
}
for(const area of ['#marketlist','#watchlist'])$(area).addEventListener('click',async e=>{const btn=e.target.closest('button[data-collect],button[data-remove]');if(!btn||btn.disabled)return;btn.disabled=true;try{if(btn.dataset.collect)await api('projects/add',{collectionId:btn.dataset.collect});else await api('projects/remove',{id:btn.dataset.remove});await refresh();say(btn.dataset.collect?'已加入自选项目':'已移除自选');}catch(err){say(err.message);}finally{btn.disabled=false;}});
function paint(s){
 paintNoir(s);paintQuickSite(s);
 paintSocial(s.social);paintGrok(s.grok);
 paintLaunches(s.launches);
 paintMarket(s.projects);
 state=s;$('#connection').textContent='● 本机已连接';const m=s.site.last,r=m?.rounds?.find(x=>x.audience==='public');
 $('#price').textContent=r?.price?`${r.price} ZEC`:'—';$('#supply').textContent=m?`${m.left} / ${m.supply}`:'—';$('#watcher').textContent='官网收款监测：'+(m?.watched===true?'运行中':m?'未就绪':'待检查');
 $('#phase').textContent=m?.soldOut?'已售罄':m?.round?.audience==='public'?'Public 开放':m?.round?.name||'等待开售';
 $('#publictime').textContent=r?when(r.start):'以官网状态为准';
 $('#scanstatus').textContent=(s.scanning?'自动扫描中（每 30 秒）':'扫描已停止')+' · 最近成功 '+when(s.site.checkedAt)+(s.scanError?' · '+s.scanError:'');
 if(document.activeElement!==$('#sources'))$('#sources').value=s.sources.join('\n');
 setCards('#discoveries',s.candidates.map(x=>'<a class="discovery-card" href="'+esc(x.url)+'" target="_blank" rel="noreferrer">'+thumb(x.image,x.name)+'<span><b>'+esc(x.name)+' ↗</b><small>'+esc(x.kind)+'</small></span></a>').join('')||'<p>尚未配置公开项目目录。</p>');
 setCards('#feed',s.site.live.map(x=>'<a href="https://zaddr.studio/token/'+x.face+'" target="_blank" rel="noreferrer">'+thumb(artwork(x.face),'ZADDR #'+x.face+' 原始铸造图')+'<span>ZADDR #'+x.face+'<small>'+(x.height?'区块 '+x.height:esc(x.kind)+' · 未提供区块')+'</small></span></a>').join('')||'<p>尚无已读取的公开动态。</p>');
 $('#walletstate').textContent=s.wallet.ready?(s.backedUp?'已连接 · 已备份':'已连接 · 未备份'):'未启动';
 const addresses=s.wallet.addresses||[],selected=$('#address').value;
 if(JSON.stringify(addresses)!==$('#address').dataset.list){$('#address').innerHTML=addresses.length?addresses.map(a=>`<option value="${esc(a)}">${esc(a)}</option>`).join(''):'<option value="">先启动钱包</option>';$('#address').dataset.list=JSON.stringify(addresses);if(addresses.includes(selected))$('#address').value=selected;}
 $('#walletaddresscopy').disabled=!s.wallet.ready||!addresses.includes($('#address').value);
 $('#walletfunds').textContent='可用屏蔽余额：'+(Number.isSafeInteger(s.wallet.spendable)?s.wallet.spendable/1e8+' ZEC':'—');
 const syncProgress=typeof s.wallet.sync?.percentage_total_outputs_scanned==='number'?s.wallet.sync.percentage_total_outputs_scanned:null;
 const syncText=s.wallet.syncError?s.wallet.syncError+(s.wallet.syncRetryAt?' · 下次重试 '+when(s.wallet.syncRetryAt):''):s.wallet.syncComplete?'钱包扫描已完成；预检时还会核对最新区块和可用余额。':syncProgress!==null?'钱包扫描进度：'+syncProgress.toFixed(1)+'% · 已扫描 '+(s.wallet.sync.total_blocks_scanned||0)+' 个区块 · 每 20 秒刷新。':'钱包尚未连接。连接后自动同步。';
 $('#walletsync').textContent=syncText;
 $('#mintwalletsync').textContent=syncText;
 $('#mintwalletsync').className='health '+(s.wallet.syncError?'warning':'');
 const labels={waiting:'等待 Public',preparing:'核对付款条件',sending:'签名发送中',broadcast:'已广播 · 等待发放',issued:'已发放 · 准备下一枚',claimed:'已领取',done:'任务完成',unknown:'结果不明 · 禁止重发',stopped:'已停止'};
 $('#tasklist').innerHTML=[...s.tasks].reverse().map(t=>`<article><div class="taskhead"><h3>ZADDR · ${t.count}/${t.config.quantity} 枚</h3><span class="badge">${labels[t.status]||esc(t.status)}</span></div><p class="tasknote">${esc(t.note)}</p><small>${esc(when(t.createdAt))} · 接收 ${esc(t.config.address.slice(0,14))}…${esc(t.config.address.slice(-8))}</small>${t.attempts.map(a=>`<p class="tx">${a.txid?'交易 '+esc(a.txid):a.face!==undefined?'NFT #'+a.face:'发送尝试已记录'}${a.issued?' · 官网确认已发放':''}</p>`).join('')}</article>`).join('')||'<article>还没有运行任务。</article>';
}
let refreshing=false;async function refresh(){if(refreshing)return;refreshing=true;try{paint(await api('state'));}catch{$('#connection').textContent='○ 后台未连接';$('#markethealth').className='health warning';$('#markethealth').textContent='本机后台连接中断 · 当前显示的是旧数据，提醒无法实时更新';}finally{refreshing=false;}}
const expires=new Date(Date.now()+24*3600000);expires.setMinutes(expires.getMinutes()-expires.getTimezoneOffset());$('#expiry').value=expires.toISOString().slice(0,16);
setInterval(()=>{const m=state?.site.last,r=m?.rounds?.find(x=>x.audience==='public');if(!r)return;let ms=r.start-Date.now();if(ms<=0){$('#countdown').textContent=m.round?.audience==='public'?'已开放':'等待官网确认';return;}const n=Math.floor(ms/1000);$('#countdown').textContent=[Math.floor(n/3600),Math.floor(n/60)%60,n%60].map(x=>String(x).padStart(2,'0')).join(':');},1000);
function paintLaunches(r){
 if(!r)return;
 $('#launchscope').textContent=r.scope;
 const names={live:'Public 开放',upcoming:'即将 Public',application:'资格申请中',early:'早期资格线索 · 待核实',market:'市场系列 · 非预售',unknown:'开售待核实',ended:'已结束'};
 const filter=$('#launchfilter').value,q=$('#launchsearch').value.trim().toLowerCase();
 const list=r.items.filter(x=>(filter==='all'||(filter==='auto'?x.autoMint:filter==='early'?['early','application'].includes(x.phase):x.phase===filter))&&(!q||(x.name+' '+x.url).toLowerCase().includes(q)));
 $('#launchstatus').textContent=(r.scanning?'扫描运行中':'扫描未启动')+' · 显示 '+list.length+' / '+r.items.length+' 个候选'+(r.scanError?' · ZADDR：'+r.scanError:'')+(r.error?' · '+r.error:'');
 setCards('#launchlist',list.map(x=>'<article class="market-card">'+thumb(x.image,x.name)+'<h3><a href="'+esc(x.url)+'" target="_blank" rel="noreferrer">'+esc(x.name)+' ↗</a></h3><span class="badge">'+esc(names[x.phase]||names.unknown)+'</span><p>'+esc(x.note)+'</p><small>'+esc(x.source)+(x.checkedAt?' · '+esc(when(x.checkedAt)):'')+'</small>'+(x.start?'<p>Public 时间：'+esc(when(x.start))+' · 单价 '+esc(x.price??'待核实')+' ZEC</p>':'')+'<div class="row">'+(x.autoMint?'<button data-launch-mint="'+esc(x.id)+'">设置自动 mint</button>':x.phase!=='market'?'<button data-launch-plan="'+esc(x.id)+'">'+(r.plans.some(p=>p.id===x.id)?'已加入待开售':'加入待开售计划')+'</button>':'<span>请先添加项目官网</span>')+taskButton(x.phase==='market'?'':x.url,x.name)+'</div></article>').join('')||'<p>当前筛选没有结果；不代表全链没有开售项目。</p>');
 setCards('#launchplans',r.plans.map(p=>'<article><h3>'+esc(p.name)+'</h3><p>'+(p.status==='needs-budget'?'待设置预算并启动':'等待适配：目前仅监控，未启动自动付款')+'</p><div class="row"><a href="'+esc(p.url)+'" target="_blank" rel="noreferrer">打开官网 ↗</a>'+(p.id==='zaddr'?'<button data-launch-mint="zaddr">设置自动 mint</button>':'')+taskButton(p.url,p.name)+'<button class="ghost" data-launch-remove="'+esc(p.id)+'">移除计划</button></div></article>').join('')||'<p>暂无待开售计划。</p>');
 setCards('#launchevents',r.events.map(e=>'<p>'+esc(when(e.at))+' · '+esc(e.text)+'</p>').join('')||'<p>首次读取作为基准；后续官网规则变化显示在这里。</p>');
}
bind('#launchrefresh',()=>api('scan',{}));
for(const id of ['#launchfilter','#launchsearch'])$(id).addEventListener('input',()=>{if(state?.launches)paintLaunches(state.launches);});
for(const area of ['#launchlist','#launchplans'])$(area).addEventListener('click',async e=>{
 const btn=e.target.closest('button[data-launch-plan],button[data-launch-mint],button[data-launch-remove]');if(!btn||btn.disabled)return;
 btn.disabled=true;try{
  if(btn.dataset.launchRemove)await api('launches/remove',{id:btn.dataset.launchRemove});
  else {const id=btn.dataset.launchMint||btn.dataset.launchPlan;await api('launches/plan',{id});if(btn.dataset.launchMint){dialog('选择 ZADDR 付款钱包','<p>Noir 使用 Chrome 插件确认付款；Zingo 使用软件独立钱包全自动付款。</p><p><a href="#noirmint" data-wallet-route="noirmint">使用 Noir 插件 →</a></p><p><a href="#mint" data-wallet-route="mint">使用 Zingo 独立钱包 →</a></p>',null);}else say('已加入待开售计划，目前只监控；适配完成并确认预算后才能自动 mint。');}
  await refresh();
 }catch(err){say(err.message);}finally{btn.disabled=false;}
});
function paintSocial(s){
 if(!s)return;
 $('#socialstatus').textContent=(!s.tokenReady?'未配置 X API · 尚未连接':s.enabled?'自动扫描运行中':'自动扫描未启动')+(s.busy?' · 正在读取':'')+(s.snapshot?' · 最近成功 '+when(s.snapshot.checkedAt)+(s.stale?' · 数据已过期':''):' · 暂无真实热度结果')+(s.error?' · '+s.error:'');
 $('#socialstatus').className='health '+(s.error||s.stale?'warning':'good');
 $('#socialscope').textContent='间隔 '+s.intervalMinutes+' 分钟 · 每日请求 '+s.usage.count+'/'+s.dailyLimit+'（计数日期 '+(s.usage.day||'未开始')+' UTC） · 每次最多 100 条 · 请求上限不是金额上限'+(s.nextAt?' · 下次可检查 '+when(s.nextAt):'')+(s.snapshot?.partial?' · 存在更多结果，本次只读取一页':'');
 $('#socialxlink').href='https://x.com/search?'+new URLSearchParams({q:s.query,f:'live'});
 $('#socialstart').disabled=!s.tokenReady||s.busy||s.enabled;$('#socialonce').disabled=!s.tokenReady||s.busy;$('#socialstop').disabled=!s.enabled&&!s.busy;
 const q=$('#socialsearch').value.trim().toLowerCase(),early=$('#socialearly').checked,linked=$('#sociallinked').checked;
 const items=(s.snapshot?.items||[]).filter(x=>(!early||x.earlySignals.length)&&(!linked||s.links[x.id]?.matched)&&(!q||(x.name+' '+x.username+' '+x.posts.map(p=>p.text).join(' ')).toLowerCase().includes(q)));
 const n=v=>v===null||v===undefined?'未知':esc(v);
 setCards('#sociallist',items.map(x=>{const link=s.links[x.id];return '<article class="market-card">'+thumb(x.image,x.name)+'<h3><a href="'+esc(x.url)+'" target="_blank" rel="noreferrer">'+esc(x.name)+' @'+esc(x.username)+' ↗</a></h3><span class="badge">'+(link?.matched?'官网互链匹配 · 仍需核实项目':'官推身份待核实')+'</span><p>样本热度 '+n(x.score)+' · 匹配推文 '+x.posts.length+' 条<br>粉丝 '+n(x.followers)+' · 创建 '+esc(when(x.createdAt))+'</p><p>'+esc(x.description)+'</p><p>'+esc(x.earlySignals.length?'早期线索：'+x.earlySignals.join('、'):'未识别到资格关键词')+'</p>'+(link?'<small>'+esc(link.note)+' '+esc(when(link.checkedAt))+'</small>':'')+(x.website?'<div class="row"><a href="'+esc(x.website)+'" target="_blank" rel="noreferrer">账号填写的官网 ↗</a><button class="ghost" data-social-verify="'+esc(x.id)+'">核对官网互链</button><button data-social-watch="'+esc(x.id)+'">加入自选官网</button>'+taskButton(x.website,x.name)+'</div>':'<p>账号未提供可核对的官网</p>')+'<details><summary>匹配推文与互动证据（'+x.posts.length+'）</summary>'+x.posts.map(p=>'<p><a href="'+esc(p.url)+'" target="_blank" rel="noreferrer">'+esc(when(p.at))+' · 查看原帖 ↗</a><br>'+esc(p.text)+'<br><small>赞 '+n(p.metrics.likes)+' · 转发 '+n(p.metrics.reposts)+' · 回复 '+n(p.metrics.replies)+' · 引用 '+n(p.metrics.quotes)+' · 阅读 '+n(p.metrics.views)+'</small></p>').join('')+'</details></article>';}).join('')||'<article>'+(!s.tokenReady?'尚未接入 X API。点击“API / 扫描设置”填写 Token 后，才能自动读取真实搜索结果和热度。也可先点“去 X 手动搜索”。':s.snapshot?'当前筛选没有匹配账号；搜索样本不代表所有早期项目。':'尚未执行成功的 X 搜索。')+'</article>');
}
bind('#socialsettings',async()=>{
 const s=state.social;
 dialog('X API / 热度扫描设置','<p>X API 可能按使用量收费。保存不会请求 X；点击启动或检查一次才读取。每次最多 100 条、不自动翻页；每日请求上限按 UTC 计算，不是费用上限，请同时在 X 后台设置预算。</p><label>Bearer Token（仅本次后台进程内存）<input id="socialtoken" type="password" autocomplete="off" placeholder="'+(s.tokenReady?'已配置；留空保留':'在这里填写，不要发到聊天')+'"></label><label><input id="socialcleartoken" type="checkbox">清除内存 Token</label><label>搜索式<textarea id="socialquery" maxlength="450">'+esc(s.query)+'</textarea></label><div class="grid fields"><label>检查间隔（分钟，15–360）<input id="socialinterval" type="number" min="15" max="360" value="'+s.intervalMinutes+'"></label><label>每日请求上限（1–96）<input id="sociallimit" type="number" min="1" max="96" value="'+s.dailyLimit+'"></label></div><p>Token 只发送给 api.x.com，不写入钱包、配置或压缩包；重启后需重新填写。搜索结果和非敏感设置保存在本机。保存设置会停止当前自动扫描。</p>',async()=>{
  const token=$('#socialtoken').value.trim();$('#socialtoken').value='';
  await api('social/config',{token,clearToken:$('#socialcleartoken').checked,query:$('#socialquery').value,intervalMinutes:Number($('#socialinterval').value),dailyLimit:Number($('#sociallimit').value)});
 },'保存设置');
});
bind('#socialstart',()=>api('social/start',{}));bind('#socialstop',()=>api('social/stop',{}));bind('#socialonce',()=>api('social/scan',{}));
for(const id of ['#socialsearch','#socialearly','#sociallinked'])$(id).addEventListener('input',()=>{if(state?.social)paintSocial(state.social);});
$('#sociallist').addEventListener('click',async e=>{const btn=e.target.closest('button[data-social-verify],button[data-social-watch]');if(!btn||btn.disabled)return;btn.disabled=true;try{if(btn.dataset.socialVerify)await api('social/verify',{id:btn.dataset.socialVerify});else await api('social/watch',{id:btn.dataset.socialWatch});await refresh();say(btn.dataset.socialVerify?'官网互链检查完成，结果显示在卡片中':'已加入自选官网；可在项目雷达查看，不会自动申请或付款。');}catch(err){say(err.message);}finally{btn.disabled=false;}});

function paintGrok(g){
 if(!g)return;
 const currentBackend=g.researchTimeoutMs===300000;
 const mode=g.mode==='key'?'独立 API Key · 按用量计费':'Grok 订阅通道 · 消耗账号额度';
 const stages={connecting:'正在连接搜索服务',connected:'已连接，等待搜索进度',accepted:'服务已接收，正在处理',searching:'正在搜索公开帖子',writing:'正在整理搜索结果',cancelling:'正在取消本次查询'};
 const pending=g.busy?(g.operation==='research'?(stages[g.progress]||'正在搜索公开项目'):'正在连接 Grok')+(g.requestStartedAt?' · 已等待 '+Math.max(0,Math.floor((Date.now()-g.requestStartedAt)/1000))+' 秒':''):'';
 $('#grokstatus').textContent=mode+' · '+(g.login?'等待你在官方页面授权':g.loggedIn?'已登录；订阅等级未核实':g.keyReady?'已填写密钥':'未连接')+(pending?' · '+pending:'')+(g.checkedAt?' · 模型列表读取于 '+when(g.checkedAt)+'（不代表搜索权限已验证）':'')+(g.error?' · '+g.error:'');
 $('#grokstatus').className='health '+(g.error?'warning':'');
 setCards('#grokdevice',g.login?'<p>登录码：<strong class="login-code">'+esc(g.login.code)+'</strong> · 有效至 '+esc(when(g.login.expiresAt))+'</p><a class="grok-login-link" href="'+esc(g.login.url)+'" target="_blank" rel="noreferrer">打开 xAI 官方授权页面 ↗</a><p>请核对登录码，在官方页面完成登录。软件不接收你的推特密码或 Cookie；授权后本页会自动更新。若未识别订阅，可在 Grok 设置 → Account 关联 X 账号。</p>':'');
 const old=$('#grokmodel').value,models=JSON.stringify(g.models);
 if($('#grokmodel').dataset.models!==models){$('#grokmodel').innerHTML='<option value="">请选择可用模型</option>'+g.models.map(m=>'<option value="'+esc(m)+'">'+esc(m)+'</option>').join('');$('#grokmodel').dataset.models=models;if(g.models.includes(old))$('#grokmodel').value=old;else {const first=g.models.find(m=>/grok/i.test(m)&&!/image|video|imagine|vision|audio/i.test(m));if(first)$('#grokmodel').value=first;}}
 $('#groklogin').disabled=g.busy||!!g.login;$('#grokcheck').disabled=g.busy||(!g.loggedIn&&!g.keyReady);$('#grokrun').disabled=!currentBackend||g.busy||!g.models.length||Date.now()<g.nextRun;$('#grokkey').disabled=g.busy;$('#grokcancel').hidden=!(currentBackend&&g.busy&&g.operation==='research');
 const r=g.result,feedback=!currentBackend?'<p class="notice">后台尚未加载搜索修复。请点左下角“停止并退出软件”，然后重新打开并登录 Grok；只关闭窗口不会更新后台。更新前已暂停查询，避免继续按旧的 60 秒限制请求。</p>':pending?'<p role="status">'+esc(pending)+'。最长等待 5 分钟；可以取消，本次不会自动重试。</p>':g.error?'<p class="notice">本次请求失败：'+esc(g.error)+'。这不代表没有早期项目。</p>':'';
 setCards('#grokresult',feedback+(r?'<h3>最近成功查询结果</h3><small>'+esc(when(r.at))+' · '+esc(r.model)+' · '+(r.mode==='key'?'API Key':'订阅通道')+'</small><div class="grok-answer">'+esc(r.text)+'</div><h4>返回的引用来源</h4>'+(r.sources.length?r.sources.map(x=>'<p><a href="'+esc(x.url)+'" target="_blank" rel="noreferrer">'+esc(x.title)+' ↗</a></p>').join(''):'<p>本次未返回可核对引用，不能据此认定发现了真实项目。</p>'):feedback?'':'<p>尚未查询。登录与检查模型不会自动运行搜索。</p>'));
}
bind('#groklogin',async()=>{await api('grok/login',{});say('登录码已生成。请点击下方“打开 xAI 官方授权页面”完成登录。');});
bind('#groklogout',()=>api('grok/logout',{}));
bind('#grokcancel',async()=>{await api('grok/cancel',{});say('已请求取消本次搜索，保留登录；已发出的查询可能仍计入额度。');});
bind('#grokcheck',()=>api('grok/check',{}));
bind('#grokrun',()=>api('grok/research',{model:$('#grokmodel').value,query:$('#grokquery').value,confirm:true}));
bind('#grokkey',async()=>{dialog('独立 xAI API Key','<p>这个通道独立计费，不使用 X Premium 订阅额度。保存后只在本次后台内存使用；不会自动请求模型或搜索，也不会从订阅失败时自动切换过来。</p><label>API Key<input id="grokkeyinput" type="password" autocomplete="off" placeholder="只在本机填写"></label><label><input type="checkbox" id="grokpaid">我知道这个通道独立计费</label><label><input type="checkbox" id="grokclear">清除凭据并退出连接</label>',async()=>{const key=$('#grokkeyinput').value.trim();$('#grokkeyinput').value='';await api('grok/key',{key,confirmPaid:$('#grokpaid').checked,clear:$('#grokclear').checked});},'保存');});

// Public task addresses and manual progress live only in this local UI profile.
const taskStorageKey='zec-desk.project-tasks.v1';
let taskBook={wallets:[],selected:'',records:[]};
try{const saved=JSON.parse(localStorage.getItem(taskStorageKey)||'null');if(saved&&Array.isArray(saved.wallets)&&Array.isArray(saved.records)){taskBook={wallets:saved.wallets.filter(w=>w&&typeof w.id==='string'&&typeof w.label==='string'&&validTaskAddress(w.address)).slice(0,20),selected:String(saved.selected||''),records:saved.records.filter(r=>r&&typeof r.url==='string'&&typeof r.name==='string').slice(0,60)};}}catch{}
function validTaskAddress(s){return typeof s==='string'&&/^(u1[023456789acdefghjklmnpqrstuvwxyz]{50,500}|zs[023456789acdefghjklmnpqrstuvwxyz]{50,150}|t[13][1-9A-HJ-NP-Za-km-z]{33})$/.test(s);}
function taskURL(raw){const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||u.port||!u.hostname.includes('.')||/^[\d.]+$|:|(^|\.)(localhost|local|internal|test|invalid)$/.test(u.hostname)||u.href.length>2000)throw Error('请填写公开 HTTPS 项目官网，不接受本机地址或带账号密码的链接');return u.href;}
function saveTaskBook(){localStorage.setItem(taskStorageKey,JSON.stringify(taskBook));}
function taskButton(url,name){return '<button class="ghost" data-project-task="'+esc(url||'')+'" data-project-name="'+esc(name)+'">'+(url?'做项目任务':'添加任务官网')+'</button>';}
function paintProjectTasks(){
 const selected=$('#taskwallet').value||taskBook.selected;
 const options='<option value="">仅浏览，不填写钱包</option>'+taskBook.wallets.map(w=>'<option value="'+esc(w.id)+'">'+esc(w.label)+' · '+esc(w.address.slice(0,12))+'…'+esc(w.address.slice(-8))+'</option>').join('');
 if($('#taskwallet').dataset.options!==options){$('#taskwallet').innerHTML=options;$('#taskwallet').dataset.options=options;$('#taskwallet').value=selected;}
 const chosen=taskBook.wallets.find(w=>w.id===$('#taskwallet').value);$('#taskaddress').textContent=chosen?chosen.address:'未选择任务钱包';
 $('#taskrecords').innerHTML=taskBook.records.map(r=>'<article><h3>'+esc(r.name)+'</h3><p>'+esc(r.url)+'</p><p>任务钱包：'+esc(r.walletLabel||'未选择')+(r.walletAddress?' · '+esc(r.walletAddress.slice(0,12))+'…'+esc(r.walletAddress.slice(-8)):'')+'</p><p>'+esc(r.status==='submitted'?'已提交（本人标记，未核实项目方审核结果）':'进行中（未自动完成或提交）')+' · '+esc(when(r.at))+'</p><div class="row">'+taskButton(r.url,r.name)+'<button data-task-done="'+esc(r.url)+'">'+(r.status==='submitted'?'改为进行中':'我已提交任务')+'</button><button class="ghost" data-task-remove="'+esc(r.url)+'">移除记录</button></div></article>').join('')||'<p>打开项目任务后记录在此；完成状态由你手动标记。</p>';
}
function chooseProjectTask(url,name){const prior=taskBook.records.find(r=>r.url===url);if(prior){const w=taskBook.wallets.find(w=>w.address===prior.walletAddress);taskBook.selected=w?.id||'';$('#taskwallet').value=taskBook.selected;}$('#taskurl').value=url||'';$('#taskname').value=name||'';showPage('projecttasks');paintProjectTasks();say(url?'已选择项目。核对任务钱包和官网后，点击打开任务按钮。':'先填写该项目真正的官网 / 申请页面，再打开任务。');}
document.addEventListener('click',e=>{const b=e.target.closest('button[data-project-task]');if(b)chooseProjectTask(b.dataset.projectTask,b.dataset.projectName);});
$('#taskwallet').onchange=()=>{taskBook.selected=$('#taskwallet').value;try{saveTaskBook();paintProjectTasks();}catch{say('本机配置无法保存，请检查磁盘或浏览器权限');}};
bind('#taskwalletadd',async()=>{dialog('添加任务钱包地址','<p>只填写公开收款地址，可从 Noir 复制。不需要私钥、助记词或导入签名钱包。</p><label>钱包名称<input id="tasknewlabel" maxlength="50" placeholder="例如 Noir 任务钱包"></label><label>Zcash 主网收款地址<input id="tasknewaddress" autocomplete="off" spellcheck="false" placeholder="u1… / zs… / t1… / t3…"></label><p>地址类型须符合项目要求；ZECMAP 目前要求 Unified 地址 u1。软件只做格式检查，不证明你控制该钱包。</p>',()=>{const address=$('#tasknewaddress').value.trim(),label=$('#tasknewlabel').value.trim()||'任务钱包';if(!validTaskAddress(address))throw Error('地址格式不符，请只粘贴完整 Zcash 主网收款地址');if(taskBook.wallets.length>=20)throw Error('最多保存 20 个任务钱包');let w=taskBook.wallets.find(w=>w.address===address);if(!w){w={id:crypto.randomUUID(),label,address};taskBook.wallets.push(w);}taskBook.selected=w.id;saveTaskBook();$('#taskwallet').dataset.options='';$('#taskwallet').value='';paintProjectTasks();},'保存公开地址');});
bind('#taskwalletlocal',async()=>{const address=$('#address').value;if(!validTaskAddress(address))throw Error('请先在独立钱包页面连接钱包并选择地址，或直接添加 Noir 的收款地址');let w=taskBook.wallets.find(w=>w.address===address);if(!w){if(taskBook.wallets.length>=20)throw Error('最多保存 20 个任务钱包');w={id:crypto.randomUUID(),label:'独立钱包',address};taskBook.wallets.push(w);}taskBook.selected=w.id;saveTaskBook();$('#taskwallet').dataset.options='';$('#taskwallet').value='';paintProjectTasks();});
bind('#taskwalletremove',async()=>{const id=$('#taskwallet').value;if(!id)return;taskBook.wallets=taskBook.wallets.filter(w=>w.id!==id);taskBook.selected='';saveTaskBook();$('#taskwallet').value='';paintProjectTasks();});
bind('#taskcopy',async()=>{const w=taskBook.wallets.find(w=>w.id===$('#taskwallet').value);if(!w)throw Error('请先选择任务钱包');await navigator.clipboard.writeText(w.address);say('已复制所选任务钱包地址');});
function selectedTask(){const url=taskURL($('#taskurl').value.trim()),name=$('#taskname').value.trim()||new URL(url).hostname,w=taskBook.wallets.find(w=>w.id===$('#taskwallet').value);return {url,name,w};}
function recordTask(t){const old=taskBook.records.find(r=>r.url===t.url);taskBook.records=taskBook.records.filter(r=>r.url!==t.url);taskBook.records.unshift({url:t.url,name:t.name,walletLabel:t.w?.label||'',walletAddress:t.w?.address||'',status:old?.status==='submitted'&&old.walletAddress===(t.w?.address||'')?'submitted':'working',at:Date.now()});taskBook.records=taskBook.records.slice(0,60);saveTaskBook();paintProjectTasks();}
let taskOpenPending=null;
bind('#taskopen',async()=>{const t=selectedTask();if(!window.chrome?.webview?.postMessage)throw Error('内置任务窗口仅用于 Windows 桌面版。当前可使用“在浏览器打开”并复制钱包地址。');if(taskOpenPending)throw Error('正在打开上一项目，请稍等');taskOpenPending=t;window.chrome.webview.postMessage({type:'project-task.open',url:t.url,name:t.name,address:t.w?.address||''});setTimeout(()=>{if(taskOpenPending===t){taskOpenPending=null;say('未收到桌面窗口响应。请关闭软件窗口，再从原文件夹的 ZEC Desk.exe 打开新版界面；后台无需停止。');}},4000);say('正在打开项目任务窗口…');});
$('#taskexternal').onclick=()=>{try{const t=selectedTask();window.open(t.url,'_blank','noopener,noreferrer');recordTask(t);say('已请求在浏览器打开；请使用“复制钱包地址”填写，Noir 的连接和签名由插件处理。');}catch(e){say(e.message);}};
if(window.chrome?.webview)window.chrome.webview.addEventListener('message',e=>{if(e.data?.type==='project-task.opened'&&taskOpenPending){const t=taskOpenPending;taskOpenPending=null;try{recordTask(t);}catch{say('窗口已打开，但任务记录未保存，请检查本机存储');return;}say('项目任务窗口已打开。明确的空地址栏会自动填写；任务和最终提交请在页面上操作。');}else if(e.data?.type==='project-task.error'){taskOpenPending=null;say(e.data.message);}});
$('#taskrecords').addEventListener('click',e=>{const b=e.target.closest('button[data-task-done],button[data-task-remove]');if(!b)return;try{if(b.dataset.taskRemove)taskBook.records=taskBook.records.filter(r=>r.url!==b.dataset.taskRemove);else{const r=taskBook.records.find(r=>r.url===b.dataset.taskDone);if(r){r.status=r.status==='submitted'?'working':'submitted';r.at=Date.now();}}saveTaskBook();paintProjectTasks();}catch{say('任务记录未保存成功');}});
document.addEventListener('zec-desk-noir-address',e=>{const address=e.detail?.address;if(!validTaskAddress(address))return;try{let w=taskBook.wallets.find(w=>w.address===address);if(!w){if(taskBook.wallets.length>=20)throw Error('最多保存 20 个任务钱包');w={id:crypto.randomUUID(),label:'Noir',address};taskBook.wallets.push(w);}taskBook.selected=w.id;saveTaskBook();$('#taskwallet').value='';$('#taskwallet').dataset.options='';paintProjectTasks();showPage('projecttasks');say('已将 Noir 公开地址选为任务钱包；仅保存在当前浏览器界面');}catch(e){say(e.message);}});
paintProjectTasks();

document.addEventListener('click',e=>{const link=e.target.closest('[data-wallet-route]');if(link){$('#dialog').close();showPage(link.dataset.walletRoute);}});
const pages={noirmint:['开始 mint','确认项目、连接钱包、设置预算，在一个页面完成。'],radar:['发现项目','查看开售与早期资格线索，选中后再操作。'],favorites:['我的自选','关注项目变化，按需设置提醒。'],projecttasks:['做项目任务','选好钱包地址，在项目官网完成任务。'],tasks:['运行记录','查看付款尝试与项目发放结果。'],social:['推特早期项目','查找公开线索，核对来源后加入自选。'],markets:['市场监控','查看公开挂牌与系列变化。'],wallet:['独立钱包','Zingo 全自动付款使用的钱包，与 Noir 分开。'],mint:['Zingo 全自动 mint','使用软件独立钱包，预检并确认预算后启动。']};
function showPage(id,writeHash=true){
 if(!pages[id])id='noirmint';
 for(const section of document.querySelectorAll('main > section'))section.hidden=section.id!==id;
 for(const link of document.querySelectorAll('nav a')){if(link.hash==='#'+id)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}
 if(['social','markets','wallet','mint'].includes(id))$('#navmore').open=true;
 $('#pagetitle').textContent=pages[id][0];$('#pagesubtitle').textContent=pages[id][1];
 if(writeHash&&location.hash!=='#'+id)history.pushState(null,'','#'+id);
 window.scrollTo({top:0,behavior:'instant'});
}
document.addEventListener('click',e=>{const link=e.target.closest('a[href^="#"]');if(link&&pages[link.hash.slice(1)]){e.preventDefault();showPage(link.hash.slice(1));}});
window.addEventListener('hashchange',()=>showPage(location.hash.slice(1),false));
window.addEventListener('popstate',()=>showPage(location.hash.slice(1),false));
function paintQuickSite(s){
 const site=s.site||{},m=site.last,r=m?.rounds?.find(x=>x.audience==='public'),err=site.error||s.scanError||'';
 const gated=/口令/.test(err),stale=!site.checkedAt||Date.now()-site.checkedAt>90000;
 $('#quicksitebadge').textContent=gated?'需要官网口令':err?'读取未完成':stale?'需要刷新':m?.soldOut?'已售罄':m?.round?.audience==='public'?'Public 已开放':'等待开售';
 $('#quicksiteinfo').textContent=(r?'官网单价 '+r.price+' ZEC · Public '+when(r.start)+(m?' · 剩余 '+m.left+' 枚':''):'尚未取得官网价格与时间。')+(err?' · '+(gated?'请在下面填写项目方的官网口令。':err):'')+(site.checkedAt?' · 最近读取 '+when(site.checkedAt):'');
 if(gated)$('#quickgate').open=true;
}
const isDesktop=Boolean(window.chrome?.webview?.postMessage);
if(!isDesktop){$('#taskopen').hidden=true;$('#taskexternal').textContent='在浏览器打开任务';}
$('#noirbrowserbridge').hidden=!isDesktop&&location.hostname==='localhost';
$('#noirbrowsercontrols').hidden=isDesktop;
$('#noirbudget').hidden=isDesktop;
showPage(location.hash.slice(1),false);
const paintNoir=setupNoir({api,$,say});
setInterval(refresh,2500);await refresh();
