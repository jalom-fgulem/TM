// Redacción de correo: nuevo, responder, responder a todos y reenviar
// Parte de la app TM. Script clásico: comparte ámbito global con el resto.

let _composeCtx = null;    // contexto del correo que se está redactando
let _currentEmailMsg = null; // último mensaje abierto en el panel de lectura
let googleSendAs = [];       // direcciones de envío configuradas en Gmail, con su firma
let _sendAsSinPermiso = false; // true si Gmail exige un permiso extra para leerlas

// ---- Direcciones de envío (alias) y sus firmas ----
// Gmail guarda los alias y la firma de cada uno en el mismo sitio, así que una
// sola consulta resuelve las dos cosas.
async function fetchSendAsAliases(){
  if(!googleToken) return;
  try{
    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs',
      { headers: { Authorization: `Bearer ${googleToken}` } });
    if(r.status === 401){ await handleGoogleExpired(); return; }
    if(r.status === 403){        // hace falta el permiso gmail.settings.basic
      _sendAsSinPermiso = true;
      return;
    }
    if(!r.ok) return;
    const d = await r.json();
    // Se descartan los alias pendientes de verificar: Gmail no deja enviar con ellos
    googleSendAs = (d.sendAs || []).filter(a => a.isPrimary || a.verificationStatus === 'accepted');
    _sendAsSinPermiso = false;
  }catch(e){}
}

// Lista utilizable siempre, aunque no hayamos podido leer los alias
function composeAliasDisponibles(){
  if(googleSendAs.length) return googleSendAs;
  // Sin permiso para leer los alias, al menos usamos el nombre del perfil de
  // Google que viene con la sesión.
  const meta = (sbSession && sbSession.user && sbSession.user.user_metadata) || {};
  return [{
    sendAsEmail: emMyAddress(),
    displayName: meta.full_name || meta.name || '',
    signature: '', isDefault: true, isPrimary: true
  }];
}
function composeAliasPorEmail(email){
  return composeAliasDisponibles().find(a => a.sendAsEmail.toLowerCase() === (email || '').toLowerCase()) || null;
}
// Al responder conviene hacerlo desde la dirección a la que escribieron
function composeAliasParaRespuesta(msg){
  const lista = composeAliasDisponibles();
  const candidatos = [
    ...emSplitAddresses(emHeader(msg, 'To')),
    ...emSplitAddresses(emHeader(msg, 'Cc')),
    emHeader(msg, 'Delivered-To')
  ].filter(Boolean).map(emBareAddress);
  const encontrado = lista.find(a => candidatos.includes(a.sendAsEmail.toLowerCase()));
  return encontrado || lista.find(a => a.isDefault) || lista[0];
}

// ---- Utilidades de cabeceras ----
function emHeader(msg, nombre){
  const h = (msg && msg.payload && msg.payload.headers || [])
    .find(x => x.name.toLowerCase() === nombre.toLowerCase());
  return h ? h.value : '';
}
function emMyAddress(){
  return (sbSession && sbSession.user && sbSession.user.email) || '';
}
// Separa "Ana <a@x.es>, Luis <l@y.es>" en direcciones, respetando las comillas
function emSplitAddresses(str){
  if(!str) return [];
  const out=[]; let buf=''; let dentroComillas=false, dentroAngulo=false;
  for(const c of str){
    if(c === '"') dentroComillas = !dentroComillas;
    if(c === '<') dentroAngulo = true;
    if(c === '>') dentroAngulo = false;
    if(c === ',' && !dentroComillas && !dentroAngulo){ out.push(buf.trim()); buf=''; continue; }
    buf += c;
  }
  if(buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}
function emBareAddress(a){
  const m = a.match(/<([^>]+)>/);
  return (m ? m[1] : a).trim().toLowerCase();
}

// ---- Codificación para la API de Gmail ----
// Gmail espera el correo completo en base64url. Hay que cuidar los acentos:
// btoa() no admite caracteres fuera de Latin-1, así que primero pasamos a UTF-8.
function emB64(str){
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin);
}
function emB64Url(str){
  return emB64(str).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
// Asunto con acentos o eñes: hay que codificarlo según RFC 2047
function emEncodeSubject(s){
  return /^[\x00-\x7F]*$/.test(s || '') ? (s || '') : '=?UTF-8?B?' + emB64(s) + '?=';
}

// "José Carlos <jc@x.es>" -> el nombre necesita codificarse si lleva acentos
function emFormatFrom(alias){
  if(!alias) return '';
  const nombre = (alias.displayName || '').trim();
  if(!nombre) return alias.sendAsEmail;
  return emEncodeSubject(nombre) + ' <' + alias.sendAsEmail + '>';
}

function emBuildRaw(o){
  const l = [];
  if(o.from) l.push('From: ' + o.from);
  l.push('To: ' + (o.to || ''));
  if(o.cc)  l.push('Cc: '  + o.cc);
  if(o.bcc) l.push('Bcc: ' + o.bcc);
  l.push('Subject: ' + emEncodeSubject(o.subject));
  if(o.inReplyTo){
    l.push('In-Reply-To: ' + o.inReplyTo);
    l.push('References: ' + (o.references ? o.references + ' ' + o.inReplyTo : o.inReplyTo));
  }
  l.push('MIME-Version: 1.0');
  l.push('Content-Type: text/html; charset="UTF-8"');
  l.push('Content-Transfer-Encoding: base64');
  l.push('');
  l.push(emB64(o.bodyHtml || '').replace(/(.{76})/g, '$1\r\n'));
  return emB64Url(l.join('\r\n'));
}

// ---- Cita del mensaje original ----
// Fecha completa, no relativa: en una cita "El ayer 09:15..." queda mal redactado.
function emQuoteDate(dateStr){
  try{
    const d = new Date(dateStr);
    if(isNaN(d)) return dateStr || '';
    return d.toLocaleDateString('es-ES', { day:'numeric', month:'long', year:'numeric' })
         + ' a las ' + d.toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit' });
  }catch(e){ return dateStr || ''; }
}
function emQuoteOriginal(msg){
  if(!msg) return '';
  const de = emHeader(msg, 'From');
  const fecha = emHeader(msg, 'Date');
  const cuerpo = extractEmailBody(msg.payload);
  const contenido = cuerpo.html
    ? cuerpo.html
    : '<pre style="white-space:pre-wrap;font-family:inherit;margin:0;">' + escapeHtml(cuerpo.text || '') + '</pre>';
  return `<div data-cita="1"><div style="color:#555;">El ${escapeHtml(emQuoteDate(fecha))}, ${escapeHtml(de)} escribió:</div>
    <blockquote style="border-left:2px solid #ccc;margin:6px 0 0;padding-left:12px;color:#555;">${contenido}</blockquote></div>`;
}

// ---- Apertura del redactor ----
// modo: 'nuevo' | 'responder' | 'responderTodos' | 'reenviar'
function openCompose(modo, prefill){
  if(!googleToken){ setStatus('Conecta con Google para poder enviar correo.'); return; }
  const msg = (modo === 'nuevo') ? null : _currentEmailMsg;
  if(modo !== 'nuevo' && !msg){ setStatus('Abre primero un correo.'); return; }

  const yo = emBareAddress(emMyAddress());
  let to = '', cc = '', asunto = '', cuerpo = '', inReplyTo = '', references = '', threadId = '';

  if(modo === 'nuevo'){
    to = (prefill && prefill.to) || '';
    asunto = (prefill && prefill.subject) || '';
  } else {
    const asuntoOrig = emHeader(msg, 'Subject') || '(sin asunto)';
    inReplyTo  = emHeader(msg, 'Message-ID');
    references = emHeader(msg, 'References');

    if(modo === 'reenviar'){
      asunto = /^\s*(fwd|rv):/i.test(asuntoOrig) ? asuntoOrig : 'Fwd: ' + asuntoOrig;
      inReplyTo = ''; references = '';   // reenviar abre conversación nueva
    } else {
      asunto = /^\s*re:/i.test(asuntoOrig) ? asuntoOrig : 'Re: ' + asuntoOrig;
      threadId = msg.threadId || '';
      // Reply-To manda sobre From si viene informado
      to = emHeader(msg, 'Reply-To') || emHeader(msg, 'From');
      if(modo === 'responderTodos'){
        const otros = [...emSplitAddresses(emHeader(msg, 'To')), ...emSplitAddresses(emHeader(msg, 'Cc'))]
          .filter(a => {
            const b = emBareAddress(a);
            return b !== yo && b !== emBareAddress(to);
          });
        cc = otros.join(', ');
      }
    }
  }

  // Dirección de envío: al responder, la misma a la que te escribieron
  const alias = composeAliasDisponibles();
  const aliasElegido = (modo === 'nuevo')
    ? (alias.find(a => a.isDefault) || alias[0])
    : composeAliasParaRespuesta(msg);

  // La firma va debajo de lo que escribas y encima de la cita del original
  const firma = (aliasElegido && aliasElegido.signature)
    ? `<div class="firma-insertada" data-firma="1">${aliasElegido.signature}</div>`
    : '';
  cuerpo = (modo === 'nuevo') ? '<br>' + firma : '<br><br>' + firma + emQuoteOriginal(msg);

  _composeCtx = { modo, inReplyTo, references, threadId };

  const titulo = modo === 'nuevo' ? 'Nuevo correo'
               : modo === 'reenviar' ? 'Reenviar'
               : modo === 'responderTodos' ? 'Responder a todos' : 'Responder';

  document.getElementById('modalRoot').innerHTML = `
    <div class="compose-overlay" onclick="if(event.target===this) closeCompose()">
      <div class="compose-window">

        <header class="cw-head">
          <span class="cw-title">${titulo}</span>
          <div class="cw-status" id="cpStatus"></div>
          <div class="cw-head-actions">
            <button class="btn-primary cw-send" id="cpSendBtn" onclick="sendComposedEmail()">
              <i class="ti ti-send" aria-hidden="true"></i><span>Enviar</span>
            </button>
            <button class="cw-close" onclick="closeCompose()" title="Descartar" aria-label="Descartar">
              <i class="ti ti-x" aria-hidden="true"></i>
            </button>
          </div>
        </header>

        <div class="cw-fields">
          <div class="cw-row">
            <label for="cpTo">Para</label>
            <input type="text" id="cpTo" value="${escapeAttr(to)}" placeholder="nombre@dominio.es">
            <span class="cw-row-extra">
              <button type="button" onclick="toggleComposeField('cpCcRow')">Cc</button>
              <button type="button" onclick="toggleComposeField('cpBccRow')">Cco</button>
            </span>
          </div>
          <div class="cw-row" id="cpCcRow" style="${cc ? '' : 'display:none;'}">
            <label for="cpCc">Cc</label>
            <input type="text" id="cpCc" value="${escapeAttr(cc)}">
          </div>
          <div class="cw-row" id="cpBccRow" style="display:none;">
            <label for="cpBcc">Cco</label>
            <input type="text" id="cpBcc" value="">
          </div>
          <div class="cw-row">
            <label for="cpFrom">De</label>
            ${alias.length > 1 ? `
              <select id="cpFrom" class="cw-from-select" onchange="onComposeAliasChange()">
                ${alias.map(a => `<option value="${escapeAttr(a.sendAsEmail)}" ${a.sendAsEmail === aliasElegido.sendAsEmail ? 'selected' : ''}>${escapeHtml(a.displayName ? a.displayName + ' <' + a.sendAsEmail + '>' : a.sendAsEmail)}</option>`).join('')}
              </select>`
            : `<span class="cw-from"><i class="ti ti-user" aria-hidden="true"></i>${escapeHtml(aliasElegido.sendAsEmail)}</span>
               <input type="hidden" id="cpFrom" value="${escapeAttr(aliasElegido.sendAsEmail)}">`}
          </div>
          <div class="cw-row">
            <label for="cpSubject">Asunto</label>
            <input type="text" id="cpSubject" value="${escapeAttr(asunto)}" placeholder="Asunto del mensaje">
          </div>
        </div>

        <div class="cw-toolbar-wrap">${editorToolbarHTML()}</div>

        <div class="cw-body-wrap">
          <div class="compose-body" id="cpBody" contenteditable="true">${cuerpo}</div>
        </div>

      </div>
    </div>`;

  // Los botones de tabla aparecen solo con el cursor dentro de una tabla
  const b = document.getElementById('cpBody');
  ['keyup','mouseup','focus'].forEach(ev => b.addEventListener(ev, editorActualizarBarraTabla));
  // Cerrar el selector de tamaño de tabla al pinchar fuera
  document.getElementById('modalRoot').addEventListener('click', e => {
    const menu = document.getElementById('edTablaMenu');
    if(menu && !e.target.closest('#edTablaMenu') && !e.target.closest('[onclick*="editorAbrirTablas"]')){
      menu.style.display = 'none';
    }
  });

  // El cursor al principio, encima de la cita
  b.focus();
  const r = document.createRange();
  r.setStart(b, 0); r.collapse(true);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  if(modo === 'nuevo' && !to) document.getElementById('cpTo').focus();
}

function toggleComposeField(id){
  const el = document.getElementById(id);
  if(el) el.style.display = el.style.display === 'none' ? '' : 'none';
}

// ============================================================
//  EDITOR DE TEXTO ENRIQUECIDO
//
//  Construido sobre las órdenes de edición del navegador, sin librerías
//  externas. Las tablas se generan con los estilos escritos dentro de cada
//  celda: los clientes de correo eliminan las hojas de estilo, así que es la
//  única forma de que lleguen bien formateadas al destinatario.
// ============================================================

function editorToolbarHTML(){
  return `
  <div class="compose-toolbar">
    <select class="ed-select" onchange="editorBloque(this.value); this.selectedIndex=0;" title="Estilo de párrafo">
      <option value="">Estilo</option>
      <option value="p">Texto normal</option>
      <option value="h1">Título grande</option>
      <option value="h2">Título mediano</option>
      <option value="h3">Título pequeño</option>
      <option value="blockquote">Cita</option>
      <option value="pre">Texto monoespaciado</option>
    </select>
    <select class="ed-select" onchange="editorExec('fontSize', this.value); this.selectedIndex=0;" title="Tamaño">
      <option value="">Tamaño</option>
      <option value="1">Muy pequeño</option>
      <option value="2">Pequeño</option>
      <option value="3">Normal</option>
      <option value="4">Mediano</option>
      <option value="5">Grande</option>
      <option value="6">Muy grande</option>
    </select>
    <span class="ed-sep"></span>
    <button type="button" onclick="editorExec('bold')" title="Negrita"><b>B</b></button>
    <button type="button" onclick="editorExec('italic')" title="Cursiva"><i>I</i></button>
    <button type="button" onclick="editorExec('underline')" title="Subrayado"><u>U</u></button>
    <button type="button" onclick="editorExec('strikeThrough')" title="Tachado"><s>S</s></button>
    <span class="ed-sep"></span>
    <label class="ed-color" title="Color del texto">
      <i class="ti ti-letter-a" aria-hidden="true"></i>
      <input type="color" value="#1a1a18" oninput="editorExec('foreColor', this.value)">
    </label>
    <label class="ed-color" title="Resaltado">
      <i class="ti ti-highlight" aria-hidden="true"></i>
      <input type="color" value="#fff176" oninput="editorExec('hiliteColor', this.value)">
    </label>
    <span class="ed-sep"></span>
    <button type="button" onclick="editorExec('insertUnorderedList')" title="Lista con puntos"><i class="ti ti-list" aria-hidden="true"></i></button>
    <button type="button" onclick="editorExec('insertOrderedList')" title="Lista numerada"><i class="ti ti-list-numbers" aria-hidden="true"></i></button>
    <button type="button" onclick="editorExec('outdent')" title="Reducir sangría"><i class="ti ti-indent-decrease" aria-hidden="true"></i></button>
    <button type="button" onclick="editorExec('indent')" title="Aumentar sangría"><i class="ti ti-indent-increase" aria-hidden="true"></i></button>
    <span class="ed-sep"></span>
    <button type="button" onclick="editorExec('justifyLeft')" title="Alinear a la izquierda"><i class="ti ti-align-left" aria-hidden="true"></i></button>
    <button type="button" onclick="editorExec('justifyCenter')" title="Centrar"><i class="ti ti-align-center" aria-hidden="true"></i></button>
    <button type="button" onclick="editorExec('justifyRight')" title="Alinear a la derecha"><i class="ti ti-align-right" aria-hidden="true"></i></button>
    <button type="button" onclick="editorExec('justifyFull')" title="Justificar"><i class="ti ti-align-justified" aria-hidden="true"></i></button>
    <span class="ed-sep"></span>
    <button type="button" onclick="editorEnlace()" title="Insertar o editar enlace"><i class="ti ti-link" aria-hidden="true"></i></button>
    <button type="button" onclick="editorQuitarEnlace()" title="Quitar enlace"><i class="ti ti-unlink" aria-hidden="true"></i></button>
    <button type="button" onclick="editorImagen()" title="Insertar imagen"><i class="ti ti-photo" aria-hidden="true"></i></button>
    <button type="button" onclick="editorExec('insertHorizontalRule')" title="Línea separadora"><i class="ti ti-minus" aria-hidden="true"></i></button>
    <span class="ed-sep"></span>
    <button type="button" onclick="editorAbrirTablas(event)" title="Insertar tabla"><i class="ti ti-table" aria-hidden="true"></i></button>
    <button type="button" onclick="editorFirma()" title="Insertar firma"><i class="ti ti-signature" aria-hidden="true"></i></button>
    <span class="ed-sep"></span>
    <button type="button" onclick="editorLimpiar()" title="Quitar todo el formato"><i class="ti ti-clear-formatting" aria-hidden="true"></i></button>
  </div>
  <div class="ed-tabla-menu" id="edTablaMenu" style="display:none;"></div>
  <div class="ed-tabla-acciones" id="edTablaAcciones" style="display:none;">
    <span>Tabla:</span>
    <button type="button" onclick="editorFila(true)">+ Fila</button>
    <button type="button" onclick="editorFila(false)">− Fila</button>
    <button type="button" onclick="editorColumna(true)">+ Columna</button>
    <button type="button" onclick="editorColumna(false)">− Columna</button>
    <button type="button" onclick="editorBorrarTabla()">Eliminar tabla</button>
  </div>`;
}

function editorCuerpo(){ return document.getElementById('cpBody'); }

// El redactor ocupa toda la pantalla y tapa la línea de avisos del pie,
// así que los mensajes se muestran en su propia cabecera.
function composeStatus(msg, tipo){
  const el = document.getElementById('cpStatus');
  if(!el){ setStatus(msg); return; }
  el.textContent = msg || '';
  el.className = 'cw-status' + (tipo ? ' ' + tipo : '');
  if(msg) setTimeout(() => {
    if(el.textContent === msg){ el.textContent = ''; el.className = 'cw-status'; }
  }, 6000);
}

// Coloca (o sustituye) la firma justo encima de la cita del mensaje original
function composeAplicarFirma(html){
  const body = editorCuerpo(); if(!body) return;
  const actual = body.querySelector('[data-firma]');
  if(actual){
    if(html){ actual.innerHTML = html; return; }
    actual.remove(); return;
  }
  if(!html) return;
  const bloque = document.createElement('div');
  bloque.className = 'firma-insertada';
  bloque.setAttribute('data-firma', '1');
  bloque.innerHTML = html;
  const cita = body.querySelector('[data-cita]');
  if(cita) body.insertBefore(bloque, cita);
  else body.appendChild(bloque);
}

// Al cambiar de dirección de envío, cambia también su firma
function onComposeAliasChange(){
  const sel = document.getElementById('cpFrom'); if(!sel) return;
  const alias = composeAliasPorEmail(sel.value);
  composeAplicarFirma(alias && alias.signature ? alias.signature : '');
}

// Inserta contenido SIN pasar por la orden de edición del navegador.
// Es imprescindible: esa orden aplica un filtro que borra bordes, relleno y
// anchos, y dejaría las tablas sin formato al llegar al destinatario.
function editorInsertarHTML(html){
  const b = editorCuerpo(); if(!b) return;
  b.focus();
  const sel = window.getSelection();
  let rango;
  if(sel && sel.rangeCount && b.contains(sel.getRangeAt(0).startContainer)){
    rango = sel.getRangeAt(0);
  } else {                       // sin cursor válido: al final del texto
    rango = document.createRange();
    rango.selectNodeContents(b);
    rango.collapse(false);
  }
  rango.deleteContents();

  const plantilla = document.createElement('template');
  plantilla.innerHTML = html;
  const fragmento = plantilla.content;
  const ultimo = fragmento.lastChild;
  rango.insertNode(fragmento);

  if(ultimo){                    // deja el cursor detrás de lo insertado
    const despues = document.createRange();
    despues.setStartAfter(ultimo);
    despues.collapse(true);
    sel.removeAllRanges();
    sel.addRange(despues);
  }
}

// Recoloca el cursor en una celda concreta (tras añadir o borrar filas)
function editorCursorEnCelda(celda){
  if(!celda) return;
  const rango = document.createRange();
  rango.selectNodeContents(celda);
  rango.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(rango);
  editorActualizarBarraTabla();
}

function editorExec(cmd, val){
  const b = editorCuerpo(); if(!b) return;
  b.focus();
  try{ document.execCommand('styleWithCSS', false, true); }catch(e){}
  document.execCommand(cmd, false, val === undefined ? null : val);
}
function editorBloque(tag){
  if(!tag) return;
  editorExec('formatBlock', '<' + tag + '>');
}

// ---- Enlaces ----
function editorEnlace(){
  const b = editorCuerpo(); if(!b) return;
  const sel = window.getSelection();
  const textoSel = sel ? sel.toString() : '';
  const enlaceActual = editorAncestro('A');
  const url = prompt('Dirección del enlace:', enlaceActual ? enlaceActual.getAttribute('href') : 'https://');
  if(!url) return;
  b.focus();
  if(enlaceActual){ enlaceActual.setAttribute('href', url); return; }
  if(textoSel){
    editorExec('createLink', url);
  } else {
    const texto = prompt('Texto que se verá:', url) || url;
    editorInsertarHTML(`<a href="${escapeAttr(url)}">${escapeHtml(texto)}</a>&nbsp;`);
  }
}
function editorQuitarEnlace(){ editorExec('unlink'); }

function editorImagen(){
  const url = prompt('Dirección de la imagen (https://…):');
  if(!url) return;
  editorInsertarHTML(`<img src="${escapeAttr(url)}" style="max-width:100%;height:auto;" alt="">`);
}

// ---- Tablas ----
function editorAbrirTablas(ev){
  if(ev) ev.stopPropagation();
  const menu = document.getElementById('edTablaMenu');
  if(!menu) return;
  if(menu.style.display !== 'none'){ menu.style.display = 'none'; return; }
  let rejilla = '';
  for(let f = 1; f <= 6; f++){
    for(let c = 1; c <= 6; c++){
      rejilla += `<i data-f="${f}" data-c="${c}" onmouseover="editorPreviaTabla(${f},${c})" onclick="editorInsertarTabla(${f},${c})"></i>`;
    }
  }
  menu.innerHTML = `<div class="ed-rejilla">${rejilla}</div><div class="ed-rejilla-txt" id="edRejillaTxt">Elige el tamaño</div>`;
  menu.style.display = 'block';
}
function editorPreviaTabla(filas, cols){
  const menu = document.getElementById('edTablaMenu'); if(!menu) return;
  menu.querySelectorAll('.ed-rejilla i').forEach(el=>{
    const f = +el.dataset.f, c = +el.dataset.c;
    el.classList.toggle('on', f <= filas && c <= cols);
  });
  const t = document.getElementById('edRejillaTxt');
  if(t) t.textContent = `${filas} × ${cols}`;
}
function editorInsertarTabla(filas, cols){
  const menu = document.getElementById('edTablaMenu');
  if(menu) menu.style.display = 'none';
  const borde = '1px solid #d0d0d0';
  let html = '<table style="border-collapse:collapse;width:100%;margin:10px 0;font-size:14px;" cellspacing="0" cellpadding="6">';
  for(let f = 0; f < filas; f++){
    html += '<tr>';
    for(let c = 0; c < cols; c++){
      html += (f === 0)
        ? `<th style="border:${borde};padding:6px 9px;background:#f3f4f6;text-align:left;font-weight:600;">Título ${c+1}</th>`
        : `<td style="border:${borde};padding:6px 9px;">&nbsp;</td>`;
    }
    html += '</tr>';
  }
  html += '</table><p><br></p>';
  editorInsertarHTML(html);
}
// Sube por el árbol hasta encontrar la etiqueta pedida
function editorAncestro(tag){
  const sel = window.getSelection();
  if(!sel || !sel.rangeCount) return null;
  let n = sel.getRangeAt(0).startContainer;
  const cuerpo = editorCuerpo();
  while(n && n !== cuerpo){
    if(n.nodeType === 1 && n.tagName === tag) return n;
    n = n.parentNode;
  }
  return null;
}
function editorFila(anadir){
  const celda = editorAncestro('TD') || editorAncestro('TH');
  if(!celda){ composeStatus('Coloca el cursor dentro de una tabla.'); return; }
  const fila = celda.parentNode, tabla = fila.closest('table');
  if(anadir){
    const nueva = fila.cloneNode(true);
    nueva.querySelectorAll('td,th').forEach(c=>{ c.innerHTML = '&nbsp;'; });
    fila.parentNode.insertBefore(nueva, fila.nextSibling);
  } else {
    if(tabla.rows.length <= 1){ composeStatus('La tabla se quedaría sin filas.'); return; }
    const idx = fila.rowIndex;
    fila.remove();
    // Sin esto el cursor queda huérfano y la siguiente acción sobre la tabla falla
    const destino = tabla.rows[Math.min(idx, tabla.rows.length - 1)];
    editorCursorEnCelda(destino && destino.cells[0]);
  }
}
function editorColumna(anadir){
  const celda = editorAncestro('TD') || editorAncestro('TH');
  if(!celda){ composeStatus('Coloca el cursor dentro de una tabla.'); return; }
  const idx = celda.cellIndex, tabla = celda.closest('table');
  [...tabla.rows].forEach(r=>{
    if(anadir){
      const ref = r.cells[idx];
      const nueva = ref.cloneNode(false);
      nueva.innerHTML = (ref.tagName === 'TH') ? 'Título' : '&nbsp;';
      r.insertBefore(nueva, ref.nextSibling);
    } else {
      if(r.cells.length > 1 && r.cells[idx]) r.cells[idx].remove();
    }
  });
  if(!anadir){
    const f = tabla.rows[0];
    editorCursorEnCelda(f && f.cells[Math.min(idx, f.cells.length - 1)]);
  }
}
function editorBorrarTabla(){
  const celda = editorAncestro('TD') || editorAncestro('TH');
  if(!celda){ composeStatus('Coloca el cursor dentro de una tabla.'); return; }
  celda.closest('table').remove();
  editorActualizarBarraTabla();
}
// Muestra los botones de tabla solo cuando el cursor está dentro de una
function editorActualizarBarraTabla(){
  const barra = document.getElementById('edTablaAcciones');
  if(!barra) return;
  const dentro = !!(editorAncestro('TD') || editorAncestro('TH'));
  barra.style.display = dentro ? 'flex' : 'none';
}

// ---- Firma ----
function editorFirma(){
  const sel = document.getElementById('cpFrom');
  const alias = composeAliasPorEmail(sel ? sel.value : emMyAddress());
  if(alias && alias.signature){ composeAplicarFirma(alias.signature); return; }
  if(_sendAsSinPermiso){
    composeStatus('Falta autorizar el acceso a tus firmas. Ve a Configuración → Google → Volver a autorizar.', 'aviso');
  } else {
    composeStatus('Esta dirección no tiene firma configurada en Gmail.', 'aviso');
  }
}

function editorLimpiar(){
  editorExec('removeFormat');
  editorExec('unlink');
}

function closeCompose(){
  _composeCtx = null;
  document.getElementById('modalRoot').innerHTML = '';
}

// ---- Envío ----
async function sendComposedEmail(){
  const to = document.getElementById('cpTo').value.trim();
  if(!to){ composeStatus('Falta el destinatario.', 'error'); return; }
  const cc = document.getElementById('cpCc').value.trim();
  const bcc = document.getElementById('cpBcc').value.trim();
  const subject = document.getElementById('cpSubject').value.trim();
  const bodyHtml = document.getElementById('cpBody').innerHTML;

  const btn = document.getElementById('cpSendBtn');
  btn.disabled = true; btn.textContent = 'Enviando…';

  const selFrom = document.getElementById('cpFrom');
  const aliasEnvio = composeAliasPorEmail(selFrom ? selFrom.value : '');

  // Solo se envía From si aporta algo: un nombre, o un alias distinto del
  // principal. Mandarlo con la dirección pelada haría que el destinatario
  // viera el correo SIN tu nombre, porque anula el que pondría Gmail.
  const fromHeader = (aliasEnvio && (aliasEnvio.displayName || !aliasEnvio.isPrimary))
    ? emFormatFrom(aliasEnvio) : '';

  const raw = emBuildRaw({
    from: fromHeader,
    to, cc, bcc, subject, bodyHtml,
    inReplyTo: _composeCtx ? _composeCtx.inReplyTo : '',
    references: _composeCtx ? _composeCtx.references : ''
  });
  const payload = { raw };
  if(_composeCtx && _composeCtx.threadId) payload.threadId = _composeCtx.threadId;

  async function intentar(){
    return fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${googleToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  try{
    let r = await intentar();
    if(r.status === 401){          // pase caducado: se renueva y se reintenta una vez
      await handleGoogleExpired();
      if(googleToken) r = await intentar();
    }
    if(!r.ok){
      const err = await r.json().catch(() => ({}));
      composeStatus('No se pudo enviar: ' + ((err.error && err.error.message) || ('HTTP ' + r.status)), 'error');
      btn.disabled = false; btn.textContent = 'Enviar';
      return;
    }
    closeCompose();
    setStatus('Correo enviado.');
    if(currentView === 'correo') loadGmailWidget();
  }catch(e){
    composeStatus('Error de red al enviar. Revisa la conexión e inténtalo de nuevo.', 'error');
    btn.disabled = false; btn.textContent = 'Enviar';
  }
}
