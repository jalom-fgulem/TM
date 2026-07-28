// Áreas, notas, tareas, subtareas y dictado por voz
// Parte de la app TM. Script clásico: comparte ámbito global con el resto.

// ---- Áreas ----
function addArea(){
  const input=document.getElementById('newAreaInput'); const val=input.value.trim();
  if(!val) return;
  if(state.areas.includes(val)){ setStatus('Esa área ya existe.'); return; }
  state.areas.push(val); input.value=''; saveSettings(); render();
}
function removeArea(name){ state.areas=state.areas.filter(a=>a!==name); saveSettings(); render(); }
function addTipo(){
  const input=document.getElementById('newTipoInput'); const val=input.value.trim();
  if(!val) return;
  if(state.tipos.includes(val)){ setStatus('Ese tipo ya existe.'); return; }
  state.tipos.push(val); input.value=''; saveSettings(); render();
}
function removeTipo(name){
  state.tipos=state.tipos.filter(t=>t!==name);
  state.tasks.filter(t=>t.tipo===name).forEach(t=>{ t.tipo=''; saveTaskRow(t); });
  saveSettings(); render();
}


// ---- Notas ----
function saveNote(){
  const input=document.getElementById('noteInput'); const text=input.value.trim();
  if(!text) return;
  const n={id:uid(), text, created:todayStr()};
  state.notes.unshift(n);
  input.value=''; saveNoteRow(n); render();
  setStatus('Nota guardada sin procesar.');
}
function deleteNote(id){ state.notes=state.notes.filter(n=>n.id!==id); deleteNoteRow(id); render(); }

function convertNoteManual(id){
  const note=state.notes.find(n=>n.id===id); if(!note) return;
  openTaskModal(null,{title:note.text},id);
}

function renderMeetingLinkBlock(task){
  if(task.meetingId){
    const m = state.meetings.find(x=>x.id===task.meetingId);
    if(!m){ task.meetingId=null; }
    else{
      return `<div class="field">
        <label>Ficha de reunión vinculada</label>
        <p style="font-size:13.5px; margin:0 0 6px;">${escapeHtml(m.title)} — ${fmtDateShort(m.date)}</p>
        <div style="display:flex; gap:6px;">
          <button type="button" class="btn-ghost btn-small" onclick="openLinkedMeeting('${m.id}')">Abrir ficha</button>
          <button type="button" class="btn-ghost btn-small" onclick="unlinkMeeting('${task.id}')">Desvincular</button>
        </div>
      </div>`;
    }
  }
  return `<div class="field">
    <label>Participantes previstos</label>
    <ul class="sub-list" id="mExpPartList"></ul>
    <div class="sub-add">
      <input type="text" id="mExpPartInput" list="contactNamesTask" placeholder="Nombre y apellido..." onkeydown="if(event.key==='Enter'){event.preventDefault();addExpectedParticipant();}">
      <button type="button" class="btn-ghost btn-small" onclick="addExpectedParticipant()">Añadir</button>
    </div>
    <datalist id="contactNamesTask">
      ${state.contacts.map(c=>`<option value="${escapeAttr(contactFullName(c))}">`).join('')}
    </datalist>
  </div>
  <div class="field">
    <label>Ficha de reunión vinculada</label>
    <button type="button" class="btn-primary btn-small" onclick="createLinkedMeeting('${task.id}')">Crear ficha de reunión vinculada</button>
    <p class="help" style="margin-top:6px;">Los participantes previstos se trasladan automáticamente a la ficha al crearla.</p>
  </div>`;
}
function renderExpectedParticipants(){
  const el=document.getElementById('mExpPartList'); if(!el) return;
  el.innerHTML = tempExpectedParticipants.map((p,i)=>`
    <li>
      <span>${escapeHtml(p)}</span>
      <button type="button" class="btn-ghost btn-small" onclick="tempExpectedParticipants.splice(${i},1); renderExpectedParticipants();">×</button>
    </li>`).join('') || '<li style="border:none;"><span class="empty">Sin participantes previstos todavía.</span></li>';
}
function addExpectedParticipant(){
  const input=document.getElementById('mExpPartInput'); const val=input.value.trim();
  if(!val) return;
  if(!tempExpectedParticipants.includes(val)) tempExpectedParticipants.push(val);
  input.value=''; renderExpectedParticipants();
}
function createLinkedMeeting(taskId){
  const t = state.tasks.find(x=>x.id===taskId);
  if(!t) return;
  const m = {id:uid(), title:t.title, date:todayStr(), importance:t.urgency||'media', participants:(t.expectedParticipants||[]).slice(), summary:'', acuerdos:'', projectId:t.projectId||null};
  state.meetings.unshift(m);
  t.meetingId = m.id;
  saveMeetingRow(m); saveTaskRow(t);
  closeModal();
  openMeetingModal(m.id);
}
function openLinkedMeeting(meetingId){
  closeModal();
  openMeetingModal(meetingId);
}
function unlinkMeeting(taskId){
  const t = state.tasks.find(x=>x.id===taskId);
  if(!t) return;
  t.meetingId = null;
  saveTaskRow(t);
  openTaskModal(taskId);
}

// ---- Tareas ----
function openTaskModal(taskId, prefill, fromNoteId){
  const editing = taskId ? state.tasks.find(t=>t.id===taskId) : null;
  const data = editing || prefill || {};
  if(!editing && !data.projectId && (currentView==='proyectos' || currentView==='desarrollo') && currentProjectId) data.projectId = currentProjectId;
  const selectedAreas = data.areas || [];
  tempSubtasks = (editing && editing.subtasks) ? JSON.parse(JSON.stringify(editing.subtasks)) : [];
  tempExpectedParticipants = (editing && editing.expectedParticipants) ? editing.expectedParticipants.slice() : [];
  tempLinkedTaskIds = (editing && editing.linkedTaskIds) ? editing.linkedTaskIds.slice() : [];
  tempDriveFiles = (editing && editing.driveFiles) ? editing.driveFiles.slice() : [];
  const incomingLinks = editing ? state.tasks.filter(x => x.id !== editing.id && (x.linkedTaskIds||[]).includes(editing.id)) : [];
  const root=document.getElementById('modalRoot');
  root.innerHTML=`
    <div class="modal-bg" onclick="if(event.target===this) closeModal()">
      <div class="modal modal-wide">
        <h3>${editing?'Editar tarea':'Nueva tarea'}</h3>

        <div class="field">
          <label>Título</label>
          <input type="text" id="mTitle" value="${escapeAttr(data.title||'')}" placeholder="¿Qué hay que hacer?">
        </div>

        ${(editing?.sourceEmailId||tempSourceEmailId)?`
        <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#e8f0fe;border-radius:7px;margin-bottom:12px;font-size:12px;">
          <i class="ti ti-mail" style="color:#1a73e8;font-size:14px;"></i>
          <span style="flex:1;color:#1a73e8;font-weight:500;">Creada desde un correo</span>
          <button class="btn-ghost btn-small" onclick="openEmailFromTask('${escapeAttr(editing?.sourceEmailId||tempSourceEmailId||'')}')">Ver correo</button>
        </div>` : ''}
        <p class="modal-sect">Clasificación</p>

        <div class="field-row">
          <div class="field" style="margin-bottom:0;">
            <label>Tipo</label>
            <select id="mTipo" onchange="document.getElementById('meetingLinkWrap').style.display=(this.value==='Reunión por montar')?'block':'none';document.getElementById('callWrap').style.display=(this.value==='Llamada')?'block':'none';">
              <option value="" ${!data.tipo?'selected':''}>— Sin tipo —</option>
              ${state.tipos.map(t=>`<option value="${escapeAttr(t)}" ${data.tipo===t?'selected':''}>${escapeHtml(t)}</option>`).join('')}
            </select>
          </div>
          <div class="field" style="margin-bottom:0;">
            <label>Urgencia</label>
            <select id="mUrgency">
              <option value="alta" ${data.urgency==='alta'?'selected':''}>🔴 Alta</option>
              <option value="media" ${(!data.urgency||data.urgency==='media')?'selected':''}>🟡 Media</option>
              <option value="baja" ${data.urgency==='baja'?'selected':''}>🟢 Baja</option>
            </select>
          </div>
        </div>

        <div id="meetingLinkWrap" style="display:${(data.tipo==='Reunión por montar')?'block':'none'};margin-top:10px;">
          ${editing ? renderMeetingLinkBlock(editing) : '<p class="help">Guarda la tarea primero; la ficha de reunión se puede vincular al editarla.</p>'}
        </div>
        <div id="callWrap" style="display:${(data.tipo==='Llamada')?'block':'none'};margin-top:10px;">
          <div class="field" style="margin-bottom:0;">
            <label>A quién llamas</label>
            <input type="text" id="mCallWith" list="contactNamesCall" value="${escapeAttr(data.callWith||'')}" placeholder="Nombre y apellido...">
            <datalist id="contactNamesCall">${state.contacts.map(c=>`<option value="${escapeAttr(contactFullName(c))}">`).join('')}</datalist>
          </div>
        </div>

        <div class="field-row" style="margin-top:12px;">
          <div class="field" style="margin-bottom:0;">
            <label>Proyecto (opcional)</label>
            <select id="mProject">
              <option value="">— Sin proyecto —</option>
              ${state.projects.filter(p=>p.active||p.id===data.projectId).map(p=>`<option value="${p.id}" ${data.projectId===p.id?'selected':''}>${escapeHtml(p.name)}${!p.active?' (archivado)':''}</option>`).join('')}
            </select>
          </div>
          <div class="field" style="margin-bottom:0;">
            <label>Fecha inicio (opcional)</label>
            <input type="date" id="mStart" value="${data.start||''}" onchange="const due=document.getElementById('mDue');if(due.value&&due.value<this.value)due.value=this.value;">
          </div>
          <div class="field" style="margin-bottom:0;">
            <label>Fecha límite (opcional)</label>
            <input type="date" id="mDue" value="${data.due||''}" onchange="const st=document.getElementById('mStart');if(st.value&&st.value>this.value)st.value=this.value;">
          </div>
        </div>

        <p class="modal-sect">Áreas afectadas</p>

        <div class="area-toggles" id="mAreas">
          ${state.areas.map(a=>`
          <label class="area-toggle ${selectedAreas.includes(a)?'checked':''}" onclick="event.preventDefault();var cb=this.querySelector('input');cb.checked=!cb.checked;this.classList.toggle('checked',cb.checked);this.querySelector('.area-toggle-icon').textContent=cb.checked?'✓':'';">
            <input type="checkbox" value="${escapeAttr(a)}" ${selectedAreas.includes(a)?'checked':''}>
            <span class="area-toggle-icon">${selectedAreas.includes(a)?'✓':''}</span>
            ${escapeHtml(a)}
          </label>`).join('')}
        </div>

        <p class="modal-sect">Desglose y relaciones</p>

        <div class="field">
          <label>Subtareas</label>
          <ul class="sub-list" id="mSubList"></ul>
          <div class="sub-add">
            <input type="text" id="mSubInput" placeholder="Nueva subtarea..." onkeydown="if(event.key==='Enter'){event.preventDefault();addSubtask();}">
            <button class="btn-ghost btn-small" onclick="addSubtask()">Añadir</button>
          </div>
        </div>
        <div class="field">
          <label>Tareas relacionadas</label>
          ${incomingLinks.length ? `<div class="linked-incoming">Vinculada desde: ${incomingLinks.map(x=>`<strong>${escapeHtml(x.title)}</strong>`).join(', ')}</div>` : ''}
          <ul class="sub-list" id="mLinkedList" data-editid="${editing ? editing.id : ''}"></ul>
          <div class="sub-add">
            <select id="mLinkedSelect" style="flex:1;"></select>
            <button type="button" class="btn-ghost btn-small" onclick="addLinkedTaskTemp()">Vincular</button>
          </div>
        </div>

        ${googleToken ? `
        <p class="modal-sect">Adjuntos de Drive</p>
        <div class="field">
          <ul class="drive-files-list" id="mDriveList"></ul>
          <div class="sub-add">
            <input type="text" id="mDriveSearch" placeholder="Buscar en Drive..." oninput="searchDriveFiles(this.value)">
          </div>
          <div class="drive-search-results" id="mDriveResults"></div>
        </div>` : ''}

        <p class="modal-sect">Contexto</p>

        <div class="field">
          <label>Notas de contexto</label>
          <div class="row-flex">
            <textarea id="mContext" placeholder="Detalle, enlaces, con quién depende...">${escapeHtml(data.context||'')}</textarea>
            <button type="button" class="btn-mic" id="micContext" onclick="startDictation('mContext','micContext')" title="Dictar">🎙️</button>
          </div>
        </div>

        <div class="field" style="margin-bottom:0;">
          <label>Documento interno <span style="font-size:11px;color:var(--text-muted);font-weight:400;">— notas largas, instrucciones, borradores</span></label>
          <textarea id="mDoc" placeholder="Escribe aquí documentación, instrucciones detalladas, borradores de texto..." style="min-height:160px;font-family:ui-monospace,monospace;font-size:12px;line-height:1.6;">${escapeHtml(data.taskDoc||'')}</textarea>
        </div>

        ${googleToken ? `
        <div class="gsync-section">
          <div class="gsync-section-title">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="#1a73e8"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
            Sincronizar con Google
          </div>
          ${editing && editing.gTaskId ? `
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="font-size:12px;color:#1a73e8;font-weight:600;">✓ Vinculada con Google Tasks</span>
            <span style="font-size:11px;color:var(--text-soft);">${escapeHtml(googleTasks.find(x=>x.id===editing.gTaskId)?._listTitle||'')}</span>
            <button class="btn-ghost btn-small" onclick="unlinkGTask('${escapeAttr(editing.gTaskId||'')}')">Desvincular</button>
          </div>` : `
          <div>
            <div class="gsync-row">
              <label><input type="checkbox" id="gSyncTask" onchange="document.getElementById('gSyncTaskSub').style.display=this.checked?'flex':'none'"> Añadir a Google Tasks</label>
            </div>
            <div class="gsync-sub" id="gSyncTaskSub" style="display:none;margin-top:6px;">
              <select id="gSyncTaskList">
                ${googleTaskLists.map(l=>`<option value="${escapeAttr(l.id)}">${escapeHtml(l.title)}</option>`).join('')}
              </select>
            </div>
          </div>`}
          <div>
            <div class="gsync-row">
              <label><input type="checkbox" id="gSyncCal" onchange="document.getElementById('gSyncCalSub').style.display=this.checked?'flex':'none'"> Crear evento en Google Calendar</label>
            </div>
            <div class="gsync-sub" id="gSyncCalSub" style="display:none;margin-top:6px;gap:6px;flex-wrap:wrap;">
              <select id="gSyncCalId">
                ${googleCalendars.map(c=>`<option value="${escapeAttr(c.id)}">${escapeHtml(c.summary||c.id)}</option>`).join('')}
              </select>
              <input type="date" id="gSyncCalDate" value="${data.due||todayStr()}">
              <input type="time" id="gSyncCalStart" value="09:00">
              <input type="time" id="gSyncCalEnd" value="10:00">
            </div>
          </div>
        </div>` : ''}

        <div class="modal-actions">
          <button class="btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn-primary" onclick="saveTask('${editing?editing.id:''}','${fromNoteId||''}')">Guardar tarea</button>
        </div>
      </div>
    </div>`;
  renderSubList();
  renderExpectedParticipants();
  renderLinkedTasksList();
  renderDriveFilesList();
}
function renderSubList(){
  const el=document.getElementById('mSubList'); if(!el) return;
  el.innerHTML = tempSubtasks.map((s,i)=>{
    if(!s.children) s.children=[];
    const childrenHtml = s.children.map((c,j)=>`
      <li style="margin-left:22px; border-bottom:none;">
        <input type="checkbox" ${c.done?'checked':''} onchange="tempSubtasks[${i}].children[${j}].done=this.checked; renderSubList();">
        <span class="${c.done?'done':''}">${escapeHtml(c.text)}</span>
        <button class="btn-ghost btn-small" onclick="tempSubtasks[${i}].children.splice(${j},1); renderSubList();">×</button>
      </li>`).join('');
    return `
    <li draggable="true"
      ondragstart="_sDragStart(event,${i})"
      ondragend="_sDragEnd(event)"
      ondragover="_sDragOver(event,${i})"
      ondrop="_sDrop(event,${i})">
      <span class="sub-drag-handle"><i class="ti ti-grip-vertical"></i></span>
      <input type="checkbox" ${s.done?'checked':''} onchange="tempSubtasks[${i}].done=this.checked; renderSubList();">
      <span class="${s.done?'done':''}">${escapeHtml(s.text)}</span>
      <button class="btn-ghost btn-small" onclick="tempSubtasks.splice(${i},1); renderSubList();">×</button>
    </li>
    ${childrenHtml}
    <li style="margin-left:22px; border-bottom:none;">
      <input type="text" placeholder="+ sub-subtarea..." style="flex:1; border:1px solid var(--line); border-radius:5px; padding:3px 6px; font-size:12px;"
        onkeydown="if(event.key==='Enter'){event.preventDefault(); if(this.value.trim()){ tempSubtasks[${i}].children.push({id:uid(),text:this.value.trim(),done:false}); this.value=''; renderSubList(); } }">
    </li>`;
  }).join('') || '<li style="border:none;"><span class="empty">Sin subtareas.</span></li>';
}
function addSubtask(){
  const input=document.getElementById('mSubInput'); const val=input.value.trim();
  if(!val) return;
  tempSubtasks.push({id:uid(), text:val, done:false, children:[]});
  input.value=''; renderSubList();
}
function renderLinkedTasksList(){
  const listEl=document.getElementById('mLinkedList'); if(!listEl) return;
  const editId=listEl.dataset.editid;
  listEl.innerHTML=tempLinkedTaskIds.map((id,i)=>{
    const lt=state.tasks.find(x=>x.id===id);
    return `<li>
      <span>${escapeHtml(lt?lt.title:'(tarea eliminada)')}</span>
      <button type="button" class="btn-ghost btn-small" onclick="tempLinkedTaskIds.splice(${i},1);renderLinkedTasksList();">× Quitar</button>
    </li>`;
  }).join('')||'<li style="border:none;"><span class="empty">Sin tareas vinculadas todavía.</span></li>';
  const sel=document.getElementById('mLinkedSelect'); if(!sel) return;
  const prev=sel.value;
  sel.innerHTML='<option value="">— Seleccionar tarea para vincular —</option>'+
    state.tasks.filter(x=>x.id!==editId&&!tempLinkedTaskIds.includes(x.id))
      .map(x=>`<option value="${x.id}"${x.id===prev?' selected':''}>${escapeHtml(x.title)}</option>`).join('');
}
// ---- Dictado por voz ----
let _dictRec = null;
function startDictation(targetId, btnId){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){ setStatus('El dictado no está disponible en este navegador. Prueba con Chrome.'); return; }
  if(_dictRec){ _dictRec.stop(); return; }
  const btn = document.getElementById(btnId);
  _dictRec = new SR();
  _dictRec.lang = 'es-ES';
  _dictRec.continuous = true;
  _dictRec.interimResults = false;
  _dictRec.onstart = ()=>{ if(btn) btn.classList.add('rec'); setStatus('Dictando… pulsa el micrófono para detener.'); };
  _dictRec.onresult = e=>{
    const el = document.getElementById(targetId); if(!el) return;
    let txt = '';
    for(let i=e.resultIndex;i<e.results.length;i++) if(e.results[i].isFinal) txt+=e.results[i][0].transcript;
    if(txt){ const sep=el.value&&!/\s$/.test(el.value)?' ':''; el.value+=sep+txt; }
  };
  _dictRec.onerror = e=>{ if(e.error!=='aborted') setStatus('Error de micrófono: '+e.error); };
  _dictRec.onend = ()=>{ if(btn) btn.classList.remove('rec'); _dictRec=null; setStatus(''); };
  _dictRec.start();
}

function addLinkedTaskTemp(){
  const sel=document.getElementById('mLinkedSelect'); if(!sel||!sel.value) return;
  if(!tempLinkedTaskIds.includes(sel.value)) tempLinkedTaskIds.push(sel.value);
  renderLinkedTasksList();
}
function closeModal(){ document.getElementById('modalRoot').innerHTML=''; tempSubtasks=[]; tempLinkedTaskIds=[]; tempSourceEmailId=null; tempDriveFiles=[]; }

function saveTask(taskId, fromNoteId){
  const title=document.getElementById('mTitle').value.trim();
  if(!title){ setStatus('El título no puede estar vacío.'); return; }
  const areas=Array.from(document.querySelectorAll('#mAreas input:checked')).map(el=>el.value);
  const projectId=document.getElementById('mProject').value || null;
  const tipo=document.getElementById('mTipo').value;
  const urgency=document.getElementById('mUrgency').value;
  const due=document.getElementById('mDue').value;
  const start=document.getElementById('mStart')?.value||'';
  const context=document.getElementById('mContext').value.trim();
  const taskDoc=document.getElementById('mDoc')?.value.trim()||'';
  const subtasks=JSON.parse(JSON.stringify(tempSubtasks));
  const expectedParticipants=tempExpectedParticipants.slice();
  const callWith=document.getElementById('mCallWith').value.trim();

  const linkedTaskIds=tempLinkedTaskIds.slice();
  const driveFiles=tempDriveFiles.slice();
  let t;
  if(taskId){
    t=state.tasks.find(x=>x.id===taskId);
    Object.assign(t,{title,areas,projectId,tipo,urgency,due,start,context,taskDoc,subtasks,expectedParticipants,callWith,linkedTaskIds,driveFiles});
  } else {
    t={id:uid(),title,areas,projectId,tipo,urgency,due,start,context,taskDoc,subtasks,expectedParticipants,callWith,linkedTaskIds,driveFiles,status:'pendiente',created:todayStr(),...(tempSourceEmailId?{sourceEmailId:tempSourceEmailId}:{})};
    state.tasks.unshift(t);
  }
  if(fromNoteId){ state.notes=state.notes.filter(n=>n.id!==fromNoteId); deleteNoteRow(fromNoteId); }
  saveTaskRow(t);

  // Google sync — create new Google Task
  const syncTask = document.getElementById('gSyncTask');
  if(syncTask?.checked){
    const listId = document.getElementById('gSyncTaskList')?.value;
    if(listId && googleToken){
      const body = {title};
      if(due) body.due = due+'T00:00:00.000Z';
      if(context) body.notes = context;
      fetch(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks`,{
        method:'POST', headers:{Authorization:`Bearer ${googleToken}`,'Content-Type':'application/json'}, body:JSON.stringify(body)
      }).then(r=>r.ok?r.json():null).then(nt=>{
        if(nt){
          googleTasks.unshift({...nt,_listId:listId,_listTitle:googleTaskLists.find(l=>l.id===listId)?.title||''});
          t.gTaskId = nt.id;
          t.gTaskListId = listId;
          saveTaskRow(t);
          setStatus('Tarea guardada y vinculada con Google Tasks.');
        }
      }).catch(()=>{});
    }
  } else if(t.gTaskId && t.gTaskListId && googleToken){
    // Sync changes back to linked Google Task
    const gBody = {title};
    if(due) gBody.due = due+'T00:00:00.000Z'; else gBody.due = null;
    if(context) gBody.notes = context;
    fetch(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(t.gTaskListId)}/tasks/${encodeURIComponent(t.gTaskId)}`,{
      method:'PATCH', headers:{Authorization:`Bearer ${googleToken}`,'Content-Type':'application/json'}, body:JSON.stringify(gBody)
    }).then(r=>{
      if(r.ok){
        const idx=googleTasks.findIndex(x=>x.id===t.gTaskId);
        if(idx>=0) Object.assign(googleTasks[idx],{title,notes:context,due:due?due+'T00:00:00.000Z':''});
      }
    }).catch(()=>{});
  }

  // Google Calendar event
  const syncCal = document.getElementById('gSyncCal');
  if(syncCal?.checked){
    const calId = document.getElementById('gSyncCalId')?.value;
    const calDate = document.getElementById('gSyncCalDate')?.value;
    const calStart = document.getElementById('gSyncCalStart')?.value || '09:00';
    const calEnd = document.getElementById('gSyncCalEnd')?.value || '10:00';
    if(calId && calDate && googleToken){
      const event = {summary:title, description:context||'', start:{dateTime:`${calDate}T${calStart}:00`, timeZone:'Europe/Madrid'}, end:{dateTime:`${calDate}T${calEnd}:00`, timeZone:'Europe/Madrid'}};
      fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`,{
        method:'POST', headers:{Authorization:`Bearer ${googleToken}`,'Content-Type':'application/json'}, body:JSON.stringify(event)
      }).then(r=>r.ok?setStatus('Evento creado en Google Calendar.'):null).catch(()=>{});
    }
  }

  closeModal(); render();
  setStatus('Tarea guardada.');
}
function toggleSubtasksExpand(id,ev){
  if(ev) ev.stopPropagation();
  if(expandedSubtasks.has(id)) expandedSubtasks.delete(id); else expandedSubtasks.add(id);
  render();
}
function toggleSubtaskInline(taskId, subId){
  const t=state.tasks.find(x=>x.id===taskId); if(!t) return;
  const s=t.subtasks.find(x=>x.id===subId); if(!s) return;
  s.done = !s.done;
  saveTaskRow(t); render();
}
function toggleChildSubtaskInline(taskId, subId, childId){
  const t=state.tasks.find(x=>x.id===taskId); if(!t) return;
  const s=t.subtasks.find(x=>x.id===subId); if(!s || !s.children) return;
  const c=s.children.find(x=>x.id===childId); if(!c) return;
  c.done = !c.done;
  saveTaskRow(t); render();
}
function cycleUrgency(id,ev){
  if(ev) ev.stopPropagation();
  const t=state.tasks.find(x=>x.id===id);
  const order=['alta','media','baja'];
  t.urgency = order[(order.indexOf(t.urgency)+1)%3];
  saveTaskRow(t); render();
}
function toggleDone(id,ev){
  if(ev) ev.stopPropagation();
  const t=state.tasks.find(x=>x.id===id);
  t.status = t.status==='hecha'?'pendiente':'hecha';
  saveTaskRow(t); render();
}
function deleteTask(id,ev){
  if(ev) ev.stopPropagation();
  state.tasks=state.tasks.filter(t=>t.id!==id);
  deleteTaskRow(id); render();
}
