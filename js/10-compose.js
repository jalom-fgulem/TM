// Redacción de correo: nuevo, responder, responder a todos y reenviar
// Parte de la app TM. Script clásico: comparte ámbito global con el resto.

let _composeCtx = null;    // contexto del correo que se está redactando
let _currentEmailMsg = null; // último mensaje abierto en el panel de lectura
let _composeAdjuntos = [];   // archivos adjuntos del correo que se redacta
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
    // Gmail suele devolver la dirección principal SIN nombre para mostrar: ahí
    // usa el de la cuenta de Google, que desde fuera no se ve. Si lo dejáramos
    // vacío, el destinatario recibiría el correo con la dirección pelada y sin
    // tu nombre, así que se rellena con el de tu perfil.
    googleSendAs.forEach(a => { if(!(a.displayName || '').trim()) a.displayName = miNombreParaCorreo(); });
    _sendAsSinPermiso = false;
  }catch(e){}
}

// Tu nombre, buscándolo donde esté: primero el perfil de la app, luego el de
// la cuenta de Google con la que has entrado.
function miNombreParaCorreo(){
  const p = (typeof state !== 'undefined' && state.profile) || {};
  const delPerfil = [p.nombre, p.apellidos].filter(Boolean).join(' ').trim();
  if(delPerfil) return delPerfil;
  const meta = (sbSession && sbSession.user && sbSession.user.user_metadata) || {};
  return (meta.full_name || meta.name || '').trim();
}

// Lista utilizable siempre, aunque no hayamos podido leer los alias
function composeAliasDisponibles(){
  if(googleSendAs.length) return googleSendAs;
  // Sin permiso para leer los alias, al menos usamos el nombre del perfil de
  // Google que viene con la sesión.
  const meta = (sbSession && sbSession.user && sbSession.user.user_metadata) || {};
  return [{
    sendAsEmail: emMyAddress(),
    displayName: miNombreParaCorreo() || meta.full_name || meta.name || '',
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

// Las cabeceras de un correo solo admiten caracteres ingleses. Un nombre con
// tilde o eñe hay que codificarlo igual que el asunto; si va en crudo, el que
// lo recibe ve "JosÃ©" o cosas peores. Le pasaba a Para, Cc y Cco.
const _NOMBRE_CON_SIGNOS = /[()<>@,;:\\".\[\]]/;
function emEncodeAddressList(lista){
  if(!lista || !lista.trim()) return '';
  return emSplitAddresses(lista).map(dir => {
    const m = dir.match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/);
    if(!m) return dir.trim();                       // solo la dirección: ya es válida
    const correo = m[2].trim();
    const nombre = m[1].replace(/^"(.*)"$/, '$1').trim();
    if(!nombre) return '<' + correo + '>';
    if(/^[\x00-\x7F]*$/.test(nombre)){
      // Inglés puro: basta con entrecomillar si lleva comas, puntos o similares
      return (_NOMBRE_CON_SIGNOS.test(nombre) ? '"' + nombre.replace(/"/g, '') + '"' : nombre) + ' <' + correo + '>';
    }
    return emEncodeSubject(nombre) + ' <' + correo + '>';
  }).join(', ');
}

// "José Carlos <jc@x.es>" -> el nombre necesita codificarse si lleva acentos
function emFormatFrom(alias){
  if(!alias) return '';
  const nombre = (alias.displayName || '').trim();
  if(!nombre) return alias.sendAsEmail;
  return emEncodeSubject(nombre) + ' <' + alias.sendAsEmail + '>';
}

// Devuelve el correo completo en texto plano (formato RFC 822)
function emBuildMime(o){
  const adj = o.adjuntos || [];
  const l = [];
  if(o.from) l.push('From: ' + o.from);
  l.push('To: ' + emEncodeAddressList(o.to));
  if(o.cc)  l.push('Cc: '  + emEncodeAddressList(o.cc));
  if(o.bcc) l.push('Bcc: ' + emEncodeAddressList(o.bcc));
  l.push('Subject: ' + emEncodeSubject(o.subject));
  if(o.inReplyTo){
    l.push('In-Reply-To: ' + o.inReplyTo);
    l.push('References: ' + (o.references ? o.references + ' ' + o.inReplyTo : o.inReplyTo));
  }
  l.push('MIME-Version: 1.0');

  const cuerpoB64 = emB64(o.bodyHtml || '').replace(/(.{76})/g, '$1\r\n');

  if(!adj.length){
    l.push('Content-Type: text/html; charset="UTF-8"');
    l.push('Content-Transfer-Encoding: base64');
    l.push('');
    l.push(cuerpoB64);
    return l.join('\r\n');
  }

  // Con adjuntos: el correo se parte en trozos separados por una marca única
  const marca = 'tm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  l.push(`Content-Type: multipart/mixed; boundary="${marca}"`);
  l.push('');
  l.push(`--${marca}`);
  l.push('Content-Type: text/html; charset="UTF-8"');
  l.push('Content-Transfer-Encoding: base64');
  l.push('');
  l.push(cuerpoB64);

  adj.forEach(a => {
    l.push(`--${marca}`);
    l.push(`Content-Type: ${a.tipo || 'application/octet-stream'}; name="${a.nombre.replace(/"/g,'')}"`);
    l.push(`Content-Disposition: attachment; filename="${a.nombre.replace(/"/g,'')}"`);
    l.push('Content-Transfer-Encoding: base64');
    l.push('');
    l.push(a.datos.replace(/(.{76})/g, '$1\r\n'));
  });
  l.push(`--${marca}--`);
  return l.join('\r\n');
}
function emBuildRaw(o){ return emB64Url(emBuildMime(o)); }

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
  const firmaGuardada = (typeof firmaParaAlias === 'function')
    ? firmaParaAlias(aliasElegido ? aliasElegido.sendAsEmail : '') : null;
  const firmaHtml = firmaGuardada ? firmaGuardada.html
                  : (aliasElegido && aliasElegido.signature) ? aliasElegido.signature : '';
  const firma = firmaHtml ? `<div class="firma-insertada" data-firma="1">${firmaHtml}</div>` : '';
  cuerpo = (modo === 'nuevo') ? '<br>' + firma : '<br><br>' + firma + emQuoteOriginal(msg);

  _composeAdjuntos = [];
  _composeCtx = { modo, inReplyTo, references, threadId, cuerpoInicial: cuerpo };

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
            <button class="cw-close" onclick="composeElegirAdjuntos()" title="Adjuntar archivos">
              <i class="ti ti-paperclip" aria-hidden="true"></i>
            </button>
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
        <div class="cp-adjuntos" id="cpAdjuntos" style="display:none;"></div>

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
    const mf = document.getElementById('edFirmaMenu');
    if(mf && !e.target.closest('#edFirmaMenu') && !e.target.closest('[onclick*="editorAbrirFirmas"]')){
      mf.style.display = 'none';
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
    <button type="button" onclick="editorAbrirFirmas(event)" title="Insertar firma"><i class="ti ti-signature" aria-hidden="true"></i></button>
    <span class="ed-sep"></span>
    <button type="button" id="edMic" class="ed-mic" onclick="dictarEnRedactor()" title="Dictar el texto" aria-label="Dictar el texto"><i class="ti ti-microphone" aria-hidden="true"></i></button>
    <button type="button" onclick="editorLimpiar()" title="Quitar todo el formato"><i class="ti ti-clear-formatting" aria-hidden="true"></i></button>
  </div>
  <div class="ed-tabla-menu" id="edTablaMenu" style="display:none;"></div>
  <div class="ed-firma-menu" id="edFirmaMenu" style="display:none;"></div>
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

// ---- Dictado dentro del redactor ----
// El cuerpo del correo no es una caja de texto normal, sino contenido con
// formato, así que lo dictado se escribe en la posición del cursor.
function dictarEnRedactor(){
  const cuerpo = editorCuerpo(); if(!cuerpo) return;
  cuerpo.focus();
  dictarTexto({
    btnId: 'edMic',
    escribir: texto => {
      const sel = cuerpo.ownerDocument.getSelection();
      let rango = (sel && sel.rangeCount && cuerpo.contains(sel.anchorNode)) ? sel.getRangeAt(0) : null;
      if(!rango){                                   // sin cursor dentro: al final
        rango = cuerpo.ownerDocument.createRange();
        rango.selectNodeContents(cuerpo);
        rango.collapse(false);
      }
      rango.deleteContents();
      const nodo = cuerpo.ownerDocument.createTextNode(texto);
      rango.insertNode(nodo);
      rango.setStartAfter(nodo); rango.collapse(true);
      if(sel){ sel.removeAllRanges(); sel.addRange(rango); }
    },
    aviso: (m, t) => composeStatus(m, t)
  });
}

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
  const propia = (typeof firmaParaAlias === 'function') ? firmaParaAlias(sel.value) : null;
  if(propia){ composeAplicarFirma(propia.html); return; }
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
// Menú para elegir entre las firmas guardadas
function editorAbrirFirmas(ev){
  if(ev) ev.stopPropagation();
  const menu = document.getElementById('edFirmaMenu'); if(!menu) return;
  if(menu.style.display !== 'none'){ menu.style.display = 'none'; return; }

  const lista = (typeof firmasLista === 'function') ? firmasLista() : [];
  const selFrom = document.getElementById('cpFrom');
  const alias = selFrom ? selFrom.value : '';

  if(!lista.length){
    const deGmail = composeAliasPorEmail(alias);
    if(deGmail && deGmail.signature){ composeAplicarFirma(deGmail.signature); return; }
    composeStatus('No hay firmas configuradas. Ve a Configuración → Firmas de correo.', 'aviso');
    return;
  }

  // Primero las de la dirección desde la que escribes
  const propias = lista.filter(f => (f.alias || '').toLowerCase() === (alias || '').toLowerCase());
  const generales = lista.filter(f => !f.alias && !propias.includes(f));
  const resto = lista.filter(f => !propias.includes(f) && !generales.includes(f));
  const ordenadas = [...propias, ...generales, ...resto];

  menu.innerHTML = ordenadas.map(f => `
    <button type="button" class="ed-firma-op" onclick="editorElegirFirma('${f.id}')">
      <span class="ed-firma-nombre">${escapeHtml(f.nombre || 'Sin nombre')}</span>
      ${f.alias ? `<span class="ed-firma-alias">${escapeHtml(f.alias)}</span>` : ''}
    </button>`).join('')
    + `<button type="button" class="ed-firma-op quitar" onclick="editorElegirFirma('')">Quitar la firma</button>`;
  menu.style.display = 'block';
}
function editorElegirFirma(id){
  const menu = document.getElementById('edFirmaMenu');
  if(menu) menu.style.display = 'none';
  if(!id){ composeAplicarFirma(''); return; }
  const f = firmasLista().find(x => x.id === id);
  if(f) composeAplicarFirma(f.html);
}

function editorLimpiar(){
  editorExec('removeFormat');
  editorExec('unlink');
}

// ---- Cierre con opción de guardar borrador ----
// Compara con el contenido inicial para saber si de verdad has escrito algo:
// la firma y la cita del original no cuentan como texto tuyo.
function composeTieneContenido(){
  const val = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  if(val('cpTo') || val('cpCc') || val('cpBcc') || val('cpSubject')) return true;
  if(_composeAdjuntos.length) return true;
  const body = editorCuerpo();
  if(!body || !_composeCtx) return false;
  return body.innerHTML.trim() !== (_composeCtx.cuerpoInicial || '').trim();
}

function closeCompose(forzar){
  if(!forzar && composeTieneContenido()){ preguntarPorBorrador(); return; }
  _composeCtx = null;
  document.getElementById('modalRoot').innerHTML = '';
}

function preguntarPorBorrador(){
  if(document.getElementById('cpDraftAsk')) return;
  const caja = document.createElement('div');
  caja.className = 'cw-ask';
  caja.id = 'cpDraftAsk';
  caja.innerHTML = `
    <div class="cw-ask-box">
      <h4>¿Guardar el borrador?</h4>
      <p>Has empezado a escribir este correo. Puedes guardarlo en tus borradores de Gmail y seguir más tarde.</p>
      <div class="cw-ask-actions">
        <button class="btn-ghost btn-small" onclick="document.getElementById('cpDraftAsk').remove()">Seguir escribiendo</button>
        <button class="btn-ghost btn-small cw-ask-descartar" onclick="closeCompose(true)">Descartar</button>
        <button class="btn-primary btn-small" onclick="guardarBorrador()">Guardar borrador</button>
      </div>
    </div>`;
  document.querySelector('.compose-window').appendChild(caja);
}

async function guardarBorrador(){
  const ask = document.getElementById('cpDraftAsk');
  if(ask) ask.remove();
  composeStatus('Guardando borrador…');

  const val = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const selFrom = document.getElementById('cpFrom');
  const aliasEnvio = composeAliasPorEmail(selFrom ? selFrom.value : '');
  const fromHeader = (aliasEnvio && (aliasEnvio.displayName || !aliasEnvio.isPrimary))
    ? emFormatFrom(aliasEnvio) : '';

  const raw = emBuildRaw({
    from: fromHeader,
    to: val('cpTo'), cc: val('cpCc'), bcc: val('cpBcc'),
    subject: val('cpSubject'),
    bodyHtml: editorCuerpo().innerHTML,
    inReplyTo: _composeCtx ? _composeCtx.inReplyTo : '',
    references: _composeCtx ? _composeCtx.references : '',
    adjuntos: _composeAdjuntos
  });
  const mensaje = { raw };
  if(_composeCtx && _composeCtx.threadId) mensaje.threadId = _composeCtx.threadId;

  const enviar = () => fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${googleToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: mensaje })
  });

  try{
    let r = await enviar();
    if(r.status === 401){ await handleGoogleExpired(); if(googleToken) r = await enviar(); }
    if(!r.ok){
      const err = await r.json().catch(() => ({}));
      composeStatus('No se pudo guardar el borrador: ' + ((err.error && err.error.message) || ('HTTP ' + r.status)), 'error');
      return;
    }
    closeCompose(true);
    setStatus('Borrador guardado en Gmail.');
  }catch(e){
    composeStatus('Error de red al guardar el borrador.', 'error');
  }
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

  const datos = {
    from: fromHeader,
    to, cc, bcc, subject, bodyHtml,
    inReplyTo: _composeCtx ? _composeCtx.inReplyTo : '',
    references: _composeCtx ? _composeCtx.references : '',
    adjuntos: _composeAdjuntos
  };
  const mime = emBuildMime(datos);

  // Por debajo de 4 MB se envía como texto dentro de la petición, que permite
  // indicar la conversación. Por encima hay que usar el extremo de subida, que
  // no la admite: ahí el hilo lo mantienen las cabeceras In-Reply-To.
  const grande = mime.length > 4 * 1024 * 1024;

  async function intentar(){
    if(grande){
      return fetch('https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media', {
        method: 'POST',
        headers: { Authorization: `Bearer ${googleToken}`, 'Content-Type': 'message/rfc822' },
        body: mime
      });
    }
    const payload = { raw: emB64Url(mime) };
    if(_composeCtx && _composeCtx.threadId) payload.threadId = _composeCtx.threadId;
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
    closeCompose(true);
    setStatus('Correo enviado.');
    if(currentView === 'correo') loadGmailWidget();
  }catch(e){
    // Puede que la petición llegara y solo se perdiera la respuesta. Antes de
    // invitar a reintentar —lo que enviaría el correo dos veces— se comprueba
    // si de verdad salió.
    composeStatus('Comprobando si el correo llegó a salir…');
    const salio = await comprobarSiSalio(subject);
    if(salio){
      closeCompose(true);
      setStatus('El correo sí se envió; solo se perdió la confirmación.');
      if(currentView === 'correo') loadGmailWidget();
      return;
    }
    composeStatus('No se pudo enviar. Revisa la conexión e inténtalo de nuevo.', 'error');
    btn.disabled = false; btn.textContent = 'Enviar';
  }
}

// Busca en Enviados un correo con ese asunto de hace menos de tres minutos
async function comprobarSiSalio(subject){
  if(!subject || !googleToken) return false;
  try{
    const consulta = `in:sent subject:"${subject.replace(/"/g, '')}"`;
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(consulta)}&maxResults=3`,
      { headers: { Authorization: `Bearer ${googleToken}` } });
    if(!r.ok) return false;
    const lista = (await r.json()).messages || [];
    if(!lista.length) return false;
    const det = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${lista[0].id}?format=minimal`,
      { headers: { Authorization: `Bearer ${googleToken}` } });
    if(!det.ok) return false;
    const m = await det.json();
    return (Date.now() - Number(m.internalDate || 0)) < 3 * 60 * 1000;
  }catch(e){ return false; }
}

// ============================================================
//  ADJUNTOS
// ============================================================

const ADJ_LIMITE_TOTAL = 24 * 1024 * 1024;   // 🔧 PERSONALIZAR: tope conjunto

function composeElegirAdjuntos(){
  let input = document.getElementById('cpFiles');
  if(!input){
    input = document.createElement('input');
    input.type = 'file'; input.multiple = true; input.id = 'cpFiles';
    input.style.display = 'none';
    input.addEventListener('change', () => composeAnadirAdjuntos(input.files));
    document.querySelector('.compose-window').appendChild(input);
  }
  input.value = '';
  input.click();
}

async function composeAnadirAdjuntos(archivos){
  const lista = [...(archivos || [])];
  if(!lista.length) return;
  composeStatus('Preparando adjuntos…');

  for(const f of lista){
    const yaHay = _composeAdjuntos.reduce((t, a) => t + a.bytes, 0);
    if(yaHay + f.size > ADJ_LIMITE_TOTAL){
      composeStatus(`"${f.name}" no cabe: el conjunto no puede pasar de ${Math.round(ADJ_LIMITE_TOTAL/1024/1024)} MB.`, 'error');
      continue;
    }
    try{
      const datos = await leerArchivoBase64(f);
      _composeAdjuntos.push({ nombre: f.name, tipo: f.type || 'application/octet-stream', bytes: f.size, datos });
    }catch(e){
      composeStatus(`No se pudo leer "${f.name}".`, 'error');
    }
  }
  renderAdjuntosCompose();
  composeStatus('');
}

function leerArchivoBase64(f){
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader();
    lector.onload = () => {
      // El resultado viene como "data:tipo;base64,XXXX"; nos quedamos con XXXX
      const r = String(lector.result);
      resolver(r.slice(r.indexOf(',') + 1));
    };
    lector.onerror = rechazar;
    lector.readAsDataURL(f);
  });
}

function tamañoLegible(bytes){
  if(bytes < 1024) return bytes + ' B';
  if(bytes < 1024*1024) return Math.round(bytes/1024) + ' KB';
  return (bytes/1024/1024).toFixed(1).replace('.', ',') + ' MB';
}

function renderAdjuntosCompose(){
  const zona = document.getElementById('cpAdjuntos');
  if(!zona) return;
  if(!_composeAdjuntos.length){ zona.innerHTML = ''; zona.style.display = 'none'; return; }
  zona.style.display = '';
  const total = _composeAdjuntos.reduce((t, a) => t + a.bytes, 0);
  zona.innerHTML = `
    <div class="cp-adj-titulo"><i class="ti ti-paperclip" aria-hidden="true"></i> ${_composeAdjuntos.length} adjunto${_composeAdjuntos.length>1?'s':''} · ${tamañoLegible(total)}</div>
    <div class="cp-adj-lista">
      ${_composeAdjuntos.map((a, i) => `
        <span class="cp-adj">
          <i class="ti ${attachmentIcon(a.tipo)}" aria-hidden="true"></i>
          <span class="cp-adj-nombre" title="${escapeAttr(a.nombre)}">${escapeHtml(a.nombre)}</span>
          <span class="cp-adj-peso">${tamañoLegible(a.bytes)}</span>
          <button type="button" onclick="quitarAdjunto(${i})" title="Quitar">✕</button>
        </span>`).join('')}
    </div>`;
}
function quitarAdjunto(i){
  _composeAdjuntos.splice(i, 1);
  renderAdjuntosCompose();
}

// ============================================================
//  ARRASTRAR ARCHIVOS DESDE EL FINDER AL REDACTOR
//
//  Se añade además una protección de alcance general: si sueltas un archivo
//  fuera del redactor, el navegador lo abriría en la pestaña y perderías lo
//  que estuvieras escribiendo. Aquí se impide.
// ============================================================

function _arrastraArchivos(e){
  const t = e.dataTransfer && e.dataTransfer.types;
  return !!t && Array.from(t).includes('Files');
}
// El objetivo de un evento no siempre es un elemento (puede ser window o el
// propio documento), y entonces closest() no existe.
function _dentroDelRedactor(destino){
  return !!(destino && typeof destino.closest === 'function' && destino.closest('.compose-window'));
}

// Red de seguridad: ningún archivo suelto navega fuera de la aplicación
window.addEventListener('dragover', e => { if(_arrastraArchivos(e)) e.preventDefault(); });
window.addEventListener('drop',     e => { if(_arrastraArchivos(e) && !_dentroDelRedactor(e.target)) e.preventDefault(); });

let _contadorArrastre = 0;   // dragenter/dragleave saltan también en los hijos

document.addEventListener('dragenter', e => {
  if(!_arrastraArchivos(e)) return;
  const ventana = document.querySelector('.compose-window');
  if(!ventana) return;
  _contadorArrastre++;
  if(!document.getElementById('cpSoltar')){
    const capa = document.createElement('div');
    capa.className = 'cp-soltar';
    capa.id = 'cpSoltar';
    capa.innerHTML = `<div class="cp-soltar-caja">
      <i class="ti ti-paperclip" aria-hidden="true"></i>
      <span>Suelta los archivos para adjuntarlos</span>
    </div>`;
    ventana.appendChild(capa);
  }
});

document.addEventListener('dragleave', e => {
  if(!_arrastraArchivos(e)) return;
  _contadorArrastre--;
  if(_contadorArrastre <= 0){ _contadorArrastre = 0; quitarCapaSoltar(); }
});

document.addEventListener('drop', async e => {
  if(!_arrastraArchivos(e)) return;
  _contadorArrastre = 0;
  quitarCapaSoltar();
  if(!_dentroDelRedactor(e.target)) return;  // fuera del redactor no se hace nada
  e.preventDefault();
  const archivos = e.dataTransfer.files;
  if(archivos && archivos.length) await composeAnadirAdjuntos(archivos);
});

function quitarCapaSoltar(){
  const c = document.getElementById('cpSoltar');
  if(c) c.remove();
}

// Pegar archivos o capturas de pantalla: van como adjunto, no incrustados.
// Las imágenes pegadas dentro del texto viajan como datos en el propio HTML y
// la mayoría de gestores de correo las bloquean o las descartan.
document.addEventListener('paste', async e => {
  if(!document.querySelector('.compose-window')) return;
  const items = e.clipboardData && e.clipboardData.files;
  if(!items || !items.length) return;
  e.preventDefault();
  await composeAnadirAdjuntos(items);
  composeStatus(`${items.length} archivo${items.length>1?'s':''} adjuntado${items.length>1?'s':''} desde el portapapeles.`);
});
