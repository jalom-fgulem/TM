// Proyectos, contactos (CRM) y reuniones
// Parte de la app TM. Script clásico: comparte ámbito global con el resto.

// ---- Proyectos ----
function addProject(initialArea){
  const input=document.getElementById('newProjInput'); const val=input.value.trim();
  if(!val) return;
  const p={id:uid(), name:val, areas:initialArea?[initialArea]:[], log:[], active:true};
  state.projects.push(p);
  input.value=''; saveProjectRow(p); render();
}
function toggleProjectActive(id,ev){
  if(ev) ev.stopPropagation();
  const p=getProj(id); if(!p) return;
  p.active = !p.active;
  saveProjectRow(p); render();
}
function showConfirm(message, onYes){
  const root=document.getElementById('modalRoot');
  root.innerHTML=`
    <div class="modal-bg">
      <div class="modal">
        <h3>Confirmar</h3>
        <p style="font-size:14px; line-height:1.4;">${escapeHtml(message)}</p>
        <div class="modal-actions">
          <button class="btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn-primary" id="confirmYesBtn">Confirmar</button>
        </div>
      </div>
    </div>`;
  document.getElementById('confirmYesBtn').onclick = function(){ onYes(); };
}
function deleteProject(id,ev){
  if(ev) ev.stopPropagation();
  showConfirm('¿Eliminar el proyecto y su diario? Las tareas asociadas se conservan, pero quedan sin proyecto.', ()=>{
    state.tasks.filter(t=>t.projectId===id).forEach(t=>{ t.projectId=null; saveTaskRow(t); });
    state.projects=state.projects.filter(p=>p.id!==id);
    deleteProjectRow(id);
    if(currentProjectId===id) currentProjectId=null;
    closeModal(); render();
  });
}
function openProject(id){ currentProjectId=id; render(); }
function closeProject(){ currentProjectId=null; render(); }
function toggleProjArea(projectId, area){
  const p=getProj(projectId); if(!p) return;
  if(p.areas.includes(area)) p.areas=p.areas.filter(a=>a!==area);
  else p.areas.push(area);
  saveProjectRow(p); render();
}
function addLogEntry(projectId){
  const p=getProj(projectId); if(!p) return;
  const input=document.getElementById('projLogInput');
  const text=input.value.trim();
  if(!text) return;
  p.log.unshift({id:uid(), date:todayStr(), text});
  input.value='';
  saveProjectRow(p); render();
  setStatus('Apunte añadido al diario.');
}
function deleteLogEntry(projectId, entryId){
  const p=getProj(projectId); if(!p) return;
  p.log=p.log.filter(e=>e.id!==entryId);
  saveProjectRow(p); render();
}

// ---- Contactos (CRM reducido) ----
function contactFullName(c){ return (c.nombre+' '+c.apellidos).trim(); }
function openContactModal(contactId, prefill){
  const editing = contactId ? state.contacts.find(c=>c.id===contactId) : null;
  const data = editing || prefill || {};
  const root=document.getElementById('modalRoot');
  root.innerHTML=`
    <div class="modal-bg" onclick="if(event.target===this) closeModal()">
      <div class="modal">
        <h3>${editing?'Editar contacto':'Nuevo contacto'}</h3>
        <div class="field"><label>Nombre</label><input type="text" id="cNombre" value="${escapeAttr(data.nombre||'')}"></div>
        <div class="field"><label>Apellidos</label><input type="text" id="cApellidos" value="${escapeAttr(data.apellidos||'')}"></div>
        <div class="field"><label>Cargo</label><input type="text" id="cCargo" value="${escapeAttr(data.cargo||'')}"></div>
        <div class="field"><label>Empresa / Institución</label><input type="text" id="cEmpresa" value="${escapeAttr(data.empresa||'')}"></div>
        <div class="modal-actions">
          ${editing?`<button class="btn-ghost" onclick="deleteContact('${editing.id}')">Eliminar</button>`:''}
          <button class="btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn-primary" onclick="saveContact('${editing?editing.id:''}')">Guardar</button>
        </div>
      </div>
    </div>`;
}
function saveContact(contactId){
  const nombre=document.getElementById('cNombre').value.trim();
  const apellidos=document.getElementById('cApellidos').value.trim();
  if(!nombre){ setStatus('El nombre no puede estar vacío.'); return; }
  const cargo=document.getElementById('cCargo').value.trim();
  const empresa=document.getElementById('cEmpresa').value.trim();
  let c;
  if(contactId){
    c=state.contacts.find(x=>x.id===contactId);
    Object.assign(c,{nombre,apellidos,cargo,empresa});
  } else {
    c={id:uid(),nombre,apellidos,cargo,empresa};
    state.contacts.push(c);
  }
  saveContactRow(c);
  closeModal();
  if(meetingDraftStash){
    restoreMeetingDraft();
  } else {
    render();
  }
  setStatus('Contacto guardado.');
}
function restoreMeetingDraft(){
  const stash = meetingDraftStash;
  meetingDraftStash = null;
  tempParticipants = stash.participants.slice();
  const draftData = {
    title: stash.title, date: stash.date, importance: stash.importance,
    projectId: stash.projectId, summary: stash.summary, acuerdos: stash.acuerdos,
    participants: stash.participants
  };
  const editing = stash.meetingId ? state.meetings.find(m=>m.id===stash.meetingId) : null;
  openMeetingModal(stash.meetingId||null, draftData);
  if(editing){ document.getElementById('modalRoot').dataset.meetingId = stash.meetingId; }
}
function deleteContact(contactId){
  showConfirm('¿Eliminar este contacto? No borra sus menciones en reuniones pasadas.', ()=>{
    state.contacts=state.contacts.filter(c=>c.id!==contactId);
    deleteContactRow(contactId);
    closeModal(); render();
  });
}

// ---- Reuniones ----
function openMeetingModal(meetingId, prefill){
  const editing = meetingId ? state.meetings.find(m=>m.id===meetingId) : null;
  const data = prefill || editing || {};
  tempParticipants = (data.participants||[]).slice();
  const root=document.getElementById('modalRoot');
  root.dataset.meetingId = meetingId || '';
  root.innerHTML=`
    <div class="modal-bg" onclick="if(event.target===this) closeModal()">
      <div class="modal">
        <h3>${editing?'Editar reunión':'Nueva ficha de reunión'}</h3>
        <div class="field">
          <label>Título</label>
          <input type="text" id="rTitle" value="${escapeAttr(data.title||'')}">
        </div>
        <div class="field">
          <label>Fecha</label>
          <input type="date" id="rDate" value="${data.date||todayStr()}">
        </div>
        <div class="field">
          <label>Importancia</label>
          <select id="rImportance">
            <option value="alta" ${data.importance==='alta'?'selected':''}>Alta</option>
            <option value="media" ${(!data.importance||data.importance==='media')?'selected':''}>Media</option>
            <option value="baja" ${data.importance==='baja'?'selected':''}>Baja</option>
          </select>
        </div>
        <div class="field">
          <label>Participantes</label>
          <div class="area-manage" id="rPartList"></div>
          <div class="area-add">
            <input type="text" id="rPartInput" list="contactNames" placeholder="Nombre y apellido..." onkeydown="if(event.key==='Enter'){event.preventDefault();addParticipant();}">
            <button class="btn-ghost btn-small" onclick="addParticipant()">Añadir</button>
          </div>
          <datalist id="contactNames">
            ${state.contacts.map(c=>`<option value="${escapeAttr(contactFullName(c))}">`).join('')}
          </datalist>
        </div>
        <div class="field">
          <label>Proyecto relacionado (opcional)</label>
          <select id="rProject">
            <option value="">— Sin proyecto —</option>
            ${state.projects.filter(p=>p.active||p.id===data.projectId).map(p=>`<option value="${p.id}" ${data.projectId===p.id?'selected':''}>${escapeHtml(p.name)}${!p.active?' (archivado)':''}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Resumen</label>
          <div class="row-flex">
            <textarea id="rSummary" style="min-height:110px;">${escapeHtml(data.summary||'')}</textarea>
          </div>
        </div>
        <div class="field">
          <label>Acuerdos y decisiones</label>
          <textarea id="rAcuerdos">${escapeHtml(data.acuerdos||'')}</textarea>
        </div>
        <input type="hidden" id="rCalEventId" value="${escapeAttr(data.calEventId||'')}">
        <input type="hidden" id="rSourceEmailId" value="${escapeAttr(data.sourceEmailId||'')}">
        ${data.calEventId ? `
        <div class="field">
          <label>Calendario</label>
          <p class="help" style="margin:0;">Esta ficha ya está vinculada a un evento del calendario.</p>
        </div>` : `
        <div class="field">
          <label class="regla-check"><input type="checkbox" id="rCrearEvento" onchange="document.getElementById('rEventoDatos').style.display=this.checked?'':'none'"> Crear también el evento en el calendario</label>
          <div id="rEventoDatos" style="display:none; margin-top:8px;">
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <div style="flex:1; min-width:110px;">
                <label>Hora</label>
                <input type="time" id="rHora" value="10:00">
              </div>
              <div style="flex:1; min-width:110px;">
                <label>Duración</label>
                <select id="rDuracion">
                  <option value="30">30 minutos</option>
                  <option value="60" selected>1 hora</option>
                  <option value="90">1 hora y media</option>
                  <option value="120">2 horas</option>
                </select>
              </div>
            </div>
            <label style="margin-top:8px;">Calendario</label>
            <select id="rCalendario">
              ${(googleCalendars||[]).map(c=>`<option value="${escapeAttr(c.id)}">${escapeHtml(c.summary||c.id)}</option>`).join('')}
            </select>
          </div>
        </div>`}
        <div class="modal-actions">
          <button class="btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn-primary" onclick="saveMeeting('${editing?editing.id:''}')">Guardar ficha</button>
        </div>
      </div>
    </div>`;
  renderParticipants();
}
function renderParticipants(){
  const el=document.getElementById('rPartList'); if(!el) return;
  el.innerHTML = tempParticipants.map((p,i)=>{
    const isContact = state.contacts.some(c=>contactFullName(c)===p);
    return `<span class="area-chip">${escapeHtml(p)}
      ${isContact?'':`<button onclick="quickAddContactFromParticipant('${escapeAttr(p)}')" title="Añadir a Contactos" style="color:var(--accent);">+CRM</button>`}
      <button onclick="tempParticipants.splice(${i},1); renderParticipants();">×</button>
    </span>`;
  }).join('') || '<span class="empty">Sin participantes.</span>';
}
function quickAddContactFromParticipant(fullName){
  const titleEl=document.getElementById('rTitle');
  if(titleEl){
    meetingDraftStash = {
      meetingId: document.getElementById('modalRoot').dataset.meetingId || '',
      title: titleEl.value,
      date: document.getElementById('rDate').value,
      importance: document.getElementById('rImportance').value,
      projectId: document.getElementById('rProject').value,
      summary: document.getElementById('rSummary').value,
      acuerdos: document.getElementById('rAcuerdos').value,
      participants: tempParticipants.slice()
    };
  }
  const parts = fullName.trim().split(/\s+/);
  const nombre = parts.length>1 ? parts.slice(0,-1).join(' ') : parts[0];
  const apellidos = parts.length>1 ? parts.slice(-1).join(' ') : '';
  openContactModal(null, {nombre, apellidos});
}
function addParticipant(){
  const input=document.getElementById('rPartInput'); const val=input.value.trim();
  if(!val) return;
  if(!tempParticipants.includes(val)) tempParticipants.push(val);
  input.value=''; renderParticipants();
}
async function saveMeeting(meetingId){
  const title=document.getElementById('rTitle').value.trim();
  if(!title){ setStatus('El título no puede estar vacío.'); return; }
  const date=document.getElementById('rDate').value || todayStr();
  const importance=document.getElementById('rImportance').value;
  const projectId=document.getElementById('rProject').value || null;
  const summary=document.getElementById('rSummary').value.trim();
  const acuerdos=document.getElementById('rAcuerdos').value.trim();
  const participants=tempParticipants.slice();
  let calEventId=document.getElementById('rCalEventId')?.value || null;
  const sourceEmailId=document.getElementById('rSourceEmailId')?.value || null;

  // Si se ha pedido, se crea antes el evento para poder guardar su referencia
  const quiereEvento=document.getElementById('rCrearEvento')?.checked;
  if(quiereEvento && !calEventId){
    calEventId = await crearEventoDeReunion({ title, date, participants: tempParticipants.slice(), summary });
  }

  let m;
  if(meetingId){
    m=state.meetings.find(x=>x.id===meetingId);
    Object.assign(m,{title,date,importance,projectId,summary,acuerdos,participants,calEventId});
  } else {
    m={id:uid(),title,date,importance,projectId,summary,acuerdos,participants,calEventId,sourceEmailId};
    state.meetings.unshift(m);
  }
  tempParticipants=[];
  saveMeetingRow(m);
  closeModal(); render();
  setStatus('Ficha guardada.');
}
function deleteMeeting(id,ev){
  if(ev) ev.stopPropagation();
  showConfirm('¿Eliminar esta ficha de reunión?', ()=>{
    state.meetings=state.meetings.filter(m=>m.id!==id);
    deleteMeetingRow(id);
    closeModal(); render();
  });
}

function renderReuniones(){
  const pending = state.tasks.filter(t=>t.tipo==='Reunión por montar' && t.status!=='hecha');
  const doneReu = state.tasks.filter(t=>t.tipo==='Reunión por montar' && t.status==='hecha');
  const pendingBox = `
    <div class="panel-box" style="margin-bottom:14px;">
      <h2>Reuniones por montar (${pending.length})</h2>
      ${pending.length ? pending.map(t=>{
        const m = t.meetingId ? state.meetings.find(x=>x.id===t.meetingId) : null;
        return `
        <div class="note-item">
          <p style="font-weight:600;">${escapeHtml(t.title)}</p>
          <div class="note-meta">${t.due?'Vence '+fmtDateShort(t.due):'Sin fecha'} ${m?'· Ficha ya creada ('+fmtDateShort(m.date)+')':'· Sin ficha todavía'}</div>
          <div class="note-actions">
            ${m
              ? `<button class="btn-ghost btn-small" onclick="openLinkedMeeting('${m.id}')">Abrir ficha y añadir resumen</button>`
              : `<button class="btn-primary btn-small" onclick="createLinkedMeeting('${t.id}')">Crear ficha para esta reunión</button>`}
            <button class="btn-ghost btn-small" onclick="openTaskModal('${t.id}')">Ver tarea</button>
          </div>
        </div>`;
      }).join('') : '<p class="empty">No hay reuniones pendientes de montar.</p>'}
      ${showDoneTasks && doneReu.length ? `
        <div style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px;">
          <p class="help" style="margin-bottom:6px;">Cerradas</p>
          ${doneReu.map(t=>`
          <div class="note-item" style="opacity:0.7;">
            <p style="font-weight:600;">${escapeHtml(t.title)}</p>
            <div class="note-meta">${t.due?fmtDateShort(t.due):''}</div>
            <div class="note-actions">
              <button class="btn-ghost btn-small" onclick="reopenTask('${t.id}',event)">↺ Reabrir</button>
              <button class="btn-ghost btn-small" onclick="openTaskModal('${t.id}')">Ver tarea</button>
            </div>
          </div>`).join('')}
        </div>` : ''}
    </div>`;

  const procBox=`
    <div class="panel-box" style="margin-bottom:14px;">
      <h2>Nueva reunión</h2>
      <p class="help">Da de alta la ficha a mano con el resumen que ya tengas preparado.</p>
      <div style="display:flex; justify-content:flex-end;">
        <button class="btn-primary btn-small" onclick="openMeetingModal(null)">Nueva ficha</button>
      </div>
    </div>`;

  const contactShortcut = `
    <p class="help" style="margin-bottom:12px;">La ficha completa de personas (nombre, cargo, empresa) está en la pestaña <strong>CRM</strong>. Aquí solo ves quién ha aparecido en reuniones.</p>`;
  const people={};
  state.meetings.forEach(m=>{
    (m.participants||[]).forEach(p=>{
      if(!people[p]) people[p]={count:0,last:''};
      people[p].count++;
      if(m.date>people[p].last) people[p].last=m.date;
    });
  });
  const names=Object.keys(people).sort((a,b)=>people[b].count-people[a].count);
  const peopleBox = names.length ? `
    <div class="panel-box" style="margin-bottom:14px;">
      <h2>Personas en reuniones (${names.length})</h2>
      <div class="area-manage">
        ${names.map(n=>{
          const contact = state.contacts.find(c=>contactFullName(c)===n);
          const extra = contact && contact.empresa ? ' · '+contact.empresa : '';
          return `<span class="area-chip" style="cursor:pointer; ${currentPersonFilter===n?'background:var(--proj-bg); color:var(--proj);':''}" onclick="setPersonFilter('${escapeAttr(n)}')">${escapeHtml(n)}${escapeHtml(extra)} · ${people[n].count}</span>`;
        }).join('')}
      </div>
      ${currentPersonFilter?'<p class="help" style="margin-top:6px;">Mostrando reuniones con '+escapeHtml(currentPersonFilter)+'. Clic de nuevo para quitar el filtro.</p>':''}
    </div>`:'';

  let meetings=state.meetings.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  if(currentPersonFilter) meetings=meetings.filter(m=>(m.participants||[]).includes(currentPersonFilter));

  const list = meetings.length ? `<div class="card-grid">${meetings.map(m=>{
    const pn=projName(m.projectId);
    const parts=(m.participants||[]).map(p=>`<span class="badge area">${escapeHtml(p)}</span>`).join('');
    const preview=m.summary?(m.summary.length>140?m.summary.slice(0,140)+'…':m.summary):'';
    return `
    <div class="task ${m.importance}" onclick="openMeetingModal('${m.id}')">
      <p class="task-title">${escapeHtml(m.title)}</p>
      <div class="badges-row">
        <span class="badge ${m.importance}">${m.importance}</span>
        ${pn?`<span class="badge proj">${escapeHtml(pn)}</span>`:''}
        ${parts}
      </div>
      ${preview?`<p style="font-size:12px;color:var(--text-soft);margin:5px 0 0;line-height:1.4;">${escapeHtml(preview)}</p>`:''}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px;">
        <div class="task-meta">${fmtDate(m.date)}</div>
        <button class="btn-ghost btn-small" onclick="deleteMeeting('${m.id}',event)" style="color:var(--alta);">✕</button>
      </div>
    </div>`;
  }).join('')}</div>` : '<p class="empty">No hay fichas de reunión'+(currentPersonFilter?' con esa persona':'')+'.</p>';

  return pendingBox + procBox + contactShortcut + peopleBox + '<p class="sect-h">Fichas de reunión</p>' + list;
}

let currentContactId = null;
function openContactDetail(id){ currentContactId=id; render(); }
function closeContactDetail(){ currentContactId=null; render(); }

function renderCRM(){
  if(currentContactId){
    const c = state.contacts.find(x=>x.id===currentContactId);
    if(c) return renderContactDetail(c);
    currentContactId=null;
  }
  const rows = state.contacts.slice().sort((a,b)=>contactFullName(a).localeCompare(contactFullName(b)));
  const meetingCount = {};
  state.meetings.forEach(m=>(m.participants||[]).forEach(p=>{ meetingCount[p]=(meetingCount[p]||0)+1; }));
  const callCount = {};
  state.tasks.forEach(t=>{ if(t.tipo==='Llamada' && t.callWith) callCount[t.callWith]=(callCount[t.callWith]||0)+1; });

  const addBox = `
    <div class="view-header">
      <h2 style="font-size:14px;font-weight:600;color:var(--text);margin:0;">Contactos <span style="color:var(--text-muted);font-weight:400;">(${state.contacts.length})</span></h2>
      <button class="btn-primary btn-small" onclick="openContactModal(null)">+ Añadir</button>
    </div>`;

  if(rows.length===0) return addBox + '<p class="empty">No hay contactos todavía.</p>';

  const list = '<div class="card-grid">'+rows.map(c=>{
    const fn = contactFullName(c);
    const rc = meetingCount[fn] || 0;
    const cc = callCount[fn] || 0;
    const initials = fn.split(' ').slice(0,2).map(w=>w[0]||'').join('').toUpperCase();
    return `
    <div class="crm-card" onclick="openContactDetail('${c.id}')" style="flex-direction:column;align-items:flex-start;gap:8px;">
      <div style="display:flex;align-items:center;gap:10px;width:100%;">
        <div class="crm-avatar">${escapeHtml(initials)}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13.5px;font-weight:500;color:var(--text);">${escapeHtml(fn)}</div>
          <div style="font-size:11.5px;color:var(--text-soft);margin-top:2px;">${[c.cargo,c.empresa].filter(Boolean).map(escapeHtml).join(' · ')||'Sin cargo'}</div>
        </div>
      </div>
      <div style="display:flex;gap:10px;font-size:11px;color:var(--text-muted);">
        <span><strong>${rc}</strong> reunión${rc!==1?'es':''}</span>
        <span><strong>${cc}</strong> llamada${cc!==1?'s':''}</span>
      </div>
    </div>`;
  }).join('')+'</div>';

  return addBox + list;
}

function renderContactDetail(c){
  const fn = contactFullName(c);
  const meetings = state.meetings.filter(m=>(m.participants||[]).includes(fn)).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const calls = state.tasks.filter(t=>t.tipo==='Llamada' && t.callWith===fn).sort((a,b)=>(b.created||'').localeCompare(a.created||''));

  const meetingsHtml = meetings.length ? meetings.map(m=>`
    <div class="task ${m.importance}" onclick="openMeetingModal('${m.id}')">
      <p class="task-title">${escapeHtml(m.title)}</p>
      <div class="task-meta">${fmtDate(m.date)}</div>
    </div>`).join('') : '<p class="empty">Sin reuniones registradas.</p>';

  const callsHtml = calls.length ? calls.map(t=>`
    <div class="task ${t.urgency} ${t.status==='hecha'?'done':''}" onclick="openTaskModal('${t.id}')">
      <p class="task-title ${t.status==='hecha'?'done':''}">${escapeHtml(t.title)}</p>
      <div class="badges-row"><span class="badge ${t.urgency}">${t.urgency}</span><span class="badge ${t.status==='hecha'?'baja':'media'}">${t.status==='hecha'?'Hecha':'Pendiente'}</span></div>
      <div class="task-meta">${t.due?'Vence '+fmtDateShort(t.due):'Sin fecha'}</div>
    </div>`).join('') : '<p class="empty">Sin llamadas registradas.</p>';

  return `
    <div class="proj-head">
      <h3>${escapeHtml(fn)}
        <span style="display:flex; gap:6px;">
          <button class="btn-ghost btn-small" onclick="closeContactDetail()">← Volver a contactos</button>
          <button class="btn-ghost btn-small" onclick="openContactModal('${c.id}')">Editar</button>
        </span>
      </h3>
      <div class="badges-row">
        ${c.cargo?`<span class="badge area">${escapeHtml(c.cargo)}</span>`:''}
        ${c.empresa?`<span class="badge proj">${escapeHtml(c.empresa)}</span>`:''}
      </div>
    </div>
    <p class="sect-h">Reuniones (${meetings.length})</p>
    ${meetingsHtml}
    <p class="sect-h" style="margin-top:14px;">Llamadas (${calls.length})</p>
    ${callsHtml}`;
}


// Crea el evento en Google Calendar y devuelve su identificador
async function crearEventoDeReunion({ title, date, participants, summary }){
  if(!googleToken){ setStatus('Sin conexión con Google: la ficha se guarda sin evento.'); return null; }
  const hora = document.getElementById('rHora')?.value || '10:00';
  const minutos = parseInt(document.getElementById('rDuracion')?.value || '60', 10);
  const calId = document.getElementById('rCalendario')?.value || 'primary';

  const inicio = new Date(`${date}T${hora}:00`);
  const fin = new Date(inicio.getTime() + minutos * 60000);
  const zona = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const evento = {
    summary: title,
    description: summary || '',
    start: { dateTime: inicio.toISOString(), timeZone: zona },
    end:   { dateTime: fin.toISOString(),    timeZone: zona }
  };

  try{
    const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${googleToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(evento)
    });
    if(r.status === 401){ await handleGoogleExpired(); return null; }
    if(!r.ok){ setStatus('La ficha se guarda, pero no se pudo crear el evento.'); return null; }
    const creado = await r.json();
    setStatus('Ficha guardada y evento creado en el calendario.');
    refreshHeaderEvents();
    return creado.id || null;
  }catch(e){
    setStatus('La ficha se guarda, pero no se pudo crear el evento.');
    return null;
  }
}
