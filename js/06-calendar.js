// Calendario: vistas, rejillas y sincronización
// Parte de la app TM. Script clásico: comparte ámbito global con el resto.

function isCalEnabled(id){ return (state.calendarSelection||{})[id] !== false; }

function calDisplayName(c){
  const over=(state.calendarNames||{})[c.id];
  if(over) return over;
  if(c.summaryOverride) return c.summaryOverride;
  const s=c.summary||'';
  if(/^(webcal|https?):\/\//i.test(s)){
    try{ return new URL(s.replace(/^webcal:/,'https:')).hostname.replace(/^www\./,''); }
    catch(e){ return 'Suscripción'; }
  }
  return s;
}
function renameCalendar(id){
  const c=googleCalendars.find(x=>x.id===id); if(!c) return;
  const name=prompt('Nombre para este calendario:',calDisplayName(c));
  if(name===null) return;
  if(!state.calendarNames) state.calendarNames={};
  if(name.trim()) state.calendarNames[id]=name.trim();
  else delete state.calendarNames[id];
  saveSettings(); renderCalendarSelector(); renderCalSidebarList();
}

function renderCalMini(){
  const yr=calMiniMonth.getFullYear(), mo=calMiniMonth.getMonth();
  const today=todayStr();
  const selDay=calView==='day'?`${calViewDate.getFullYear()}-${String(calViewDate.getMonth()+1).padStart(2,'0')}-${String(calViewDate.getDate()).padStart(2,'0')}`:null;
  const firstDay=new Date(yr,mo,1); const lastDay=new Date(yr,mo+1,0);
  let startDow=firstDay.getDay(); if(startDow===0) startDow=7; startDow--;
  const label=new Date(yr,mo,1).toLocaleDateString('es-ES',{month:'long',year:'numeric'});
  let cells=[];
  for(let i=0;i<startDow;i++) cells.push(null);
  for(let d=1;d<=lastDay.getDate();d++) cells.push(`${yr}-${String(mo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`);
  while(cells.length%7!==0) cells.push(null);
  return `<div class="cal-mini">
    <div class="cal-mini-nav">
      <button class="cal-mini-arr" onclick="navCalMini(-1)"><i class="ti ti-chevron-left"></i></button>
      <span class="cal-mini-title">${label}</span>
      <button class="cal-mini-arr" onclick="navCalMini(1)"><i class="ti ti-chevron-right"></i></button>
    </div>
    <div class="cal-mini-grid">
      ${'LMXJVSD'.split('').map(d=>`<div class="cal-mini-dow">${d}</div>`).join('')}
      ${cells.map(ds=>{
        if(!ds) return '<div class="cal-mini-day other"></div>';
        const isT=ds===today, isSel=ds===selDay;
        return `<div class="cal-mini-day${isT?' mini-today':''}${isSel?' mini-sel':''}" onclick="selectCalDay('${ds}')">${parseInt(ds.slice(8))}</div>`;
      }).join('')}
    </div>
  </div>`;
}
function navCalMini(delta){
  calMiniMonth=new Date(calMiniMonth.getFullYear(),calMiniMonth.getMonth()+delta,1);
  const el=document.getElementById('calMiniWrap'); if(el) el.innerHTML=renderCalMini();
}

function renderCalSidebarList(){
  const el=document.getElementById('calSidebarList'); if(!el) return;
  if(!googleCalendars.length){ el.innerHTML=''; return; }
  const mine=googleCalendars.filter(c=>c.accessRole==='owner'||c.accessRole==='writer');
  const others=googleCalendars.filter(c=>c.accessRole!=='owner'&&c.accessRole!=='writer');
  const renderGroup=(list,title)=>{
    if(!list.length) return '';
    return `<div class="cal-list-group">
      <div class="cal-list-group-title">${title}</div>
      ${list.map(c=>{
        const on=isCalEnabled(c.id);
        const name=calDisplayName(c);
        const color=c.backgroundColor||'#4285F4';
        const isUrl=/^(webcal|https?):\/\//i.test(c.summary||'');
        return `<div class="cal-list-item" onclick="toggleCalendar('${escapeAttr(c.id)}')">
          <span class="cal-list-check${on?' on':''}" style="background:${on?color:'transparent'};border-color:${color};"></span>
          <span class="cal-list-name" title="${escapeAttr(c.summary)}">${escapeHtml(name)}</span>
          ${isUrl?`<button class="cal-list-rename" onclick="event.stopPropagation();renameCalendar('${escapeAttr(c.id)}')" title="Renombrar"><i class="ti ti-pencil"></i></button>`:''}
        </div>`;
      }).join('')}
    </div>`;
  };
  el.innerHTML=renderGroup(mine,'Mis calendarios')+renderGroup(others,'Otros calendarios');
}

function toggleCalendar(id){
  if(!state.calendarSelection) state.calendarSelection={};
  state.calendarSelection[id] = !isCalEnabled(id);
  saveSettings();
  renderCalendarSelector();
  renderCalSidebarList();
  loadCalendarWidget();
  loadCalendarData();
}
function renderCalendarSelector(){
  const el=document.getElementById('calSelector'); if(!el) return;
  el.innerHTML=googleCalendars.map(c=>{
    const on=isCalEnabled(c.id);
    return `<span class="cal-chip ${on?'on':''}" onclick="toggleCalendar('${escapeAttr(c.id)}')" title="${escapeAttr(c.summary)}">
      <span class="cal-chip-dot" style="background:${c.backgroundColor||'#4285F4'}"></span>
      ${escapeHtml(calDisplayName(c))}
    </span>`;
  }).join('');
}

function getWeekRange(d){
  const day=d.getDay();
  const mon=new Date(d); mon.setDate(d.getDate()-(day===0?6:day-1)); mon.setHours(0,0,0,0);
  const sun=new Date(mon); sun.setDate(mon.getDate()+6); sun.setHours(23,59,59,999);
  return{mon,sun};
}
function get3WeekStart(d){
  const day=d.getDay();
  const mon=new Date(d); mon.setDate(d.getDate()-(day===0?6:day-1)); mon.setHours(0,0,0,0);
  return mon;
}
function change3Week(delta){
  if(delta===0){ calViewDate=new Date(); }
  else{ const d=new Date(calViewDate); d.setDate(d.getDate()+delta*7); calViewDate=d; }
  render(); loadCalendarData();
}

function renderCalendario(){
  if(!googleToken) return `<div class="agenda-connect">
    <p>Conecta tu cuenta de Google en ⚙️ Configuración para ver tu calendario.</p>
    <button class="btn-primary btn-small" onclick="openConfigDrawer()">Conectar con Google</button>
  </div>`;
  let navMid='';
  if(calView==='month'){
    const lbl=calViewMonth.toLocaleDateString('es-ES',{month:'long',year:'numeric'});
    navMid=`<button class="btn-ghost btn-small" onclick="changeCalMonth(-1)"><i class="ti ti-chevron-left"></i></button>
      <span class="cal-nav-label" id="calNavLabel" style="text-transform:capitalize;">${lbl}</span>
      <button class="btn-ghost btn-small" onclick="changeCalMonth(0)">Hoy</button>
      <button class="btn-ghost btn-small" onclick="changeCalMonth(1)"><i class="ti ti-chevron-right"></i></button>`;
  } else if(calView==='day'){
    const lbl=calViewDate.toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    navMid=`<button class="btn-ghost btn-small" onclick="changeCalDay(-1)"><i class="ti ti-chevron-left"></i></button>
      <span class="cal-nav-label" id="calNavLabel" style="text-transform:capitalize;">${lbl}</span>
      <button class="btn-ghost btn-small" onclick="changeCalDay(0)">Hoy</button>
      <button class="btn-ghost btn-small" onclick="changeCalDay(1)"><i class="ti ti-chevron-right"></i></button>`;
  } else if(calView==='3week'){
    const s=get3WeekStart(calViewDate);
    const e=new Date(s); e.setDate(s.getDate()+20);
    const lbl=s.toLocaleDateString('es-ES',{day:'numeric',month:'short'})+' – '+e.toLocaleDateString('es-ES',{day:'numeric',month:'short',year:'numeric'});
    navMid=`<button class="btn-ghost btn-small" onclick="change3Week(-1)"><i class="ti ti-chevron-left"></i></button>
      <span class="cal-nav-label" id="calNavLabel">${lbl}</span>
      <button class="btn-ghost btn-small" onclick="change3Week(0)">Hoy</button>
      <button class="btn-ghost btn-small" onclick="change3Week(1)"><i class="ti ti-chevron-right"></i></button>`;
  } else {
    const {mon,sun}=getWeekRange(calViewDate);
    const lbl=mon.toLocaleDateString('es-ES',{day:'numeric',month:'short'})+' – '+sun.toLocaleDateString('es-ES',{day:'numeric',month:'short',year:'numeric'});
    navMid=`<button class="btn-ghost btn-small" onclick="changeCalWeek(-1)"><i class="ti ti-chevron-left"></i></button>
      <span class="cal-nav-label" id="calNavLabel">${lbl}</span>
      <button class="btn-ghost btn-small" onclick="changeCalWeek(0)">Hoy</button>
      <button class="btn-ghost btn-small" onclick="changeCalWeek(1)"><i class="ti ti-chevron-right"></i></button>`;
  }
  const content = calView==='month'
    ? `<div class="cal-grid" id="calMonthGrid"><div class="empty" style="grid-column:span 7;padding:16px;">Cargando...</div></div>`
    : `<div id="calViewContent"><p class="empty" style="padding:16px;">Cargando...</p></div>`;

  const sidebar=`<div class="cal-sidebar">
    <div id="calMiniWrap">${renderCalMini()}</div>
    <div>
      <div class="cal-list-group">
        <div class="cal-list-group-title">Mostrar en calendario</div>
        <div class="cal-list-item" onclick="showCalLocalTasks=!showCalLocalTasks;render();loadCalendarData();">
          <span class="cal-list-check${showCalLocalTasks?' on':''}" style="background:${showCalLocalTasks?'#7c3aed':'transparent'};border-color:#7c3aed;"></span>
          <span class="cal-list-name">Tareas</span>
        </div>
        <div class="cal-list-item" onclick="showCalGTasks=!showCalGTasks;render();loadCalendarData();">
          <span class="cal-list-check${showCalGTasks?' on':''}" style="background:${showCalGTasks?'#1a73e8':'transparent'};border-color:#1a73e8;"></span>
          <span class="cal-list-name">G Tasks</span>
        </div>
      </div>
      <div id="calSidebarList"></div>
    </div>
  </div>`;

  return `<div class="cal-layout">
    ${sidebar}
    <div class="cal-main">
      <div class="cal-nav">
        ${navMid}
        <div class="cal-view-tabs" style="margin-left:auto;">
          <button class="cal-view-tab ${calView==='day'?'active':''}" onclick="setCalView('day')">Día</button>
          <button class="cal-view-tab ${calView==='week'?'active':''}" onclick="setCalView('week')">Semana</button>
          <button class="cal-view-tab ${calView==='3week'?'active':''}" onclick="setCalView('3week')">3 Semanas</button>
          <button class="cal-view-tab ${calView==='month'?'active':''}" onclick="setCalView('month')">Mes</button>
        </div>
        <div style="display:flex;gap:4px;margin-left:8px;align-items:center;">
          <button class="btn-primary btn-small" onclick="openCalEventModal(null)" style="gap:4px;"><i class="ti ti-plus"></i> Evento</button>
          <button class="btn-ghost btn-small" onclick="loadCalendarData()" title="Actualizar"><i class="ti ti-refresh"></i></button>
        </div>
      </div>
      <div id="agendaSyncBar" class="agenda-sync-bar" style="display:none;"></div>
      ${content}
    </div>
  </div>`;
}
function setCalView(v){ calView=v; calSelectedDay=null; if(v!=='month') calViewDate=new Date(); render(); loadCalendarData(); }
function changeCalMonth(delta){
  if(delta===0){ calViewMonth=new Date(); calMiniMonth=new Date(); }
  else{ calViewMonth=new Date(calViewMonth.getFullYear(),calViewMonth.getMonth()+delta,1); calMiniMonth=new Date(calViewMonth); }
  calSelectedDay=null; render(); loadCalendarMonth();
}
function changeCalDay(delta){
  if(delta===0){ calViewDate=new Date(); } else { const d=new Date(calViewDate); d.setDate(d.getDate()+delta); calViewDate=d; }
  render(); loadCalendarData();
}
function changeCalWeek(delta){
  if(delta===0){ calViewDate=new Date(); } else { const d=new Date(calViewDate); d.setDate(d.getDate()+delta*7); calViewDate=d; }
  render(); loadCalendarData();
}
async function loadCalendarData(){
  if(calView==='month'){ loadCalendarMonth(); return; }
  let tMin,tMax;
  if(calView==='day'){
    const d=new Date(calViewDate); d.setHours(0,0,0,0);
    tMin=d.toISOString();
    const end=new Date(d); end.setDate(d.getDate()+1);
    tMax=end.toISOString();
  } else if(calView==='3week'){
    const s=get3WeekStart(calViewDate);
    const e=new Date(s); e.setDate(s.getDate()+21); e.setHours(23,59,59,999);
    tMin=s.toISOString(); tMax=e.toISOString();
  } else {
    const {mon,sun}=getWeekRange(calViewDate);
    tMin=mon.toISOString(); tMax=sun.toISOString();
  }
  calMonthEvents=await fetchCalendarEvents(tMin,tMax);
  renderCalendarSelector();
  renderCalSidebarList();
  const el=document.getElementById('calViewContent'); if(!el) return;
  if(calView==='day') el.innerHTML=renderCalDayGrid();
  else if(calView==='3week') renderCal3WeekGrid();
  else el.innerHTML=renderCalWeekGrid();
}
function renderCalDayGrid(){
  const dateStr=calViewDate.toISOString().slice(0,10);
  const today2=todayStr();
  const isToday3=dateStr===today2;
  const dayGTasks=showCalGTasks?googleTasks.filter(t=>t.due&&t.due.slice(0,10)===dateStr):[];
  const dayLTasks=showCalLocalTasks?state.tasks.filter(t=>t.status!=='hecha'&&!t.gTaskId&&taskSpanPos(t,dateStr)):[];
  const overdueGTasks=isToday3&&showCalGTasks?googleTasks.filter(t=>t.due&&t.due.slice(0,10)<today2):[];
  const overdueLTasks=isToday3&&showCalLocalTasks?state.tasks.filter(t=>t.due&&t.due<today2&&t.status!=='hecha'&&!t.gTaskId):[];
  const taskHtml=dayGTasks.map(t=>`<div class="gtask-day-row" onclick="openGTaskModal('${escapeAttr(t._listId)}','${escapeAttr(t.id)}')">
    <div class="gtask-day-row-info">
      <div class="gtask-day-row-label">✓ Google Tasks · ${escapeHtml(t._listTitle||'')}</div>
      <div class="gtask-day-row-title">${escapeHtml(t.title||'')}</div>
      ${t.notes?`<div style="font-size:11px;color:var(--text-soft);margin-top:2px;">${escapeHtml(t.notes.slice(0,80))}</div>`:''}
    </div>
    <button class="btn-ghost btn-small" style="flex-shrink:0;" onclick="event.stopPropagation();completeGoogleTask('${escapeAttr(t._listId)}','${escapeAttr(t.id)}')">✓</button>
  </div>`).join('')
  +dayLTasks.map(t=>`<div class="ltask-day-row ${t.urgency||''}" onclick="openTaskModal('${escapeAttr(t.id)}')">
    <div class="gtask-day-row-info">
      <div class="gtask-day-row-label" style="color:#7c3aed;">● Tarea · ${escapeHtml(t.tipo||t.urgency||'')}</div>
      <div class="gtask-day-row-title">${escapeHtml(t.title||'')}</div>
      ${t.context?`<div style="font-size:11px;color:var(--text-soft);margin-top:2px;">${escapeHtml(t.context.slice(0,80))}</div>`:''}
    </div>
  </div>`).join('');
  const overdueHtml=overdueGTasks.map(t=>`<div class="gtask-day-row overdue" onclick="openGTaskModal('${escapeAttr(t._listId)}','${escapeAttr(t.id)}')">
    <div class="gtask-day-row-info">
      <div class="gtask-day-row-label" style="color:#ef4444;">⚠ Vencida · Google Tasks · ${escapeHtml(t._listTitle||'')}</div>
      <div class="gtask-day-row-title">${escapeHtml(t.title||'')}</div>
    </div>
    <button class="btn-ghost btn-small" style="flex-shrink:0;" onclick="event.stopPropagation();completeGoogleTask('${escapeAttr(t._listId)}','${escapeAttr(t.id)}')">✓</button>
  </div>`).join('')
  +overdueLTasks.map(t=>`<div class="ltask-day-row overdue" onclick="openTaskModal('${escapeAttr(t.id)}')">
    <div class="gtask-day-row-info">
      <div class="gtask-day-row-label" style="color:#ef4444;">⚠ Vencida · ${escapeHtml(t.tipo||t.urgency||'Tarea')}</div>
      <div class="gtask-day-row-title">${escapeHtml(t.title||'')}</div>
    </div>
  </div>`).join('');
  if(!calMonthEvents.length && !dayGTasks.length && !dayLTasks.length && !overdueGTasks.length && !overdueLTasks.length) return '<p class="empty" style="padding:16px;">Sin eventos ni tareas este día.</p>';
  return overdueHtml+taskHtml+calMonthEvents.map(ev=>{
    const t=ev.start.dateTime?new Date(ev.start.dateTime).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}):'Todo el día';
    const tend=ev.end?.dateTime?new Date(ev.end.dateTime).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}):'';
    const dot=ev._calColor?`<span class="cal-day-event-dot" style="background:${ev._calColor};"></span>`:'';
    return `<div class="cal-day-event-row" style="cursor:pointer;" onclick="openCalEventModal('${escapeAttr(ev.id)}')">
      ${dot}
      <div class="cal-day-event-info">
        <div class="cal-day-event-time">${t}${tend?' – '+tend:''}</div>
        <div class="cal-day-event-title">${escapeHtml(ev.summary||'(sin título)')}</div>
        ${ev._calName?`<div class="cal-day-event-calname">${escapeHtml(ev._calName)}</div>`:''}
      </div>
    </div>`;
  }).join('');
}
function renderCalWeekGrid(){
  const{mon}=getWeekRange(calViewDate);
  const today=todayStr();
  const byDay={};
  calMonthEvents.forEach(ev=>{
    const d=ev.start.dateTime?ev.start.dateTime.slice(0,10):ev.start.date;
    if(!byDay[d])byDay[d]=[]; byDay[d].push(ev);
  });
  const names=['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
  const weekDays=Array.from({length:7},(_,i)=>{
    const d=new Date(mon); d.setDate(mon.getDate()+i);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  });

  // Spanning bars strip (all-day gcal events + multi-day tasks)
  const spanItems=[..._gcalAllDaySpans(calMonthEvents),..._ltaskSpans()].filter(it=>it.end>=weekDays[0]&&it.start<=weekDays[6]);
  const bars=_buildSpanBars(spanItems,weekDays);
  const maxLane=bars.length?Math.max(...bars.map(b=>b.lane)):0;
  const stripHtml=bars.length?`<div class="cal-week-allday-strip" style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));grid-auto-rows:22px;min-height:${maxLane*23+4}px;padding:2px 0;border-bottom:1px solid var(--border);">
    ${bars.map(b=>`<div class="cal-span-bar ${b.cls}" style="grid-column:${b.col}/span ${b.span};grid-row:${b.lane};background:${b.color};" onclick="${b.onClick}" title="${escapeHtml(b.label)}">${b.cBefore?'◀ ':''}${escapeHtml(b.label)}${b.cAfter?' ▶':''}</div>`).join('')}
  </div>`:'';

  const colsHtml=weekDays.map((ds,i)=>{
    const d=new Date(mon); d.setDate(mon.getDate()+i);
    const isT=ds===today;
    const evs=byDay[ds]||[];
    const evHtml=evs.filter(ev=>ev.start.dateTime).map(ev=>{
      const t=new Date(ev.start.dateTime).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});
      return `<div class="cal-week-event" style="background:${ev._calColor||'var(--accent)'};cursor:pointer;" onclick="event.stopPropagation();openCalEventModal('${escapeAttr(ev.id)}')">${t} ${escapeHtml(ev.summary||'')}</div>`;
    }).join('');
    // Only single-day tasks in column cells (multi-day ones are in the strip above)
    const colGTasks=showCalGTasks?googleTasks.filter(t=>t.due&&t.due.slice(0,10)===ds):[];
    const colLTasks=showCalLocalTasks?state.tasks.filter(t=>t.status!=='hecha'&&!t.gTaskId&&(!t.start||t.start===t.due)&&t.due===ds):[];
    const overdueGTasks=isT&&showCalGTasks?googleTasks.filter(t=>t.due&&t.due.slice(0,10)<today):[];
    const overdueLTasks=isT&&showCalLocalTasks?state.tasks.filter(t=>t.due&&t.due<today&&t.status!=='hecha'&&!t.gTaskId&&(!t.start||t.start===t.due)):[];
    const taskHtml=
       (showCalGTasks?colGTasks.map(t=>`<div class="gtask-cal-pill" onclick="event.stopPropagation();openGTaskModal('${escapeAttr(t._listId)}','${escapeAttr(t.id)}')">✓ ${escapeHtml(t.title||'')}</div>`).join(''):'')
      +(showCalLocalTasks?colLTasks.map(t=>`<div class="ltask-cal-pill ${t.urgency||''}" onclick="event.stopPropagation();openTaskModal('${escapeAttr(t.id)}')">● ${escapeHtml(t.title||'')}</div>`).join(''):'')
      +(showCalGTasks?overdueGTasks.map(t=>`<div class="gtask-cal-pill overdue" onclick="event.stopPropagation();openGTaskModal('${escapeAttr(t._listId)}','${escapeAttr(t.id)}')">⚠ ${escapeHtml(t.title||'')}</div>`).join(''):'')
      +(showCalLocalTasks?overdueLTasks.map(t=>`<div class="ltask-cal-pill ${t.urgency||''} overdue" onclick="event.stopPropagation();openTaskModal('${escapeAttr(t.id)}')">⚠ ${escapeHtml(t.title||'')}</div>`).join(''):'');
    return `<div class="cal-week-col">
      <div class="cal-week-col-head ${isT?'today-col':''}">
        <div class="cal-week-col-head-name">${names[i]}</div>
        <div class="cal-week-col-head-day">${d.getDate()}</div>
      </div>
      <div class="cal-week-col-body">${evHtml}${taskHtml}</div>
    </div>`;
  }).join('');

  return `<div style="display:flex;flex-direction:column;">${stripHtml}<div class="cal-week-grid">${colsHtml}</div></div>`;
}

function renderCal3WeekGrid(){
  const el=document.getElementById('calViewContent'); if(!el) return;
  const today=todayStr();
  const start=get3WeekStart(calViewDate);

  const byDay={};
  calMonthEvents.forEach(ev=>{
    const d=ev.start.dateTime?ev.start.dateTime.slice(0,10):ev.start.date;
    if(!byDay[d])byDay[d]=[]; byDay[d].push(ev);
  });
  const singleByDay={};
  if(showCalGTasks) googleTasks.filter(t=>t.due).forEach(t=>{
    const d=t.due.slice(0,10); if(!singleByDay[d])singleByDay[d]=[]; singleByDay[d].push({_type:'gtask',...t});
  });
  if(showCalLocalTasks) state.tasks.filter(t=>t.due&&t.status!=='hecha'&&!t.gTaskId&&(!t.start||t.start===t.due)).forEach(t=>{
    if(!singleByDay[t.due])singleByDay[t.due]=[]; singleByDay[t.due].push({_type:'ltask',...t});
  });

  const gcalSpans=_gcalAllDaySpans(calMonthEvents);
  const ltSpans=_ltaskSpans();
  const allSpanItems=[...gcalSpans,...ltSpans];

  const dowLabels=['Lu','Ma','Mi','Ju','Vi','Sá','Do'];
  let html=`<div class="cal-grid">
    <div class="cal-dow-row">${dowLabels.map(d=>`<div class="cal-dow">${d}</div>`).join('')}</div>`;

  for(let w=0;w<3;w++){
    const weekDays=[];
    for(let d=0;d<7;d++){
      const dt=new Date(start); dt.setDate(start.getDate()+w*7+d);
      weekDays.push(`${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`);
    }
    const bars=_buildSpanBars(allSpanItems,weekDays);
    const spansHtml=_renderSpanBars(bars);
    const daysHtml=weekDays.map(ds=>{
      const isToday=ds===today;
      const evs=(byDay[ds]||[]).filter(ev=>ev.start.dateTime).sort((a,b)=>(a.start.dateTime<b.start.dateTime?-1:1));
      const tasks=singleByDay[ds]||[];
      // No MAX — show all events so cells auto-expand
      const evRows=evs.map(ev=>{
        const isMissing=_reunionesCal&&ev._calId===_reunionesCal.id&&_reunionesMissingIds.has(ev.id);
        const t=new Date(ev.start.dateTime).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});
        return `<div class="cal-ev-row${isMissing?' missing-agenda':''}" onclick="event.stopPropagation();openCalEventModal('${escapeAttr(ev.id)}')">
          <span class="cal-ev-dot" style="background:${ev._calColor||'var(--accent)'};"></span>
          <span class="cal-ev-time">${t}</span>
          <span class="cal-ev-title">${isMissing?'⚠ ':''}${escapeHtml(ev.summary||'')}</span>
        </div>`;
      }).join('');
      const taskRows=tasks.map(t=>
        t._type==='gtask'
          ?`<div class="cal-ev-row" onclick="event.stopPropagation();openGTaskModal('${escapeAttr(t._listId)}','${escapeAttr(t.id)}')"><span class="cal-ev-dot" style="background:#1a73e8;"></span><span class="cal-ev-title">✓ ${escapeHtml(t.title||'')}</span></div>`
          :`<div class="cal-ev-row" onclick="event.stopPropagation();openTaskModal('${escapeAttr(t.id)}')"><span class="cal-ev-dot" style="background:#7c3aed;"></span><span class="cal-ev-title">${escapeHtml(t.title||'')}</span></div>`
      ).join('');
      const mo=new Date(ds+'T12:00:00').toLocaleDateString('es-ES',{month:'short'});
      return `<div class="cal-day${isToday?' today':''}" style="grid-row:2;min-height:140px;" data-date="${ds}" onclick="selectCalDay('${ds}')">
        <div class="cal-day-num"><span>${parseInt(ds.slice(8))}</span><span style="font-size:9px;color:var(--text-muted);margin-left:2px;">${mo}</span></div>
        ${evRows}${taskRows}
      </div>`;
    }).join('');
    html+=`<div class="cal-month-week">${spansHtml}${daysHtml}</div>`;
  }
  html+='</div>';
  el.innerHTML=html;
}

function selectCalDay(dateStr){
  // Navigate to day view for that date
  calViewDate=new Date(dateStr+'T12:00:00');
  calMiniMonth=new Date(calViewDate.getFullYear(),calViewDate.getMonth(),1);
  calView='day';
  render();
  loadCalendarData();
}
function renderCalDayDetail(){
  const det=document.getElementById('calDayDetail'); if(!det) return;
  if(!calSelectedDay){ det.style.display='none'; return; }
  const evs=calMonthEvents.filter(ev=>{
    const d=ev.start.dateTime?ev.start.dateTime.slice(0,10):ev.start.date;
    return d===calSelectedDay;
  });
  const d=new Date(calSelectedDay+'T12:00:00');
  const label=d.toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long'});
  det.style.display='block';
  const isSelectedToday = calSelectedDay===todayStr();
  const dayGTasks=googleTasks.filter(t=>t.due&&t.due.slice(0,10)===calSelectedDay);
  const dayLTasks=state.tasks.filter(t=>t.status!=='hecha'&&taskSpanPos(t,calSelectedDay));
  const overdueGDet=isSelectedToday?googleTasks.filter(t=>t.due&&t.due.slice(0,10)<calSelectedDay):[];
  const overdueLDet=isSelectedToday?state.tasks.filter(t=>t.due&&t.due<calSelectedDay&&t.status!=='hecha'):[];
  const overdueSection=(overdueGDet.length||overdueLDet.length)?
    `<div style="margin-top:10px;font-size:11px;font-weight:700;color:#ef4444;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">⚠ Vencidas</div>`+
    overdueGDet.map(t=>`<div class="agenda-event" style="border-left:2px solid #ef4444;padding-left:8px;cursor:pointer;background:rgba(239,68,68,.05);border-radius:4px;" onclick="openGTaskModal('${escapeAttr(t._listId)}','${escapeAttr(t.id)}')">
      <span class="agenda-event-time" style="color:#ef4444;font-size:11px;">G Tasks · ${escapeHtml(t._listTitle||'')}</span>
      <span class="agenda-event-title">${escapeHtml(t.title||'')}
        <button class="btn-ghost btn-small" style="font-size:10px;padding:1px 6px;margin-left:6px;" onclick="event.stopPropagation();completeGoogleTask('${escapeAttr(t._listId)}','${escapeAttr(t.id)}')">✓</button>
      </span>
    </div>`).join('')+
    overdueLDet.map(t=>`<div class="agenda-event" style="border-left:2px solid #ef4444;padding-left:8px;cursor:pointer;background:rgba(239,68,68,.05);border-radius:4px;" onclick="openTaskModal('${escapeAttr(t.id)}')">
      <span class="agenda-event-time" style="color:#ef4444;font-size:11px;">${escapeHtml(t.tipo||t.urgency||'Tarea')}</span>
      <span class="agenda-event-title">${escapeHtml(t.title||'')}</span>
    </div>`).join('') : '';
  det.innerHTML=`<div class="cal-day-detail-head">${label}</div>`+
    overdueSection+
    (evs.length ? evs.map(ev=>{
      const t=ev.start.dateTime?new Date(ev.start.dateTime).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}):'Todo el día';
      const dot=ev._calColor?`<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${ev._calColor};flex-shrink:0;margin-top:3px;"></span>`:'';
      return `<div class="agenda-event" style="cursor:pointer;" onclick="openCalEventModal('${escapeAttr(ev.id)}')">${dot}<span class="agenda-event-time">${t}</span><span class="agenda-event-title">${escapeHtml(ev.summary||'(sin título)')}</span></div>`;
    }).join('') : '<p class="empty">Sin eventos este día.</p>')+
    (dayGTasks.length ? `<div style="margin-top:10px;font-size:11px;font-weight:700;color:#1a73e8;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">✓ Google Tasks</div>`+
      dayGTasks.map(t=>`<div class="agenda-event" style="border-left:2px solid #1a73e8;padding-left:8px;cursor:pointer;" onclick="openGTaskModal('${escapeAttr(t._listId)}','${escapeAttr(t.id)}')">
        <span class="agenda-event-time" style="color:#1a73e8;font-size:11px;">${escapeHtml(t._listTitle||'Tasks')}</span>
        <span class="agenda-event-title">${escapeHtml(t.title||'')}
          <button class="btn-ghost btn-small" style="font-size:10px;padding:1px 6px;margin-left:6px;" onclick="event.stopPropagation();completeGoogleTask('${escapeAttr(t._listId)}','${escapeAttr(t.id)}')">✓</button>
        </span>
      </div>`).join('') : '')+
    (dayLTasks.length ? `<div style="margin-top:10px;font-size:11px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">● Tareas</div>`+
      dayLTasks.map(t=>`<div class="agenda-event" style="border-left:2px solid #7c3aed;padding-left:8px;cursor:pointer;" onclick="openTaskModal('${escapeAttr(t.id)}')">
        <span class="agenda-event-time" style="color:#7c3aed;font-size:11px;">${escapeHtml(t.tipo||t.urgency||'')}</span>
        <span class="agenda-event-title">${escapeHtml(t.title||'')}</span>
      </div>`).join('') : '');
}
async function loadCalendarMonth(){
  const grid=document.getElementById('calMonthGrid'); if(!grid) return;
  const yr=calViewMonth.getFullYear(), mo=calViewMonth.getMonth();
  const tMin=new Date(yr,mo,1).toISOString();
  const tMax=new Date(yr,mo+1,0,23,59,59).toISOString();
  calMonthEvents = await fetchCalendarEvents(tMin, tMax);
  renderCalendarSelector();
  renderCalSidebarList();
  renderCalMonthGrid();
  checkAgendaDirectorSync(); // async, non-blocking
}

async function checkAgendaDirectorSync(){
  if(!googleToken || !googleCalendars.length) return;
  _reunionesCal  = googleCalendars.find(c=>c.summary?.toLowerCase().includes('reuniones'));
  _agendaDirCal  = googleCalendars.find(c=>c.summary?.toLowerCase().includes('agenda director'));
  if(!_reunionesCal || !_agendaDirCal){ _reunionesMissingIds=new Set(); updateAgendaSyncBar(); return; }

  const now=new Date();
  const tMin=now.toISOString();
  const tMax=new Date(now.getTime()+15*24*60*60*1000).toISOString();
  const fetchCal=async calId=>{
    try{
      const r=await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?timeMin=${encodeURIComponent(tMin)}&timeMax=${encodeURIComponent(tMax)}&singleEvents=true&orderBy=startTime&maxResults=200`,
        {headers:{Authorization:`Bearer ${googleToken}`}});
      if(!r.ok) return [];
      return (await r.json()).items||[];
    }catch(e){ return []; }
  };
  [_reunionesEvents15, _agendaDirEvents15] = await Promise.all([fetchCal(_reunionesCal.id), fetchCal(_agendaDirCal.id)]);

  // Match by título normalizado + inicio (hasta minuto)
  const agendaKeys=new Set(_agendaDirEvents15.map(ev=>{
    const s=ev.start?.dateTime?.slice(0,16)||ev.start?.date||'';
    return (ev.summary||'').trim().toLowerCase()+'|'+s;
  }));
  _reunionesMissingIds=new Set();
  _reunionesEvents15.forEach(ev=>{
    const s=ev.start?.dateTime?.slice(0,16)||ev.start?.date||'';
    const key=(ev.summary||'').trim().toLowerCase()+'|'+s;
    if(!agendaKeys.has(key)) _reunionesMissingIds.add(ev.id);
  });
  updateAgendaSyncBar();
  renderCalMonthGrid(); // re-render para aplicar difuminado
}

function updateAgendaSyncBar(){
  const el=document.getElementById('agendaSyncBar'); if(!el) return;
  if(!_agendaDirCal||!_reunionesCal||_reunionesMissingIds.size===0){ el.style.display='none'; return; }
  const n=_reunionesMissingIds.size;
  el.style.display='flex';
  el.innerHTML=`<i class="ti ti-alert-triangle" style="color:#d97706;flex-shrink:0;"></i>
    <span><b>${n}</b> evento${n!==1?'s':''} de <b>Reuniones</b> no ${n!==1?'están':'está'} en <b>Agenda Director</b> (próximos 15 días)</span>
    <button class="btn-primary btn-small" style="margin-left:auto;white-space:nowrap;" onclick="syncAgendaDirector()"><i class="ti ti-copy"></i> Copiar a Agenda Director</button>`;
}

async function syncAgendaDirector(){
  if(!googleToken||!_agendaDirCal||!_reunionesCal) return;
  const missing=_reunionesEvents15.filter(ev=>_reunionesMissingIds.has(ev.id));
  if(!missing.length) return;
  const btn=document.querySelector('#agendaSyncBar button');
  if(btn){ btn.disabled=true; btn.textContent='Copiando...'; }
  let ok=0, fail=0;
  for(const ev of missing){
    const body={summary:ev.summary,description:ev.description,location:ev.location,start:ev.start,end:ev.end};
    if(ev.conferenceData) body.conferenceData=ev.conferenceData;
    try{
      const r=await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(_agendaDirCal.id)}/events`,{
        method:'POST',headers:{Authorization:`Bearer ${googleToken}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
      r.ok?ok++:fail++;
    }catch(e){ fail++; }
  }
  alert(`✓ ${ok} evento${ok!==1?'s':''} copiado${ok!==1?'s':''} a Agenda Director${fail?` · ${fail} error${fail!==1?'es':''}`:''}.`);
  await checkAgendaDirectorSync();
}

function _buildSpanBars(items, weekDays){
  // items: [{start, end, color, label, onClick}]
  // Returns bars with col, span, lane assigned
  const weekStart=weekDays[0], weekEnd=weekDays[6];
  const raw=items.map(item=>{
    const effS=item.start<weekStart?weekStart:item.start;
    const effE=item.end>weekEnd?weekEnd:item.end;
    const col=weekDays.indexOf(effS)+1;
    const col2=weekDays.indexOf(effE)+1;
    if(col<1||col2<col) return null;
    return{...item,col,span:col2-col+1,cBefore:item.start<weekStart,cAfter:item.end>weekEnd};
  }).filter(Boolean);
  const lanes=[];
  return raw.map(b=>{
    const effEnd=weekDays[b.col+b.span-2];
    const effStart=weekDays[b.col-1];
    let li=lanes.findIndex(e=>!e||e<effStart);
    if(li===-1){lanes.push(effEnd);li=lanes.length-1;} else lanes[li]=effEnd;
    const cls=b.cBefore&&b.cAfter?'cont-both':b.cBefore?'cont-before':b.cAfter?'cont-after':'';
    return{...b,lane:li+1,cls};
  });
}
function _gcalAllDaySpans(events){
  return events.filter(ev=>{
    if(!ev.start.date||!ev.end?.date) return false;
    const endExcl=new Date(new Date(ev.end.date+'T12:00:00').getTime()-86400000).toISOString().slice(0,10);
    return endExcl>ev.start.date;
  }).map(ev=>({
    start:ev.start.date,
    end:new Date(new Date(ev.end.date+'T12:00:00').getTime()-86400000).toISOString().slice(0,10),
    color:ev._calColor||'#4285F4',label:ev.summary||'',onClick:`openCalEventModal('${escapeAttr(ev.id)}')`
  }));
}
function _ltaskSpans(){
  return showCalLocalTasks ? state.tasks.filter(t=>t.start&&t.due&&t.start<t.due&&t.status!=='hecha'&&!t.gTaskId).map(t=>({
    start:t.start,end:t.due,
    color:{alta:'#ef4444',media:'#f59e0b',baja:'#22c55e','':'#7c3aed'}[t.urgency||''],
    label:t.title,onClick:`openTaskModal('${escapeAttr(t.id)}')`
  })) : [];
}
function _renderSpanBars(bars){
  if(!bars.length) return '';
  const maxLane=Math.max(...bars.map(b=>b.lane));
  return `<div class="cal-spans-container"><div class="cal-spans-inner" style="grid-auto-rows:22px;min-height:${maxLane*23}px;">
    ${bars.map(b=>`<div class="cal-span-bar ${b.cls}" style="grid-column:${b.col}/span ${b.span};grid-row:${b.lane};background:${b.color};" onclick="${b.onClick}" title="${escapeHtml(b.label)}">${b.cBefore?'◀ ':''}${escapeHtml(b.label)}${b.cAfter?' ▶':''}</div>`).join('')}
  </div></div>`;
}

function renderCalMonthGrid(){
  const grid=document.getElementById('calMonthGrid'); if(!grid) return;
  const yr=calViewMonth.getFullYear(), mo=calViewMonth.getMonth();
  const today=todayStr();
  const firstDay=new Date(yr,mo,1);
  const lastDay=new Date(yr,mo+1,0);
  let startDow=firstDay.getDay(); if(startDow===0) startDow=7; startDow--;

  const byDay={};
  calMonthEvents.forEach(ev=>{
    const d=ev.start.dateTime?ev.start.dateTime.slice(0,10):ev.start.date;
    if(!byDay[d])byDay[d]=[]; byDay[d].push(ev);
  });

  // Single-day tasks (no start range) for pills inside day cells
  const singleByDay={};
  if(showCalGTasks) googleTasks.filter(t=>t.due).forEach(t=>{
    const d=t.due.slice(0,10);
    if(!singleByDay[d])singleByDay[d]=[];
    singleByDay[d].push({_type:'gtask',...t});
    if(d<today&&d!==today){if(!singleByDay[today])singleByDay[today]=[]; singleByDay[today].push({_type:'gtask',_overdue:true,...t});}
  });
  if(showCalLocalTasks) state.tasks.filter(t=>t.due&&t.status!=='hecha'&&(!t.start||t.start===t.due)).forEach(t=>{
    if(!singleByDay[t.due])singleByDay[t.due]=[];
    singleByDay[t.due].push({_type:'ltask',...t});
    if(t.due<today&&t.due!==today){if(!singleByDay[today])singleByDay[today]=[]; singleByDay[today].push({_type:'ltask',_overdue:true,...t});}
  });

  // Build spanning bar sources
  const gcalSpans=_gcalAllDaySpans(calMonthEvents);
  const ltSpans=_ltaskSpans();
  const allSpanItems=[...gcalSpans,...ltSpans];

  // Build weeks
  const weeks=[];
  let wk=[];
  for(let i=0;i<startDow;i++) wk.push(null);
  for(let d=1;d<=lastDay.getDate();d++){
    wk.push(`${yr}-${String(mo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`);
    if(wk.length===7){weeks.push(wk);wk=[];}
  }
  while(wk.length>0&&wk.length<7) wk.push(null);
  if(wk.length) weeks.push(wk);

  const dowLabels=['Lu','Ma','Mi','Ju','Vi','Sá','Do'];
  let html='<div class="cal-dow-row">'+dowLabels.map(d=>`<div class="cal-dow">${d}</div>`).join('')+'</div>';

  weeks.forEach(weekDays=>{
    const valid=weekDays.filter(Boolean);
    if(!valid.length) return;
    const weekStart=valid[0], weekEnd=valid[valid.length-1];
    const weekItems=allSpanItems.filter(it=>it.end>=weekStart&&it.start<=weekEnd);
    const bars=_buildSpanBars(weekItems,weekDays);
    const spansHtml=_renderSpanBars(bars);

    const daysHtml=weekDays.map(ds=>{
      if(!ds) return '<div class="cal-day other-month" style="grid-row:2;"></div>';
      const isToday=ds===today, isSel=ds===calSelectedDay;
      const evs=(byDay[ds]||[]).filter(ev=>ev.start.dateTime);
      const tasks=singleByDay[ds]||[];
      const MAX=4;
      const evRows=evs.slice(0,MAX).map(ev=>{
        const isMissing=_reunionesCal&&ev._calId===_reunionesCal.id&&_reunionesMissingIds.has(ev.id);
        const t=new Date(ev.start.dateTime).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});
        return `<div class="cal-ev-row${isMissing?' missing-agenda':''}" onclick="event.stopPropagation();openCalEventModal('${escapeAttr(ev.id)}')" title="${isMissing?'⚠ Falta en Agenda Director — ':''}${escapeAttr(ev.summary||'')}">
          <span class="cal-ev-dot" style="background:${ev._calColor||'var(--accent)'};"></span>
          <span class="cal-ev-time">${t}</span>
          <span class="cal-ev-title">${isMissing?'⚠ ':''}${escapeHtml(ev.summary||'')}</span>
        </div>`;
      }).join('');
      const taskRows=tasks.slice(0,Math.max(0,MAX-evs.length)).map(t=>
        t._type==='gtask'
          ?`<div class="cal-ev-row${t._overdue?' overdue':''}" onclick="event.stopPropagation();openGTaskModal('${escapeAttr(t._listId)}','${escapeAttr(t.id)}')">
              <span class="cal-ev-dot" style="background:#1a73e8;"></span>
              <span class="cal-ev-title">${t._overdue?'⚠ ':'✓ '}${escapeHtml(t.title||'')}</span>
            </div>`
          :`<div class="cal-ev-row ${t.urgency||''}${t._overdue?' overdue':''}" onclick="event.stopPropagation();openTaskModal('${escapeAttr(t.id)}')">
              <span class="cal-ev-dot" style="background:#7c3aed;"></span>
              <span class="cal-ev-title">${t._overdue?'⚠ ':''}${escapeHtml(t.title||'')}</span>
            </div>`
      ).join('');
      const totalExtra=(evs.length-MAX)+(tasks.length-Math.max(0,MAX-evs.length));
      const more=totalExtra>0?`<div class="cal-event-more" onclick="event.stopPropagation();selectCalDay('${ds}')">+${totalExtra} más</div>`:'';
      return `<div class="cal-day ${isToday?'today':''} ${isSel?'selected':''}" style="grid-row:2;" data-date="${ds}" onclick="selectCalDay('${ds}')">
        <div class="cal-day-num"><span>${parseInt(ds.slice(8))}</span></div>${evRows}${taskRows}${more}
      </div>`;
    }).join('');

    html+=`<div class="cal-month-week">${spansHtml}${daysHtml}</div>`;
  });

  grid.innerHTML=html;
}
async function refreshHeaderEvents(){
  if(!googleToken) return;
  const cfg=state.calendarConfig||{};
  const cfgIds=[cfg.primary,cfg.secondary].filter(Boolean);
  if(!cfgIds.length){ calHeaderEvents=[]; updateHeaderEvents(); return; }
  if(!googleCalendars.length) await fetchCalendarList();
  const activeCals=googleCalendars.filter(c=>cfgIds.includes(c.id));
  if(!activeCals.length){ calHeaderEvents=[]; updateHeaderEvents(); return; }
  const now=new Date();
  const end=new Date(now.getTime()+7*24*60*60*1000);
  try{
    const results=await Promise.all(activeCals.map(cal=>
      fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?timeMin=${encodeURIComponent(now.toISOString())}&timeMax=${encodeURIComponent(end.toISOString())}&singleEvents=true&orderBy=startTime&maxResults=20`,
        {headers:{Authorization:`Bearer ${googleToken}`}})
      .then(r=>r.ok?r.json():{items:[]})
      .then(d=>(d.items||[]).map(ev=>({...ev,_calName:cal.summary,_calColor:cal.backgroundColor,_calId:cal.id})))
      .catch(()=>[])
    ));
    calHeaderEvents=results.flat().sort((a,b)=>(a.start.dateTime||a.start.date)<(b.start.dateTime||b.start.date)?-1:1);
  }catch(e){ calHeaderEvents=[]; }
  updateHeaderEvents();
}
function updateHeaderEvents(){
  const el=document.getElementById('headerEvents'); if(!el) return;
  if(!googleToken || !calHeaderEvents.length){ el.innerHTML=''; return; }
  const now=new Date();
  const today=todayStr();
  const tmrw=new Date(now); tmrw.setDate(now.getDate()+1);
  const tmrwStr=`${tmrw.getFullYear()}-${String(tmrw.getMonth()+1).padStart(2,'0')}-${String(tmrw.getDate()).padStart(2,'0')}`;

  const upcoming=calHeaderEvents.filter(ev=>{
    const t=ev.start.dateTime?new Date(ev.start.dateTime):new Date(ev.start.date+'T00:00:00');
    return t>=now;
  }).slice(0,14);
  if(!upcoming.length){ el.innerHTML=''; return; }

  // Group by day
  const byDay=new Map();
  upcoming.forEach(ev=>{
    const ds=(ev.start.dateTime||ev.start.date).slice(0,10);
    if(!byDay.has(ds)) byDay.set(ds,[]);
    byDay.get(ds).push(ev);
  });

  let html='';
  byDay.forEach((evs,ds)=>{
    let lbl;
    if(ds===today) lbl='Hoy';
    else if(ds===tmrwStr) lbl='Mañana';
    else{ const d=new Date(ds+'T12:00:00'); lbl=d.toLocaleDateString('es-ES',{weekday:'short',day:'numeric',month:'short'}); }
    html+=`<span class="ep-day-sep">${lbl}</span>`;
    evs.forEach(ev=>{
      const t=ev.start.dateTime?new Date(ev.start.dateTime).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}):'Todo el día';
      const dot=ev._calColor?`<span class="ep-dot" style="background:${ev._calColor};"></span>`:'';
      const meetLink=ev.hangoutLink||_extractMeetLink(ev);
      const meetBtn=meetLink?`<a href="${escapeAttr(meetLink)}" target="_blank" class="ep-meet-btn" onclick="event.stopPropagation();" title="Unirse"><i class="ti ti-video"></i></a>`:'';
      html+=`<span class="header-event-pill" onclick="openCalEventModal('${escapeAttr(ev.id)}')" style="cursor:pointer;">${dot}<span class="ep-time">${t}</span><span class="ep-title">${escapeHtml(ev.summary||'(sin título)')}</span>${meetBtn}</span>`;
    });
  });

  el.innerHTML=html;
  upcoming.forEach(ev=>scheduleMeetingNotification(ev));
  scheduleMeetingAlerts();
}
function _extractMeetLink(ev){
  const entries=ev.conferenceData?.entryPoints||[];
  const video=entries.find(e=>e.entryPointType==='video');
  if(video) return video.uri;
  const loc=ev.location||'';
  const desc=ev.description||'';
  const meetRe=/https:\/\/meet\.google\.com\/[a-z0-9-]+/i;
  return (loc.match(meetRe)||desc.match(meetRe)||[null])[0];
}
function scheduleMeetingAlerts(){
  if(_meetAlertTimer) return;
  if(Notification.permission==='default') Notification.requestPermission();
  _meetAlertTimer=setInterval(checkMeetingAlerts, 60000);
  checkMeetingAlerts();
}
function checkMeetingAlerts(){
  if(!calHeaderEvents.length) return;
  const now=Date.now();
  calHeaderEvents.forEach(ev=>{
    if(!ev.start?.dateTime) return;
    const start=new Date(ev.start.dateTime).getTime();
    const diff=start-now;
    if(diff>0 && diff<=5*60*1000){
      if(_alertedEvents.has(ev.id)) return;
      _alertedEvents.add(ev.id);
      const title=ev.summary||'Reunión';
      const hh=new Date(ev.start.dateTime).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});
      const meetLink=ev.hangoutLink||_extractMeetLink(ev);
      if(Notification.permission==='granted'){
        const n=new Notification('📅 '+title,{body:'Comienza a las '+hh+(meetLink?' · Reunión online':''),icon:''});
        if(meetLink) n.onclick=()=>{window.open(meetLink,'_blank');n.close();};
        setTimeout(()=>n.close(),15000);
      }
    }
  });
}
function saveCfgCalendars(){
  if(!state.calendarConfig) state.calendarConfig={};
  const p=document.getElementById('cfgPrimCal'); if(p) state.calendarConfig.primary=p.value;
  const s=document.getElementById('cfgSecCal'); if(s) state.calendarConfig.secondary=s.value;
  saveSettings();
  refreshHeaderEvents();
}
function updateGoogleCalendarConfigUI(){
  const box=document.getElementById('googleCalCfg'); if(!box) return;
  if(!googleToken||!googleCalendars.length){ box.style.display='none'; return; }
  box.style.display='block';
  const cfg=state.calendarConfig||{};
  const opts='<option value="">— Ninguno —</option>'+googleCalendars.map(c=>`<option value="${escapeAttr(c.id)}">${escapeHtml(c.summary)}</option>`).join('');
  const p=document.getElementById('cfgPrimCal'); if(p){ p.innerHTML=opts; p.value=cfg.primary||''; }
  const s=document.getElementById('cfgSecCal'); if(s){ s.innerHTML=opts; s.value=cfg.secondary||''; }
}
let selectedEmailId=null;