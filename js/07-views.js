// Vista de correo, agenda y modal de eventos de calendario
// Parte de la app TM. Script clásico: comparte ámbito global con el resto.

function renderCorreo(){
  if(!googleToken) return `<div class="agenda-connect">
    <p>Conecta tu cuenta de Google en ⚙️ Configuración para ver tus emails.</p>
    <button class="btn-primary btn-small" onclick="openConfigDrawer()">Conectar con Google</button>
  </div>`;
  const labelTitle=currentEmailQuery==='is:starred'?'Destacados':currentEmailQuery==='in:inbox'?'Recibidos':currentEmailQuery==='in:sent'?'Enviados':currentEmailQuery==='is:unread'?'No leídos':currentEmailQuery.startsWith('label:')?currentEmailQuery.replace('label:',''):'Correo';
  return `<div class="gmail-layout">
    <div class="gmail-sidebar" id="gmailSidebar">${renderGmailSidebarHTML()}</div>
    <div class="gm-tirador" data-col="sb" title="Arrastra para ajustar el ancho"></div>
    <div class="gmail-list-col">
      <div class="gm-cabecera" id="gmCabecera">
        <button class="gm-carpeta" onclick="abrirCarpetasMovil()" aria-label="Cambiar de carpeta">
          <i class="ti ${iconoDeCarpeta(currentEmailQuery)}" aria-hidden="true"></i>
          <span class="gm-carpeta-nombre">${escapeHtml(labelTitle)}</span>
          <i class="ti ti-chevron-down gm-carpeta-flecha" aria-hidden="true"></i>
        </button>
        <span class="gmail-list-head-title">${escapeHtml(labelTitle)}</span>
        ${renderFichasEtiqueta().replace('<div class="gm-fichas"','<div class="gm-fichas" id="gmFichas"')}
        <span class="gm-head-btns">
          <button class="gm-lupa" onclick="alternarBuscadorMovil()" title="Buscar" aria-label="Buscar"><i class="ti ti-search" aria-hidden="true"></i></button>
          <button class="btn-primary btn-small gm-redactar" onclick="openCompose('nuevo')" title="Redactar" aria-label="Redactar"><i class="ti ti-pencil-plus" aria-hidden="true"></i><span>Redactar</span></button>
          <button class="btn-icon gm-refrescar" onclick="loadGmailWidget()" title="Actualizar" aria-label="Actualizar" style="width:26px;height:26px;font-size:13px;"><i class="ti ti-refresh" aria-hidden="true"></i></button>
        </span>
        <div class="gm-buscador">
          <i class="ti ti-search" aria-hidden="true"></i>
          <input type="text" id="gmBuscar" placeholder="${(typeof isMobile==='function' && isMobile()) ? 'Buscar…' : 'Buscar en el correo…'}" onkeydown="buscarCorreo(event)">
          <button class="gm-buscar-x" onclick="limpiarBusqueda()" title="Limpiar" aria-label="Limpiar la búsqueda"><i class="ti ti-x" aria-hidden="true"></i></button>
        </div>
      </div>
      <div id="gmailWidget"><p class="empty" style="padding:16px 12px;">Cargando...</p></div>
    </div>
    <div class="gm-tirador" data-col="list" title="Arrastra para ajustar el ancho"></div>
    <div class="gmail-preview-col" id="gmailPreviewCol">
      <div class="gmail-preview-empty"><i class="ti ti-mail" style="font-size:32px;opacity:.3;" aria-hidden="true"></i><span>Selecciona un correo</span></div>
    </div>
  </div>`;
}
const CARPETAS_CORREO = [
  ['in:inbox',    'ti-inbox',        'Recibidos'],
  ['is:unread',   'ti-mail',         'No leídos'],
  ['is:starred',  'ti-star',         'Destacados'],
  ['in:sent',     'ti-send',         'Enviados'],
  ['in:drafts',   'ti-file',         'Borradores'],
  ['in:trash',    'ti-trash',        'Papelera'],
  ['in:spam',     'ti-alert-circle', 'Spam']
];
function iconoDeCarpeta(q){
  const c = CARPETAS_CORREO.find(x => x[0] === q);
  return c ? c[1] : 'ti-tag';                     // si no es carpeta, es una etiqueta
}

// En el móvil no hay barra lateral, así que sin esto no había manera de llegar
// a Enviados, Papelera o a tus etiquetas: solo se veía la bandeja de entrada.
function abrirCarpetasMovil(){
  const fila = (q, icono, nombre, activa) => `
    <button class="acc-menu-item ${activa ? 'azul' : 'gris'}" onclick="closeModal();setEmailQuery('${escapeAttr(q)}')">
      <i class="ti ${icono}" aria-hidden="true"></i><span>${escapeHtml(nombre)}</span>
      ${activa ? '<i class="ti ti-check" style="margin-left:auto;color:var(--accent);" aria-hidden="true"></i>' : ''}
    </button>`;

  const etiquetas = (gmailUserLabels || []).filter(l => l.type === 'user');
  document.getElementById('modalRoot').innerHTML = `
    <div class="modal-bg" onclick="if(event.target===this) closeModal()">
      <div class="modal">
        <h3>Ir a…</h3>
        <div class="acc-menu">
          ${CARPETAS_CORREO.map(([q, i, n]) => fila(q, i, n, currentEmailQuery === q)).join('')}
        </div>
        ${etiquetas.length ? `<p class="sect-h" style="margin:14px 0 4px;">Etiquetas</p>
          <div class="acc-menu">
            ${etiquetas.map(l => fila('label:' + l.name, 'ti-tag', l.name, currentEmailQuery === 'label:' + l.name)).join('')}
          </div>` : ''}
        <div class="modal-actions">
          <button class="btn-ghost" onclick="closeModal();loadGmailWidget();"><i class="ti ti-refresh" aria-hidden="true"></i> Actualizar</button>
          <button class="btn-ghost" onclick="closeModal()">Cerrar</button>
        </div>
      </div>
    </div>`;
}

// El buscador se guarda hasta que hace falta: así la barra ocupa una sola fila
function alternarBuscadorMovil(){
  const cab = document.getElementById('gmCabecera'); if(!cab) return;
  const abierto = cab.classList.toggle('buscando');
  if(abierto) setTimeout(() => document.getElementById('gmBuscar')?.focus(), 30);
}

function setEmailQuery(q){
  currentEmailQuery=q; selectedEmailId=null;
  render(); loadGmailWidget();
}
function renderAgendaView(){
  if(!googleToken) return `<div class="agenda-connect">
    <p>Conecta tu cuenta de Google para ver tu calendario y emails con estrella.</p>
    <button class="btn-primary btn-small" onclick="connectGoogle()">🔗 Conectar con Google</button>
  </div>`;
  return `<div class="agenda-grid">
    <div>
      <div class="agenda-sect-head">
        <h2>📅 Próximos 7 días</h2>
        <button class="btn-ghost btn-small" onclick="loadCalendarWidget()">↺</button>
      </div>
      <div id="calSelector" class="cal-selector"></div>
      <div id="calendarWidget"><p class="empty">Cargando...</p></div>
    </div>
    <div>
      <div class="agenda-sect-head">
        <h2>⭐ Emails con estrella</h2>
        <button class="btn-ghost btn-small" onclick="loadGmailWidget()">↺</button>
      </div>
      <div id="gmailWidget"><p class="empty">Cargando...</p></div>
    </div>
  </div>`;
}
async function loadAgendaData(){
  if(currentView==='calendario'){ loadCalendarData(); }
  else if(currentView==='correo') loadGmailWidget();
}

async function loadCalendarWidget(){
  const el=document.getElementById('calendarWidget'); if(!el) return;
  el.innerHTML='<p class="empty">Cargando...</p>';
  const events=await fetchCalendarEvents();
  if(!events.length){ el.innerHTML='<p class="empty">Sin eventos en los próximos 7 días.</p>'; return; }
  const byDay={};
  events.forEach(ev=>{
    const key=ev.start.dateTime?ev.start.dateTime.slice(0,10):ev.start.date;
    if(!byDay[key]) byDay[key]=[];
    byDay[key].push(ev);
  });
  const dias=['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  el.innerHTML=Object.entries(byDay).map(([date,evs])=>{
    const d=new Date(date+'T12:00:00');
    const label=date===todayStr()?'Hoy':(dias[d.getDay()]+' '+d.getDate()+' '+monthsEs[d.getMonth()]);
    return `<div class="agenda-day">
      <div class="agenda-day-label">${label}</div>
      ${evs.map(ev=>{
        const t=ev.start.dateTime?new Date(ev.start.dateTime).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}):'Todo el día';
        const dot=ev._calColor?`<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${ev._calColor};flex-shrink:0;margin-top:3px;"></span>`:'';
        return `<div class="agenda-event">
          <span class="agenda-event-time">${t}</span>
          ${dot}
          <span class="agenda-event-title">${escapeHtml(ev.summary||'(sin título)')}<br><span style="font-size:11px;color:var(--ink-soft);font-family:-apple-system,Helvetica,Arial,sans-serif;">${escapeHtml(ev._calName||'')}</span></span>
        </div>`;
      }).join('')}
    </div>`;
  }).join('');
}
function _findCalEvent(id){ return calMonthEvents.find(x=>x.id===id)||calHeaderEvents.find(x=>x.id===id)||null; }

function openCalEventModal(eventId, defaultDate){
  const ev = eventId ? _findCalEvent(eventId) : null;
  const isAllDay = ev ? !!ev.start?.date : false;
  const startDt = ev?.start?.dateTime ? new Date(ev.start.dateTime) : null;
  const endDt   = ev?.end?.dateTime   ? new Date(ev.end.dateTime)   : null;
  const startDate = ev ? (ev.start.date || ev.start.dateTime?.slice(0,10)) : (defaultDate || todayStr());
  const startTime = startDt ? startDt.toTimeString().slice(0,5) : '09:00';
  // Google all-day end is exclusive — subtract 1 day for display
  const endDateRaw = ev ? (ev.end?.date || ev.end?.dateTime?.slice(0,10)) : startDate;
  const endDateDisp = (ev && ev.end?.date)
    ? new Date(new Date(ev.end.date+'T12:00:00').getTime()-86400000).toISOString().slice(0,10)
    : endDateRaw;
  const endTime = endDt ? endDt.toTimeString().slice(0,5) : '10:00';
  const calId = ev?._calId || googleCalendars[0]?.id || 'primary';
  const root = document.getElementById('modalRoot');
  // Meet / conference link
  const meetLink = ev ? (ev.hangoutLink || _extractMeetLink(ev)) : null;
  // Ficha vinculada
  const linkedFicha = ev ? state.meetings.find(m=>m.calEventId===ev.id) : null;
  // Attendees
  const attendees = ev?.attendees || [];
  const selfAttendee = attendees.find(a=>a.self);
  const rsvpStatus = selfAttendee?.responseStatus || null;
  const organizer = ev?.organizer;
  const isRecurring = !!(ev?.recurringEventId || ev?.recurrence?.length);
  const statusColors = {accepted:'accepted',declined:'declined',tentative:'tentative',needsAction:'needsAction'};

  const meetSection = meetLink ? `
    <a href="${escapeAttr(meetLink)}" target="_blank" class="ev-meet-link">
      <i class="ti ti-video"></i> Unirse a la reunión online
    </a>` : '';

  const rsvpSection = selfAttendee ? `
    <div class="field" style="margin-bottom:10px;">
      <label>Tu respuesta</label>
      <div class="rsvp-row">
        <button class="rsvp-btn ${rsvpStatus==='accepted'?'accepted':''}" onclick="rsvpEvent('${escapeAttr(ev.id)}','${escapeAttr(ev._calId||'')}','accepted')">✓ Acepto</button>
        <button class="rsvp-btn ${rsvpStatus==='tentative'?'tentative':''}" onclick="rsvpEvent('${escapeAttr(ev.id)}','${escapeAttr(ev._calId||'')}','tentative')">? Tal vez</button>
        <button class="rsvp-btn ${rsvpStatus==='declined'?'declined':''}" onclick="rsvpEvent('${escapeAttr(ev.id)}','${escapeAttr(ev._calId||'')}','declined')">✕ Rechazo</button>
      </div>
    </div>` : '';

  const attendeesSection = attendees.length ? `
    <div class="field" style="margin-bottom:12px;">
      <label>Asistentes (${attendees.length})</label>
      <div class="ev-attendees">
        ${attendees.map(a=>`<span class="ev-attendee ${statusColors[a.responseStatus]||'needsAction'}" title="${escapeAttr(a.email||'')}">
          ${a.self?'<strong>Tú</strong>':escapeHtml(a.displayName||a.email||'')}
          ${a.organizer?' 👑':''}
        </span>`).join('')}
      </div>
    </div>` : '';

  root.innerHTML = `
    <div class="modal-bg" onclick="if(event.target===this) closeModal()">
      <div class="modal modal-wide" style="max-height:90vh;overflow-y:auto;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <h3 style="margin:0;">${ev ? 'Evento' : 'Nuevo evento'}</h3>
          <div style="display:flex;align-items:center;gap:8px;">
            ${isRecurring?`<span style="font-size:11px;padding:2px 7px;border-radius:99px;background:var(--accent-bg);color:var(--accent);">↻ Recurrente</span>`:''}
            ${ev?._calName ? `<span style="font-size:12px;color:var(--text-soft);">${escapeHtml(ev._calName)}</span>` : ''}
            ${organizer&&!organizer.self?`<span style="font-size:11px;color:var(--text-soft);">Org: ${escapeHtml(organizer.displayName||organizer.email||'')}</span>`:''}
          </div>
        </div>
        ${meetSection}
        ${rsvpSection}
        <div class="field">
          <label>Título</label>
          <input type="text" id="cevTitle" value="${escapeAttr(ev?.summary||'')}" placeholder="Título del evento">
        </div>
        <div class="field">
          <label>Calendario</label>
          <select id="cevCalId">
            ${googleCalendars.map(c=>`<option value="${escapeAttr(c.id)}" ${c.id===calId?'selected':''}>${escapeHtml(c.summary||c.id)}</option>`).join('')}
          </select>
        </div>
        <div class="gsync-row" style="margin-bottom:12px;">
          <label><input type="checkbox" id="cevAllDay" onchange="toggleCalEventAllDay(this.checked)" ${isAllDay?'checked':''}> Todo el día</label>
        </div>
        <div class="field-row">
          <div class="field" style="margin-bottom:0;">
            <label>Fecha inicio</label>
            <input type="date" id="cevStartDate" value="${startDate}" onchange="if(document.getElementById('cevEndDate').value<this.value) document.getElementById('cevEndDate').value=this.value;">
          </div>
          <div class="field" style="margin-bottom:0;" id="cevStartTimeWrap">
            <label>Hora inicio</label>
            <input type="time" id="cevStartTime" value="${startTime}">
          </div>
        </div>
        <div class="field-row" style="margin-top:10px;">
          <div class="field" style="margin-bottom:0;">
            <label>Fecha fin</label>
            <input type="date" id="cevEndDate" value="${endDateDisp}">
          </div>
          <div class="field" style="margin-bottom:0;" id="cevEndTimeWrap">
            <label>Hora fin</label>
            <input type="time" id="cevEndTime" value="${endTime}">
          </div>
        </div>
        <div class="field" style="margin-top:12px;">
          <label>Descripción</label>
          <textarea id="cevDesc" placeholder="Notas, enlace de videoconferencia…" style="min-height:80px;">${escapeHtml(ev?.description||'')}</textarea>
        </div>
        <div class="field">
          <label>Ubicación</label>
          <input type="text" id="cevLocation" value="${escapeAttr(ev?.location||'')}" placeholder="Dirección, sala, enlace…">
        </div>
        ${attendeesSection}
        ${ev ? `
        <div class="field" style="margin-top:4px;">
          <label>Ficha de reunión</label>
          ${linkedFicha
            ? `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--accent-bg);border-radius:7px;font-size:13px;">
                <i class="ti ti-notes" style="color:var(--accent);"></i>
                <span style="flex:1;font-weight:500;">${escapeHtml(linkedFicha.title)}</span>
                <button class="btn-ghost btn-small" onclick="closeModal();openMeetingModal('${linkedFicha.id}')">Abrir ficha</button>
                <button class="btn-ghost btn-small" onclick="unlinkCalEventFicha('${linkedFicha.id}','${escapeAttr(ev.id)}')">Desvincular</button>
              </div>`
            : `<button class="btn-ghost btn-small" onclick="createFichaFromCalEvent('${escapeAttr(ev.id)}')"><i class="ti ti-notes"></i> Crear ficha de reunión</button>`
          }
        </div>` : ''}
        <div class="modal-actions">
          <button class="btn-ghost" onclick="closeModal()">Cancelar</button>
          ${ev ? `<button class="btn-ghost" style="color:var(--alta);" onclick="deleteCalEvent('${escapeAttr(ev.id)}','${escapeAttr(ev._calId||'')}')">Eliminar</button>` : ''}
          <button class="btn-primary" onclick="saveCalEvent('${escapeAttr(eventId||'')}','${escapeAttr(ev?._calId||'')}')">Guardar</button>
        </div>
      </div>
    </div>`;
  toggleCalEventAllDay(isAllDay);
}

function createFichaFromCalEvent(eventId){
  const ev=_findCalEvent(eventId);
  if(!ev) return;
  const date=(ev.start?.date||ev.start?.dateTime?.slice(0,10))||todayStr();
  const attendees=(ev.attendees||[]).filter(a=>!a.self).map(a=>a.displayName||a.email||'').filter(Boolean);
  closeModal();
  openMeetingModal(null,{title:ev.summary||'',date,participants:attendees,calEventId:eventId});
}
function unlinkCalEventFicha(meetingId,eventId){
  const m=state.meetings.find(x=>x.id===meetingId);
  if(m){ m.calEventId=null; saveMeetingRow(m); saveState(); }
  openCalEventModal(eventId);
}

function toggleCalEventAllDay(allDay){
  const sw = document.getElementById('cevStartTimeWrap');
  const ew = document.getElementById('cevEndTimeWrap');
  if(sw) sw.style.display = allDay ? 'none' : '';
  if(ew) ew.style.display = allDay ? 'none' : '';
}

async function saveCalEvent(eventId, originalCalId){
  const title = document.getElementById('cevTitle')?.value.trim();
  if(!title){ setStatus('El título no puede estar vacío.'); return; }
  const newCalId   = document.getElementById('cevCalId')?.value || originalCalId || 'primary';
  const allDay     = document.getElementById('cevAllDay')?.checked;
  const startDate  = document.getElementById('cevStartDate')?.value;
  const startTime  = document.getElementById('cevStartTime')?.value || '00:00';
  const endDate    = document.getElementById('cevEndDate')?.value || startDate;
  const endTime    = document.getElementById('cevEndTime')?.value || '01:00';
  const desc       = document.getElementById('cevDesc')?.value.trim() || '';
  const location   = document.getElementById('cevLocation')?.value.trim() || '';
  if(!startDate || !googleToken) return;
  const body = { summary: title };
  if(desc)     body.description = desc;
  if(location) body.location    = location;
  if(allDay){
    body.start = { date: startDate };
    const endExcl = new Date(endDate+'T12:00:00'); endExcl.setDate(endExcl.getDate()+1);
    body.end = { date: endExcl.toISOString().slice(0,10) };
  } else {
    body.start = { dateTime: `${startDate}T${startTime}:00`, timeZone: 'Europe/Madrid' };
    body.end   = { dateTime: `${endDate}T${endTime}:00`,     timeZone: 'Europe/Madrid' };
  }
  try{
    let r;
    if(eventId && originalCalId && newCalId !== originalCalId){
      // Move to different calendar: delete + create
      await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(originalCalId)}/events/${encodeURIComponent(eventId)}`,
        { method:'DELETE', headers:{Authorization:`Bearer ${googleToken}`} });
      r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(newCalId)}/events`,
        { method:'POST', headers:{Authorization:`Bearer ${googleToken}`,'Content-Type':'application/json'}, body:JSON.stringify(body) });
    } else if(eventId){
      r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(originalCalId||newCalId)}/events/${encodeURIComponent(eventId)}`,
        { method:'PUT', headers:{Authorization:`Bearer ${googleToken}`,'Content-Type':'application/json'}, body:JSON.stringify(body) });
    } else {
      r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(newCalId)}/events`,
        { method:'POST', headers:{Authorization:`Bearer ${googleToken}`,'Content-Type':'application/json'}, body:JSON.stringify(body) });
    }
    if(r.status===401){ handleGoogleExpired(); return; }
    if(!r.ok){ setStatus('Error al guardar el evento.'); return; }
    setStatus(eventId ? 'Evento actualizado.' : 'Evento creado.');
    closeModal();
    loadCalendarData(); refreshHeaderEvents();
  }catch(e){ setStatus('Error al guardar el evento.'); }
}

async function deleteCalEvent(eventId, calId){
  if(!googleToken || !eventId || !calId) return;
  if(!confirm('¿Eliminar este evento de Google Calendar?')) return;
  try{
    const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`,
      { method:'DELETE', headers:{Authorization:`Bearer ${googleToken}`} });
    if(r.status===401){ handleGoogleExpired(); return; }
    if(r.ok || r.status===204){
      calMonthEvents  = calMonthEvents.filter(x=>x.id!==eventId);
      calHeaderEvents = calHeaderEvents.filter(x=>x.id!==eventId);
      setStatus('Evento eliminado.');
      closeModal();
      if(currentView==='calendario') render();
      refreshHeaderEvents();
    } else { setStatus('Error al eliminar el evento.'); }
  }catch(e){ setStatus('Error al eliminar el evento.'); }
}

async function rsvpEvent(eventId, calId, response){
  if(!googleToken || !eventId || !calId) return;
  const ev = _findCalEvent(eventId);
  if(!ev) return;
  const attendees = (ev.attendees||[]).map(a=>
    a.self ? {...a, responseStatus: response} : a
  );
  try{
    const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`,
      { method:'PATCH', headers:{Authorization:`Bearer ${googleToken}`,'Content-Type':'application/json'},
        body: JSON.stringify({attendees}) });
    if(r.status===401){ handleGoogleExpired(); return; }
    if(r.ok){
      const updated = await r.json();
      // update local cache
      const idx = calMonthEvents.findIndex(x=>x.id===eventId);
      if(idx>=0) calMonthEvents[idx]={...calMonthEvents[idx],...updated};
      const idx2 = calHeaderEvents.findIndex(x=>x.id===eventId);
      if(idx2>=0) calHeaderEvents[idx2]={...calHeaderEvents[idx2],...updated};
      const labels={accepted:'Aceptado',declined:'Rechazado',tentative:'Tal vez'};
      setStatus(labels[response]||'Respuesta enviada.');
      openCalEventModal(eventId);
    } else { setStatus('Error al enviar respuesta.'); }
  }catch(e){ setStatus('Error al enviar respuesta.'); }
}

async function fetchCalendarEvents(timeMin, timeMax){
  if(!googleToken) return [];
  if(!googleCalendars.length) await fetchCalendarList();
  const activeCals = googleCalendars.filter(c=>isCalEnabled(c.id));
  if(!activeCals.length) return [];
  const now=timeMin||new Date().toISOString();
  const end=timeMax||new Date(Date.now()+7*24*60*60*1000).toISOString();
  try{
    const results=await Promise.all(activeCals.map(cal=>
      fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?timeMin=${encodeURIComponent(now)}&timeMax=${encodeURIComponent(end)}&singleEvents=true&orderBy=startTime&maxResults=50`,
        {headers:{Authorization:`Bearer ${googleToken}`}})
      .then(r=>{ if(r.status===401){handleGoogleExpired();} return r.ok?r.json():{items:[]}; })
      .then(d=>(d.items||[]).map(ev=>({...ev,_calName:cal.summary,_calColor:cal.backgroundColor,_calId:cal.id})))
      .catch(()=>[])
    ));
    return results.flat().sort((a,b)=>{
      const ta=a.start.dateTime||a.start.date;
      const tb=b.start.dateTime||b.start.date;
      return ta<tb?-1:ta>tb?1:0;
    });
  }catch(e){return[];}
}
