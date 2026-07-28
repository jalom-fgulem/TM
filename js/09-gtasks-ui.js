// Google Tasks, kanban, listas y configuración
// Parte de la app TM. Script clásico: comparte ámbito global con el resto.

async function fetchGoogleTaskLists(){
  if(!googleToken) return;
  try{
    const r=await fetch('https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=20',{headers:{Authorization:`Bearer ${googleToken}`}});
    if(r.status===401){handleGoogleExpired();return;}
    if(!r.ok) return;
    googleTaskLists=(await r.json()).items||[];
  }catch(e){}
}
async function fetchGoogleTasks(){
  if(!googleToken) return;
  if(!googleTaskLists.length) await fetchGoogleTaskLists();
  if(!googleTaskLists.length) return;
  try{
    const results=await Promise.all(googleTaskLists.map(list=>
      fetch(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(list.id)}/tasks?showCompleted=false&showHidden=false&maxResults=100`,
        {headers:{Authorization:`Bearer ${googleToken}`}})
      .then(r=>r.ok?r.json():{items:[]})
      .then(d=>(d.items||[]).filter(t=>t.status!=='completed').map(t=>({...t,_listId:list.id,_listTitle:list.title})))
      .catch(()=>[])
    ));
    googleTasks=results.flat();

    // Sincronizar cambios de Google Tasks → tareas locales
    let syncChanged=false;
    googleTasks.forEach(gt=>{
      const local=state.tasks.find(t=>t.gTaskId===gt.id);
      if(!local) return;
      const gtDue=gt.due?gt.due.slice(0,10):'';
      const gtTitle=(gt.title||'').trim();
      const gtNotes=(gt.notes||'').trim();
      if(gtTitle&&gtTitle!==local.title){ local.title=gtTitle; syncChanged=true; }
      if(gtNotes!==(local.context||'').trim()){ local.context=gtNotes; syncChanged=true; }
      if(gtDue!==(local.due||'')){ local.due=gtDue||null; syncChanged=true; }
    });
    if(syncChanged){ await saveState(); setStatus('Tareas actualizadas desde Google Tasks.'); }

    if(currentView==='lista'||currentView==='panel'||currentView==='gtasks') render();
    if(currentView==='calendario'){ if(calView==='month') renderCalMonthGrid(); else loadCalendarData(); }
  }catch(e){}
}
async function completeGoogleTask(listId,taskId){
  if(!googleToken) return;
  try{
    await fetch(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,{
      method:'PATCH',
      headers:{Authorization:`Bearer ${googleToken}`,'Content-Type':'application/json'},
      body:JSON.stringify({status:'completed'})
    });
    googleTasks=googleTasks.filter(t=>!(t.id===taskId&&t._listId===listId));
    setStatus('Tarea marcada como completada en Google Tasks.');
    if(currentView==='lista'||currentView==='panel'||currentView==='gtasks') render();
    if(currentView==='calendario'){ if(calView==='month') renderCalMonthGrid(); else loadCalendarData(); }
  }catch(e){ setStatus('Error al completar la tarea.'); }
}
function googleTaskCard(t){
  const due=t.due?t.due.slice(0,10):'';
  const today=todayStr();
  const overdue=due&&due<today;
  return `<div class="gtask-card" onclick="openGTaskModal('${escapeAttr(t._listId)}','${escapeAttr(t.id)}')" style="cursor:pointer;">
    <div style="display:flex;align-items:flex-start;gap:8px;">
      <span class="gtask-badge">G Tasks</span>
      <span class="gtask-card-title">${escapeHtml(t.title||'(sin título)')}</span>
    </div>
    ${t.notes?`<div class="gtask-card-meta">${escapeHtml(t.notes.slice(0,120))}${t.notes.length>120?'…':''}</div>`:''}
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
      <div class="gtask-card-meta">
        ${t._listTitle?`<span style="font-weight:500;">${escapeHtml(t._listTitle)}</span> · `:''}
        ${due?`<span style="${overdue?'color:var(--alta);font-weight:600;':''}">Límite: ${fmtDateShort(due)}</span>`:'Sin fecha'}
      </div>
      <button class="btn-ghost btn-small" onclick="event.stopPropagation();completeGoogleTask('${escapeAttr(t._listId)}','${escapeAttr(t.id)}')">✓ Completar</button>
    </div>
  </div>`;
}
function renderGTasks(){
  if(!googleToken){
    return `<div style="padding:40px;text-align:center;color:var(--text-soft);">
      <p style="font-size:15px;margin-bottom:12px;">Conecta Google para ver tus tareas.</p>
    </div>`;
  }
  const lists = googleTaskLists;
  const activeList = currentGTaskList || (lists[0]?.id || null);
  const tasks = googleTasks.filter(t=>t._listId===activeList);
  const today = todayStr();

  const sidebarItems = lists.map(l=>`
    <div class="gtl-item ${l.id===activeList?'active':''}" onclick="selectGTaskList('${escapeAttr(l.id)}')">
      <svg class="gtl-item-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
      ${escapeHtml(l.title)}
    </div>`).join('');

  const taskItems = tasks.length
    ? `<div class="gtl-card-grid">${tasks.map(t=>{
    const due=t.due?t.due.slice(0,10):'';
    const overdue=due&&due<today;
    const linked=state.tasks.find(x=>x.gTaskId===t.id);
    return `<div class="gtl-card${linked?' linked':''}${overdue?' overdue':''}" onclick="openGTaskModal('${escapeAttr(t._listId)}','${escapeAttr(t.id)}')">
      <div class="gtl-card-top">
        <div class="gtl-card-circle" onclick="event.stopPropagation();completeGoogleTask('${escapeAttr(t._listId)}','${escapeAttr(t.id)}')" title="Completar"></div>
        <div class="gtl-card-title">${escapeHtml(t.title||'(sin título)')}</div>
      </div>
      ${linked?`<div class="gtl-linked-badge">↔ Sincronizada · ${escapeHtml(linked.title.slice(0,30))}${linked.title.length>30?'…':''}</div>`:''}
      ${t.notes?`<div class="gtl-card-notes">${escapeHtml(t.notes.slice(0,120))}${t.notes.length>120?'…':''}</div>`:''}
      <div class="gtl-card-footer">
        <span class="gtl-card-due${overdue?' overdue':''}">${due?(overdue?'⚠ Vencida: ':'Límite: ')+fmtDateShort(due):'Sin fecha'}</span>
        <span style="font-size:10px;color:var(--text-soft);">${escapeHtml(t._listTitle||'')}</span>
      </div>
    </div>`;
  }).join('')}</div>`
    : `<div class="gtl-empty"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg><span>Sin tareas pendientes</span></div>`;

  const activeTitle = lists.find(l=>l.id===activeList)?.title || 'Tareas';

  return `<div class="gtasks-layout">
    <div class="gtl-sidebar">
      <div class="gtl-sidebar-head">Listas</div>
      ${sidebarItems}
      ${!lists.length?`<div style="padding:12px 10px;font-size:12px;color:var(--text-soft);">Cargando…</div>`:''}
    </div>
    <div class="gtl-main">
      <div class="gtl-header">
        <span class="gtl-header-title">${escapeHtml(activeTitle)}</span>
        <button class="btn-ghost btn-small" onclick="fetchGoogleTasks()" title="Actualizar"><i class="ti ti-refresh" style="font-size:12px;"></i> Actualizar</button>
      </div>
      <div class="gtl-add-row">
        <input class="gtl-add-input" id="gtlAddInput" placeholder="Añadir tarea…" onkeydown="if(event.key==='Enter') addGTaskQuick('${escapeAttr(activeList||'')}')">
        <button class="btn-primary btn-small" onclick="addGTaskQuick('${escapeAttr(activeList||'')}')">Añadir</button>
      </div>
      <div class="gtl-task-list">
        ${taskItems}
      </div>
    </div>
  </div>`;
}
function selectGTaskList(listId){
  currentGTaskList = listId;
  if(currentView==='gtasks') render();
}
async function addGTaskQuick(listId){
  const input = document.getElementById('gtlAddInput');
  if(!input) return;
  const title = input.value.trim();
  if(!title || !listId || !googleToken) return;
  input.value = '';
  try{
    const r = await fetch(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks`,{
      method:'POST',
      headers:{Authorization:`Bearer ${googleToken}`,'Content-Type':'application/json'},
      body: JSON.stringify({title})
    });
    if(r.status===401){handleGoogleExpired();return;}
    if(r.ok){
      const newTask = await r.json();
      googleTasks.unshift({...newTask, _listId:listId, _listTitle: googleTaskLists.find(l=>l.id===listId)?.title||''});
      if(currentView==='gtasks') render();
      setStatus('Tarea añadida en Google Tasks.');
    }
  }catch(e){ setStatus('Error al añadir la tarea.'); }
}
function openGTaskModal(listId, taskId){
  const t = googleTasks.find(x=>x._listId===listId&&x.id===taskId);
  if(!t) return;
  const localLinked = state.tasks.find(x=>x.gTaskId===taskId);
  const due = t.due ? t.due.slice(0,10) : '';
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
    <div class="modal-bg" onclick="if(event.target===this) closeModal()">
      <div class="modal modal-wide">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
          <h3 style="margin:0;">Editar Google Task</h3>
          <span class="gtask-badge" style="font-size:11px;padding:3px 8px;">G Tasks · ${escapeHtml(t._listTitle||'')}</span>
        </div>

        <div class="field">
          <label>Título</label>
          <input type="text" id="gtmTitle" value="${escapeAttr(t.title||'')}" placeholder="Título de la tarea">
        </div>

        <div class="field">
          <label>Notas</label>
          <textarea id="gtmNotes" placeholder="Notas adicionales…">${escapeHtml(t.notes||'')}</textarea>
        </div>

        <div class="field">
          <label>Fecha límite</label>
          <input type="date" id="gtmDue" value="${due}">
        </div>

        <div class="gsync-section">
          <div class="gsync-section-title">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="#1a73e8"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6" stroke="#1a73e8" stroke-width="2"/><line x1="8" y1="2" x2="8" y2="6" stroke="#1a73e8" stroke-width="2"/><line x1="3" y1="10" x2="21" y2="10" stroke="#1a73e8" stroke-width="2"/></svg>
            Crear evento en Google Calendar
          </div>
          <div class="gsync-row">
            <label><input type="checkbox" id="gtmSyncCal" onchange="document.getElementById('gtmCalSub').style.display=this.checked?'flex':'none'"> Añadir al calendario</label>
          </div>
          <div class="gsync-sub" id="gtmCalSub" style="display:none;margin-top:6px;gap:6px;flex-wrap:wrap;">
            <select id="gtmCalId">
              ${googleCalendars.map(c=>`<option value="${escapeAttr(c.id)}">${escapeHtml(c.summary||c.id)}</option>`).join('')}
            </select>
            <input type="time" id="gtmCalStart" value="09:00">
            <input type="time" id="gtmCalEnd" value="10:00">
          </div>
        </div>

        <div class="field" style="margin-top:12px;">
          <label>${localLinked ? 'Tarea local vinculada' : 'Vincular con tarea local (opcional)'}</label>
          ${localLinked ? `
          <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--accent-bg);border-radius:7px;">
            <span style="flex:1;font-size:13px;color:var(--text);">${escapeHtml(localLinked.title)}</span>
            <button class="btn-ghost btn-small" onclick="openTaskModal('${escapeAttr(localLinked.id)}')">Abrir</button>
            <button class="btn-ghost btn-small" style="color:var(--alta);" onclick="unlinkGTask('${escapeAttr(taskId)}')">Desvincular</button>
          </div>` : `
          <select id="gtmLinkLocal">
            <option value="">— Sin vincular —</option>
            ${state.tasks.filter(x=>!x.gTaskId&&x.status!=='hecha').map(x=>`<option value="${escapeAttr(x.id)}">${escapeHtml(x.title)}</option>`).join('')}
          </select>`}
        </div>

        <div class="modal-actions">
          <button class="btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn-ghost" style="color:var(--alta);" onclick="event.stopPropagation();completeGoogleTask('${escapeAttr(listId)}','${escapeAttr(taskId)}');closeModal()">✓ Completar</button>
          <button class="btn-primary" onclick="saveGTaskModal('${escapeAttr(listId)}','${escapeAttr(taskId)}')">Guardar</button>
        </div>
      </div>
    </div>`;
}

async function saveGTaskModal(listId, taskId){
  const title = document.getElementById('gtmTitle')?.value.trim();
  if(!title){ setStatus('El título no puede estar vacío.'); return; }
  const notes = document.getElementById('gtmNotes')?.value.trim() || '';
  const due   = document.getElementById('gtmDue')?.value || '';
  const linkLocalId = document.getElementById('gtmLinkLocal')?.value || '';
  if(!googleToken) return;
  try{
    const body = {title, notes};
    if(due) body.due = due+'T00:00:00.000Z'; else body.due = null;
    const r = await fetch(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,{
      method:'PATCH',
      headers:{Authorization:`Bearer ${googleToken}`,'Content-Type':'application/json'},
      body:JSON.stringify(body)
    });
    if(r.status===401){ handleGoogleExpired(); return; }
    if(!r.ok){ setStatus('Error al guardar Google Task.'); return; }

    // Update local cache
    const idx = googleTasks.findIndex(x=>x._listId===listId&&x.id===taskId);
    if(idx>=0) Object.assign(googleTasks[idx], {title, notes, due: due?due+'T00:00:00.000Z':''});

    // Create calendar event if checked
    const syncCal = document.getElementById('gtmSyncCal');
    if(syncCal?.checked && due){
      const calId    = document.getElementById('gtmCalId')?.value;
      const calStart = document.getElementById('gtmCalStart')?.value || '09:00';
      const calEnd   = document.getElementById('gtmCalEnd')?.value   || '10:00';
      if(calId){
        const ev = {summary:title, description:notes,
          start:{dateTime:`${due}T${calStart}:00`,timeZone:'Europe/Madrid'},
          end:  {dateTime:`${due}T${calEnd}:00`,  timeZone:'Europe/Madrid'}};
        await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`,{
          method:'POST', headers:{Authorization:`Bearer ${googleToken}`,'Content-Type':'application/json'}, body:JSON.stringify(ev)
        });
        if(calView==='month') renderCalMonthGrid(); else if(currentView==='calendario') loadCalendarData();
      }
    }

    // Link to local task (new link selected)
    if(linkLocalId){
      const local = state.tasks.find(x=>x.id===linkLocalId);
      if(local){ local.gTaskId=taskId; local.gTaskListId=listId; saveTaskRow(local); }
    }

    // Sync changes to already-linked local task
    const linked = state.tasks.find(x=>x.gTaskId===taskId);
    if(linked){
      linked.title = title;
      if(notes) linked.context = notes;
      if(due)   linked.due = due;
      saveTaskRow(linked);
    }

    setStatus('Google Task guardada.');
    closeModal();
    if(currentView==='gtasks'||currentView==='lista'||currentView==='panel') render();
  }catch(e){ setStatus('Error al guardar Google Task.'); }
}

function unlinkGTask(taskId){
  const linked = state.tasks.find(x=>x.gTaskId===taskId);
  if(linked){ delete linked.gTaskId; delete linked.gTaskListId; saveTaskRow(linked); }
  setStatus('Vínculo eliminado.');
  closeModal();
  if(currentView==='gtasks'||currentView==='lista'||currentView==='panel') render();
}

function openEmailFromTask(msgId){
  if(!msgId) return;
  closeModal();
  setView('correo');
  // Wait for the correo view to render, then select the email
  setTimeout(()=>{ selectEmail(msgId); }, 300);
}
function importEmailAsTask(subject, from, msgId){
  tempSourceEmailId = msgId || null;
  openTaskModal(null,{title:subject+(from?` (${from})`:'')});
}
function addCorreoPendiente(subject, msgId){
  tempSourceEmailId = msgId || null;
  openTaskModal(null,{title:subject, tipo:'Correo pendiente'});
}
async function archiveEmail(msgId){
  if(!googleToken) return;
  const el=document.querySelector(`.gmail-list-item[data-id="${msgId}"]`);
  if(el){ el.style.opacity='0.4'; el.style.pointerEvents='none'; }
  try{
    const res=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}/modify`,{
      method:'POST',
      headers:{Authorization:`Bearer ${googleToken}`,'Content-Type':'application/json'},
      body:JSON.stringify({removeLabelIds:['INBOX']})
    });
    if(res.status===401){handleGoogleExpired();return;}
    if(res.ok){
      if(selectedEmailId===msgId) selectNextEmail(msgId);
      if(el) el.remove();
      setStatus('Email archivado.');
    }
    else{ if(el){el.style.opacity='';el.style.pointerEvents='';} setStatus('Error al archivar el email.'); }
  }catch(e){
    if(el){el.style.opacity='';el.style.pointerEvents='';}
    setStatus('Error al archivar el email.');
  }
}
async function deleteEmail(msgId){
  if(!googleToken) return;
  const el=document.querySelector(`.gmail-list-item[data-id="${msgId}"]`);
  if(el){ el.style.opacity='0.4'; el.style.pointerEvents='none'; }
  try{
    const res=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}/trash`,{
      method:'POST',
      headers:{Authorization:`Bearer ${googleToken}`}
    });
    if(res.status===401){handleGoogleExpired();return;}
    if(res.ok){
      if(selectedEmailId===msgId) selectNextEmail(msgId);
      if(el) el.remove();
      setStatus('Email movido a papelera.');
    }
    else{ if(el){el.style.opacity='';el.style.pointerEvents='';} setStatus('Error al borrar el email.'); }
  }catch(e){
    if(el){el.style.opacity='';el.style.pointerEvents='';}
    setStatus('Error al borrar el email.');
  }
}

function renderNotes(){
  const badge=document.getElementById('notesCountBadge');
  if(badge){ if(state.notes.length){ badge.style.display='inline'; badge.textContent=state.notes.length; } else { badge.style.display='none'; } }
  const el=document.getElementById('notesList');
  if(state.notes.length===0){ el.innerHTML='<p class="empty">No hay notas sin procesar.</p>'; return; }
  el.innerHTML=state.notes.map(n=>`
    <div class="note-item">
      <p>${escapeHtml(n.text)}</p>
      <div class="note-meta">${fmtDateShort(n.created)}</div>
      <div class="note-actions">
        <button class="btn-primary btn-small" onclick="convertNoteManual('${n.id}')">Convertir en tarea</button>
        <button class="btn-ghost btn-small" onclick="deleteNote('${n.id}')">Descartar</button>
      </div>
    </div>`).join('');
}
function renderAreaManage(){
  document.getElementById('areaManageList').innerHTML = state.areas.map((a,i)=>`
    <div class="area-edit-row">
      <input class="area-edit-input" value="${escapeAttr(a)}"
        onblur="renameArea(${i},this.value)"
        onkeydown="if(event.key==='Enter'){this.blur();}">
      <button class="area-del-btn" onclick="removeArea('${escapeAttr(a)}')" title="Eliminar área">×</button>
    </div>`).join('');
  document.getElementById('tipoManageList').innerHTML = state.tipos.map((t,i)=>`
    <div class="area-edit-row">
      <input class="area-edit-input" value="${escapeAttr(t)}"
        onblur="renameTipo(${i},this.value)"
        onkeydown="if(event.key==='Enter'){this.blur();}">
      <button class="area-del-btn" onclick="removeTipo('${escapeAttr(t)}')" title="Eliminar tipo">×</button>
    </div>`).join('');
}
function renameArea(idx, newVal){
  newVal = newVal.trim();
  const old = state.areas[idx];
  if(!newVal || newVal === old) return;
  if(state.areas.some((a,i)=>i!==idx && a===newVal)){ setStatus('Esa área ya existe.'); renderAreaManage(); return; }
  state.areas[idx] = newVal;
  state.tasks.filter(t=>(t.areas||[]).includes(old)).forEach(t=>{ t.areas=t.areas.map(a=>a===old?newVal:a); saveTaskRow(t); });
  state.projects.filter(p=>(p.areas||[]).includes(old)).forEach(p=>{ p.areas=p.areas.map(a=>a===old?newVal:a); saveProjectRow(p); });
  saveSettings(); setStatus('Área renombrada.');
}
function renameTipo(idx, newVal){
  newVal = newVal.trim();
  const old = state.tipos[idx];
  if(!newVal || newVal === old) return;
  if(state.tipos.some((t,i)=>i!==idx && t===newVal)){ setStatus('Ese tipo ya existe.'); renderAreaManage(); return; }
  state.tipos[idx] = newVal;
  state.tasks.filter(t=>t.tipo===old).forEach(t=>{ t.tipo=newVal; saveTaskRow(t); });
  saveSettings(); setStatus('Tipo renombrado.');
}
function updateAppTitle(){
  const alias = (state.profile && state.profile.alias) ? state.profile.alias : '';
  document.getElementById('appTitle').textContent = 'Gestor de tareas';
  const aliasEl = document.getElementById('headerAliasTag');
  if(aliasEl) aliasEl.textContent = alias ? `· ${alias}` : '';
}
function saveProfile(){
  state.profile = {
    nombre:    document.getElementById('cfgNombre').value.trim(),
    apellidos: document.getElementById('cfgApellidos').value.trim(),
    alias:     document.getElementById('cfgAlias').value.trim(),
    email:     document.getElementById('cfgEmail').value.trim(),
    cargo:     document.getElementById('cfgCargo').value.trim()
  };
  saveSettings(); updateAppTitle(); setStatus('Perfil guardado.');
}

// ── Kanban drag & drop (cards) ───────────────────────────────────────────────
let _kDragId=null;
function _kDragStart(e,id){
  _kDragId=id; _colDragTipo=null;
  e.dataTransfer.effectAllowed='move';
  e.dataTransfer.setData('text/plain',id);
  setTimeout(()=>{ const el=document.querySelector(`.task[data-task-id="${id}"]`); if(el) el.classList.add('k-dragging'); },0);
}
function _kDragEnd(e){
  document.querySelectorAll('.task.k-dragging').forEach(el=>el.classList.remove('k-dragging'));
  document.querySelectorAll('.kcol.k-drag-over').forEach(el=>el.classList.remove('k-drag-over'));
  document.querySelectorAll('.task.k-drop-above,.task.k-drop-below').forEach(el=>el.classList.remove('k-drop-above','k-drop-below'));
  _kDragId=null;
}
function _kColDragOver(e,colEl){
  e.preventDefault(); e.dataTransfer.dropEffect='move';
  if(_colDragTipo!==null){
    document.querySelectorAll('.kcol.col-drop-left,.kcol.col-drop-right').forEach(el=>el.classList.remove('col-drop-left','col-drop-right'));
    if(_colDragTipo!==colEl.dataset.tipo){
      const r=colEl.getBoundingClientRect();
      colEl.classList.add(e.clientX<r.left+r.width/2?'col-drop-left':'col-drop-right');
    }
    return;
  }
  colEl.classList.add('k-drag-over');
  document.querySelectorAll('.task.k-drop-above,.task.k-drop-below').forEach(el=>el.classList.remove('k-drop-above','k-drop-below'));
  const card=e.target.closest('[data-task-id]');
  if(card&&card.dataset.taskId!==_kDragId){
    const r=card.getBoundingClientRect();
    card.classList.add(e.clientY<r.top+r.height/2?'k-drop-above':'k-drop-below');
  }
}
function _kColDragLeave(e,colEl){
  if(!colEl.contains(e.relatedTarget)){
    colEl.classList.remove('k-drag-over','col-drop-left','col-drop-right');
  }
}
function _kDrop(e,tipo){
  e.preventDefault();
  if(_colDragTipo!==null){ _doColDrop(e,tipo); return; }
  if(!_kDragId) return;
  const task=state.tasks.find(t=>t.id===_kDragId); if(!task) return;
  const srcTipo=task.tipo;
  if(!state.kanbanOrder) state.kanbanOrder={};
  if(srcTipo!==tipo && state.kanbanOrder[srcTipo])
    state.kanbanOrder[srcTipo]=state.kanbanOrder[srcTipo].filter(id=>id!==_kDragId);
  task.tipo=tipo;
  const tipoIds=state.tasks.filter(t=>t.status!=='hecha'&&t.tipo===tipo).map(t=>t.id);
  let ord=[...(state.kanbanOrder[tipo]||[])].filter(id=>tipoIds.includes(id));
  tipoIds.forEach(id=>{ if(!ord.includes(id)) ord.push(id); });
  ord=ord.filter(id=>id!==_kDragId);
  const card=e.target.closest('[data-task-id]');
  const tid=card?.dataset.taskId;
  if(tid&&tid!==_kDragId){
    const r=card.getBoundingClientRect();
    const before=e.clientY<r.top+r.height/2;
    const idx=ord.indexOf(tid);
    idx!==-1?ord.splice(before?idx:idx+1,0,_kDragId):ord.push(_kDragId);
  } else { ord.push(_kDragId); }
  state.kanbanOrder[tipo]=ord;
  _kDragId=null;
  if(task.tipo!==srcTipo) saveTaskRow(task);
  saveSettings(); render();
}

// ── Kanban drag & drop (columns) ─────────────────────────────────────────────
let _colDragTipo=null;
function _colDragStart(e,tipo){
  e.stopPropagation();
  _colDragTipo=tipo; _kDragId=null;
  e.dataTransfer.effectAllowed='move';
  e.dataTransfer.setData('text/plain','col:'+tipo);
  setTimeout(()=>{
    document.querySelectorAll('.kcol').forEach(el=>{ if(el.dataset.tipo===tipo) el.classList.add('col-dragging'); });
  },0);
}
function _colDragEnd(e){
  document.querySelectorAll('.kcol.col-dragging,.kcol.col-drop-left,.kcol.col-drop-right').forEach(el=>el.classList.remove('col-dragging','col-drop-left','col-drop-right'));
  _colDragTipo=null;
}
function _doColDrop(e,targetTipo){
  if(!_colDragTipo||_colDragTipo===targetTipo){ _colDragTipo=null; return; }
  const tipos=[...state.tipos];
  const srcIdx=tipos.indexOf(_colDragTipo);
  const tgtIdx=tipos.indexOf(targetTipo);
  if(srcIdx===-1||tgtIdx===-1){ _colDragTipo=null; return; }
  tipos.splice(srcIdx,1);
  const newTgt=tipos.indexOf(targetTipo);
  const colEl=e.currentTarget||e.target.closest('.kcol');
  const before=colEl ? e.clientX<colEl.getBoundingClientRect().left+colEl.getBoundingClientRect().width/2 : true;
  tipos.splice(before?newTgt:newTgt+1,0,_colDragTipo);
  state.tipos=tipos;
  _colDragTipo=null;
  saveSettings(); render();
}

// ── Subtask drag & drop ──────────────────────────────────────────────────────
let _sDragIdx=null;
function _sDragStart(e,i){
  _sDragIdx=i;
  e.dataTransfer.effectAllowed='move';
  setTimeout(()=>e.currentTarget.classList.add('s-dragging'),0);
}
function _sDragEnd(e){ e.currentTarget.classList.remove('s-dragging'); _sDragIdx=null; }
function _sDragOver(e,i){
  if(_sDragIdx===null) return;
  e.preventDefault();
  document.querySelectorAll('li.s-drop-above,li.s-drop-below').forEach(el=>el.classList.remove('s-drop-above','s-drop-below'));
  const r=e.currentTarget.getBoundingClientRect();
  e.currentTarget.classList.add(e.clientY<r.top+r.height/2?'s-drop-above':'s-drop-below');
}
function _sDrop(e,targetIdx){
  e.preventDefault();
  if(_sDragIdx===null||_sDragIdx===targetIdx){ _sDragIdx=null; return; }
  const r=e.currentTarget.getBoundingClientRect();
  const before=e.clientY<r.top+r.height/2;
  const moved=tempSubtasks.splice(_sDragIdx,1)[0];
  const dest=_sDragIdx<targetIdx?(before?targetIdx-1:targetIdx):(before?targetIdx:targetIdx+1);
  tempSubtasks.splice(dest,0,moved);
  _sDragIdx=null;
  renderSubList();
}

function taskCard(t, showTipo){
  const today=todayStr();
  const overdue=t.due && t.due<today && t.status!=='hecha';
  const areaBadges=(t.areas||[]).map(a=>`<span class="badge area">${escapeHtml(a)}</span>`).join('');
  const pn=projName(t.projectId);
  const outgoing=(t.linkedTaskIds||[]).filter(id=>state.tasks.find(x=>x.id===id));
  const incoming=state.tasks.filter(x=>x.id!==t.id&&(x.linkedTaskIds||[]).includes(t.id));
  const totalLinks=new Set([...outgoing,...incoming.map(x=>x.id)]).size;
  const linkBadge=totalLinks?`<span class="badge link" title="${[...outgoing.map(id=>{const x=state.tasks.find(t=>t.id===id);return x?x.title:''}),...incoming.map(x=>x.title)].filter(Boolean).join(', ')}">🔗 ${totalLinks} vinculada${totalLinks!==1?'s':''}</span>`:'';

  const expanded = expandedSubtasks.has(t.id);
  const sub = (t.subtasks&&t.subtasks.length) ? `
    <div class="subprogress" onclick="toggleSubtasksExpand('${t.id}',event)" style="cursor:pointer;">
      Subtareas: ${t.subtasks.filter(s=>s.done).length}/${t.subtasks.length} ${expanded?'▾':'▸'}
    </div>
    ${expanded ? `<ul class="sub-list" style="margin-top:4px;">
      ${t.subtasks.map(s=>`
        <li onclick="event.stopPropagation();">
          <input type="checkbox" ${s.done?'checked':''} onchange="toggleSubtaskInline('${t.id}','${s.id}')">
          <span class="${s.done?'done':''}">${escapeHtml(s.text)}</span>
        </li>
        ${(s.children||[]).map(c=>`
        <li style="margin-left:20px;" onclick="event.stopPropagation();">
          <input type="checkbox" ${c.done?'checked':''} onchange="toggleChildSubtaskInline('${t.id}','${s.id}','${c.id}')">
          <span class="${c.done?'done':''}">${escapeHtml(c.text)}</span>
        </li>`).join('')}`).join('')}
    </ul>` : ''}` : '';
  const isToday=t.due&&t.due===today&&t.status!=='hecha';
  const urgLabel={alta:'🔴 Alta',media:'🟡 Media',baja:'🟢 Baja'}[t.urgency]||t.urgency;
  return `
  <div class="task ${t.urgency} ${t.status==='hecha'?'done':''} ${isToday?'due-today':''}" data-task-id="${t.id}"
    draggable="true" ondragstart="_kDragStart(event,'${t.id}')" ondragend="_kDragEnd(event)"
    onclick="openTaskModal('${t.id}')">
    <p class="task-title ${t.status==='hecha'?'done':''}"><span class="task-drag-handle"><i class="ti ti-grip-vertical"></i></span>${escapeHtml(t.title)}</p>
    <div class="badges-row">
      <span class="badge ${t.urgency}" onclick="cycleUrgency('${t.id}',event)" title="Clic para cambiar urgencia" style="cursor:pointer;">${urgLabel}</span>
      ${showTipo && t.tipo?`<span class="badge tipo">${escapeHtml(t.tipo)}</span>`:''}
      ${t.meetingId?`<span class="badge proj">📋 Ficha</span>`:''}
      ${t.taskDoc?`<span class="badge" style="background:#f3f0ff;color:#6d28d9;border:1px solid #ddd6fe;" title="Tiene documento interno"><i class="ti ti-file-text" aria-hidden="true"></i> Doc</span>`:''}
      ${t.callWith?`<span class="badge area">📞 ${escapeHtml(t.callWith)}</span>`:''}
      ${pn?`<span class="badge proj">${escapeHtml(pn)}</span>`:''}
      ${linkBadge}
      ${areaBadges}
      ${t.sourceEmailId?`<span class="badge" style="background:#e8f0fe;color:#1a73e8;border:1px solid #c5d8fd;cursor:pointer;" onclick="event.stopPropagation();openEmailFromTask('${escapeAttr(t.sourceEmailId)}')">✉ Ver correo</span>`:''}
      ${(t.driveFiles&&t.driveFiles.length)?t.driveFiles.map(f=>`<a class="badge" style="background:#e6f4ea;color:#137333;border:1px solid #b7dfbf;text-decoration:none;" href="${escapeAttr(f.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()"><i class="ti ${driveFileIcon(f.mimeType)}" aria-hidden="true"></i> ${escapeHtml(f.name.length>22?f.name.slice(0,20)+'…':f.name)}</a>`).join(''):''}
    </div>
    ${sub}
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px;">
      <div class="task-meta">${t.due?`<span class="${overdue?'overdue':isToday?'due-today-label':''}">${overdue?'⚠ Vencida — '+fmtDateShort(t.due):isToday?'📅 Hoy':fmtDateShort(t.due)}</span>`:'<span style="color:var(--text-muted)">Sin fecha</span>'}</div>
      <div style="display:flex;gap:4px;" onclick="event.stopPropagation()">
        <button class="btn-ghost btn-small" onclick="toggleDone('${t.id}',event)">${t.status==='hecha'?'Reabrir':'✓ Hecha'}</button>
        <button class="btn-ghost btn-small" onclick="deleteTask('${t.id}',event)" style="color:var(--alta);">✕</button>
      </div>
    </div>
  </div>`;
}

function gTaskOrphanCard(gt){
  const dueStr=gt.due?gt.due.slice(0,10):null;
  const today=todayStr();
  const overdue=dueStr&&dueStr<today;
  return `
  <div class="task" style="cursor:pointer;border-left:3px solid #1a73e8;" onclick="openGTaskModal('${escapeAttr(gt._listId)}','${escapeAttr(gt.id)}')">
    <p class="task-title">${escapeHtml(gt.title||'')}</p>
    <div class="badges-row">
      ${gt._listTitle?`<span class="badge" style="background:#e8f0fe;color:#1a73e8;border:1px solid #c5d8fd;">${escapeHtml(gt._listTitle)}</span>`:''}
    </div>
    ${gt.notes?`<p class="task-ctx" style="font-size:12px;color:var(--text-soft);margin-top:4px;">${escapeHtml(gt.notes.slice(0,80))}</p>`:''}
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px;">
      <div class="task-meta">${dueStr?`<span class="${overdue?'overdue':''}">${overdue?'⚠ Vencida — ':''}${fmtDateShort(dueStr)}</span>`:'<span style="color:var(--text-muted)">Sin fecha</span>'}</div>
      <div onclick="event.stopPropagation()">
        <button class="btn-ghost btn-small" onclick="completeGoogleTask('${escapeAttr(gt._listId)}','${escapeAttr(gt.id)}')">✓ Hecha</button>
      </div>
    </div>
  </div>`;
}

function renderKanban(taskSet){
  const open=taskSet.filter(t=>t.status!=='hecha');
  const done=taskSet.filter(t=>t.status==='hecha');

  // Google Tasks huérfanas: no tienen ninguna tarea interna que las referencie
  const linkedGTaskIds=new Set(taskSet.map(t=>t.gTaskId).filter(Boolean));
  const orphanGTasks=googleTasks.filter(gt=>gt.status!=='completed'&&!linkedGTaskIds.has(gt.id));
  const today=todayStr();
  const urgOrd={alta:0,media:1,baja:2};
  const sortFn=(a,b)=>{
    const at=a.due===today?0:1, bt=b.due===today?0:1;
    if(at!==bt) return at-bt;
    return urgOrd[a.urgency]-urgOrd[b.urgency]||(a.due||'9999').localeCompare(b.due||'9999');
  };
  const kanbanSort=(items,tipo)=>{
    const todayItems=items.filter(t=>t.due===today);
    const restItems=items.filter(t=>t.due!==today);
    const ord=(state.kanbanOrder||{})[tipo]||[];
    const sortRest=(!ord.length)?[...restItems].sort(sortFn):[...restItems].sort((a,b)=>{ const ia=ord.indexOf(a.id),ib=ord.indexOf(b.id); if(ia<0&&ib<0)return sortFn(a,b); if(ia<0)return 1; if(ib<0)return -1; return ia-ib; });
    return [...todayItems.sort(sortFn), ...sortRest];
  };

  const urgent=open.filter(t=>t.urgency==='alta').sort(sortFn);

  const cols=[];
  state.tipos.forEach(tp=>{
    cols.push({title:tp, items:kanbanSort(open.filter(t=>t.tipo===tp),tp), showTipo:false, prefill:{tipo:tp}});
  });
  const sinTipo=open.filter(t=>!t.tipo || !state.tipos.includes(t.tipo)).sort(sortFn);
  if(sinTipo.length) cols.push({title:'Sin tipo', items:sinTipo, showTipo:true, prefill:{}});

  const urgentSidebar = `
    <div class="kcol-urgente-sidebar">
      <h3>⚡ Urgente <span class="count">${urgent.length}</span></h3>
      ${urgent.length ? urgent.map(t=>taskCard(t,true)).join('') : '<p class="empty" style="font-size:12px;">Nada urgente.</p>'}
      <button class="kcol-add" onclick="openTaskModal(null,JSON.parse(this.dataset.p))" data-p="${escapeAttr(JSON.stringify({urgency:'alta'}))}">+ Añadir urgente</button>
    </div>`;

  const doneSection = showDoneTasks && done.length ? `
    <div style="margin-top:14px;border-top:1px solid var(--border);padding-top:12px;">
      <p class="sect-h" style="margin-bottom:8px;">Tareas cerradas</p>
      <div class="card-grid">${done.sort((a,b)=>(b.created||'').localeCompare(a.created||'')).map(t=>`
        <div class="task" style="opacity:0.72;border-left:3px solid var(--border);">
          <p class="task-title">${escapeHtml(t.title)}</p>
          <div class="badges-row">${t.urgency?`<span class="badge ${t.urgency}">${t.urgency}</span>`:''} ${t.tipo?`<span class="badge">${escapeHtml(t.tipo)}</span>`:''}</div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;">
            <span class="task-meta">${t.due?fmtDateShort(t.due):''}</span>
            <button class="btn-ghost btn-small" onclick="reopenTask('${t.id}',event)">↺ Reabrir</button>
          </div>
        </div>`).join('')}</div>
    </div>` : '';

  const orphanCol=orphanGTasks.length?`
    <div class="kcol" style="border-top:3px solid #1a73e8;">
      <h3><i class="ti ti-checkbox" style="color:#1a73e8;font-size:13px;" aria-hidden="true"></i> Google Tasks <span class="count">${orphanGTasks.length}</span></h3>
      ${orphanGTasks.map(gt=>gTaskOrphanCard(gt)).join('')}
    </div>`:'';

  const mainKanban = cols.length
    ? '<div class="kanban">'+cols.map(c=>`
        <div class="kcol" data-tipo="${escapeAttr(c.title)}"
          ondragover="_kColDragOver(event,this)"
          ondragleave="_kColDragLeave(event,this)"
          ondrop="_kDrop(event,'${escapeAttr(c.title)}')">
          <h3><span class="col-drag-handle" draggable="true" ondragstart="_colDragStart(event,'${escapeAttr(c.title)}')" ondragend="_colDragEnd(event)"><i class="ti ti-grip-horizontal"></i></span>${escapeHtml(c.title)} <span class="count">${c.items.length}</span></h3>
          ${c.items.length ? c.items.map(t=>taskCard(t,c.showTipo)).join('') : '<p class="empty">Nada aquí.</p>'}
          <button class="kcol-add" onclick="openTaskModal(null,JSON.parse(this.dataset.p))" data-p="${escapeAttr(JSON.stringify(c.prefill))}">+ Añadir</button>
        </div>`).join('')+orphanCol+'</div>'
    : orphanCol||'<p class="empty">Sin tipos de tarea configurados.</p>';

  return `<div class="kanban-wrap"><div class="kanban-main">${mainKanban}${doneSection}</div>${urgentSidebar}</div>`;
}

function renderLista(){
  const order={alta:0,media:1,baja:2};
  let list=state.tasks.slice();
  if(currentUrgFilter==='hecha') list=list.filter(t=>t.status==='hecha');
  else if(currentUrgFilter!=='todas') list=list.filter(t=>t.urgency===currentUrgFilter&&t.status!=='hecha');
  else list=list.filter(t=>t.status!=='hecha');
  if(currentAreaFilter!=='todas') list=list.filter(t=>(t.areas||[]).includes(currentAreaFilter));
  if(currentTipoFilter==='sintipo') list=list.filter(t=>!t.tipo || !state.tipos.includes(t.tipo));
  else if(currentTipoFilter!=='todas') list=list.filter(t=>t.tipo===currentTipoFilter);
  list.sort((a,b)=>order[a.urgency]-order[b.urgency]||(a.due||'9999').localeCompare(b.due||'9999'));

  const urgOpts=[['todas','Todas'],['alta','Alta'],['media','Media'],['baja','Baja'],['hecha','Hechas']];
  const areaOpts=['todas'].concat(state.areas);
  const tipoOpts=['todas'].concat(state.tipos).concat(['sintipo']);
  return `
    <div class="filters"><span class="filter-label">Urgencia</span>${urgOpts.map(([k,l])=>`<button class="btn-small ${currentUrgFilter===k?'active':''}" onclick="setUrgFilter('${k}')">${l}</button>`).join('')}</div>
    <div class="filters"><span class="filter-label">Área</span>${areaOpts.map(a=>`<button class="btn-small ${currentAreaFilter===a?'active':''}" onclick="setAreaFilter('${escapeAttr(a)}')">${a==='todas'?'Todas':escapeHtml(a)}</button>`).join('')}</div>
    <div class="filters"><span class="filter-label">Tipo</span>${tipoOpts.map(t=>`<button class="btn-small ${currentTipoFilter===t?'active':''}" onclick="setTipoFilter('${escapeAttr(t)}')">${t==='todas'?'Todos':(t==='sintipo'?'Sin tipo':escapeHtml(t))}</button>`).join('')}</div>
    ${list.length ? `<div class="card-grid">${list.map(t=>taskCard(t,true)).join('')}</div>` : '<p class="empty">Nada aquí con estos filtros.</p>'}
    ${googleTasks.length ? `<div class="gtask-section-head"><svg width="14" height="14" viewBox="0 0 24 24" fill="#1a73e8"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>Google Tasks<button class="btn-ghost btn-small" onclick="fetchGoogleTasks()" style="margin-left:4px;" title="Actualizar"><i class="ti ti-refresh" style="font-size:11px;"></i></button></div><div class="card-grid">${googleTasks.map(t=>googleTaskCard(t)).join('')}</div>` : ''}`;
}

let showArchivedProjects = false;
function toggleShowArchived(){ showArchivedProjects = !showArchivedProjects; render(); }

let showDoneTasks = false;

function reopenTask(id, event){
  if(event) event.stopPropagation();
  const t = state.tasks.find(x=>x.id===id);
  if(!t) return;
  t.status = 'pendiente';
  saveTaskRow(t);
  render();
}

const DEV_AREA = 'Desarrollo digital';
function renderProyectosList(filterArea){
  const scope = filterArea ? state.projects.filter(p=>(p.areas||[]).includes(filterArea)) : state.projects;
  const addBox=`<div class="proj-add"><input type="text" id="newProjInput" placeholder="${filterArea?'Nuevo desarrollo (p. ej. Dashboard de presupuesto)...':'Nuevo proyecto (p. ej. Licitación cocina La Tebaida)...'}" onkeydown="if(event.key==='Enter'){event.preventDefault();addProject(${filterArea?`'${escapeAttr(filterArea)}'`:''});}"><button class="btn-primary btn-small" onclick="addProject(${filterArea?`'${escapeAttr(filterArea)}'`:''})">${filterArea?'Crear desarrollo':'Crear proyecto'}</button></div>`;
  const archivedCount = scope.filter(p=>!p.active).length;
  const toggleBox = `<div class="filters"><button class="btn-small ${!showArchivedProjects?'active':''}" onclick="showArchivedProjects=false; render();">Activos</button><button class="btn-small ${showArchivedProjects?'active':''}" onclick="showArchivedProjects=true; render();">Archivados (${archivedCount})</button></div>`;
  const visible = scope.filter(p=>showArchivedProjects ? !p.active : p.active);
  if(scope.length===0) return addBox+`<p class="empty">${filterArea?'No hay desarrollos todavía.':'No hay proyectos. Crea uno y entra en él para gestionar su panel y su diario.'}</p>`;
  if(visible.length===0) return addBox+toggleBox+'<p class="empty">'+(showArchivedProjects?'No hay archivados.':'No hay activos.')+'</p>';
  return addBox + toggleBox + '<div class="card-grid">' + visible.map(p=>{
    const tasks=state.tasks.filter(t=>t.projectId===p.id);
    const open=tasks.filter(t=>t.status!=='hecha');
    const urgent=open.filter(t=>t.urgency==='alta').length;
    const areaBadges=p.areas.map(a=>`<span class="badge area">${escapeHtml(a)}</span>`).join(' ');
    const lastLog=p.log.length?('Último apunte: '+fmtDateShort(p.log[0].date)):'Sin apuntes en el diario';
    return `
    <div class="proj-list-card" onclick="openProject('${p.id}')">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px;">
        <h3 style="margin:0;font-size:14px;">${escapeHtml(p.name)}</h3>
        <button class="btn-ghost btn-small" style="flex-shrink:0;" onclick="toggleProjectActive('${p.id}',event)">${p.active?'Archivar':'Reactivar'}</button>
      </div>
      <div class="badges-row" style="margin-bottom:8px;">${areaBadges||'<span class="empty">Sin áreas</span>'}</div>
      <div class="proj-meta">${open.length} abiertas${urgent?' · <strong style="color:var(--alta);">'+urgent+' urgente'+(urgent>1?'s':'')+'</strong>':''} · ${tasks.length-open.length} hechas</div>
      <div class="proj-meta" style="margin-top:3px;">${lastLog}</div>
    </div>`;
  }).join('')+'</div>';
}

function renderProjectDetail(){
  const p=getProj(currentProjectId);
  if(!p) { currentProjectId=null; return renderProyectosList(); }
  const tasks=state.tasks.filter(t=>t.projectId===p.id);
  const areaChecks=state.areas.map(a=>`
    <label class="chk ${p.areas.includes(a)?'checked':''}" onclick="event.preventDefault(); toggleProjArea('${p.id}','${escapeAttr(a)}')">
      ${escapeHtml(a)}
    </label>`).join('');
  const logHtml = p.log.length ? p.log.map(e=>`
    <div class="log-entry">
      <div class="log-date">${fmtDate(e.date)} <button class="btn-ghost btn-small" onclick="deleteLogEntry('${p.id}','${e.id}')">×</button></div>
      <div class="log-text">${escapeHtml(e.text)}</div>
    </div>`).join('') : '<p class="empty">El diario está vacío. Los apuntes que hagas quedan aquí con fecha.</p>';

  const projMeetings = state.meetings.filter(m=>m.projectId===p.id).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const meetingsHtml = projMeetings.length
    ? projMeetings.map(m=>`
      <div class="task ${m.importance}" onclick="openMeetingModal('${m.id}')" style="cursor:pointer;margin-bottom:8px;">
        <p class="task-title">${escapeHtml(m.title)}</p>
        <div class="task-meta">${fmtDate(m.date)}${(m.participants||[]).length?` · ${m.participants.length} participante${m.participants.length!==1?'s':''}`:''}</div>
        ${m.summary?`<p class="task-ctx" style="font-size:12px;color:var(--text-soft);margin-top:4px;">${escapeHtml(m.summary.slice(0,100))}${m.summary.length>100?'…':''}</p>`:''}
      </div>`).join('')
    : '<p class="empty">Sin reuniones asociadas a este proyecto. Crea una ficha desde el módulo de Reuniones o desde un evento del calendario.</p>';

  return `
    <div class="proj-head">
      <h3>${escapeHtml(p.name)}
        <span style="display:flex; gap:6px;">
          <button class="btn-ghost btn-small" onclick="closeProject()">← Volver</button>
          <button class="btn-ghost btn-small" onclick="deleteProject('${p.id}',event)">Eliminar</button>
        </span>
      </h3>
      <div class="field" style="margin-bottom:0;">
        <label>Áreas del proyecto (clic para activar/desactivar)</label>
        <div class="checks">${areaChecks}</div>
      </div>
    </div>

    <p class="sect-h">Panel del proyecto</p>
    ${tasks.length ? renderKanban(tasks) : '<p class="empty">Sin tareas asignadas. Usa "+ Añadir tarea" (se asignará a este proyecto automáticamente).</p>'}

    <div class="panel-box" style="margin-top:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <h2 style="margin:0;">Reuniones del proyecto</h2>
        <button class="btn-ghost btn-small" onclick="openMeetingModal(null,{projectId:'${p.id}'})"><i class="ti ti-plus"></i> Nueva ficha</button>
      </div>
      ${meetingsHtml}
    </div>

    <div class="panel-box" style="margin-top:16px;">
      <h2>Diario del proyecto</h2>
      <div class="row-flex">
        <textarea id="projLogInput" placeholder="Apunte de hoy sobre este proyecto..."></textarea>
      </div>
      <div style="margin-top:8px; display:flex; justify-content:flex-end;">
        <button class="btn-primary btn-small" onclick="addLogEntry('${p.id}')">Apuntar con fecha de hoy</button>
      </div>
      <div style="margin-top:12px;">${logHtml}</div>
    </div>`;
}
