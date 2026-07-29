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
// Correos de particulares: ahí no hay logotipo de empresa que valga
const DOMINIOS_PERSONALES = new Set(['gmail.com','googlemail.com','hotmail.com','hotmail.es',
  'outlook.com','outlook.es','live.com','yahoo.com','yahoo.es','icloud.com','me.com','mac.com',
  'protonmail.com','proton.me','aol.com','msn.com','terra.es','telefonica.net','ono.com','wanadoo.es']);

function mostrarLogotipos(){ return state.mailLogos !== false; }   // activado salvo que se apague

// El logotipo se pide como el icono del sitio web del remitente. Se usa el
// servicio de Google, que es el mismo sitio donde ya está tu correo: así no
// entra en juego ninguna empresa nueva que no supiera ya con quién te escribes.
function logoDeRemitente(email){
  if(!mostrarLogotipos()) return '';
  const dom = ((email || '').split('@')[1] || '').trim().toLowerCase();
  if(!dom || dom.indexOf('.') < 0 || DOMINIOS_PERSONALES.has(dom)) return '';
  return 'https://www.google.com/s2/favicons?sz=64&domain=' + encodeURIComponent(dom);
}

function cambiarLogotipos(activado){
  state.mailLogos = !!activado;
  saveSettings();
  if(currentView === 'correo'){ render(); loadGmailWidget(); }
  setStatus(activado ? 'Se mostrarán los logotipos de los remitentes.' : 'Se mostrarán solo las iniciales.');
}

function avatarHTML(from, tam){
  const nombre = (from || '').replace(/<[^>]+>/, '').replace(/"/g, '').trim();
  const email = emBareAddress(from || '');
  const clase = tam === 'sm' ? 'gm-avatar sm' : 'gm-avatar';
  const logo = logoDeRemitente(email);
  // El logotipo sólo se hace visible cuando ha llegado de verdad: hasta entonces
  // (y si no llega nunca) se siguen viendo las iniciales de colores.
  const img = logo ? `<img class="gm-avatar-logo" src="${escapeAttr(logo)}" alt="" referrerpolicy="no-referrer"
    onload="this.classList.add('ok')" onerror="this.remove()">` : '';
  return `<span class="${clase}" style="background:${avatarColor(email)};" title="${escapeAttr(from || '')}">${escapeHtml(avatarInicial(nombre, email))}${img}</span>`;
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
  const col = _lecturaAmpliada
    ? document.getElementById('gmailPreviewColAmpliado')
    : document.getElementById('gmailPreviewCol');
  if(!col || !_currentThread) return;
  const msgs = _currentThread.messages || [];
  if(!msgs.length){ col.innerHTML = '<div class="gmail-preview-empty">Conversación vacía.</div>'; return; }

  const ultimo = msgs[msgs.length - 1];
  _currentEmailMsg = ultimo;   // responder/reenviar actúan sobre el más reciente
  const asunto = emHeader(ultimo, 'Subject') || '(sin asunto)';
  const destacado = (ultimo.labelIds || []).includes('STARRED');
  // INBOX no se enseña: estando en la bandeja no aporta nada y roba una fila
  const etiquetas = (ultimo.labelIds || []).filter(id => !id.startsWith('CATEGORY_') &&
    !['UNREAD','IMPORTANT','SENT','DRAFT','INBOX'].includes(id));

  col.innerHTML = `
    <div class="gmail-preview-head">
      <div class="gm-th-fila1">
        <button class="mobile-back-btn" onclick="closeMobileEmailDetail()" aria-label="Volver a la lista"><i class="ti ti-arrow-left" aria-hidden="true"></i><span>Volver</span></button>
        <div class="gm-th-titulo">
          <span class="gmail-preview-subject">${escapeHtml(asunto)}</span>
          ${etiquetas.length ? `<div class="gm-th-etiquetas">${etiquetas.map(id => `<span class="gm-th-chip">${escapeHtml(nombreEtiqueta(id))}</span>`).join('')}</div>` : ''}
        </div>
      </div>
      <div class="gm-acciones">
        <div class="gm-acc-principales">
          <button class="gm-acc grande azul" onclick="openCompose('responder')" title="Responder" aria-label="Responder"><i class="ti ti-corner-up-left" aria-hidden="true"></i><span class="acc-txt">Responder</span></button>
          <button class="gm-acc grande azul solo-movil" onclick="openCompose('responderTodos')" title="Responder a todos" aria-label="Responder a todos"><i class="ti ti-corner-up-left-double" aria-hidden="true"></i></button>
          <button class="gm-acc grande verde" onclick="archiveEmail('${_currentThread.id}')" title="Archivar toda la conversación" aria-label="Archivar toda la conversación"><i class="ti ti-archive" aria-hidden="true"></i><span class="acc-txt">Archivar</span></button>
          <button class="gm-acc grande rojo" onclick="deleteEmail('${_currentThread.id}')" title="Mover toda la conversación a la papelera" aria-label="Mover toda la conversación a la papelera"><i class="ti ti-trash" aria-hidden="true"></i><span class="acc-txt">Borrar</span></button>
          <button class="gm-acc mas" onclick="abrirMasAcciones()" title="Más acciones" aria-label="Más acciones"><i class="ti ti-dots" aria-hidden="true"></i></button>
        </div>
        <div class="gm-acc-secundarias">
        <span class="gm-acc-sep"></span>
        <button class="gm-acc azul" onclick="openCompose('responderTodos')" title="Responder a todos" aria-label="Responder a todos"><i class="ti ti-corner-up-left-double" aria-hidden="true"></i></button>
        <button class="gm-acc azul" onclick="openCompose('reenviar')" title="Reenviar" aria-label="Reenviar"><i class="ti ti-corner-up-right" aria-hidden="true"></i></button>
        <span class="gm-acc-sep"></span>
        <button class="gm-acc ambar ${destacado ? 'on' : ''}" onclick="toggleStarEmail('${ultimo.id}')" title="${destacado ? 'Quitar destacado' : 'Destacar'}" aria-label="${destacado ? 'Quitar destacado' : 'Destacar'}"><i class="ti ti-star${destacado ? '-filled' : ''}" aria-hidden="true"></i></button>
        <button class="gm-acc morado" onclick="abrirSelectorEtiquetas('${ultimo.id}')" title="Etiquetar" aria-label="Etiquetar"><i class="ti ti-tag" aria-hidden="true"></i></button>
        <button class="gm-acc morado" onclick="crearReglaDesdeCorreo('${ultimo.id}')" title="Crear regla con este remitente" aria-label="Crear regla con este remitente"><i class="ti ti-filter" aria-hidden="true"></i></button>
        <button class="gm-acc naranja" onclick="marcarComoSpam('${_currentThread.id}')" title="Marcar como spam" aria-label="Marcar como spam"><i class="ti ti-alert-octagon" aria-hidden="true"></i></button>
        <button class="gm-acc" onclick="${_lecturaAmpliada ? 'cerrarLecturaAmpliada()' : 'ampliarLectura()'}" title="${_lecturaAmpliada ? 'Volver al panel' : 'Ver a pantalla completa'}" aria-label="${_lecturaAmpliada ? 'Volver al panel' : 'Ver a pantalla completa'}"><i class="ti ti-${_lecturaAmpliada ? 'arrows-minimize' : 'arrows-maximize'}" aria-hidden="true"></i></button>
        <span class="gm-acc-sep"></span>
        <button class="gm-acc turquesa" onclick="reunionDesdeCorreo('${ultimo.id}')" title="Crear ficha de reunión" aria-label="Crear ficha de reunión"><i class="ti ti-users" aria-hidden="true"></i></button>
        <button class="gm-acc verde" onclick="importEmailAsTask('${escapeAttr(asunto)}','${escapeAttr((emHeader(ultimo,'From')||'').replace(/<[^>]+>/,'').trim())}','${escapeAttr(ultimo.id)}')" title="Crear tarea" aria-label="Crear tarea"><i class="ti ti-checkbox" aria-hidden="true"></i></button>
        </div>
      </div>
    </div>
    ${fichaCrmHTML(emHeader(msgs[0], 'From'))}
    <div class="gm-th-lista" id="gmThreadList">
      ${msgs.map((m, i) => renderMensajeHilo(m, i === msgs.length - 1)).join('')}
    </div>`;

  msgs.forEach(m => { if(_msgsExpandidos.has(m.id)) pintarCuerpoMensaje(m); });
}

// En el móvil sólo caben Responder, Archivar y Borrar. El resto de acciones
// vive aquí, en una hoja que sube desde abajo, para no robarle filas al correo.
function abrirMasAcciones(){
  if(!_currentThread) return;
  const msgs = _currentThread.messages || [];
  const ultimo = msgs[msgs.length - 1];
  const asunto = emHeader(ultimo, 'Subject') || '(sin asunto)';
  const de = (emHeader(ultimo, 'From') || '').replace(/<[^>]+>/, '').trim();
  const destacado = (ultimo.labelIds || []).includes('STARRED');

  const opciones = [
    ['azul',     'corner-up-right',       'Reenviar',                 `openCompose('reenviar')`],
    ['ambar',    'star' + (destacado ? '-filled' : ''), destacado ? 'Quitar destacado' : 'Destacar', `toggleStarEmail('${ultimo.id}')`],
    ['morado',   'tag',                   'Etiquetar',                `abrirSelectorEtiquetas('${ultimo.id}')`],
    ['morado',   'filter',                'Crear regla con este remitente', `crearReglaDesdeCorreo('${ultimo.id}')`],
    ['naranja',  'alert-octagon',         'Marcar como spam',         `marcarComoSpam('${_currentThread.id}')`],
    ['gris',     _lecturaAmpliada ? 'arrows-minimize' : 'arrows-maximize',
                 _lecturaAmpliada ? 'Volver al panel' : 'Ver a pantalla completa',
                 _lecturaAmpliada ? 'cerrarLecturaAmpliada()' : 'ampliarLectura()'],
    ['turquesa', 'users',                 'Crear ficha de reunión',   `reunionDesdeCorreo('${ultimo.id}')`],
    ['verde',    'checkbox',              'Crear tarea',              `importEmailAsTask('${escapeAttr(asunto)}','${escapeAttr(de)}','${escapeAttr(ultimo.id)}')`]
  ];

  document.getElementById('modalRoot').innerHTML = `
    <div class="modal-bg" onclick="if(event.target===this) closeModal()">
      <div class="modal">
        <h3>Más acciones</h3>
        <div class="acc-menu">
          ${opciones.map(([color, icono, texto, accion]) => `
            <button class="acc-menu-item ${color}" onclick="closeModal();${accion}">
              <i class="ti ti-${icono}" aria-hidden="true"></i><span>${escapeHtml(texto)}</span>
            </button>`).join('')}
        </div>
        <div class="modal-actions">
          <button class="btn-ghost" onclick="closeModal()">Cerrar</button>
        </div>
      </div>
    </div>`;
}

function nombreEtiqueta(id){
  if(id === 'INBOX') return 'Bandeja de entrada';
  if(id === 'STARRED') return 'Destacado';
  if(id === 'SPAM') return 'Spam';
  if(id === 'TRASH') return 'Papelera';
  const l = (gmailUserLabels || []).find(x => x.id === id);
  return l ? l.name : id;
}

// ¿Este mensaje lo he escrito yo? Gmail lo marca con la etiqueta SENT, pero eso
// falla cuando el correo llega de vuelta por una lista o un reenvío, así que
// además se compara el remitente con mi dirección y con todos mis alias.
function esMensajeMio(m){
  const etiquetas = m.labelIds || [];
  if(etiquetas.includes('SENT') || etiquetas.includes('DRAFT')) return true;
  const de = emBareAddress(emHeader(m, 'From') || '').toLowerCase();
  if(!de) return false;
  if(de === (emMyAddress() || '').toLowerCase()) return true;
  return (typeof composeAliasDisponibles === 'function' ? composeAliasDisponibles() : [])
    .some(a => (a.sendAsEmail || '').toLowerCase() === de);
}

function renderMensajeHilo(m, esUltimo){
  const de = emHeader(m, 'From');
  const mio = esMensajeMio(m);
  const deNombre = (de || '').replace(/<[^>]+>/, '').replace(/"/g, '').trim() || emBareAddress(de);
  const para = emHeader(m, 'To');
  const fecha = emHeader(m, 'Date');
  const abierto = _msgsExpandidos.has(m.id);
  const adjuntos = extractAttachments(m.payload);

  return `
  <article class="gm-msg ${abierto ? 'abierto' : ''} ${mio ? 'mio' : ''}" id="gm-msg-${m.id}">
    <header class="gm-msg-cab" onclick="toggleMensajeHilo('${m.id}')">
      ${avatarHTML(de)}
      <div class="gm-msg-quien">
        <div class="gm-msg-de">
          <button class="persona" onclick="event.stopPropagation();abrirPersonaDeCorreo('${escapeAttr(de)}')"
                  title="Ver o añadir al CRM">${escapeHtml(deNombre)}${marcaCrm(de)}</button>
          ${mio ? '<span class="gm-msg-yo"><i class="ti ti-corner-up-right" aria-hidden="true"></i><span class="yo-largo">Enviado por ti</span><span class="yo-corto">Tú</span></span>' : ''}
        </div>
        <div class="gm-msg-para">Para: ${listaPersonasHTML(para, emHeader(m, 'Cc'))}</div>
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
          ${adjuntos.map(a => `<div class="email-attach-item" title="${escapeAttr(a.filename)}">
            <span class="adj-abrir" onclick="openEmailAttachment('${escapeAttr(m.id)}','${escapeAttr(a.attachmentId || '')}','${escapeAttr(a.filename)}','${escapeAttr(a.mimeType)}')">
              <i class="ti ${attachmentIcon(a.mimeType)}" aria-hidden="true"></i><span>${escapeHtml(a.filename)}</span>
            </span>
            <button class="adj-guardar" title="Guardar como…" onclick="event.stopPropagation();guardarAdjunto('${escapeAttr(m.id)}','${escapeAttr(a.attachmentId || '')}','${escapeAttr(a.filename)}','${escapeAttr(a.mimeType)}')"><i class="ti ti-download" aria-hidden="true"></i></button>
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

// Un enlace dentro de un correo se abre siempre fuera, en una pestaña nueva.
// Si se dejara al marco, la web intentaría cargarse dentro del correo (y casi
// ninguna lo permite) o, peor, sustituiría a la aplicación entera.
function abrirEnlaceDeCorreo(ev){
  const a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
  if(!a) return;
  const destino = a.href || '';
  ev.preventDefault();
  ev.stopPropagation();

  if(/^mailto:/i.test(destino)){
    // Escribir a esa dirección con el propio redactor, sin salir de la app
    const para = decodeURIComponent(destino.replace(/^mailto:/i, '').split('?')[0]);
    if(typeof openCompose === 'function') openCompose('nuevo', { to: para });
    return;
  }
  if(!/^https?:/i.test(destino)) return;    // nada de javascript:, data:, file:…
  window.open(destino, '_blank', 'noopener,noreferrer');
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
    // allow-popups-to-escape-sandbox: la pestaña que se abre al pulsar un enlace
    // se comporta como un navegador normal, sin heredar las restricciones de aquí.
    marco.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox allow-same-origin');
    cont.appendChild(marco);
    // <base target="_blank">: los enlaces del correo salen a una pestaña nueva.
    // Sin esto intentan cargarse dentro del marco y la mayoría de webs lo rechazan.
    marco.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_blank"><style>body{font-family:system-ui,sans-serif;font-size:13.5px;line-height:1.6;margin:0;padding:4px 0;color:#1A1A18;word-break:break-word;}
      @media(max-width:820px){body{font-size:16px;line-height:1.55;}}a{color:#2563EB;}img{max-width:100%;height:auto;}blockquote{border-left:2px solid #ddd;margin:6px 0;padding-left:12px;color:#666;}</style></head><body>${cuerpo.html}</body></html>`;
    // La altura hay que medirla VARIAS veces: al cargar, las tablas, las
    // imágenes y las tipografías aún no han terminado de colocarse, y una sola
    // medida sale corta y recorta el correo.
    const ajustar = () => {
      try{
        const d = marco.contentDocument; if(!d || !d.body) return;
        const alto = Math.max(d.body.scrollHeight, d.documentElement.scrollHeight) + 24;
        if(alto > 40) marco.style.height = alto + 'px';
      }catch(e){}
    };
    marco.onload = () => {
      ajustar();
      try{
        const d = marco.contentDocument;
        if(window.ResizeObserver){
          const obs = new ResizeObserver(ajustar);
          obs.observe(d.body);
        }
        d.querySelectorAll('img').forEach(img => {
          if(!img.complete) img.addEventListener('load', ajustar, { once:true });
        });
        // La web que se abre no debe poder tocar esta pestaña ni saber de dónde viene
        d.querySelectorAll('a[href]').forEach(a => {
          a.setAttribute('target', '_blank');
          a.setAttribute('rel', 'noopener noreferrer');
        });
        // Y el clic lo atiende la propia aplicación: así el enlace nunca puede
        // llevarse por delante la pantalla del correo, pase lo que pase.
        d.addEventListener('click', abrirEnlaceDeCorreo, true);
      }catch(e){}
    };
    // Fuera del evento de carga a propósito: si por lo que sea no llega a
    // dispararse, estas pasadas ajustan la altura igualmente.
    [120, 400, 1000, 2500].forEach(ms => setTimeout(ajustar, ms));
  } else {
    cont.innerHTML = `<pre class="gm-msg-texto">${escapeHtml(cuerpo.text || '(sin contenido)')}</pre>`;
  }
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

// ============================================================
//  LECTURA A PANTALLA COMPLETA
//
//  El panel de la derecha se queda corto para correos largos o con tablas.
//  Esta vista reutiliza el mismo pintado, pero a todo lo ancho.
// ============================================================

let _lecturaAmpliada = false;

function ampliarLectura(){
  if(!_currentThread) return;
  _lecturaAmpliada = true;
  const caja = document.createElement('div');
  caja.className = 'lectura-overlay';
  caja.id = 'lecturaOverlay';
  caja.innerHTML = `
    <div class="lectura-ventana">
      <div class="lectura-cab">
        <span class="lectura-titulo">Lectura ampliada</span>
        <button class="cw-close" onclick="cerrarLecturaAmpliada()" title="Volver (Esc)">
          <i class="ti ti-x" aria-hidden="true"></i>
        </button>
      </div>
      <div class="gmail-preview-col" id="gmailPreviewColAmpliado"></div>
    </div>`;
  document.body.appendChild(caja);
  renderThreadPanel();          // vuelve a pintar, ahora dentro de la ventana grande
}

function cerrarLecturaAmpliada(){
  _lecturaAmpliada = false;
  const o = document.getElementById('lecturaOverlay');
  if(o) o.remove();
  renderThreadPanel();          // devuelve el contenido al panel de la derecha
}

document.addEventListener('keydown', e => {
  if(e.key === 'Escape' && _lecturaAmpliada) cerrarLecturaAmpliada();
});

// Doble clic en un correo de la lista lo abre directamente ampliado
document.addEventListener('dblclick', e => {
  const fila = e.target.closest('.gmail-list-item');
  if(!fila) return;
  if(e.target.closest('.gli-acc')) return;   // no si se pulsó un botón de acción
  if(_currentThread && _currentThread.id === fila.dataset.tid) ampliarLectura();
  else selectEmail(fila.dataset.id, fila.dataset.tid).then(() => ampliarLectura());
});


// ---- Ficha de reunión a partir de un correo ----
// Aprovecha el remitente y los destinatarios como participantes previstos, y
// deja el asunto como título. Al guardar, la ficha puede crear su evento en el
// calendario desde el propio formulario de reuniones.
function reunionDesdeCorreo(msgId){
  const m = (_currentThread?.messages || []).find(x => x.id === msgId)
         || (_currentThread?.messages || []).slice(-1)[0];
  if(!m){ setStatus('Abre primero un correo.'); return; }

  const yo = emBareAddress(emMyAddress());
  const gente = [
    ...emSplitAddresses(emHeader(m, 'From')),
    ...emSplitAddresses(emHeader(m, 'To')),
    ...emSplitAddresses(emHeader(m, 'Cc'))
  ];
  // Nombres legibles, sin duplicados y sin uno mismo
  const vistos = new Set();
  const participantes = [];
  gente.forEach(a => {
    const correo = emBareAddress(a);
    if(!correo || correo === yo || vistos.has(correo)) return;
    vistos.add(correo);
    const nombre = a.replace(/<[^>]+>/, '').replace(/"/g, '').trim();
    participantes.push(nombre || correo);
  });

  const asunto = (emHeader(m, 'Subject') || '').replace(/^\s*(re|rv|fwd)\s*:\s*/i, '').trim();
  const resumen = 'Origen: correo de ' + (emHeader(m, 'From') || '') +
                  ' del ' + emQuoteDate(emHeader(m, 'Date')) + '.';

  openMeetingModal(null, {
    title: asunto || 'Reunión',
    date: todayStr(),
    participants: participantes,
    summary: resumen,
    sourceEmailId: msgId
  });
}


// ---- Tarjeta del remitente: ¿está en el CRM? ----
function fichaCrmHTML(cabeceraFrom){
  if(!cabeceraFrom) return '';
  const c = (typeof contactoPorRemitente === 'function') ? contactoPorRemitente(cabeceraFrom) : null;
  const correo = emBareAddress(cabeceraFrom);
  const visible = (cabeceraFrom || '').replace(/<[^>]+>/, '').replace(/"/g, '').trim() || correo;

  if(c){
    const detalle = [c.cargo, c.empresa].filter(Boolean).join(' · ');
    return `<div class="crm-tarjeta conocido">
      ${avatarHTML(cabeceraFrom, 'sm')}
      <div class="crm-datos">
        <span class="crm-nombre">${escapeHtml(contactFullName(c))}</span>
        ${detalle ? `<span class="crm-detalle">${escapeHtml(detalle)}</span>` : ''}
      </div>
      <span class="crm-marca"><i class="ti ti-address-book" aria-hidden="true"></i> En tu CRM</span>
      <button class="btn-ghost btn-small" onclick="openContactDetail('${c.id}'); setView('crm');">Ver ficha</button>
    </div>`;
  }
  return `<div class="crm-tarjeta">
    ${avatarHTML(cabeceraFrom, 'sm')}
    <div class="crm-datos">
      <span class="crm-nombre">${escapeHtml(visible)}</span>
      <span class="crm-detalle">No está en tu CRM</span>
    </div>
    <button class="btn-ghost btn-small" onclick="altaContactoDesdeCorreo('${escapeAttr(cabeceraFrom)}')">+ Añadir al CRM</button>
  </div>`;
}


// Marca discreta cuando la persona ya está en el CRM
function marcaCrm(cabecera){
  if(typeof contactoPorRemitente !== 'function') return '';
  return contactoPorRemitente(cabecera) ? '<i class="ti ti-address-book persona-crm" aria-hidden="true"></i>' : '';
}

// Destinatarios y copias, cada uno pulsable
function listaPersonasHTML(para, cc){
  const gente = [...emSplitAddresses(para || ''), ...emSplitAddresses(cc || '')];
  if(!gente.length) return '—';
  const vistos = new Set();
  const trozos = [];
  gente.forEach(a => {
    const correo = emBareAddress(a);
    if(!correo || vistos.has(correo)) return;
    vistos.add(correo);
    const nombre = a.replace(/<[^>]+>/, '').replace(/"/g, '').trim() || correo;
    trozos.push(`<button class="persona" onclick="event.stopPropagation();abrirPersonaDeCorreo('${escapeAttr(a)}')"
      title="${escapeAttr(correo)}">${escapeHtml(nombre)}${marcaCrm(a)}</button>`);
  });
  return trozos.join('<span class="persona-sep">·</span>');
}
