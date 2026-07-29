// Copia de seguridad, resumen y render principal
// Parte de la app TM. Script clásico: comparte ámbito global con el resto.

// ---- Copia de seguridad ----
function copyBackupToClipboard(){
  const payload = JSON.stringify({exportedAt:new Date().toISOString(), version:STORAGE_KEY, data:state}, null, 2);
  const root=document.getElementById('modalRoot');
  root.innerHTML=`
    <div class="modal-bg" onclick="if(event.target===this) closeModal()">
      <div class="modal">
        <h3>Copia de seguridad (selecciona y copia)</h3>
        <p class="help">El texto ya está seleccionado. Pulsa Ctrl+C (o el gesto de copiar de tu dispositivo) y pégalo donde quieras guardarlo.</p>
        <textarea id="backupOutput" readonly style="min-height:220px; font-family:monospace; font-size:11px;">${escapeHtml(payload)}</textarea>
        <div class="modal-actions">
          <button class="btn-ghost" onclick="closeModal()">Cerrar</button>
        </div>
      </div>
    </div>`;
  const ta=document.getElementById('backupOutput');
  ta.focus(); ta.select();
}
function importBackup(input){
  const file = input.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    restoreFromJSONText(reader.result);
    input.value='';
  };
  reader.readAsText(file);
}
function restoreFromJSONText(text){
  let data;
  try{
    const parsed = JSON.parse(text);
    data = parsed.data || parsed;
    if(!data.tasks || !Array.isArray(data.tasks)) throw new Error('Formato no reconocido');
  }catch(e){
    setStatus('El texto pegado no es una copia válida del gestor de tareas.');
    return;
  }
  showConfirm('Esto SUSTITUYE todo lo que hay ahora en el gestor de tareas por el contenido de la copia. ¿Continuar?', ()=>{
    state = Object.assign({notes:[],tasks:[],areas:DEFAULT_AREAS.slice(),tipos:DEFAULT_TIPOS.slice(),projects:[],meetings:[],contacts:[]}, data);
    state.tasks.forEach(t=>{ if(!t.subtasks) t.subtasks=[]; t.subtasks.forEach(s=>{ if(!s.children) s.children=[]; }); if(!t.linkedTaskIds) t.linkedTaskIds=[]; });
    state.projects.forEach(p=>{ if(!p.areas) p.areas=[]; if(!p.log) p.log=[]; if(p.active===undefined) p.active=true; });
    persistAll(); render();
    setStatus('Copia restaurada.');
  });
}
async function deleteAllRows(table){
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=not.is.null`, {
    method: 'DELETE',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  if(!res.ok) setStatus('No se pudo limpiar una tabla antes de restaurar (HTTP '+res.status+').');
}
async function persistAll(){
  await Promise.all(['tasks','projects','meetings','contacts','notes'].map(deleteAllRows));
  await Promise.all([
    ...state.tasks.map(saveTaskRow),
    ...state.projects.map(saveProjectRow),
    ...state.meetings.map(saveMeetingRow),
    ...state.contacts.map(saveContactRow),
    ...state.notes.map(saveNoteRow),
    saveSettings()
  ]);
}
function openPasteImportModal(){
  const root=document.getElementById('modalRoot');
  root.innerHTML=`
    <div class="modal-bg" onclick="if(event.target===this) closeModal()">
      <div class="modal">
        <h3>Importar copia pegando texto</h3>
        <p class="help">Pega aquí el contenido completo que copiaste con "Copiar copia (portapapeles)".</p>
        <textarea id="pasteImportInput" style="min-height:160px;"></textarea>
        <div class="modal-actions">
          <button class="btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn-primary" onclick="restoreFromJSONText(document.getElementById('pasteImportInput').value); closeModal();">Restaurar</button>
        </div>
      </div>
    </div>`;
}

// ---- Resumen ----
function copySummary(){
  const pending=state.tasks.filter(t=>t.status!=='hecha');
  const order={alta:0,media:1,baja:2};
  pending.sort((a,b)=>order[a.urgency]-order[b.urgency]||(a.due||'9999').localeCompare(b.due||'9999'));
  let text='Pendientes ('+new Date().toLocaleDateString('es-ES')+'):\n';
  pending.forEach(t=>{
    const areas=(t.areas||[]).join(', ');
    const pn=projName(t.projectId);
    text+='- ['+t.urgency.toUpperCase()+'] '+t.title+(t.tipo?' ('+t.tipo+')':'')+(pn?' — Proyecto: '+pn:'')+(areas?' — '+areas:'')+(t.due?' — vence '+fmtDateShort(t.due):'');
    if(t.subtasks && t.subtasks.length){
      const done=t.subtasks.filter(s=>s.done).length;
      text+=' — subtareas '+done+'/'+t.subtasks.length;
      t.subtasks.forEach(s=>{ text+='\n    '+(s.done?'[x] ':'[ ] ')+s.text; });
    }
    if(t.context) text+='\n    '+t.context.replace(/\n/g,'\n    ');
    text+='\n';
  });
  if(pending.length===0) text+='(nada pendiente)';
  const root=document.getElementById('modalRoot');
  root.innerHTML=`
    <div class="modal-bg" onclick="if(event.target===this) closeModal()">
      <div class="modal">
        <h3>Resumen de pendientes (selecciona y copia)</h3>
        <p class="help">El texto ya está seleccionado. Pulsa Ctrl+C (o el gesto de copiar de tu dispositivo).</p>
        <textarea id="summaryOutput" readonly style="min-height:220px; font-family:monospace; font-size:12px;">${escapeHtml(text)}</textarea>
        <div class="modal-actions">
          <button class="btn-ghost" onclick="closeModal()">Cerrar</button>
        </div>
      </div>
    </div>`;
  const ta=document.getElementById('summaryOutput');
  ta.focus(); ta.select();
}

// ---- Render ----
function openNotesDrawer(){
  document.getElementById('notesDrawer').classList.add('open');
  document.getElementById('drawerOverlay').classList.add('open');
  setTimeout(()=>{ const el=document.getElementById('noteInput'); if(el) el.focus(); }, 260);
}
function closeNotesDrawer(){
  document.getElementById('notesDrawer').classList.remove('open');
  document.getElementById('drawerOverlay').classList.remove('open');
}
function openConfigDrawer(){
  document.getElementById('configDrawer').classList.add('open');
  document.getElementById('drawerOverlay').classList.add('open');
  renderAreaManage();
  const p = state.profile || {};
  document.getElementById('cfgNombre').value    = p.nombre    || '';
  document.getElementById('cfgApellidos').value = p.apellidos || '';
  document.getElementById('cfgAlias').value     = p.alias     || '';
  document.getElementById('cfgCargo').value     = p.cargo     || '';
  document.getElementById('cfgEmail').value     = p.email     || '';
  const logos = document.getElementById('cfgLogos');
  if(logos) logos.checked = state.mailLogos !== false;
}
function closeConfigDrawer(){
  document.getElementById('configDrawer').classList.remove('open');
  document.getElementById('drawerOverlay').classList.remove('open');
}
function closeAllDrawers(){
  ['notesDrawer','configDrawer'].forEach(id=>document.getElementById(id).classList.remove('open'));
  document.getElementById('drawerOverlay').classList.remove('open');
}

function setView(v){ currentView=v; if(v!=='proyectos' && v!=='desarrollo') currentProjectId=null; if(v!=='reuniones' && v!=='crm') currentPersonFilter=null; if(v!=='crm') currentContactId=null; closeMobileMore(); render(); updateMobileNav(); if(v==='calendario'){ loadCalendarMonth(); } else if(v==='correo') loadGmailWidget(); else if(v==='gtasks'){ if(googleToken) fetchGoogleTasks(); } }
function setUrgFilter(f){ currentUrgFilter=f; render(); }
function setAreaFilter(f){ currentAreaFilter=f; render(); }
function setTipoFilter(f){ currentTipoFilter=f; render(); }
function setPersonFilter(name){ currentPersonFilter = (currentPersonFilter===name) ? null : name; render(); }

function render(){
  renderNotes(); renderAreaManage();
  ['panel','lista','proyectos','reuniones','crm','desarrollo','calendario','correo','gtasks'].forEach(v=>{
    const el=document.getElementById('tab-'+v); if(el) el.classList.toggle('active', currentView===v);
  });
  const btnDone = document.getElementById('btnToggleDone');
  if(btnDone){
    const showViews = ['panel','lista','proyectos','reuniones'];
    const inView = showViews.includes(currentView) || !!currentProjectId;
    btnDone.style.display = inView ? '' : 'none';
    btnDone.textContent = showDoneTasks ? 'Ocultar cerradas' : 'Mostrar cerradas';
    btnDone.classList.toggle('active', showDoneTasks);
  }
  const root=document.getElementById('viewRoot');
  if(currentView==='panel') root.innerHTML=renderKanban(state.tasks);
  else if(currentView==='lista') root.innerHTML=renderLista();
  else if(currentView==='reuniones') root.innerHTML=renderReuniones();
  else if(currentView==='crm') root.innerHTML=renderCRM();
  else if(currentView==='desarrollo') root.innerHTML = currentProjectId ? renderProjectDetail() : renderProyectosList(DEV_AREA);
  else if(currentView==='calendario') root.innerHTML=renderCalendario();
  else if(currentView==='correo') root.innerHTML=renderCorreo();
  else if(currentView==='gtasks') root.innerHTML=renderGTasks();
  else if(currentProjectId) root.innerHTML=renderProjectDetail();
  else root.innerHTML=renderProyectosList();
}
