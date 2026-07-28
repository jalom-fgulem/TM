// Panel de lectura: conversación completa, avatares y acciones sobre el correo
// Parte de la app TM. Script clásico: comparte ámbito global con el resto.

let _currentThread = null;        // conversación abierta ahora mismo
let _msgsExpandidos = new Set();  // mensajes desplegados dentro de la conversación

// ---- Avatares ----
// La API de Gmail no entrega la foto del remitente, así que se dibuja la
// inicial sobre un color estable: la misma dirección da siempre el mismo color.
const AVATAR_COLORES = ['#2563EB','#7C3AED','#DC2626','#D97706','#059669','#0891B2','#DB2777','#4F46E5','#65A30D','#EA580C'];

function avatarColor(email){
  const e = (email || '?').toLowerCase();
  let suma = 0;
  for(let i = 0; i < e.length; i++) suma = (suma + e.charCodeAt(i) * (i + 1)) % 100000;
  return AVATAR_COLORES[suma % AVATAR_COLORES.length];
}
function avatarInicial(nombre, email){
  const base = (nombre || '').trim() || (email || '').trim();
  if(!base) return '?';
  // "José Carlos Alonso" -> JA ; "ana.perez@x.es" -> A
  const limpio = base.replace(/["<>]/g, '').trim();
  const partes = limpio.split(/[\s.]+/).filter(Boolean);
  if(partes.length >= 2 && !limpio.includes('@')){
    return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
  }
  return limpio[0].toUpperCase();
}
function avatarHTML(from, tam){
  const nombre = (from || '').replace(/<[^>]+>/, '').replace(/"/g, '').trim();
  const email = emBareAddress(from || '');
  const clase = tam === 'sm' ? 'gm-avatar sm' : 'gm-avatar';
  return `<span class="${clase}" style="background:${avatarColor(email)};" title="${escapeAttr(from || '')}">${escapeHtml(avatarInicial(nombre, email))}</span>`;
}

// ---- Apertura de una conversación ----
async function selectEmail(msgId, threadId){
  selectedEmailId = msgId;
  document.querySelectorAll('.gmail-list-item,.thread-sub-item')
    .forEach(el => el.classList.toggle('selected', el.dataset.id === msgId));
  const col = document.getElementById('gmailPreviewCol'); if(!col) return;
  col.innerHTML = '<div class="gmail-preview-empty"><i class="ti ti-loader" style="font-size:24px;opacity:.4;" aria-hidden="true"></i></div>';

  try{
    const tid = threadId || msgId;
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${tid}?format=full`,
      { headers: { Authorization: `Bearer ${googleToken}` } });
    if(r.status === 401){ handleGoogleExpired(); return; }
    if(!r.ok) throw new Error();
    const hilo = await r.json();
    _currentThread = hilo;

    // Se despliega el mensaje que has abierto; si no, el más reciente
    _msgsExpandidos = new Set();
    const msgs = hilo.messages || [];
    const abrir = msgs.find(m => m.id === msgId) || msgs[msgs.length - 1];
    if(abrir) _msgsExpandidos.add(abrir.id);

    renderThreadPanel();
    if(isMobile()) document.querySelector('.gmail-layout')?.classList.add('email-open');
    msgs.filter(m => (m.labelIds || []).includes('UNREAD')).forEach(m => markEmailAsRead(m.id));
  }catch(e){
    if(col) col.innerHTML = '<div class="gmail-preview-empty">Error al cargar la conversación.</div>';
  }
}

function renderThreadPanel(){
  const col = document.getElementById('gmailPreviewCol');
  if(!col || !_currentThread) return;
  const msgs = _currentThread.messages || [];
  if(!msgs.length){ col.innerHTML = '<div class="gmail-preview-empty">Conversación vacía.</div>'; return; }

  const ultimo = msgs[msgs.length - 1];
  _currentEmailMsg = ultimo;   // responder/reenviar actúan sobre el más reciente
  const asunto = emHeader(ultimo, 'Subject') || '(sin asunto)';
  const destacado = (ultimo.labelIds || []).includes('STARRED');
  const etiquetas = (ultimo.labelIds || []).filter(id => !id.startsWith('CATEGORY_') &&
    !['UNREAD','IMPORTANT','SENT','DRAFT'].includes(id));

  col.innerHTML = `
    <div class="gmail-preview-head">
      <button class="mobile-back-btn" onclick="closeMobileEmailDetail()"><i class="ti ti-arrow-left" aria-hidden="true"></i> Volver</button>
      <div class="gm-th-titulo">
        <span class="gmail-preview-subject">${escapeHtml(asunto)}</span>
        <div class="gm-th-etiquetas">${etiquetas.map(id => `<span class="gm-th-chip">${escapeHtml(nombreEtiqueta(id))}</span>`).join('')}</div>
      </div>
      <div class="gm-acciones">
        <button class="gm-acc" onclick="openCompose('responder')" title="Responder"><i class="ti ti-corner-up-left" aria-hidden="true"></i></button>
        <button class="gm-acc" onclick="openCompose('responderTodos')" title="Responder a todos"><i class="ti ti-corner-up-left-double" aria-hidden="true"></i></button>
        <button class="gm-acc" onclick="openCompose('reenviar')" title="Reenviar"><i class="ti ti-corner-up-right" aria-hidden="true"></i></button>
        <span class="gm-acc-sep"></span>
        <button class="gm-acc ${destacado ? 'on' : ''}" onclick="toggleStarEmail('${ultimo.id}')" title="${destacado ? 'Quitar destacado' : 'Destacar'}"><i class="ti ti-star${destacado ? '-filled' : ''}" aria-hidden="true"></i></button>
        <button class="gm-acc" onclick="archiveEmail('${ultimo.id}')" title="Archivar"><i class="ti ti-archive" aria-hidden="true"></i></button>
        <button class="gm-acc" onclick="marcarComoSpam('${ultimo.id}')" title="Marcar como spam"><i class="ti ti-alert-octagon" aria-hidden="true"></i></button>
        <button class="gm-acc peligro" onclick="deleteEmail('${ultimo.id}')" title="Mover a papelera"><i class="ti ti-trash" aria-hidden="true"></i></button>
        <button class="gm-acc" onclick="abrirSelectorEtiquetas('${ultimo.id}')" title="Etiquetar"><i class="ti ti-tag" aria-hidden="true"></i></button>
        <button class="gm-acc" onclick="crearReglaDesdeCorreo('${ultimo.id}')" title="Crear regla con este remitente"><i class="ti ti-filter" aria-hidden="true"></i></button>
        <span class="gm-acc-sep"></span>
        <button class="gm-acc" onclick="importEmailAsTask('${escapeAttr(asunto)}','${escapeAttr((emHeader(ultimo,'From')||'').replace(/<[^>]+>/,'').trim())}','${escapeAttr(ultimo.id)}')" title="Crear tarea"><i class="ti ti-checkbox" aria-hidden="true"></i></button>
      </div>
    </div>
    <div class="gm-th-lista" id="gmThreadList">
      ${msgs.map((m, i) => renderMensajeHilo(m, i === msgs.length - 1)).join('')}
    </div>`;

  msgs.forEach(m => { if(_msgsExpandidos.has(m.id)) pintarCuerpoMensaje(m); });
}

function nombreEtiqueta(id){
  if(id === 'INBOX') return 'Bandeja de entrada';
  if(id === 'STARRED') return 'Destacado';
  if(id === 'SPAM') return 'Spam';
  if(id === 'TRASH') return 'Papelera';
  const l = (gmailUserLabels || []).find(x => x.id === id);
  return l ? l.name : id;
}

function renderMensajeHilo(m, esUltimo){
  const de = emHeader(m, 'From');
  const deNombre = (de || '').replace(/<[^>]+>/, '').replace(/"/g, '').trim() || emBareAddress(de);
  const para = emHeader(m, 'To');
  const fecha = emHeader(m, 'Date');
  const abierto = _msgsExpandidos.has(m.id);
  const adjuntos = extractAttachments(m.payload);

  return `
  <article class="gm-msg ${abierto ? 'abierto' : ''}" id="gm-msg-${m.id}">
    <header class="gm-msg-cab" onclick="toggleMensajeHilo('${m.id}')">
      ${avatarHTML(de)}
      <div class="gm-msg-quien">
        <div class="gm-msg-de">${escapeHtml(deNombre)}</div>
        <div class="gm-msg-para">Para: ${escapeHtml((para || '').replace(/<[^>]+>/g, '').trim() || '—')}</div>
      </div>
      <div class="gm-msg-meta">
        ${adjuntos.length ? `<i class="ti ti-paperclip" aria-hidden="true"></i>` : ''}
        <span>${escapeHtml(formatEmailDate(fecha))}</span>
        <i class="ti ti-chevron-${abierto ? 'up' : 'down'} gm-msg-flecha" aria-hidden="true"></i>
      </div>
    </header>
    ${abierto ? `
      ${adjuntos.length ? `<div class="email-attachments">
        <div class="email-attachments-title"><i class="ti ti-paperclip" aria-hidden="true"></i> ${adjuntos.length} adjunto${adjuntos.length > 1 ? 's' : ''}</div>
        <div class="email-attach-list">
          ${adjuntos.map(a => `<div class="email-attach-item" onclick="openEmailAttachment('${escapeAttr(m.id)}','${escapeAttr(a.attachmentId || '')}','${escapeAttr(a.filename)}','${escapeAttr(a.mimeType)}')" title="${escapeAttr(a.filename)}">
            <i class="ti ${attachmentIcon(a.mimeType)}" aria-hidden="true"></i><span>${escapeHtml(a.filename)}</span>
          </div>`).join('')}
        </div>
      </div>` : ''}
      <div class="gm-msg-cuerpo" id="gm-body-${m.id}"></div>
      <div class="gm-msg-pie">
        <button class="btn-ghost btn-small" onclick="responderAMensaje('${m.id}')"><i class="ti ti-corner-up-left" aria-hidden="true"></i> Responder</button>
        <button class="btn-ghost btn-small" onclick="reenviarMensaje('${m.id}')"><i class="ti ti-corner-up-right" aria-hidden="true"></i> Reenviar</button>
      </div>`
    : `<div class="gm-msg-resumen" onclick="toggleMensajeHilo('${m.id}')">${escapeHtml(m.snippet || '')}</div>`}
  </article>`;
}

// El cuerpo va en un marco aislado para que el HTML del correo no afecte a la app
function pintarCuerpoMensaje(m){
  const cont = document.getElementById('gm-body-' + m.id);
  if(!cont || cont.dataset.pintado) return;
  cont.dataset.pintado = '1';
  const cuerpo = extractEmailBody(m.payload);
  if(cuerpo.html){
    const marco = document.createElement('iframe');
    marco.className = 'gmail-preview-iframe';
    marco.setAttribute('sandbox', 'allow-popups allow-same-origin');
    cont.appendChild(marco);
    marco.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;font-size:13.5px;line-height:1.6;margin:0;padding:4px 0;color:#1A1A18;word-break:break-word;}a{color:#2563EB;}img{max-width:100%;height:auto;}blockquote{border-left:2px solid #ddd;margin:6px 0;padding-left:12px;color:#666;}</style></head><body>${cuerpo.html}</body></html>`;
    marco.onload = () => {
      try{
        const alto = marco.contentDocument.body.scrollHeight + 16;
        marco.style.height = Math.min(alto, 620) + 'px';
        if(alto > 620) añadirVerMas(cont, marco, alto);
      }catch(e){}
    };
  } else {
    cont.innerHTML = `<pre class="gm-msg-texto">${escapeHtml(cuerpo.text || '(sin contenido)')}</pre>`;
    const pre = cont.firstChild;
    if(pre.scrollHeight > 620){ pre.style.maxHeight = '620px'; añadirVerMas(cont, pre, pre.scrollHeight); }
  }
}
function añadirVerMas(cont, elemento, altoReal){
  const btn = document.createElement('button');
  btn.className = 'gm-vermas';
  btn.textContent = 'Ver más';
  btn.onclick = () => {
    const desplegado = elemento.dataset.desplegado === '1';
    elemento.style.height = desplegado ? '620px' : altoReal + 'px';
    elemento.style.maxHeight = desplegado ? '620px' : 'none';
    elemento.dataset.desplegado = desplegado ? '0' : '1';
    btn.textContent = desplegado ? 'Ver más' : 'Ver menos';
  };
  cont.appendChild(btn);
}

function toggleMensajeHilo(id){
  if(_msgsExpandidos.has(id)) _msgsExpandidos.delete(id);
  else _msgsExpandidos.add(id);
  renderThreadPanel();
}

// Responder o reenviar a un mensaje concreto del hilo, no siempre al último
function responderAMensaje(id){
  const m = (_currentThread?.messages || []).find(x => x.id === id);
  if(m) _currentEmailMsg = m;
  openCompose('responder');
}
function reenviarMensaje(id){
  const m = (_currentThread?.messages || []).find(x => x.id === id);
  if(m) _currentEmailMsg = m;
  openCompose('reenviar');
}

// ---- Acciones nuevas ----
async function toggleStarEmail(msgId){
  if(!googleToken) return;
  const m = (_currentThread?.messages || []).find(x => x.id === msgId);
  const tiene = m ? (m.labelIds || []).includes('STARRED') : false;
  try{
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}/modify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${googleToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(tiene ? { removeLabelIds: ['STARRED'] } : { addLabelIds: ['STARRED'] })
    });
    if(r.status === 401){ handleGoogleExpired(); return; }
    if(!r.ok){ setStatus('No se pudo cambiar el destacado.'); return; }
    if(m) m.labelIds = tiene ? (m.labelIds || []).filter(l => l !== 'STARRED') : [...(m.labelIds || []), 'STARRED'];
    renderThreadPanel();
    setStatus(tiene ? 'Destacado quitado.' : 'Correo destacado.');
  }catch(e){ setStatus('Error de red.'); }
}

async function marcarComoSpam(msgId){
  if(!googleToken) return;
  showConfirm('¿Marcar como spam? Se moverá a la carpeta de spam y Gmail aprenderá de remitentes parecidos.', async () => {
    closeModal();
    const el = document.querySelector(`.gmail-list-item[data-id="${msgId}"]`);
    try{
      const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}/modify`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${googleToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ addLabelIds: ['SPAM'], removeLabelIds: ['INBOX'] })
      });
      if(r.status === 401){ handleGoogleExpired(); return; }
      if(!r.ok){ setStatus('No se pudo marcar como spam.'); return; }
      if(selectedEmailId === msgId) selectNextEmail(msgId);
      if(el) el.remove();
      setStatus('Marcado como spam.');
    }catch(e){ setStatus('Error de red.'); }
  });
}
