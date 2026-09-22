export function dayKey(at,zone){return new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(at);}
export function calendarItems(items,mode,zone,now=Date.now()){
  const today=dayKey(now,zone);
  return items.filter(x=>mode==='all'||mode==='past'&&x.startsAt<now||mode==='today'&&dayKey(x.startsAt,zone)===today||mode==='upcoming'&&x.startsAt>=now).sort((a,b)=>a.startsAt-b.startsAt);
}
export function setupIntelligence({$,esc,api,bind,dialog,say,refresh,setCards,thumb,when,taskButton}){
  let current=null;
  const phaseNames={'application-hint':'申请 / 名单线索','closed-hint':'结束 / 售罄线索','upcoming-hint':'待公布线索',unknown:'待核实'};
  const stageNames={public:'Public 公售',allowlist:'白名单场',unknown:'场次未确认'};
  const verificationNames={'user-checked':'本人已核对项目方原帖',secondary:'二手转引 · 待复核',unverified:'来源待核实','project-api':'项目官网接口'};
  function renderCalendar(){
    if(!current)return;const zone=$('#intelzone').value,mode=$('#inteldate').value;
    const items=calendarItems(current.schedule,mode,zone);
    const fmt=new Intl.DateTimeFormat('zh-CN',{timeZone:zone,dateStyle:'medium',timeStyle:'short'});
    setCards('#intelcalendar',items.map(x=>'<article><h3>'+esc(x.name)+' <span class="badge">'+esc(stageNames[x.stage])+'</span></h3><p class="schedule-time">'+esc(fmt.format(x.startsAt))+' · '+esc(zone)+'</p><p>'+esc(verificationNames[x.verification])+(x.stale?' · 数据过期':'')+'</p><small>原公告时间：'+esc(x.originalTime)+'<br>记录 / 读取时间：'+esc(when(x.checkedAt))+'</small><p>'+esc(x.note)+'</p><p>'+(x.startsAt<=Date.now()?'已到公告时间 · 开放状态待核实':'排期提醒 · 到点不代表允许付款')+'</p><div class="row"><a href="'+esc(x.sourceUrl)+'" target="_blank" rel="noreferrer">核对公告来源 ↗</a><a href="'+esc(x.url)+'" target="_blank" rel="noreferrer">项目入口 ↗</a>'+(x.id!=='zaddr-live'?'<button class="ghost" data-intel-remove="'+esc(x.id)+'">移除排期</button>':'')+'</div></article>').join('')||'<p>当前范围没有已记录的明确时间。可点“记录公告排期”补充；不从 TBA 或模糊日期猜测开售时间。</p>');
  }
  function render(r){
    current=r;if(!r){$('#intelstatus').textContent='项目情报后台尚未更新，请完整退出旧版后重新打开。';return;}
    $('#inteltoggle').textContent=r.enabled?'停止情报监控':'启动情报监控';
    $('#intelrefresh').disabled=r.busy;
    const fresh=r.items.filter(x=>!x.stale&&!x.error),changed=r.items.filter(x=>x.changedAt&&Date.now()-x.changedAt<86400000);
    $('#intelstatus').textContent=(r.enabled?'监控中 · 每 10 分钟':'监控未启动')+(r.busy?' · 正在读取':'')+' · '+fresh.length+'/'+r.items.length+' 个来源可用 · '+changed.length+' 个近 24 小时变化';
    const q=$('#intelsearch').value.trim().toLowerCase(),mode=$('#intelfilter').value;
    const items=r.items.filter(x=>(x.name+' '+x.url).toLowerCase().includes(q)&&(mode==='all'||mode==='changed'&&changed.includes(x)||mode==='unknown'&&(x.phase==='unknown'||x.stale||x.error)||x.phase===mode));
    setCards('#intelcards',items.map(x=>'<article class="market-card">'+thumb(x.image,x.name)+'<h3>'+esc(x.name)+'</h3><span class="badge">'+esc(phaseNames[x.phase]||'待核实')+'</span><p>'+(x.error?esc(x.error):x.checkedAt?x.limited?'仅能读取部分静态内容，请在浏览器核对':'已读取网页文字；身份、资格与开放状态仍需复核':'公开目录收录的项目入口，尚未读取')+'</p><small>最近成功：'+esc(when(x.checkedAt))+(x.stale?' · 未取得或已过期':'')+'</small>'+(x.changedAt?'<p>最近变化：'+esc(when(x.changedAt))+'</p>':'')+'<div class="row"><a href="'+esc(x.url)+'" target="_blank" rel="noreferrer">查看项目入口 ↗</a><button data-intel-watch="'+esc(x.url)+'">加入自选</button>'+taskButton(x.url,x.name)+'<button class="ghost" data-intel-schedule="'+esc(x.url)+'">记录排期</button></div><details><summary>来源与页面证据</summary><p>此分类来自页面关键词，不代表已获得资格或确认可 Mint。</p>'+(x.discoverySource?'<p><a href="'+esc(x.discoverySource)+'" target="_blank" rel="noreferrer">发现来源：公开项目目录 ↗</a></p>':'<p>发现来源：本机自选 / 扫描来源</p>')+(x.snippets||[]).map(s=>'<blockquote>'+esc(s)+'</blockquote>').join('')+(x.links||[]).map(a=>'<p><a href="'+esc(a.url)+'" target="_blank" rel="noreferrer">页面提供的入口：'+esc(a.name)+' ↗</a></p>').join('')+'</details></article>').join('')||'<p>没有符合筛选条件的来源。</p>');
    setCards('#intelevents',r.events.slice(0,20).map(x=>'<p><small>'+esc(when(x.at))+'</small> '+esc(x.name)+'：'+esc(x.text)+'（'+esc(phaseNames[x.before]||'待核实')+' → '+esc(phaseNames[x.after]||'待核实')+'） <a href="'+esc(x.url)+'" target="_blank" rel="noreferrer">核对来源 ↗</a></p>').join('')||'<p>首次读取建立基准；后续只记录申请与 Mint 相关内容的变化。</p>');
    renderCalendar();
  }
  function scheduleDialog(item={}){
    dialog('记录公告排期','<label>项目名称<input id="schedname" maxlength="120" value="'+esc(item.name||'')+'"></label><label>项目入口<input id="schedurl" type="url" value="'+esc(item.url||'')+'" placeholder="https://..."></label><label>公告原帖链接<input id="schedsource" type="url" placeholder="https://..."></label><div class="grid fields"><label>公告日期与时间<input id="schedtime" type="datetime-local"></label><label>公告时区<select id="schedoffset"><option value="+08:00">北京时间 UTC+8</option><option value="Z">UTC</option><option value="+09:00">日本时间 UTC+9</option></select></label><label>场次<select id="schedstage"><option value="unknown">阶段未确认</option><option value="allowlist">白名单场</option><option value="public">Public 公售</option></select></label><label>证据<select id="schedverification"><option value="secondary">二手转引，待核对原帖</option><option value="user-checked">我已核对项目方原帖</option><option value="unverified">来源待核实</option></select></label></div><label>价格 / 条件备注<input id="schednote" maxlength="300" placeholder="选填；没有确认的价格请留空"></label><p>这里只记录排期，不会创建自动付款任务。请按原公告填写时区；来源核验是你的标记。</p>',async()=>{
      await api('intelligence/schedule',{name:$('#schedname').value,url:$('#schedurl').value.trim(),sourceUrl:$('#schedsource').value.trim(),originalTime:$('#schedtime').value+$('#schedoffset').value,stage:$('#schedstage').value,verification:$('#schedverification').value,note:$('#schednote').value});say('公告排期已保存；未启动付款。');
    },'保存排期');
  }
  bind('#intelrefresh',()=>api('intelligence/refresh',{}));
  bind('#inteltoggle',()=>api('intelligence/enabled',{enabled:!current?.enabled}));
  bind('#intelschedule',()=>scheduleDialog());
  for(const id of ['#intelsearch','#intelfilter'])$(id).addEventListener('input',()=>render(current));
  for(const id of ['#intelzone','#inteldate'])$(id).addEventListener('change',renderCalendar);
  $('#intelcards').addEventListener('click',async e=>{
    const b=e.target.closest('button[data-intel-watch],button[data-intel-schedule]');if(!b||b.disabled)return;
    const item=current?.items.find(x=>x.url===(b.dataset.intelWatch||b.dataset.intelSchedule));if(!item)return;
    if(b.dataset.intelSchedule){scheduleDialog(item);return;}
    b.disabled=true;try{await api('projects/add',{name:item.name,url:item.url});await refresh();say('已加入自选，可继续做项目任务。');}catch(e){say(e.message);}finally{b.disabled=false;}
  });
  $('#intelcalendar').addEventListener('click',async e=>{const b=e.target.closest('button[data-intel-remove]');if(!b)return;b.disabled=true;try{await api('intelligence/remove',{id:b.dataset.intelRemove});await refresh();}catch(e){say(e.message);}finally{b.disabled=false;}});
  return render;
}
