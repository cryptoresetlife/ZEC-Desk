export function setupSweep({$,esc,api,bind,dialog,say,when}){
  let latest=null,filled=false,offset=0;
  const labels={waiting:'等待低价挂单',preparing:'核对付款',sending:'签名发送中',broadcast:'等待 NFT 到账',done:'已完成',stopped:'已停止',unknown:'结果待核对'};
  const controls=['#sweepbelow','#sweeptotal','#sweepquantity','#sweepfee','#sweepexpiry','#sweepaddress'];
  function config(){return {address:$('#sweepaddress').value,below:$('#sweepbelow').value.trim(),total:$('#sweeptotal').value.trim(),quantity:Number($('#sweepquantity').value),maxFee:$('#sweepfee').value.trim(),expiresAt:new Date($('#sweepexpiry').value).getTime()};}
  function renderCards(){
    const snap=latest?.snapshot;let items=snap?.items||[];
    const threshold=Number($('#sweepbelow').value);
    if($('#sweepmatches').checked)items=items.filter(l=>!l.reserved&&threshold>0&&Number(l.price)<threshold);
    offset=Math.min(offset,Math.max(0,Math.floor((items.length-1)/24)*24));
    $('#sweeplist').innerHTML=items.slice(offset,offset+24).map(l=>`<article class="market-card"><a href="https://zaddr.studio/token/${l.face}" target="_blank" rel="noreferrer"><img class="sweep-art" src="/zaddr/${l.face}.svg" width="96" height="96" loading="lazy" alt="ZADDR #${l.face}"></a><h3>ZADDR #${l.face}</h3><p>${esc(l.price)} ZEC</p><p>${l.reserved?'已被预订':'可购买挂单'}</p><a href="https://zaddr.studio/market?buy=${encodeURIComponent(l.id)}" target="_blank" rel="noreferrer">官网核对 ↗</a></article>`).join('')||'<p>暂无匹配挂单；输入价格阈值后可筛选。</p>';
    for(const img of $('#sweeplist').querySelectorAll('img'))img.addEventListener('error',()=>{const face=img.alt.split('#')[1];img.addEventListener('error',()=>{img.src='/favicon.svg';},{once:true});img.src=`https://zaddr.studio/og/${face}.png`;},{once:true});
    $('#sweepcount').textContent=`${items.length} 个挂单 · 第 ${Math.floor(offset/24)+1} / ${Math.max(1,Math.ceil(items.length/24))} 页`;
    $('#sweepprev').disabled=offset===0;$('#sweepnext').disabled=offset+24>=items.length;
  }
  $('#sweepprev').onclick=()=>{offset-=24;renderCards();};$('#sweepnext').onclick=()=>{offset+=24;renderCards();};
  $('#sweepmatches').onchange=()=>{offset=0;renderCards();};$('#sweepbelow').addEventListener('input',()=>{offset=0;renderCards();});
  bind('#sweeprefresh',()=>api('sweep/refresh',{}));
  bind('#sweepstop',async()=>{await api('sweep/stop',{});say('已停止后续购买；已广播的交易仍会结算。');});
  bind('#sweepreconcile',()=>api('sweep/reconcile',{}));
  bind('#sweeppreview',async()=>{
    const p=await api('sweep/preview',config()),c=p.config;
    dialog('确认 ZADDR 自动扫货',`<p>仅购买 ZADDR 官网二级市场挂单。启动后独立 Zingo 钱包将自动签名付款。</p><p>单枚价格 <b>严格低于 ${esc(c.below)} ZEC</b><br>总预算（含手续费）<b>${esc(c.total)} ZEC</b><br>最多购买 <b>${c.quantity} 枚</b><br>单笔手续费上限 ${esc(c.maxFee)} ZEC<br>截止 ${esc(when(c.expiresAt))}</p><p>接收地址：<code>${esc(c.address)}</code></p><p>当前价格匹配 ${p.matches} 个挂单；实际付款前重新核对库存、本人持仓和余额。逐笔成交后再买下一枚，结果不明即停止。</p>`,async()=>{await api('sweep/arm',{id:p.id,confirm:true});say('自动扫货已启动。请保持电脑开机、不休眠。');},'确认预算并启动自动购买');
  });
  return function paint(s,wallet){
    latest=s||{};
    const options=wallet?.ready?wallet.addresses||[]:[],old=$('#sweepaddress').value;
    if($('#sweepaddress').dataset.options!==JSON.stringify(options)){
      $('#sweepaddress').innerHTML=options.length?options.map(a=>`<option value="${esc(a)}">${esc(a)}</option>`).join(''):'<option value="">请先在独立钱包中打开钱包</option>';
      if(options.includes(old))$('#sweepaddress').value=old;$('#sweepaddress').dataset.options=JSON.stringify(options);
    }
    if(!filled){filled=true;const c=s?.task?.config;if(c){$('#sweepbelow').value=c.below;$('#sweeptotal').value=c.total;$('#sweepquantity').value=c.quantity;$('#sweepfee').value=c.maxFee;}}
    for(const id of controls)$(id).disabled=Boolean(s?.active||s?.busy);
    $('#sweeppreview').disabled=Boolean(s?.active||s?.busy||s?.unresolved);
    $('#sweepstatus').textContent=(s?.error?'读取失败：'+s.error+' · ':'')+(s?.snapshot?`${s.snapshot.open?'市场已开放':'市场未开放'} · 最近读取 ${when(s.snapshot.checkedAt)}`:'尚未读取挂单')+(s?.snapshot&&Date.now()-s.snapshot.checkedAt>30000?' · 数据已过期，请刷新':'');
    $('#sweeptask').textContent=s?.task?`${s.active?'正在运行':'未运行'} · ${labels[s.task.status]||s.task.status} · 已到账 ${s.task.count} / ${s.task.config.quantity} 枚 · 已支出 / 锁定 ${s.task.spent} / ${s.task.config.total} ZEC · ${s.task.note}`:'尚未启动自动扫货。填写设置后预检，再确认启动。';
    $('#sweepactivity').hidden=!(s?.active||s?.busy||s?.unresolved);$('#sweepactivitytext').textContent=$('#sweepactivity').hidden?'':$('#sweeptask').textContent;
    $('#sweeprecords').innerHTML=(s?.records||[]).slice().reverse().map(t=>`<article><b>${esc(labels[t.status]||t.status)}</b> · ${esc(when(t.at))}<p>${esc(t.note)}</p>${(t.attempts||[]).map(a=>`<p>ZADDR #${a.face} · ${esc(a.price)} ZEC + 手续费 ${(a.fee/1e8).toFixed(8)} ZEC · ${a.cancelled?'发送前已取消':a.settled?'官网确认持有':'待核对'}<br>${a.txid?'<code>'+esc(a.txid)+'</code>':''}</p>`).join('')}</article>`).join('')||'<p>暂无付款记录。</p>';
    const sig=JSON.stringify([s?.snapshot,s?.error]);if($('#sweeplist').dataset.sig!==sig){$('#sweeplist').dataset.sig=sig;renderCards();}
  };
}
