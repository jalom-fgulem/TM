// Gmail: listado, lectura, adjuntos y Drive
// Parte de la app TM. Script clásico: comparte ámbito global con el resto.

async function loadGmailWidget(){
  const el=document.getElementById('gmailWidget'); if(!el) return;
  el.innerHTML='<p class="empty" style="padding:16px 12px;">Cargando...</p>';
  const msgs=await fetchGmailUnread();
  if(!msgs.length){ el.innerHTML='<p class="empty" style="padding:16px 12px;">No hay emails con este filtro.</p>'; return; }
  const linkedEmailIds=new Set((state.tasks||[]).filter(t=>t.sourceEmailId).map(t=>t.sourceEmailId));
  // Group by threadId, keep insertion order of first appearance
  const byThread=new Map();
  msgs.forEach(m=>{
    const tid=m.threadId||m._threadId||m.id;
    if(!byThread.has(tid)) byThread.set(tid,[]);
    byThread.get(tid).push(m);
  });
  // Sort each thread's messages oldest→newest so last = most recent
  byThread.forEach(tMsgs=>tMsgs.sort((a,b)=>{
    const dA=new Date((a.payload?.headers||[]).find(h=>h.name==='Date')?.value||0);
    const dB=new Date((b.payload?.headers||[]).find(h=>h.name==='Date')?.value||0);
    return dA-dB;
  }));
  let _grupoActual=null;   // para insertar la cabecera de día al cambiar de fecha
  el.innerHTML=[...byThread.entries()].map(([tid,tMsgs])=>{
    const main=tMsgs[tMsgs.length-1]; // newest = representative
    const count=tMsgs.length;
    const hdrs=main.payload?.headers||[];
    const subject=hdrs.find(h=>h.name==='Subject')?.value||'(sin asunto)';
    const from=(hdrs.find(h=>h.name==='From')?.value||'').replace(/<[^>]+>/,'').trim()||'(desconocido)';
    const date=hdrs.find(h=>h.name==='Date')?.value||'';
    const unread=(main.labelIds||[]).includes('UNREAD');
    const sel=selectedEmailId===main.id;
    const hasTask=linkedEmailIds.has(main.id);
    const hasAtt=tMsgs.some(m=>extractAttachments(m.payload).length>0);
    const mainRow=`<div class="gmail-list-item${sel?' selected':''}${hasTask?' has-task':''}" draggable="true" title="Puedes arrastrarlo a una etiqueta" data-id="${main.id}" data-tid="${tid}" onclick="selectEmail('${main.id}','${tid}')">
      <div class="gli-row1">
        ${count>1?`<button class="thread-toggle" onclick="event.stopPropagation();toggleListThread('${escapeAttr(tid)}')" title="Ver hilo"><i class="ti ti-chevron-right" aria-hidden="true"></i></button>`:'<span style="width:16px;flex-shrink:0;display:inline-block;"></span>'}
        ${avatarHTML(hdrs.find(h=>h.name==='From')?.value||'', 'sm')}
        <div class="gli-from${unread?' bold':''}" style="min-width:0;">${escapeHtml(from)}</div>
        <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;">
          ${hasAtt?`<i class="ti ti-paperclip" style="font-size:11px;color:var(--text-soft);" aria-hidden="true"></i>`:''}
          ${count>1?`<span class="thread-count-badge">${count}</span>`:''}
          <span class="gli-date">${escapeHtml(formatEmailDate(date))}</span>
        </div>
      </div>
      <div class="gli-subject${unread?' bold':''}">${escapeHtml(subject)}</div>
      <div class="gli-snippet">${escapeHtml(main.snippet||'')}</div>
      ${hasTask?`<span class="gli-task-badge"><i class="ti ti-checkbox" aria-hidden="true"></i> Tarea vinculada</span>`:''}
    </div>`;
    const subContainer=count>1?`<div class="thread-sub-container" id="thread-sub-${tid}">
      <div class="thread-sub-loading">Cargando hilo…</div>
    </div>`:'';
    // Cabecera de día cuando cambia la fecha respecto al correo anterior
    const grupo=grupoDeDia(date);
    let cabecera='';
    if(grupo!==_grupoActual){ _grupoActual=grupo; cabecera=`<div class="gm-dia">${escapeHtml(grupo)}</div>`; }
    return cabecera+mainRow+subContainer;
  }).join('');
}
async function fetchGmailUnread(){
  if(!googleToken) return[];
  try{
    const lr=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(currentEmailQuery)}&maxResults=25`,
      {headers:{Authorization:`Bearer ${googleToken}`}});
    if(lr.status===401){handleGoogleExpired();return[];}
    if(!lr.ok) return[];
    const stubs=(await lr.json()).messages||[];
    if(!stubs.length) return[];
    const fields='id,threadId,labelIds,snippet,payload(headers,mimeType,parts(filename,mimeType,body(attachmentId,size),parts(filename,mimeType,body(attachmentId,size))))';
    return await Promise.all(stubs.map(({id,threadId})=>
      fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full&fields=${encodeURIComponent(fields)}`,
        {headers:{Authorization:`Bearer ${googleToken}`}}).then(r=>r.json()).then(m=>({...m,_threadId:threadId}))
    ));
  }catch(e){return[];}
}
async function fetchGmailLabels(){
  if(!googleToken) return;
  try{
    const r=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels',{headers:{Authorization:`Bearer ${googleToken}`}});
    if(!r.ok) return;
    const data=await r.json();
    const systemExclude=['CHAT','SENT','TRASH','SPAM','STARRED','UNREAD','IMPORTANT','CATEGORY_PERSONAL','CATEGORY_SOCIAL','CATEGORY_UPDATES','CATEGORY_FORUMS','CATEGORY_PROMOTIONS'];
    gmailUserLabels=(data.labels||[]).filter(l=>l.type==='user'||(!systemExclude.includes(l.id)&&l.type==='system'&&l.name==='INBOX')).filter(l=>!systemExclude.includes(l.id));
    _gruposPlegados = new Set(state.mailCollapsed || []);
    renderGmailLabelBtns();
    cargarContadoresEtiqueta();
  }catch(e){}
}
function renderGmailLabelBtns(){
  const el=document.getElementById('gmailSidebar');
  if(el) el.innerHTML=renderGmailSidebarHTML();
}
function formatEmailDate(dateStr){
  try{
    const d=new Date(dateStr), now=new Date();
    const t=d.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});
    const yd=new Date(now); yd.setDate(yd.getDate()-1);
    if(d.toDateString()===now.toDateString()) return `Hoy ${t}`;
    if(d.toDateString()===yd.toDateString()) return `Ayer ${t}`;
    if(now-d < 7*86400000) return d.toLocaleDateString('es-ES',{weekday:'short',day:'numeric'})+` ${t}`;
    return d.toLocaleDateString('es-ES',{day:'numeric',month:'short'})+` ${t}`;
  }catch(e){return'';}
}
const _expandedThreads={};
async function toggleListThread(tid){
  const container=document.getElementById(`thread-sub-${tid}`); if(!container) return;
  const btn=document.querySelector(`.gmail-list-item[data-tid="${tid}"] .thread-toggle`);
  const isOpen=container.classList.contains('open');
  container.classList.toggle('open',!isOpen);
  btn?.classList.toggle('open',!isOpen);
  if(isOpen||_expandedThreads[tid]) return;
  _expandedThreads[tid]=true;
  const linkedEmailIds=new Set((state.tasks||[]).filter(t=>t.sourceEmailId).map(t=>t.sourceEmailId));
  try{
    const r=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${tid}?format=metadata&metadataHeaders=From&metadataHeaders=Date&metadataHeaders=Subject`,{headers:{Authorization:`Bearer ${googleToken}`}});
    if(!r.ok) throw new Error();
    const thread=await r.json();
    const msgs=(thread.messages||[]).slice().reverse(); // newest first
    container.innerHTML=msgs.map(m=>{
      const hdrs=m.payload?.headers||[];
      const from=(hdrs.find(h=>h.name==='From')?.value||'').replace(/<[^>]+>/,'').trim()||'(desconocido)';
      const date=hdrs.find(h=>h.name==='Date')?.value||'';
      const isLinked=linkedEmailIds.has(m.id);
      const isSel=selectedEmailId===m.id;
      return `<div class="thread-sub-item${isSel?' selected':''}${isLinked?' has-task':''}" data-id="${m.id}" data-tid="${tid}" onclick="selectEmail('${m.id}','${tid}')">
        <div class="thread-sub-row1">
          <span class="thread-sub-from">${escapeHtml(from)}</span>
          <span class="thread-sub-date">${escapeHtml(formatEmailDate(date))}</span>
        </div>
        <div class="thread-sub-snippet">${escapeHtml(m.snippet||'')}</div>
        ${isLinked?`<span class="gli-task-badge" style="margin-top:3px;"><i class="ti ti-checkbox" aria-hidden="true"></i> Tarea vinculada</span>`:''}
      </div>`;
    }).join('');
  }catch(e){ container.innerHTML='<div class="thread-sub-loading" style="color:var(--alta);">Error al cargar el hilo.</div>'; _expandedThreads[tid]=false; }
}
async function markEmailAsRead(msgId){
  if(!googleToken) return;
  try{
    await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}/modify`,{
      method:'POST',
      headers:{Authorization:`Bearer ${googleToken}`,'Content-Type':'application/json'},
      body:JSON.stringify({removeLabelIds:['UNREAD']})
    });
    // Update list item UI
    const el=document.querySelector(`.gmail-list-item[data-id="${msgId}"]`);
    if(el){ el.querySelector('.gli-from')?.classList.remove('bold'); el.querySelector('.gli-subject')?.classList.remove('bold'); }
  }catch(e){}
}
function selectNextEmail(removedMsgId){
  const items=[...document.querySelectorAll('.gmail-list-item')];
  const idx=items.findIndex(el=>el.dataset.id===removedMsgId);
  const next=items[idx+1]||items[idx-1];
  if(next){ selectEmail(next.dataset.id, next.dataset.tid||''); }
  else{
    selectedEmailId=null;
    const col=document.getElementById('gmailPreviewCol');
    if(col) col.innerHTML='<div class="gmail-preview-empty"><i class="ti ti-mail" style="font-size:32px;opacity:.3;" aria-hidden="true"></i><span>Bandeja vacía</span></div>';
  }
}
function extractAttachments(payload){
  const atts=[];
  function walk(p){
    if(!p) return;
    if(p.filename && p.filename.length>0 && p.body){
      atts.push({filename:p.filename, mimeType:p.mimeType||'application/octet-stream', attachmentId:p.body.attachmentId||null, size:p.body.size||0});
    }
    if(p.parts) p.parts.forEach(walk);
  }
  walk(payload);
  return atts;
}
function attachmentIcon(mimeType){
  if(!mimeType) return 'ti-paperclip';
  if(mimeType.startsWith('image/')) return 'ti-photo';
  if(mimeType==='application/pdf') return 'ti-file-type-pdf';
  if(mimeType.includes('spreadsheet')||mimeType.includes('excel')) return 'ti-table';
  if(mimeType.includes('presentation')||mimeType.includes('powerpoint')) return 'ti-presentation';
  if(mimeType.includes('word')||mimeType.includes('document')) return 'ti-file-text';
  if(mimeType.startsWith('video/')) return 'ti-video';
  if(mimeType.startsWith('audio/')) return 'ti-music';
  return 'ti-paperclip';
}
async function openEmailAttachment(msgId, attachmentId, filename, mimeType){
  if(!googleToken) return;
  setStatus('Abriendo adjunto…');
  try{
    const r=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}/attachments/${attachmentId}`,{headers:{Authorization:`Bearer ${googleToken}`}});
    if(r.status===401){handleGoogleExpired();return;}
    if(!r.ok){setStatus('Error al abrir adjunto.');return;}
    const data=await r.json();
    const b64=data.data.replace(/-/g,'+').replace(/_/g,'/');
    const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
    const blob=new Blob([bytes],{type:mimeType||'application/octet-stream'});
    const url=URL.createObjectURL(blob);
    // Open in new tab — browser shows PDFs/images inline; OS handles other types on download
    const win=window.open(url,'_blank');
    if(!win){
      // Fallback: force download if popup blocked
      const a=document.createElement('a'); a.href=url; a.download=filename;
      document.body.appendChild(a); a.click(); a.remove();
    }
    setTimeout(()=>URL.revokeObjectURL(url), 30000);
    setStatus('Adjunto abierto.');
  }catch(e){ setStatus('Error al abrir adjunto.'); }
}
function driveFileIcon(mimeType){
  if(!mimeType) return 'ti-file';
  if(mimeType==='application/vnd.google-apps.document') return 'ti-file-text';
  if(mimeType==='application/vnd.google-apps.spreadsheet') return 'ti-table';
  if(mimeType==='application/vnd.google-apps.presentation') return 'ti-presentation';
  if(mimeType==='application/pdf') return 'ti-file-type-pdf';
  if(mimeType.startsWith('image/')) return 'ti-photo';
  return 'ti-file';
}
let _driveSearchTimer=null;
function reauthorizeForDrive(){
  // Vuelve a pasar por la pantalla de permisos de Google (p. ej. si se añaden
  // permisos nuevos). Mantiene la sesión de la aplicación.
  connectGoogle();
}
function searchDriveFiles(query){
  const res=document.getElementById('mDriveResults'); if(!res) return;
  if(_driveSearchTimer) clearTimeout(_driveSearchTimer);
  if(!query||query.length<2){ res.classList.remove('open'); res.innerHTML=''; return; }
  _driveSearchTimer=setTimeout(async()=>{
    if(!googleToken){ res.classList.remove('open'); return; }
    res.classList.add('open');
    res.innerHTML='<div class="drive-result-item" style="color:var(--text-soft);cursor:default;">Buscando…</div>';
    try{
      const safeQuery=query.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      const url=new URL('https://www.googleapis.com/drive/v3/files');
      url.searchParams.set('q',`name contains '${safeQuery}' and trashed=false`);
      url.searchParams.set('fields','files(id,name,mimeType,webViewLink)');
      url.searchParams.set('pageSize','10');
      const r=await fetch(url.toString(),{headers:{Authorization:`Bearer ${googleToken}`}});
      if(r.status===401){handleGoogleExpired();return;}
      if(r.status===403){
        res.innerHTML='<div class="drive-result-item" style="cursor:default;gap:8px;"><span style="color:var(--text-soft);flex:1;">Drive necesita permiso adicional.</span><button class="btn-ghost btn-small" onclick="reauthorizeForDrive()">Reconectar Google</button></div>';
        return;
      }
      if(!r.ok){
        const err=await r.json().catch(()=>({}));
        res.innerHTML=`<div class="drive-result-item" style="color:var(--text-soft);cursor:default;">Error ${r.status}: ${escapeHtml(err?.error?.message||'al buscar en Drive.')}</div>`;
        return;
      }
      const data=await r.json();
      const files=data.files||[];
      if(!files.length){res.innerHTML='<div class="drive-result-item" style="color:var(--text-soft);cursor:default;">Sin resultados.</div>';return;}
      res.innerHTML=files.map(f=>`
        <div class="drive-result-item" onclick="attachDriveFile(${JSON.stringify(JSON.stringify({id:f.id,name:f.name,mimeType:f.mimeType,url:f.webViewLink}))})">
          <i class="ti ${driveFileIcon(f.mimeType)}" style="color:#1a73e8;flex-shrink:0;" aria-hidden="true"></i>
          <span class="drive-result-name">${escapeHtml(f.name)}</span>
        </div>`).join('');
    }catch(e){res.innerHTML='<div class="drive-result-item" style="color:var(--text-soft);cursor:default;">Error de red al buscar en Drive.</div>';}
  },400);
}
function attachDriveFile(jsonStr){
  const file=JSON.parse(jsonStr);
  if(tempDriveFiles.find(f=>f.id===file.id)) return;
  tempDriveFiles.push(file);
  renderDriveFilesList();
  const res=document.getElementById('mDriveResults');
  if(res){res.classList.remove('open');res.innerHTML='';}
  const inp=document.getElementById('mDriveSearch');
  if(inp) inp.value='';
}
function removeDriveFile(id){
  tempDriveFiles=tempDriveFiles.filter(f=>f.id!==id);
  renderDriveFilesList();
}
function renderDriveFilesList(){
  const el=document.getElementById('mDriveList'); if(!el) return;
  if(!tempDriveFiles.length){el.innerHTML='';return;}
  el.innerHTML=tempDriveFiles.map(f=>`
    <li class="drive-file-item">
      <i class="ti ${driveFileIcon(f.mimeType)}" style="color:#1a73e8;flex-shrink:0;" aria-hidden="true"></i>
      <a href="${escapeAttr(f.url)}" target="_blank" rel="noopener">${escapeHtml(f.name)}</a>
      <button class="btn-ghost btn-small" style="padding:0 4px;min-width:0;" onclick="removeDriveFile('${escapeAttr(f.id)}')" title="Quitar">×</button>
    </li>`).join('');
}
function extractEmailBody(payload){
  if(!payload) return{text:'',html:''};
  let text='',html='';
  function decode(data){ try{ return decodeURIComponent(escape(atob(data.replace(/-/g,'+').replace(/_/g,'/')||''))); }catch(e){ return atob((data||'').replace(/-/g,'+').replace(/_/g,'/')); } }
  function walk(p){
    if(!p) return;
    if(p.mimeType==='text/html' && p.body?.data && !html) html=decode(p.body.data);
    else if(p.mimeType==='text/plain' && p.body?.data && !text) text=decode(p.body.data);
    if(p.parts) p.parts.forEach(walk);
  }
  if(payload.body?.data){ return payload.mimeType==='text/html'?{html:decode(payload.body.data),text:''}:{text:decode(payload.body.data),html:''}; }
  walk(payload);
  return{text,html};
}
// ============================================================
//  REFRESCO AUTOMÁTICO DEL CORREO
//
//  Gmail mantiene un contador de cambios del buzón (historyId). Consultarlo es
//  una petición mínima, así que se comprueba cada 45 segundos y solo se
//  recarga la lista cuando de verdad ha cambiado algo.
//
//  Se pausa cuando la pestaña no está a la vista (no gasta batería ni cuota)
//  y mientras estás escribiendo un correo.
// ============================================================

let _mailPollTimer = null;
let _lastHistoryId = null;
let _lastUnread = null;
const MAIL_POLL_MS = 45000;   // 🔧 PERSONALIZAR: cada cuánto se comprueba

function startMailPolling(){
  stopMailPolling();
  _mailPollTimer = setInterval(checkNewMail, MAIL_POLL_MS);
}
function stopMailPolling(){
  if(_mailPollTimer){ clearInterval(_mailPollTimer); _mailPollTimer = null; }
}

async function checkNewMail(silencioso){
  if(!googleToken) return;
  if(!silencioso && document.visibilityState !== 'visible') return;
  if(document.querySelector('.compose-window')) return;   // no molestar mientras escribes
  try{
    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile',
      { headers: { Authorization: `Bearer ${googleToken}` } });
    if(r.status === 401){ handleGoogleExpired(); return; }
    if(!r.ok) return;
    const perfil = await r.json();

    if(_lastHistoryId === null){ _lastHistoryId = perfil.historyId; return; }
    if(perfil.historyId === _lastHistoryId) return;        // nada nuevo
    _lastHistoryId = perfil.historyId;

    if(currentView === 'correo') loadGmailWidget();
    avisarSiHayCorreoNuevo();
  }catch(e){}
}

// Avisa solo si han ENTRADO mensajes, no cuando los lees o los archivas
async function avisarSiHayCorreoNuevo(){
  try{
    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels/INBOX',
      { headers: { Authorization: `Bearer ${googleToken}` } });
    if(!r.ok) return;
    const d = await r.json();
    const sinLeer = d.messagesUnread || 0;
    const badge = document.getElementById('gmailUnreadBadge');
    if(badge){ badge.textContent = sinLeer || ''; badge.style.display = sinLeer ? '' : 'none'; }
    actualizarBadgeApp(sinLeer);

    if(_lastUnread !== null && sinLeer > _lastUnread && typeof _swNotify === 'function'){
      const nuevos = sinLeer - _lastUnread;
      _swNotify(
        `${nuevos} correo${nuevos > 1 ? 's nuevos' : ' nuevo'}`,
        'Tienes ' + sinLeer + ' sin leer en la bandeja de entrada.',
        { tag: 'tm-correo-nuevo' }
      );
    }
    _lastUnread = sinLeer;
  }catch(e){}
}


// Agrupa por fecha para las separaciones de la lista
function grupoDeDia(fechaStr){
  try{
    const d=new Date(fechaStr); if(isNaN(d)) return 'Sin fecha';
    const hoy=new Date(); hoy.setHours(0,0,0,0);
    const dia=new Date(d); dia.setHours(0,0,0,0);
    const diff=Math.round((hoy-dia)/86400000);
    // Fecha completa siempre: "Ayer, 27 de julio de 2026"
    const fecha = d.getDate()+' de '+monthsEs[d.getMonth()]+' de '+d.getFullYear();
    if(diff<=0) return 'Hoy, '+fecha;
    if(diff===1) return 'Ayer, '+fecha;
    if(diff<7){
      const sem = d.toLocaleDateString('es-ES',{weekday:'long'}).replace(/^./,c=>c.toUpperCase());
      return sem+', '+fecha;
    }
    return fecha;
  }catch(e){ return 'Sin fecha'; }
}

// ---- Contador en el icono de la aplicación ----
// Solo funciona con la app instalada en la pantalla de inicio (o como aplicación
// en el escritorio). En una pestaña normal del navegador no se ve.
async function actualizarBadgeApp(n){
  try{
    if(!('setAppBadge' in navigator)) return;
    if(n > 0) await navigator.setAppBadge(n);
    else await navigator.clearAppBadge();
  }catch(e){}
}
